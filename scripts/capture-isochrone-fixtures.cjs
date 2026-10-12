#!/usr/bin/env node
/**
 * @file capture-isochrone-fixtures.cjs
 * @description Captures the isochrone-provider fixture corpus. Run BY HAND, never in CI.
 *
 * ## Why this file exists, and why nothing calls it
 *
 * The normaliser of `@geoleaf-plugins/isochrone` is written against what an engine really
 * answers, never against its documentation. So the corpus is captured from a real instance,
 * once, and versioned — same reasoning, and same shape, as `capture-route-fixtures.cjs`.
 *
 * 🛑 **No test ever calls an engine.** A test hitting a public instance is subject to a
 * fair-use quota and makes the run non-reproducible: its red would mean "the internet moved",
 * which nobody can act on. This script is therefore deliberately absent from `ci-local.cjs`
 * and from `ci.yml`.
 *
 * ## Three captures, and each one holds something different
 *
 * - **nominal** — one origin on a dense road network, three durations. What the normaliser
 *   reads: one polygon per contour, served from the largest to the smallest, each carrying
 *   the engine's own style properties.
 * - **off-network** — a point at sea. The engine does NOT refuse it: it answers 200 and one
 *   polygon per contour, each the size of a single grid cell. The plugin draws it, because it
 *   does not judge a geometry. This capture holds that decision — and RE-capturing it is the
 *   only gesture that would show an engine starting to refuse such a point.
 * - **refused-duration** — a duration beyond what this instance accepts. It is the only
 *   refusal body the corpus holds: a 400 whose JSON carries the engine's own numeric code.
 *
 * ⚠️ The last two are captured for the answer they are EXPECTED to get. If the instance
 * answers otherwise, nothing is written: the fixture would stop holding what its name says,
 * and the tests reading it would start asserting something nobody decided.
 *
 * ## The envelope
 *
 * Each file is `{ request, status, body }`. `status` is kept because a refusal is defined by
 * it, and a body alone would not say whether it came back as a 200 or a 400. `request` is the
 * question as sent — the `json` parameter, decoded — so a re-capture is reproducible from the
 * file alone.
 *
 * ## No credentials, and only the origin and the path are printed
 *
 * The instance is public and unauthenticated. If an engine ever needs a key, it does NOT come
 * here: a captured fixture is committed, and a key that reaches a committed file has left the
 * machine. The log prints the origin and the path of each request, never its query string —
 * the habit is what keeps a key out of a terminal the day someone points this at their own
 * instance.
 *
 * ## This script is the ONLY formatter of the corpus
 *
 * The fixtures are written pretty-printed and covered by `.prettierignore`
 * (`packages/plugins/<any>/fixtures/`): these files exist so that a re-capture answers "did
 * the engine change its answer?", and a second formatter in the loop turns that diff into
 * noise.
 *
 * Usage:  node scripts/capture-isochrone-fixtures.cjs [--force]
 * Exit codes: 0 captured · 1 an answer was not the expected one · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const ROOT = registry.ROOT;

/**
 * Where the corpus lands.
 *
 * ⚠️ At the package ROOT and NOT under `src/`: the manifest ships `src/`, so a fixture placed
 * there would travel to every npm consumer for no reason.
 */
const OUT_DIR = path.join(registry.requireByDirName("isochrone").absDir, "fixtures");

/** The public instance, and the action asked of it. */
const ENDPOINT = "https://valhalla1.openstreetmap.de";
const ACTION = "/isochrone";

/** How long the instance is given, in milliseconds. A long isochrone is slow to compute. */
const TIMEOUT_MS = 60_000;

/**
 * @typedef {object} Question
 * @property {{ lat: number, lon: number }[]} locations Latitude first — the engine's order.
 * @property {string} costing The engine's travel model.
 * @property {{ time: number }[]} contours Minutes asked.
 * @property {true} polygons Polygons rather than lines.
 */

/**
 * @typedef {object} Capture
 * @property {string} id Short name, printed.
 * @property {string} file File name under the corpus directory.
 * @property {Question} question The question, as sent.
 * @property {(status: number, body: unknown) => string | null} reject Why the answer is not
 *   the expected one, or `null`.
 */

/**
 * Builds a question for one origin.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {number[]} minutes Durations asked.
 * @returns {Question} The question.
 */
function question(lat, lon, minutes) {
    return {
        locations: [{ lat, lon }],
        costing: "auto",
        contours: minutes.map((time) => ({ time })),
        polygons: true,
    };
}

/**
 * Checks that a body carries one polygon per duration asked.
 *
 * @param {unknown} body Parsed response.
 * @param {number[]} minutes Durations asked.
 * @returns {string | null} Why it is unusable, or `null`.
 */
function rejectContours(body, minutes) {
    const features = /** @type {{ features?: unknown }} */ (body ?? {}).features;
    if (!Array.isArray(features)) return "aucune liste `features`";
    if (features.length !== minutes.length)
        return `${features.length} contour(s) pour ${minutes.length} durée(s) demandée(s)`;
    for (const m of minutes) {
        const feature = features.find((f) => f?.properties?.contour === m);
        if (!feature) return `aucun contour de ${m} minute(s)`;
        const type = feature.geometry?.type;
        if (type !== "Polygon" && type !== "MultiPolygon")
            return `contour de ${m} minute(s) en ${JSON.stringify(type)}`;
    }
    return null;
}

const NOMINAL_MINUTES = [5, 10, 15];

/** @type {Capture[]} */
const CAPTURES = [
    {
        id: "nominal",
        file: "valhalla-isochrone-nominal.json",
        // Saint-Denis, Réunion — the origin `capture-route-fixtures.cjs` starts its trip from.
        question: question(-20.8823, 55.4504, NOMINAL_MINUTES),
        reject(status, body) {
            if (status !== 200) return `HTTP ${status}`;
            return rejectContours(body, NOMINAL_MINUTES);
        },
    },
    {
        id: "off-network",
        file: "valhalla-isochrone-off-network.json",
        // Open sea, well over a hundred kilometres from the nearest road.
        question: question(-22.2, 54.5, NOMINAL_MINUTES),
        reject(status, body) {
            // 🛑 A refusal here is not a failed capture, it is NEWS: the plugin has no reason
            // named after "no road nearby" precisely because no engine was ever seen refusing
            // such a point. Bringing that reason back is a decision — so nothing is written.
            if (status !== 200)
                return (
                    `HTTP ${status} — l'instance REFUSE désormais un point hors réseau ` +
                    `(code ${JSON.stringify(/** @type {{ error_code?: unknown }} */ (body ?? {}).error_code)}). ` +
                    "C'est la condition qui rouvre le motif retiré : à décider, pas à re-capturer."
                );
            return rejectContours(body, NOMINAL_MINUTES);
        },
    },
    {
        id: "refused-duration",
        file: "valhalla-isochrone-refused-duration.json",
        // Ninety minutes: beyond what this instance accepts, within what the provider declares.
        question: question(-20.8823, 55.4504, [90]),
        reject(status, body) {
            if (status === 200)
                return "HTTP 200 — l'instance accepte désormais cette durée : son plafond a bougé.";
            if (status !== 400) return `HTTP ${status} — un 400 était attendu`;
            const code = /** @type {{ error_code?: unknown }} */ (body ?? {}).error_code;
            if (!Number.isInteger(code)) return `\`error_code\` = ${JSON.stringify(code)}`;
            return null;
        },
    },
];

const force = process.argv.includes("--force");

/** @returns {Promise<void>} */
async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    /** @type {string[]} */
    const problems = [];

    for (const capture of CAPTURES) {
        const out = path.join(OUT_DIR, capture.file);
        const rel = path.relative(ROOT, out);
        const url = new URL(ACTION, ENDPOINT);
        url.searchParams.set("json", JSON.stringify(capture.question));
        // Origin and path only — never the query string.
        const shown = `GET ${url.origin}${url.pathname}`;

        if (fs.existsSync(out) && !force) {
            console.log(
                `⏭️  ${capture.id} — ${rel} existe déjà, non réécrit (--force pour rejouer).`
            );
            continue;
        }

        console.log(`── ${capture.id} ──`);
        console.log(`   ${shown}`);

        let status;
        let body;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            status = res.status;
            body = await res.json();
        } catch (err) {
            problems.push(`${capture.id} — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        const why = capture.reject(status, body);
        if (why) {
            // Refusing beats writing: a fixture that does not carry what its name says would
            // make every assertion reading it vacuously true, or true of something else.
            problems.push(`${capture.id} — réponse inattendue : ${why}`);
            continue;
        }

        const envelope = { request: capture.question, status, body };
        fs.writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
        console.log(
            `   ✅ ${rel} — HTTP ${status}, ${fs.statSync(out).size} octets, non retouché.`
        );
    }

    if (problems.length > 0) {
        console.error("");
        console.error("ERROR [ISOCHRONE-FIXTURES]: capture incomplète —");
        for (const p of problems) console.error(`  ${p}`);
        console.error("");
        console.error(
            "  Rien n'a été écrit pour ces captures. Un jeu d'essai qui ne porte plus ce que son\n" +
                "  nom annonce ferait dire aux tests autre chose que ce qui a été décidé."
        );
        process.exit(1);
    }

    console.log("");
    console.log(
        `✅ [ISOCHRONE-FIXTURES] corpus dans ${path.relative(ROOT, OUT_DIR)} — ` +
            `${CAPTURES.length} capture(s) : ${CAPTURES.map((c) => c.id).join(", ")}.`
    );
}

main().catch((err) => {
    console.error(`ERROR [ISOCHRONE-FIXTURES]: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(2);
});
