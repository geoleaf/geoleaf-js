"use strict";
/**
 * lazy-plugin-assets.cjs — the files of every plugin the application loads ON DEMAND.
 *
 * ## Why this module exists
 *
 * The worker pre-caches what a first page load requests (`boot-assets.cjs`), and nothing else:
 * a plugin loaded on demand is an `import()`, and pre-caching it at install would cancel the
 * laziness the code-splitting buys. But an `import()` is served by the worker's static cache —
 * never by IndexedDB, where the offline preparation writes the zone. A plugin the user had not
 * opened online therefore had no copy anywhere: the zone was prepared, and the editor's button
 * did nothing once the network was gone.
 *
 * The answer is a SECOND list, kept by the worker and fetched only when the user prepares a
 * zone (`PRECACHE_LAZY_PLUGINS`, `sw-core.js`). It is derived here, from the deployed files,
 * and never written by hand.
 *
 * 🛑 **It is NOT merged into `deriveBootCriticalAssets`.** That function is the single source of
 * the boot pre-cache AND of the payload gate's weighing (`check-app-payload.cjs`). Adding the
 * lazy plugins there would pre-cache them at every install and weigh them as boot cost — the
 * exact two errors its doctrine names.
 *
 * ## The derivation
 *
 * 1. The entries: every `import("./dist/<plugin>.plugin.js?v=…")` of the DEPLOYED `init.js`,
 *    comments out — query string kept, since the worker matches without `ignoreSearch` and the
 *    browser will ask for exactly that key.
 * 2. Their closure: every `"./<file>.js"` each file imports, statically or not — a plugin's
 *    drawing engine or exporter is itself an `import()`, and it is the part a user needs offline.
 *    Chunk imports carry no query string; they are kept bare, as the browser asks for them.
 *
 * @module scripts/lib/lazy-plugin-assets
 */

const fs = require("fs");
const path = require("path");

/**
 * Plugin entries the deployed `init.js` loads on demand.
 *
 * @param {string} initCode The deployed `init.js`.
 * @returns {string[]} Deploy-relative URLs, query string kept, in declaration order.
 */
function extractLazyPluginEntries(initCode) {
    const code = initCode.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const entries = [];
    for (const m of code.matchAll(
        /\bimport\(\s*["']\.\/(dist\/[^"']+\.plugin\.js[^"']*)["']\s*\)/g
    )) {
        if (!entries.includes(m[1])) entries.push(m[1]);
    }
    return entries;
}

/**
 * Relative `.js` files one built file imports, statically or through `import()`.
 *
 * @param {string} code The built file.
 * @returns {string[]} Specifiers as written, `./` stripped.
 */
function extractRelativeImports(code) {
    const found = new Set();
    for (const re of [
        /\bfrom\s*["']\.\/([^"'?]+\.js)["']/g,
        /\bimport\s*["']\.\/([^"'?]+\.js)["']/g,
        /\bimport\(\s*["']\.\/([^"'?]+\.js)["']\s*\)/g,
    ]) {
        for (const m of code.matchAll(re)) found.add(m[1]);
    }
    return [...found];
}

/**
 * Every file of every plugin the deploy loads on demand, minus what the boot pre-cache holds.
 *
 * @param {{ outDir: string, bootAssets: string[] }} args `outDir` — the deploy directory, after
 *   `init.js` is copied; `bootAssets` — the boot pre-cache, left out of this list (a plugin the
 *   variant loads at boot is already there).
 * @returns {string[]} Deploy-relative URLs, deduplicated.
 * @throws {Error} When `init.js` is missing, or a derived URL has no file behind it — a single
 *   404 would make the worker report the plugins as kept when one of them is not.
 */
function deriveLazyPluginAssets({ outDir, bootAssets }) {
    const initFile = path.join(outDir, "init.js");
    if (!fs.existsSync(initFile)) {
        throw new Error(`deriveLazyPluginAssets: init.js not found in ${outDir}`);
    }
    const boot = new Set(bootAssets);
    const seen = new Set();
    const queue = extractLazyPluginEntries(fs.readFileSync(initFile, "utf8"));
    const missing = [];
    while (queue.length > 0) {
        const url = queue.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        const file = path.join(outDir, url.split("?")[0]);
        if (!fs.existsSync(file)) {
            missing.push(url);
            continue;
        }
        const dir = path.posix.dirname(url.split("?")[0]);
        for (const spec of extractRelativeImports(fs.readFileSync(file, "utf8"))) {
            queue.push(path.posix.join(dir, spec));
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `deriveLazyPluginAssets: ${missing.length} derived URL(s) have no file — ${missing.join(", ")}`
        );
    }
    return [...seen].filter((u) => !boot.has(u));
}

module.exports = { deriveLazyPluginAssets, extractLazyPluginEntries, extractRelativeImports };
