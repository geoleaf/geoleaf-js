/**
 * @fileoverview Plugin discovery for the deploy build — the descriptor replaces the constants.
 *
 * ## What this closes
 *
 * Adding a plugin used to mean editing files that do not belong to it: `build-deploy.cjs`
 * carried one `DIST_*` constant and one ~15-line copy block per plugin — twelve of each —
 * so the build's knowledge of the plugin fleet lived as a hand-maintained list in a script
 * that grew by hundreds of lines a week. A hand-maintained list does not fail when it goes
 * stale; it silently stops matching, and the artefact ships without the bundle.
 *
 * The single source is now the plugin's OWN `package.json`, under the `geoleaf` key:
 *
 *     "geoleaf": {
 *         "bundle": "geoleaf-<dir>.plugin.js",   // the built entry this plugin ships as
 *         "lazyChunks": false,                   // code-splitting emits side chunks to copy
 *         "includeFlag": null                    // null = every variant; otherwise the
 *     }                                          //   variant flag that opts it in
 *
 * ## Why every field is REQUIRED, including the ones that are usually defaulted
 *
 * A defaulted field cannot distinguish "the author decided" from "the author forgot". For a
 * build manifest that decides what ships to a client, that distinction is the whole point:
 * a forgotten `includeFlag` defaulting to "always" would ship an optional plugin everywhere,
 * and a forgotten `lazyChunks` defaulting to false would drop the code-split chunks of a
 * plugin that has them — a deploy whose first tool click 404s, exit code 0.
 *
 * ## What this module does NOT decide
 *
 * Which variant sets which flag stays in `build-deploy.cjs`: the variant matrix is a property
 * of the DELIVERABLES, not of any plugin. And the app-side boot wiring (`init.js`) is not
 * generated from these descriptors — deliberately: its plugin zone is one-third comments
 * encoding paid incidents, and a generator would either lose them or freeze them. The
 * descriptor↔boot drift is closed by a parity check instead (`verify-app-template.cjs`).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./packages.cjs");

/** Variant flags a descriptor may name — the whole matrix, kept in one place. */
const KNOWN_INCLUDE_FLAGS = new Set(["includeStorage", "includeCog", "includeEditor"]);

/**
 * Fewer discovered plugins than this is a broken registry, not a slimmed-down repository.
 * A discovery that returns an empty (or nearly empty) fleet would make the copy loop below
 * it a green no-op — the exact failure mode the old `throw`-on-missing constants closed.
 */
const FLEET_FLOOR = 10;

/**
 * Discovers the plugin fleet from the workspace registry and each plugin's descriptor.
 *
 * @returns {Array<{id: string, name: string, dist: string, bundle: string,
 *   lazyChunks: boolean, includeFlag: string|null}>} One entry per published plugin,
 *   sorted by directory name so the build log order is stable across runs.
 * @throws {Error} On a missing or malformed descriptor — a plugin the build cannot
 *   describe must stop the build, not ship half-configured.
 */
function discoverPlugins() {
    const fleet = registry.plugins().map((pkg) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(pkg.absDir, "package.json"), "utf8"));
        const d = manifest.geoleaf;
        if (!d || typeof d !== "object") {
            throw new Error(
                `discover-plugins: ${pkg.name} has no "geoleaf" descriptor in its package.json. ` +
                    `Every published plugin must describe how it ships (bundle, lazyChunks, includeFlag).`
            );
        }
        const dirName = path.basename(pkg.absDir);
        if (typeof d.bundle !== "string" || !/^geoleaf-[a-z0-9-]+\.plugin\.js$/.test(d.bundle)) {
            throw new Error(
                `discover-plugins: ${pkg.name} declares bundle "${d.bundle}" — expected the ` +
                    `built entry name, of the form "geoleaf-<name>.plugin.js".`
            );
        }
        if (typeof d.lazyChunks !== "boolean") {
            throw new Error(
                `discover-plugins: ${pkg.name} must declare "lazyChunks" as a boolean. A default ` +
                    `here could not distinguish "decided" from "forgotten", and a forgotten true ` +
                    `ships a plugin whose first dynamic import 404s.`
            );
        }
        if (d.includeFlag !== null && !KNOWN_INCLUDE_FLAGS.has(d.includeFlag)) {
            throw new Error(
                `discover-plugins: ${pkg.name} declares includeFlag "${d.includeFlag}" — ` +
                    `expected null (ships in every variant) or one of: ` +
                    `${[...KNOWN_INCLUDE_FLAGS].join(", ")}.`
            );
        }
        return {
            id: dirName,
            name: pkg.name,
            dist: path.join(pkg.absDir, "dist"),
            bundle: d.bundle,
            lazyChunks: d.lazyChunks,
            includeFlag: d.includeFlag,
        };
    });

    if (fleet.length < FLEET_FLOOR) {
        throw new Error(
            `discover-plugins: only ${fleet.length} plugin(s) discovered (floor ${FLEET_FLOOR}). ` +
                `A fleet this small is a broken registry or a moved directory, not a cleaned-up ` +
                `repository — refusing to let the copy loop run green over it.`
        );
    }

    return fleet.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { discoverPlugins, KNOWN_INCLUDE_FLAGS };
