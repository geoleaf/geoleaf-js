"use strict";
/**
 * boot-assets.cjs — what a FIRST PAGE LOAD requests, derived exactly once.
 *
 * ## Why this module exists
 *
 * `build-deploy.cjs` is the derived source of the three
 * lists that used to describe the distribution directory by hand. The payload gate needs
 * EXACTLY the same set for a different reason — weighing it — and the move that fails is
 * writing a second extractor for it. Two extractors diverge; the unmaintained one goes green
 * while measuring something else. One corpus, two consumers:
 *
 *   • `build-deploy.cjs`        — injects `STATIC_ASSETS` and the `<link rel="modulepreload">`
 *   • `check-app-payload.cjs`   — gates the weight those same URLs represent
 *
 * This is the pattern already applied by `lib/tsdoc-examples.cjs` (`productDocsFiles()`), for
 * the same reason and after the same defect.
 *
 * ## ⚠️ The criterion is "what the first load REQUESTS", not "what gets COPIED"
 *
 * Walking `outDir` is the derivation that looks obvious and is the wrong one: it drags in the
 * LAZY bundles (cancelling the very laziness the code-splitting buys), every `.map` and
 * `sw.js` — then gets the whole batch rejected by `cache.addAll()` at the first 404. The boot
 * set is what `index.html` references, plus what the entry imports STATICALLY. Nothing else
 * is boot-critical by definition.
 *
 * ## The two objects, and why they must not be conflated
 *
 * `deriveBootCriticalAssets()` returns what gets PRE-CACHED — the shell and its retinue. It
 * deliberately excludes profile data: it is not in `STATIC_ASSETS`, and has no business being
 * there. Yet the browser downloads that data anyway on the first screen, and it accounts for
 * 60 % of the page. `deriveFirstScreenData()` returns it separately, so the payload gate sees
 * the whole page where the worker only sees its shell.
 *
 * @module scripts/lib/boot-assets
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Deploy-relative URL of the root config. Read at EVERY boot by `boot-core.ts`
 * (`profilesPath + "geoleaf.config.json"`), always at this path, but only once the whole
 * bundle is parsed — which is why pre-caching and preloading it pays off.
 */
const ROOT_CONFIG_DEPLOY_PATH = "profiles/geoleaf.config.json";

/**
 * Deploy-relative URL of the app shell. `sw-core.js` serves offline navigations through a
 * LITERAL `cache.match("index.html")`: this exact key must be pre-cached — the string is a
 * contract between the two files, not a path adjustable from one side only.
 */
const APP_SHELL_DEPLOY_PATH = "index.html";

/**
 * Extracts the chunks a built ESM entry imports STATICALLY.
 *
 * The eager/lazy split cannot be read off the filesystem — `dist/chunks/` holds both, and
 * that is precisely the trap. The lazy ones are `offline-engine-entry` and `qrcode`:
 * preloading them would cancel the benefit of their `import()`, which exists to defer them.
 * Hence an extraction that reads the entry's STATIC imports, never the directory.
 *
 * ⚠️ This comment quantified the pool — "it carried 6, of which only 4 are eager" — until
 * 2026-08-08, and **both numbers were wrong** on that date: measured on the deploy output,
 * **5** chunks of which **3** are eager. The NAMES, though, were right and stayed right. That
 * is this repo's doctrine: name, do not count — a count in prose diverges without anything
 * saying so, and this one lived in the very file that SERVES as the derivation's source.
 *
 * Both static forms (`… from "x"` and the bare side-effect `import "x"`) are matched;
 * `import("x")` is not, the parenthesis sitting between the keyword and the quote.
 *
 * @param {string} esmFile Absolute path of the built entry (e.g. `dist/geoleaf.esm.js`).
 * @returns {string[]} Chunk paths relative to the deploy root.
 * @throws {Error} If the entry is unreadable, or if chunks exist on disk with none matched —
 *   an extractor that silently finds nothing is the failure mode this assertion guards.
 */
function extractEagerChunks(esmFile) {
    if (!fs.existsSync(esmFile)) {
        throw new Error(`extractEagerChunks: entry not found — ${esmFile}`);
    }
    const code = fs.readFileSync(esmFile, "utf-8");
    const found = new Set();
    for (const re of [
        /\bfrom\s*["'](\.\/chunks\/[^"']+\.js)["']/g,
        /\bimport\s*["'](\.\/chunks\/[^"']+\.js)["']/g,
    ]) {
        for (const m of code.matchAll(re)) {
            found.add(`dist/${m[1].replace(/^\.\//, "")}`);
        }
    }

    // Anti-blindness: a regex that stops matching (minifier change, renamed directory)
    // would return an empty list, and every downstream consumer would silently go green on
    // nothing. The corpus is what decides whether that emptiness is legitimate.
    const chunksDir = path.join(path.dirname(esmFile), "chunks");
    const hasChunksOnDisk =
        fs.existsSync(chunksDir) && fs.readdirSync(chunksDir).some((f) => f.endsWith(".js"));
    if (found.size === 0 && hasChunksOnDisk) {
        throw new Error(
            `extractEagerChunks: ${path.basename(esmFile)} yielded 0 static chunk imports ` +
                `while ${path.relative(ROOT, chunksDir)} holds .js files — the extractor stopped matching.`
        );
    }
    return [...found].sort();
}

/**
 * Extracts the same-origin assets an HTML document references from `<script src>` and
 * `<link href>`, query strings included.
 *
 * Re-reading them off the PATCHED markup — rather than re-applying the `?v=` rule — is what
 * keeps the pre-cache keys identical to the URLs the browser will request. That equality is
 * load-bearing: `cache.match()` is called without `ignoreSearch`, so a cache-buster present
 * on one side and absent on the other is a permanent miss. It has been one: `STATIC_ASSETS`
 * pre-cached `dist/geoleaf-main.min.css?v=…` while `index.html` requested the bare path, so
 * one of its three entries never served anything.
 *
 * Cross-origin references (MapLibre on unpkg, Google Fonts) are set aside: `cache.addAll()`
 * would reject the batch on any of them, and the worker already handles third parties through
 * `networkFirstStrategy`, which caches them on first load.
 *
 * @param {string} html The patched document.
 * @returns {string[]} Relative URLs, in document order, deduplicated.
 */
function extractHtmlAssetRefs(html) {
    const refs = [];
    const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    for (const m of html.matchAll(re)) {
        const url = m[1].trim();
        if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
        if (!refs.includes(url)) refs.push(url);
    }
    return refs;
}

/**
 * Transitive closure of the `.mjs` modules reachable from the document's entries.
 *
 * ## Why this fourth source exists
 *
 * The three other derivations only see what the document references and what
 * `dist/geoleaf.esm.js` imports from `./chunks/`. Since MapLibre 6 the engine is a module
 * graph: `global.mjs` → `maplibre-gl.mjs` → `maplibre-gl-shared.mjs`, plus a worker. Only
 * the first is in the HTML. Without this closure the pre-cache held ONE of the FOUR —
 * measured on 2026-08-08 — and the service worker went green on a shell that could not
 * paint a map offline. `deriveBootCriticalAssets` does verify that every derived URL has a
 * file behind it; **never the reverse**, and this is exactly that hole.
 *
 * ## Why we scan LITERALS, and not just the `import`s
 *
 * ⚠️ The worker is not loaded through a static form. In the minified bundle its name is a
 * bare literal picked at runtime:
 *
 *     let t = e.endsWith(`-dev.mjs`) ? `maplibre-gl-worker-dev.mjs` : `maplibre-gl-worker.mjs`;
 *     return new URL(`./${t}`, e).href
 *
 * A rule targeting `new URL("./x.mjs", import.meta.url)` would therefore have MISSED it
 * while looking like it covered it — the worst kind of error here. So we capture every
 * literal that names an `.mjs`, whatever the quote, then KEEP only those that exist on disk:
 * without that filter, `maplibre-gl-worker-dev.mjs` (named in the code, never copied) would
 * wrongly redden the bijection. The symmetric case — a module referenced but not copied — is
 * guarded upstream by the anti-blindness in `build-deploy.cjs`, which throws if a production
 * `.mjs` of the package is missing from its copy list.
 *
 * @param {string} outDir Output directory of the variant.
 * @param {string[]} htmlRefs URLs returned by `extractHtmlAssetRefs`.
 * @returns {string[]} URLs relative to `outDir`, deduplicated and sorted.
 * @throws {Error} If an `.mjs` present in `vendor/maplibre-gl/` is reached by no rule — the
 *   direction the bijection does not cover, and the only one that protects against an
 *   extractor gone blind.
 */
function extractVendorModuleClosure(outDir, htmlRefs) {
    const LITERAL_MJS = /["'`]([^"'`]*?[\w-]+\.mjs)["'`]/g;
    const reached = new Set();
    const queue = htmlRefs.map((u) => u.split("?")[0]).filter((u) => u.endsWith(".mjs"));

    while (queue.length > 0) {
        const rel = queue.shift();
        if (reached.has(rel)) continue;
        const abs = path.join(outDir, rel);
        if (!fs.existsSync(abs)) continue;
        reached.add(rel);

        const dir = path.posix.dirname(rel.split(path.sep).join("/"));
        for (const m of fs.readFileSync(abs, "utf8").matchAll(LITERAL_MJS)) {
            const spec = m[1].replace(/^\.\//, "");
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(spec)) continue; // absolu / cross-origin
            const dep = path.posix.normalize(path.posix.join(dir, spec));
            if (fs.existsSync(path.join(outDir, dep))) queue.push(dep);
        }
    }

    // Anti-blindness — the DIRECTION `deriveBootCriticalAssets` does not verify. A vendored
    // module no rule reaches silently drops out of the pre-cache: the build stays green and
    // the map breaks offline. Seen red by neutralizing the literal capture.
    const vendorRel = "vendor/maplibre-gl";
    const vendorDir = path.join(outDir, vendorRel);
    if (fs.existsSync(vendorDir)) {
        const unreached = fs
            .readdirSync(vendorDir)
            .filter((f) => f.endsWith(".mjs"))
            .map((f) => `${vendorRel}/${f}`)
            .filter((u) => !reached.has(u));
        if (unreached.length > 0) {
            throw new Error(
                `extractVendorModuleClosure: ${unreached.length} module(s) vendoré(s) hors de ` +
                    `la clôture — ${unreached.join(", ")}. Ils ne seraient PAS pré-cachés, et ` +
                    `la carte ne se peindrait pas au premier chargement hors ligne.`
            );
        }
    }
    return [...reached].sort();
}

/**
 * Derives the list of boot-critical assets for a deploy variant.
 *
 * Three sources, none written by hand: what the patched document references, what the entry
 * imports statically, and the root config.
 *
 * Chunks are listed explicitly even though the `<link rel="modulepreload">` tags already put
 * them in the markup: the pre-cache must not depend on the preload block being present. Two
 * independent paths to the same set, deduplicated.
 *
 * @param {object} args
 * @param {string} args.outDir Output directory of the variant.
 * @param {string} args.patchedHtml The `index.html` written into `outDir`.
 * @param {string[]} args.eagerChunks Chunks returned by `extractEagerChunks`.
 * @returns {{ assets: string[], eagerChunks: string[] }}
 * @throws {Error} If the derivation is empty, or if a derived URL has no file behind it in
 *   `outDir` — the bijection that keeps a pre-cache from pointing at nothing.
 */
function deriveBootCriticalAssets({ outDir, patchedHtml, eagerChunks }) {
    const assets = [];
    const htmlRefs = extractHtmlAssetRefs(patchedHtml);
    for (const url of [
        // The shell, first and under EXACTLY this key. A document does not reference
        // itself, so no extraction can produce it — yet `navigationStrategy` serves offline
        // navigations through a literal `cache.match("index.html")`. Deriving the rest
        // without putting it back would have removed the one entry the old hand-written
        // list had right, and every offline navigation with it.
        APP_SHELL_DEPLOY_PATH,
        ...htmlRefs,
        // What the document's modules pull in turn. The HTML only names the entry of the
        // MapLibre graph; its three dependencies appear nowhere else.
        ...extractVendorModuleClosure(outDir, htmlRefs),
        ...eagerChunks,
        ROOT_CONFIG_DEPLOY_PATH,
    ]) {
        if (!assets.includes(url)) assets.push(url);
    }

    if (assets.length === 0) {
        throw new Error(`deriveBootCriticalAssets: empty derivation for ${outDir}`);
    }

    // Bijection: every derived URL must have a file behind it. An entry that 404s gets the
    // ENTIRE batch rejected by `cache.addAll()`, so the install would fail silently and the
    // application would keep booting online-only — the exact defect already closed once.
    const missing = assets.filter((u) => !fs.existsSync(path.join(outDir, u.split("?")[0])));
    if (missing.length > 0) {
        throw new Error(
            `deriveBootCriticalAssets: ${missing.length} derived URL(s) have no file in ` +
                `${path.relative(ROOT, outDir)} — ${missing.join(", ")}`
        );
    }
    return { assets, eagerChunks };
}

/**
 * Derives the data files the FIRST SCREEN requests, for a deployed variant.
 *
 * ⚠️ These files are NOT in `STATIC_ASSETS` and have no business there — they are not
 * pre-cached. Yet they are 60 % of what the page downloads, and that is the whole point of
 * the payload gate: `check-bundle-size.cjs` measures the closure of the core's static
 * imports and goes green at 182.8 / 300 KB gz while the page loads ~1,500.
 *
 * The derivation chain, with no written list anywhere:
 *
 *     geoleaf.config.json  → data.activeProfile
 *     profile-bundle.json  → themes.config.defautTheme
 *                          → themes.themes[id === defautTheme].layers[].visible === true
 *                          → layerConfigs[layerId].data.{directory,file}
 *
 * A layer whose data is remote (realtime, third-party API) has no local file: it is
 * counted as such and does not enter the same-origin weight.
 *
 * @param {string} variantDir Directory of a deployed variant (e.g. `deploy/deploy-full`).
 * @returns {{ profileId: string, themeId: string, files: string[], remote: string[] }}
 *   `files`: paths relative to `variantDir`. `remote`: ids of layers with no local file.
 * @throws {Error} If the root config, the profile bundle or the default theme cannot be
 *   found, or if the theme leaves NO layer visible — a theme that lights nothing up would
 *   let the gate go green on a zero data weight, indistinguishable from a broken
 *   derivation.
 */
function deriveFirstScreenData(variantDir) {
    const cfgPath = path.join(variantDir, ROOT_CONFIG_DEPLOY_PATH);
    if (!fs.existsSync(cfgPath)) {
        throw new Error(`deriveFirstScreenData: root config not found — ${cfgPath}`);
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    const profileId = cfg?.data?.activeProfile;
    if (!profileId) {
        throw new Error(`deriveFirstScreenData: no data.activeProfile in ${cfgPath}`);
    }

    const profileDir = path.join(variantDir, "profiles", profileId);
    const bundlePath = path.join(profileDir, "profile-bundle.json");
    if (!fs.existsSync(bundlePath)) {
        throw new Error(`deriveFirstScreenData: profile bundle not found — ${bundlePath}`);
    }
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

    // ⚠️ The default-theme key is `defautTheme` — the repo's spelling, not a typo to fix
    // here: it is written by the profile generator and read by the theme engine. Renaming
    // it on one side only would break boot without any gate blinking, exactly the class
    // `probe-gate-visibility.cjs` watches for.
    const themeId = bundle?.themes?.config?.defautTheme ?? bundle?.themes?.defaultTheme;
    const themes = bundle?.themes?.themes ?? [];
    const theme = themes.find((t) => t && t.id === themeId);
    if (!theme) {
        throw new Error(
            `deriveFirstScreenData: default theme "${themeId}" not among the ` +
                `${themes.length} theme(s) of ${path.relative(ROOT, bundlePath)}`
        );
    }

    const visible = (theme.layers ?? []).filter((l) => l && l.visible === true);
    if (visible.length === 0) {
        throw new Error(
            `deriveFirstScreenData: theme "${themeId}" turns on 0 layer — a data weight of ` +
                `zero is indistinguishable from a broken derivation.`
        );
    }

    const configs = bundle?.layerConfigs ?? {};
    // The profile bundle is itself a first-screen request, and the SAFEST of them all: this
    // derivation just read it to learn which layers are visible, so the browser cannot have
    // not requested it. It is not in `STATIC_ASSETS` — it is fetched after the root config,
    // not referenced by the markup — and that is exactly why a gate sitting on the
    // pre-cache alone would lose it.
    const files = [path.relative(variantDir, bundlePath).split(path.sep).join("/")];
    const remote = [];

    // The STYLE DOCUMENTS the bundle already carries, if any. A layer whose style is there
    // will not request it: counting it on top would be DOUBLE COUNTING, the bundle already
    // being the first element of `files`. A layer whose style is NOT there, however, does
    // emit a first-screen request — and this gate used to miss it.
    //
    // 🛑 This is the half that made the measurement wrong in the comfortable direction:
    // `size:app` went green because it was BLIND to style requests, not because the weight
    // held.
    const styleDocs = bundle?.layerStyleDocuments ?? {};

    for (const layer of visible) {
        const layerCfg = configs?.[layer.id];
        const styles = layerCfg?.styles;
        const styleFile = typeof styles?.default === "string" ? styles.default : null;
        if (styleFile) {
            const styleId = styleFile.replace(/\.json$/, "");
            const alreadyBundled = styleDocs?.[layer.id]?.[styleId] !== undefined;
            if (!alreadyBundled) {
                const styleRel = path
                    .join(
                        "profiles",
                        profileId,
                        "layers",
                        layer.id,
                        typeof styles.directory === "string" ? styles.directory : "styles",
                        styleFile
                    )
                    .split(path.sep)
                    .join("/");
                if (fs.existsSync(path.join(variantDir, styleRel))) files.push(styleRel);
            }
        }

        const data = layerCfg?.data;
        if (!data?.file) {
            remote.push(layer.id);
            continue;
        }
        const rel = path
            .join("profiles", profileId, "layers", layer.id, data.directory ?? "", data.file)
            .split(path.sep)
            .join("/");
        if (fs.existsSync(path.join(variantDir, rel))) {
            files.push(rel);
        } else {
            remote.push(layer.id);
        }
    }

    return { profileId, themeId, files, remote };
}

/**
 * Gzip weight of a file, in bytes.
 *
 * ⚠️ The gzip is recomputed here rather than read: no `.gz` exists on disk at the moment
 * this gate runs (pre-compression happens in a later build step), and the weight that
 * matters is the one the server will produce. The level is left at zlib's default, which is
 * what most servers use — level 9 here would overestimate the real compression.
 *
 * @param {string} file Absolute path.
 * @returns {number} Bytes after gzip.
 */
function gzipSize(file) {
    return zlib.gzipSync(fs.readFileSync(file)).length;
}

module.exports = {
    APP_SHELL_DEPLOY_PATH,
    ROOT_CONFIG_DEPLOY_PATH,
    extractEagerChunks,
    extractHtmlAssetRefs,
    extractVendorModuleClosure,
    deriveBootCriticalAssets,
    deriveFirstScreenData,
    gzipSize,
};
