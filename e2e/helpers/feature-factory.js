// @ts-check
// Synthetic GeoJSON generator for the scale bench — ONE algebra, two consumers.
//
// WHY THIS FILE EXISTS. The same loop was written FIVE times, and no two copies
// agreed: `06-performance-baseline.spec.js` builds it at §6.2.2 with
// `{id, name}`, at §6.2.3 with `{id}`, at §6.2.4 with `{id, name, category}`, at
// §6.2.6 with `{id}` again, and `scripts/probe-heap-metrics.mjs` carries a fifth.
// Three consequences, all measured rather than feared:
//   1. The doses are NOT comparable to each other. A property costs memory and
//      costs worker serialisation; comparing a §6.2.2 timing to a §6.2.4 heap is
//      comparing two different payloads that share a count.
//   2. Every copy draws `Math.random()`, so NO measurement is replayable. A band
//      derived from a run cannot be re-derived from the same run.
//   3. A sixth copy — which is what a new bench naively adds — would make the
//      problem worse while claiming to measure it.
//
// HOW THE SAME CODE RUNS ON BOTH SIDES. The generator is a self-contained
// function: it closes over nothing, so `Function.prototype.toString()` yields a
// source the page can define verbatim. Node calls it directly (to serve a body
// through `page.route()`, i.e. THROUGH the real loader's fetch); the page calls
// the injected twin (for the blocks that build in-place). Two call sites, one
// algorithm — the property the five copies did not have.
//
// ⚠️ NOTHING BULKY EVER ENTERS GIT. 100,000 features with 11 properties is tens
// of megabytes; it is generated per run, never committed. The seed is what makes
// that safe: the bytes are reproducible without being stored.

/**
 * @typedef {object} FeatureFactoryOptions
 * @property {number} count            How many features.
 * @property {"Point"|"LineString"|"Polygon"|"mixed"} [geometry]  Default `"Point"`.
 * @property {number} [properties]     Extra property count beyond `id`. Default `10` (→ 11 total).
 * @property {[number, number, number, number]} [bounds]  `[west, south, east, north]`.
 * @property {number} [seed]           PRNG seed. Same seed ⇒ same bytes.
 * @property {number} [clumps]         Cluster the features into N clumps. `0` = uniform.
 * @property {string} [idPrefix]       When set, ids are `<prefix><n>` strings instead of numbers.
 */

/**
 * Builds a FeatureCollection whose every feature carries a UNIQUE id, on BOTH
 * `feature.id` and `properties.id`.
 *
 * 🛑 The duplication is the point, and it is not belt-and-braces. `promoteId: "id"`
 * reads `properties.id`; `GeoJSONSource.updateData(diff)` addresses features by the
 * id MapLibre resolved; and the repo's own matchers read `id ?? properties.id` in
 * one place and `properties.id ?? id` in another. Writing one of the two would make
 * the generator agree with half the readers. `poi-to-feature.ts` already sets both,
 * for the same reason.
 *
 * ⚠️ Self-contained ON PURPOSE — no import, no outer binding, no optional chaining
 * on the hot path. `BROWSER_SOURCE` below is literally this function's source, so
 * anything it closes over would be `undefined` in the page.
 *
 * @param {FeatureFactoryOptions} options
 * @returns {{ type: "FeatureCollection", features: any[] }}
 */
function makeFeatureCollection(options) {
    const count = options.count;
    const geometry = options.geometry || "Point";
    const propCount = typeof options.properties === "number" ? options.properties : 10;
    const bounds = options.bounds || [-5, 41, 10, 51];
    const clumps = typeof options.clumps === "number" ? options.clumps : 0;
    const idPrefix = options.idPrefix;

    // mulberry32 — 32-bit, seeded, no dependency. Chosen over `Math.random()` for
    // the single property that matters here: a band derived from a run must be
    // re-derivable from that run. An unseeded generator makes every threshold
    // unfalsifiable, which is the failure this repo files as "invérifiable, donc
    // infalsifiable".
    let state = (typeof options.seed === "number" ? options.seed : 1) >>> 0;
    function rnd() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const west = bounds[0];
    const south = bounds[1];
    const spanX = bounds[2] - bounds[0];
    const spanY = bounds[3] - bounds[1];

    // Clump centres, drawn once. Real asset parks are not uniform — they follow
    // roads and towns — and uniformity flatters BOTH clustering and label
    // collision, the two subsystems a scale bench exists to stress.
    const centres = [];
    for (let c = 0; c < clumps; c++) {
        centres.push([west + rnd() * spanX, south + rnd() * spanY]);
    }
    const clumpSpanX = spanX / 60;
    const clumpSpanY = spanY / 60;

    function nextPoint() {
        if (clumps > 0) {
            const centre = centres[(rnd() * clumps) | 0];
            return [centre[0] + (rnd() - 0.5) * clumpSpanX, centre[1] + (rnd() - 0.5) * clumpSpanY];
        }
        return [west + rnd() * spanX, south + rnd() * spanY];
    }

    // Property keys mimic an asset record rather than a demo POI: that is the
    // payload whose serialisation cost the bench is meant to report.
    const keys = [
        "ref",
        "label",
        "status",
        "category",
        "installedOn",
        "lastVisit",
        "owner",
        "sector",
        "height",
        "power",
        "note",
    ];
    const statuses = ["ok", "pending", "fault", "unknown"];

    const features = [];
    for (let i = 0; i < count; i++) {
        const id = idPrefix ? idPrefix + i : i;
        const props = { id: id };
        for (let k = 0; k < propCount; k++) {
            const key = keys[k % keys.length] + (k >= keys.length ? "_" + k : "");
            if (key === "status") props[key] = statuses[(rnd() * 4) | 0];
            else if (key === "height" || key === "power")
                props[key] = Math.round(rnd() * 1000) / 10;
            else props[key] = key + "-" + i;
        }

        let kind = geometry;
        if (geometry === "mixed")
            kind = i % 3 === 0 ? "Point" : i % 3 === 1 ? "LineString" : "Polygon";

        const a = nextPoint();
        let geom;
        if (kind === "LineString") {
            const b = [a[0] + (rnd() - 0.5) * clumpSpanX, a[1] + (rnd() - 0.5) * clumpSpanY];
            const m = [a[0] + (rnd() - 0.5) * clumpSpanX, a[1] + (rnd() - 0.5) * clumpSpanY];
            geom = { type: "LineString", coordinates: [a, m, b] };
        } else if (kind === "Polygon") {
            const dx = clumpSpanX / 4;
            const dy = clumpSpanY / 4;
            geom = {
                type: "Polygon",
                coordinates: [
                    [
                        [a[0], a[1]],
                        [a[0] + dx, a[1]],
                        [a[0] + dx, a[1] + dy],
                        [a[0], a[1] + dy],
                        [a[0], a[1]],
                    ],
                ],
            };
        } else {
            geom = { type: "Point", coordinates: a };
        }

        features.push({ type: "Feature", id: id, geometry: geom, properties: props });
    }

    return { type: "FeatureCollection", features: features };
}

/**
 * The generator's source, wrapped so the page mounts it on `window`.
 *
 * ⚠️ Read from `Function.prototype.toString()` rather than duplicated as a string
 * literal: a literal twin is the sixth copy this file exists to prevent, and it
 * would drift silently — nothing compares a string to a function.
 */
const BROWSER_SOURCE = `;window.__geoleafMakeFeatures = ${makeFeatureCollection.toString()};`;

/**
 * Mounts `window.__geoleafMakeFeatures` on every navigation of `page`.
 * MUST be called BEFORE `page.goto(...)` — `addInitScript` applies to the NEXT
 * navigation, the same contract as `injectWebVitals`.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 */
async function installFeatureFactory(page) {
    await page.addInitScript({ content: BROWSER_SOURCE });
}

export { makeFeatureCollection, installFeatureFactory, BROWSER_SOURCE };
