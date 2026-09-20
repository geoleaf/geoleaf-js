#!/usr/bin/env node
/**
 * @fileoverview CDN-PINS — an exact CDN pin in the documentation names a version npm SERVES.
 *
 * ## The defect this closes
 *
 * The copy-pasteable snippets of the documentation load GeoLeaf from a CDN, and they pinned an
 * exact version. Nothing compared that version to anything: 28 URLs across seven pages stayed at
 * `3.0.0` for four minor releases, and were moved by hand on 19/09/2026 — the same day the same
 * hand had to move them again for the next publication.
 *
 * 🛑 **And the invariant is NOT "equal to `package.json`".** The version is bumped BEFORE the
 * publication, so a pin taken from the manifest names, for the length of that interval, a version
 * the CDN answers **404** for. The reference is the version the registry SERVES.
 *
 * ## What was decided on 19/09/2026, and why this gate is small
 *
 * The tutorials and guides pin the **major** (`@3`), like the root README: jsDelivr and unpkg
 * resolve it to the latest 3.x, so those 23 URLs can no longer go stale. The exact pin survives
 * only where it is the subject — the CDN reference page, which teaches "pin what you tested".
 * This gate is what keeps those few honest.
 *
 * ## The three rules
 *
 *   PIN-00  Non-vacuity: not a single exact pin found → refuse to conclude. A gate that scanned
 *           nothing is worse than no gate: it reports success for a corpus it never read.
 *   PIN-01  An exact pin naming anything other than the version the registry serves as `latest`
 *           → error, with `file:line`.
 *   PIN-02  The registry does not answer → refuse to conclude. An unanswered registry is not a
 *           green: it is the absence of a verdict, and this gate exists to stop a 404.
 *
 * ## Where it runs
 *
 * `npm run check:cdn-pins`, and as the FIRST step of `npm run docs:deploy` — the only moment when
 * the answer is actionable, and the last one that can stop a broken snippet from being served.
 *
 * ⚠️ **Deliberately NOT in `ci:local`.** Between a publication and the documentation update it
 * would be red on every commit, for something no product change can fix — the shape that gets a
 * gate disarmed within the week.
 *
 * ## Usage
 *
 *        node scripts/check-doc-cdn-pins.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { productDocsFiles } = require("./lib/tsdoc-examples.cjs");

const ROOT = path.resolve(__dirname, "..");
/** CDN hosts the documentation loads GeoLeaf from, and the exact pin that follows them. */
const PIN_RE =
    /(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\/(@geoleaf(?:-plugins)?\/[a-z0-9-]+)@(\d+\.\d+\.\d+)/g;
const REGISTRY = "https://registry.npmjs.org";

/**
 * Every exact pin of the product documentation, in reading order.
 *
 * @returns {{ pkg: string, version: string, file: string, line: number }[]} one entry per pin.
 */
function collectPins() {
    const found = [];
    for (const file of productDocsFiles()) {
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((text, index) => {
            for (const match of text.matchAll(PIN_RE)) {
                found.push({ pkg: match[1], version: match[2], file: rel, line: index + 1 });
            }
        });
    }
    return found;
}

/**
 * The version the registry serves as `latest` for one package.
 *
 * @param {string} pkg - Scoped package name.
 * @returns {Promise<string>} the published `latest`.
 * @throws {Error} when the registry does not answer, or answers without a `latest`.
 */
async function servedLatest(pkg) {
    const url = `${REGISTRY}/${pkg.replace("/", "%2f")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${pkg} — le registre répond ${response.status}`);
    const body = await response.json();
    const latest = body?.["dist-tags"]?.latest;
    if (typeof latest !== "string")
        throw new Error(`${pkg} — le registre ne dit pas de \`latest\``);
    return latest;
}

async function main() {
    console.log("\x1b[2m── CDN-PINS — une épingle exacte nomme une version SERVIE ──\x1b[0m");

    const pins = collectPins();
    if (pins.length === 0) {
        console.error(
            "❌ [PIN-00] aucune épingle exacte trouvée dans les surfaces produit.\n" +
                "   Un corpus vide ne se conclut pas : soit le motif ne mord plus, soit le corpus a bougé."
        );
        process.exit(1);
    }

    /** @type {Map<string, string>} */
    const served = new Map();
    for (const pkg of new Set(pins.map((pin) => pin.pkg))) {
        try {
            served.set(pkg, await servedLatest(pkg));
        } catch (error) {
            console.error(
                `❌ [PIN-02] refus de conclure — ${(error instanceof Error ? error : new Error(String(error))).message}.\n` +
                    "   Un registre muet n'est pas un vert : c'est l'absence de verdict, et cette gate existe pour empêcher un 404."
            );
            process.exit(1);
        }
    }

    const stale = pins.filter((pin) => pin.version !== served.get(pin.pkg));
    const packages = [...served.entries()].map(([pkg, v]) => `${pkg}@${v}`).join(" · ");
    console.log(`  ${pins.length} épingle(s) exacte(s) · registre : ${packages}`);

    if (stale.length > 0) {
        console.error(
            `❌ [PIN-01] ${stale.length} épingle(s) ne nomment pas la version servie :\n` +
                stale
                    .map((pin) => `   ${pin.file}:${pin.line}  ${pin.pkg}@${pin.version}`)
                    .join("\n") +
                "\n   Une épingle en avance sur la publication rend 404 sur le CDN ; une épingle en retard\n" +
                "   distribue une version que personne ne teste plus. Corriger la page, puis republier."
        );
        process.exit(1);
    }

    console.log("\x1b[32m✓ CDN-PINS\x1b[0m — chaque épingle exacte nomme la version servie.");
}

main().catch((error) => {
    console.error("❌ [CDN-PINS] échec inattendu :", error);
    process.exit(1);
});
