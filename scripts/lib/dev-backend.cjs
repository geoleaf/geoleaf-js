"use strict";
/**
 * dev-backend.cjs — the PROOF backend does not ship to a client.
 *
 * ## The fact
 *
 * `profiles/tourism/layers/sites_rosario/` is the proof layer of the offline cycle: it is
 * the repo's first layer to declare an offline read, a pull source and a write block. Its
 * three bindings target the backend mounted by `docker-compose.dev.yml` (pygeoapi +
 * PostgREST behind Traefik), which **only resolves on the development machine**.
 *
 * Those bindings used to be copied verbatim into `deploy-core` and `deploy-full`, hence
 * into what ships to a client — where they can only fail. Display was never at stake: the
 * layer carries a local `data.file`, it paints without network. What shipped dead was the
 * pull and the write.
 *
 * ## Why a list of NAMED hosts, and emphatically not an allowlist
 *
 * The first reflex is to allow the known providers (IGN tiles, ArcGIS, GBIF…) and strip the
 * rest. **That is the wrong direction, and a dangerous one**: the day a client profile
 * declares a legitimate production backend, an allowlist would **silently** remove it from
 * a deliverable, and the defect would only show in operation.
 *
 * The rule is therefore inverted: we name the small set of hosts that have no business
 * outside, and **everything else passes**. A false negative (a dev host forgotten here)
 * shows at the first try on the client's side; a false positive would have broken a
 * legitimate profile without a word.
 *
 * ⚠️ The removal is scoped to the BINDING KEYS — `offline.source`, `write.endpoint`,
 * `options.uploadEndpoint`. It never touches `data.*` nor the basemaps: a tile provider is
 * not a backend, and conflating the two would empty the profiles.
 */

/**
 * Proof-backend hosts — mounted by `docker-compose.dev.yml`, routed by Traefik, and
 * resolved only by the machine's `hosts` file. Unreachable anywhere else.
 *
 * ⚠️ Adding a host here is a DELIVERY-SAFETY move, not configuration: everything listed
 * here is stripped from what ships to a client.
 */
const DEV_BACKEND_HOSTS = ["qgis.geoleaf.dev"];

/**
 * @param {unknown} value
 * @returns {boolean} `true` if the value is an absolute URL to a proof backend.
 */
function isDevBackendUrl(value) {
    if (typeof value !== "string") return false;
    let host;
    try {
        host = new URL(value).hostname;
    } catch {
        return false; // relative path or non-URL value: out of scope
    }
    return DEV_BACKEND_HOSTS.includes(host);
}

/**
 * Strips a profile's bindings to the proof backend, or repoints them to a backend
 * supplied at build time.
 *
 * The walk is recursive because the same shape appears at two depths: in the layer file
 * (`layers/<id>/<id>_config.json`) and in the aggregated bundle (`profile-bundle.json`),
 * which is a copy of it. Handling one without the other would leave the binding alive in
 * the second — and the second is what the loader reads.
 *
 * ## What "strip" means, precisely
 *
 *   • `offline.source`        → REMOVED. `offline.enabled` stays true: the loader then falls
 *                               back on `data.file`, and a requested pull refuses cleanly
 *                               with a named reason instead of knocking on a dead host.
 *   • `write.endpoint`        → REMOVED, and `write.enabled` flips to `false`.
 *                               🛑 Both together, never one without the other: an
 *                               `enabled: true` with no target promises an impossible
 *                               write, which is worse than the feature's absence — the
 *                               user loses their input.
 *   • `options.uploadEndpoint` → REMOVED in the SAME layer object, because the upload is
 *                               served by the backend we just stripped. It was
 *                               `/api/upload`, root-absolute, hence wrong twice: it targets
 *                               the serving origin and not the backend, and it breaks under
 *                               a sub-directory.
 *
 * @param {any} node Root of the profile JSON (mutated in place).
 * @param {string | null} backendBaseUrl Replacement origin, or `null` to strip.
 * @returns {number} Number of bindings handled.
 */
function stripDevBackendBindings(node, backendBaseUrl = null) {
    let touched = 0;

    /** @param {any} obj */
    function walk(obj) {
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        if (!obj || typeof obj !== "object") return;

        // A layer object is dev-bound if either of its two bindings targets a proof host.
        // THIS predicate, and not the presence of an `uploadEndpoint`, is what authorizes
        // removing the third: otherwise we would strip a client profile's upload with no
        // reason.
        const sourceUrl = obj.offline?.source?.url;
        const writeUrl = obj.write?.endpoint;
        const devBound = isDevBackendUrl(sourceUrl) || isDevBackendUrl(writeUrl);

        if (devBound) {
            if (backendBaseUrl) {
                if (isDevBackendUrl(sourceUrl)) {
                    obj.offline.source.url = rehost(sourceUrl, backendBaseUrl);
                    touched += 1;
                }
                if (isDevBackendUrl(writeUrl)) {
                    obj.write.endpoint = rehost(writeUrl, backendBaseUrl);
                    touched += 1;
                }
            } else {
                if (isDevBackendUrl(sourceUrl)) {
                    delete obj.offline.source;
                    touched += 1;
                }
                if (isDevBackendUrl(writeUrl)) {
                    delete obj.write.endpoint;
                    obj.write.enabled = false;
                    touched += 1;
                }
            }
            // 🛑 BOTH BRANCHES — AND THE FIRST VERSION ONLY CALLED IT IN THE SECOND.
            // Measured on 2026-08-09: repointed to an explicit backend, the profile came
            // out with `uploadEndpoint: "/api/upload"` intact — root-absolute, hence
            // targeting the serving origin and not the backend just named. The documented
            // escape hatch reproduced the very defect it exists to work around, and
            // nothing would have said so: the upload only fails the moment someone
            // attaches a photo.
            touched += stripUploadEndpoints(obj, backendBaseUrl);
        }

        for (const value of Object.values(obj)) walk(value);
    }

    walk(node);
    return touched;
}

/**
 * Strips every `options.uploadEndpoint` under a layer object already known dev-bound.
 * @param {any} node
 * @param {string | null} backendBaseUrl
 * @returns {number}
 */
function stripUploadEndpoints(node, backendBaseUrl) {
    let n = 0;
    /** @param {any} obj */
    function walk(obj) {
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        if (!obj || typeof obj !== "object") return;
        if (typeof obj.uploadEndpoint === "string") {
            if (backendBaseUrl) obj.uploadEndpoint = joinUrl(backendBaseUrl, obj.uploadEndpoint);
            else delete obj.uploadEndpoint;
            n += 1;
        }
        for (const value of Object.values(obj)) walk(value);
    }
    walk(node);
    return n;
}

/**
 * Replaces the origin of an absolute URL while keeping path and query.
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
function rehost(url, baseUrl) {
    const parsed = new URL(url);
    return joinUrl(baseUrl, parsed.pathname + parsed.search);
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @returns {string}
 */
function joinUrl(baseUrl, pathname) {
    return `${baseUrl.replace(/\/+$/, "")}/${String(pathname).replace(/^\/+/, "")}`;
}

module.exports = {
    DEV_BACKEND_HOSTS,
    isDevBackendUrl,
    stripDevBackendBindings,
};
