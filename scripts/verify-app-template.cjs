#!/usr/bin/env node
/**
 * APP-TEMPLATE: the deployable application's HTML/JS contract (T2.6).
 *
 * ## Why this is a gate and not a Vitest suite
 *
 * These two assertions used to live in `packages/core/__tests__/bundle.test.js`
 * ("Demo bootstrap moderne"), where a test of the LIBRARY read a file of the
 * APPLICATION through `__dirname/../index.html` — the very coupling T2 removes.
 *
 * They did not follow the app into a suite of its own, deliberately. Giving
 * `apps/geoleaf-app` a `vitest.config.ts` plus a `test` script would pull it into
 * `unitScope()` and `rootProjectScope()` (`lib/test-scope.cjs`), which then needs a
 * `maxWorkers` matching the other 18 configs, a `@geoleaf/build-config` devDependency,
 * a turbo `test` task depending on a `build` the app does not have, and a knip entry for
 * the new devDeps. Six couplings for two string checks. A root-level test file was no
 * better: the root config declares only per-package `projects`, so nothing would run it.
 *
 * ## What it asserts, and why it is worth more than the two tests it replaces
 *
 * MOD-01/02 restate the original two checks. The other three close holes that nothing
 * guarded, all of the same shape: `build-deploy.cjs` patches `index.html` with regexes
 * anchored per line (`/gm`, NO `/s` flag), so a reformat that wraps one of these
 * constructs onto a second line makes the patch silently miss. The deploy would ship a
 * stale plugin list or an orphaned comment, and exit 0.
 *
 *   APP-01  index.html loads the ESM bundle           (was bundle.test.js)
 *   APP-02  init.js calls GeoLeaf.boot()              (was bundle.test.js)
 *   APP-03  index.html still uses `src/assets/icons/` — else the `→ icons/` rewrite at
 *           build-deploy.cjs is a dead regex and the deployed <link rel="icon">
 *           point outside icons/
 *   APP-04  the `<!-- Optional plugins … -->` comment is on ONE line — removed by
 *           build-deploy.cjs, `/gm` without `/s`
 *   APP-05  each variant-gated plugin <script> (offline-ui, cog, editor) is on ONE
 *           line — same reason, the four regexes are `/gm` without `/s`
 *   APP-08  the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker exists and is on ONE line —
 *           build-deploy.cjs (step 7a) substitutes it with one `modulepreload` per chunk the
 *           entry imports statically, using an `/m` regex without `/s`. A marker that stopped
 *           matching would ship a deploy that looks fine and has lost its preload block.
 *   APP-06  every module `init.js` imports EAGERLY resolves on a fresh clone — git-tracked,
 *           or covered by a named exemption whose witness proves something still guarantees
 *           the file lands in the deploy. Measured on 2026-07-30: `connector.local.js` was
 *           git-ignored and imported at boot, hence present on the author's machine and
 *           absent everywhere else — 8 E2E specs green locally, red in CI, for months.
 *   APP-09  index.html's CSP policy is COMPARED to an expected policy, in both
 *           directions, plus a list of forbidden tokens the constant cannot lift.
 *           Before it, an injected `'unsafe-eval'` came out GREEN.
 *
 * ## One invariant that does not bear on the app workspace
 *
 *   NGINX-01 every `server` block of `docker/nginx.dev.conf` sets `X-Content-Type-Options`.
 *           It is here, and not in a new script, for a PARITY reason: every new
 *           script must be wired into `ci-local.cjs` AND `ci.yml`, and that is
 *           precisely where two-sided coverage gets lost. The application's security
 *           contract covers what it declares (CSP) and what its server promises
 *           (headers): separating them would have guarded only half, the very
 *           defect per-variant gating had left open.
 *
 * Paths come from the workspace registry, never as a literal `apps/geoleaf-app`:
 * `requireByDirName` throws on a rename instead of quietly checking nothing.
 *
 * Usage: node scripts/verify-app-template.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
// The markers come from their PRODUCER — one corpus, two consumers. Copying them here
// would let APP-11 go green the day of a build-side rename, i.e. the day the tag
// removal stops applying: the gate would guard a pair nothing looks for anymore.
const { DEV_CONNECTOR_MARKERS } = require("./build-deploy.cjs");

const ROOT = path.resolve(__dirname, "..");
const APP = registry.requireByDirName("geoleaf-app").absDir;

/**
 * Plugins whose <script> tag build-deploy.cjs strips per variant.
 *
 * ⚠️ 2026-07-26 — this list was a SILENT OUTAGE. It builds the
 * `geoleaf-<name>.plugin.js` needle, and the APP-05 loop does `continue` when the
 * needle matches nothing — because not all gated plugins appear in every state of
 * `index.html` (`editor` is not in it today). Consequence: at the
 * `storage` → `offline-ui` rename, APP-05 would have stopped checking that plugin
 * **while going green**, and the tag could have split onto two lines with nothing
 * saying so — the very thing APP-05 exists to prevent, the four gating regexes of
 * `build-deploy.cjs` being `/gm` WITHOUT `/s`.
 *
 * The `continue` stays legitimate and cannot become an error. The blindness is
 * closed upstream: each name is resolved by the registry, which THROWS on an
 * absent directory. A rename fails here, loudly, instead of disarming the
 * downstream check.
 */
const GATED_PLUGINS = ["offline-ui", "cog", "editor"].map(
    (dirName) => registry.requireByDirName(dirName).dirName
);

const errors = [];

/**
 * Read a required app file, or record a fatal error.
 * @param {string} rel file name relative to the app workspace
 * @returns {string|null}
 */
function readApp(rel) {
    const abs = path.join(APP, rel);
    if (!fs.existsSync(abs)) {
        errors.push(`${path.relative(ROOT, abs)} — MISSING. The deploy has no source.`);
        return null;
    }
    return fs.readFileSync(abs, "utf8");
}

const html = readApp("index.html");
const init = readApp("init.js");

if (html !== null) {
    // APP-01
    if (!html.includes("dist/geoleaf.esm.js")) {
        errors.push("APP-01 index.html does not load `dist/geoleaf.esm.js`.");
    }

    // APP-10 — the MapLibre tag. Nothing guarded its SHAPE until now, although since
    // v6 it carries a constraint that cannot be seen by reading: the engine is an ESM
    // module, so `type="module"` is not a writing style but the condition for it to
    // execute. Without it, the browser refuses the file and the map does not mount —
    // with no other gate saying so, `index.html` never being executed by the unit
    // suite. Both halves are necessary: the first holds the shape, the second forbids
    // the return of an artifact that no longer exists on the registry.
    const mlTag = html.split("\n").find((l) => l.includes("vendor/maplibre-gl/global.mjs"));
    if (!mlTag) {
        errors.push(
            "APP-10 index.html ne charge plus `vendor/maplibre-gl/global.mjs` — le shim qui " +
                "repose le global `maplibregl`. MapLibre 6 étant ESM-only, sans lui " +
                "`new maplibregl.Map()` lève sur un global absent."
        );
    } else if (!/<script[^>]*\stype=["']module["']/.test(mlTag)) {
        errors.push(
            'APP-10 la balise du shim MapLibre n\'a pas `type="module"`. Un `.mjs` chargé en ' +
                "script classique est refusé par le navigateur : la carte ne monte pas."
        );
    }
    if (/(?:src|href)=["'][^"']*maplibre-gl(?:-csp)?\.js(?![\w-])/.test(html)) {
        errors.push(
            "APP-10 index.html référence `maplibre-gl.js` (ou `-csp.js`) — ces bundles UMD ne " +
                "sont PLUS publiés depuis MapLibre 6. La référence rendrait un 404."
        );
    }

    // APP-03
    if (!html.includes("src/assets/icons/")) {
        errors.push(
            "APP-03 index.html no longer references `src/assets/icons/` — the rewrite to " +
                "`icons/` in build-deploy.cjs (step 7) is now a regex matching nothing, and the " +
                'deployed <link rel="icon"> will point outside icons/.'
        );
    }

    // APP-04 — the comment must exist AND occupy a single line.
    const optionalLines = html.split("\n").filter((l) => l.includes("Optional plugins"));
    if (optionalLines.length === 0) {
        errors.push("APP-04 the `<!-- Optional plugins … -->` comment is gone from index.html.");
    } else if (!optionalLines.some((l) => /<!--.*Optional plugins.*-->/.test(l))) {
        errors.push(
            "APP-04 the `<!-- Optional plugins … -->` comment spans several lines. " +
                "build-deploy.cjs strips it with a `/gm` regex and NO `/s` flag, so it would " +
                "survive into the deploy as an orphaned header. Keep it on one line."
        );
    }

    // APP-05 — each gated plugin <script> must open and close on the same line.
    for (const name of GATED_PLUGINS) {
        const needle = `geoleaf-${name}.plugin.js`;
        const hits = html.split("\n").filter((l) => l.includes(needle));
        if (hits.length === 0) continue; // not every plugin is listed in every state
        if (!hits.some((l) => /<script[^>]*>\s*<\/script>/.test(l))) {
            errors.push(
                `APP-05 the <script> tag for ${needle} is split across lines. The four ` +
                    `variant-gating regexes in build-deploy.cjs are \`/gm\` without \`/s\`: the ` +
                    `tag would survive into a variant that must not carry it.`
            );
        }
    }

    // APP-08 — the preload marker must exist AND occupy a single line.
    const preloadLines = html.split("\n").filter((l) => l.includes("__GEOLEAF_MODULEPRELOAD__"));
    if (preloadLines.length === 0) {
        errors.push(
            "APP-08 the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker is gone from index.html. " +
                'build-deploy.cjs replaces it with one <link rel="modulepreload"> per statically ' +
                "imported chunk; without it the deploy ships no preload block at all and the " +
                "browser rediscovers ~112 KB gz of chunks only after parsing the entry."
        );
    } else if (!preloadLines.some((l) => /<!--\s*__GEOLEAF_MODULEPRELOAD__\s*-->/.test(l))) {
        errors.push(
            "APP-08 the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker spans several lines. " +
                "build-deploy.cjs matches it with an `/m` regex and NO `/s` flag, so the " +
                "substitution would silently miss. Keep it on one line."
        );
    }

    // APP-11 — the marker pair that frames the WORKSTATION Connector bootstrap.
    //
    // 🛑 WHAT ITS ABSENCE WOULD COST. `build-deploy.cjs` strips this block from every
    // shippable variant; that removal, and nothing else, is what keeps
    // `connector.local.js` — a write-privileged JWT — out of what ships to a client.
    // Markers gone, the removal throws (deliberate), but the gate that says it BEFORE
    // the build is here: a defect found while constructing the deploy is discovered
    // later and at greater cost.
    //
    // ⚠️ The literals come from `build-deploy.cjs`, never copied — otherwise renaming
    // the markers there would leave this gate green on a pair nobody looks for
    // anymore, i.e. at the precise moment the removal stops working.
    for (const [role, needle] of Object.entries(DEV_CONNECTOR_MARKERS)) {
        if (!html.includes(needle)) {
            errors.push(
                `APP-11 le marqueur DEV-CONNECTOR « ${role} » (\`${needle}\`) a disparu ` +
                    `d'index.html. Il encadre la balise qui charge \`connector.local.js\`, le ` +
                    `bootstrap de poste porteur d'un jeton ; build-deploy.cjs retire ce bloc ` +
                    `des variantes LIVRABLES. Restaurer la paire START/END.`
            );
        }
    }
    if (!/^\s*<script[^>]*src="connector\.local\.js"[^>]*><\/script>\s*$/m.test(html)) {
        errors.push(
            "APP-11 la balise `connector.local.js` n'est plus sur UNE seule ligne entre ses " +
                "marqueurs. Le retrait coupe des lignes entières : une balise étalée sur " +
                "plusieurs lignes en laisserait un fragment dans une variante livrable."
        );
    }
}

// APP-02
// ⚠️ The needle is `GeoLeaf.boot(`, NOT `GeoLeaf.boot()`. It carried the closed form
// until 2026-08-07, which was right as long as no option was passed — and wrong as
// soon as preloading needed `boot({ beforeBoot })` to preload the plugins the
// profile requires. The guarded property is "init.js starts the application"; the
// empty parentheses were a drafting accident, not the subject.
if (init !== null && !init.includes("GeoLeaf.boot(")) {
    errors.push("APP-02 init.js does not call `GeoLeaf.boot(…)` — the app would never start.");
}

/**
 * APP-06 — every module `init.js` imports must EXIST on a fresh clone.
 *
 * ⚠️ The class this rule closes was measured on 2026-07-30, and it is expensive
 * because it is INVISIBLE from the machine that introduces it.
 *
 * `init.js` did `await import("./connector.local.js")` on a GIT-IGNORED file. On the
 * machine that had it, all was green; everywhere else — a fresh clone, a runner —
 * the module was missing, the browser logged "Failed to load resource: 404", and the
 * 8 E2E specs asserting "0 console errors" failed. The `try/catch` around the import
 * can do NOTHING about it: the console error is not a JS exception.
 *
 * The remedy is not to forbid importing an optional file — it is to require that
 * something GUARANTEES its presence in the deploy. Hence the named exemption: it
 * does not waive the check, it names the mechanism that keeps the promise, and it
 * turns red if that mechanism disappears.
 */
/**
 * 🗑️ EMPTY, AND THAT IS AN ACHIEVEMENT — do not put `./connector.local.js` back.
 *
 * This table carried a single entry, from 07-30 to 2026-08-09: `init.js` imported
 * `./connector.local.js` (git-ignored) UNCONDITIONALLY, and the exemption named the
 * mechanism guaranteeing its presence in the deploy — an inert stub emitted by
 * `build-deploy.cjs`.
 *
 * ⚠️ The exemption was honest and APP-06 was right to go green: the file WAS there.
 * What no rule said is that in the shippable variants it contained the REAL
 * bootstrap — write-privileged `geoleaf_editor` token. A PRESENCE rule says nothing
 * about CONTENT, and nobody asked it to.
 *
 * The cause is handled upstream: `init.js` no longer imports anything, loading goes
 * through an `index.html` tag that `build-deploy.cjs` strips from shippable variants
 * (APP-11 below holds its markers). There is thus no import left to exempt — and an
 * entry reintroduced here would signal the knot just untied has been retied.
 */
const IMPORT_EXEMPTIONS = {};

/**
 * `./dist/**` — build outputs, git-ignored yet GUARANTEED by construction.
 *
 * ⚠️ This rule's preflight first flagged the 4 `./dist/geoleaf-*.plugin.js` as
 * defects. They were false positives, and discarding them unread would have been as
 * wrong as treating them: they live in `registerLazy(() => import(...))` THUNKS, so
 * they NEVER execute at boot and cannot produce the boot console error this rule
 * hunts. That is precisely what distinguishes `connector.local.js`, which executes
 * eagerly on every localhost page load.
 *
 * The exemption therefore carries its witness: `build-deploy.cjs` must keep
 * requiring `dist/` in the deploy, failing which "guaranteed by construction" stops
 * being true.
 */
const BUILD_OUTPUT_PREFIX = "./dist/";
const BUILD_OUTPUT_WITNESS = { file: "scripts/build-deploy.cjs", needle: '"dist/geoleaf.esm.js"' };

if (init !== null) {
    const specs = new Set(
        [...init.matchAll(/(?:import\s*\(|from)\s*["'](\.[^"']+)["']/g)].map((m) => m[1])
    );
    if ([...specs].some((s) => s.startsWith(BUILD_OUTPUT_PREFIX))) {
        const w = path.join(ROOT, BUILD_OUTPUT_WITNESS.file);
        if (
            !fs.existsSync(w) ||
            !fs.readFileSync(w, "utf8").includes(BUILD_OUTPUT_WITNESS.needle)
        ) {
            errors.push(
                `APP-06 les imports \`${BUILD_OUTPUT_PREFIX}*\` sont dispensés parce que la ` +
                    `construction garantit \`dist/\` dans le déployé — or ${BUILD_OUTPUT_WITNESS.file} ` +
                    `n'exige plus ${BUILD_OUTPUT_WITNESS.needle}. La dispense ne repose plus sur rien.`
            );
        }
    }
    for (const spec of specs) {
        if (spec.startsWith(BUILD_OUTPUT_PREFIX)) continue;
        const rel = path.posix.join("apps/geoleaf-app", spec.replace(/^\.\//, ""));
        const abs = path.join(ROOT, rel);
        const tracked =
            fs.existsSync(abs) &&
            require("node:child_process").spawnSync("git", ["ls-files", "--error-unmatch", rel], {
                cwd: ROOT,
                stdio: "ignore",
            }).status === 0;
        if (tracked) continue;

        const ex = IMPORT_EXEMPTIONS[spec];
        if (!ex) {
            errors.push(
                `APP-06 init.js importe \`${spec}\`, qui n'est PAS suivi par git et n'a aucune ` +
                    `garantie d'émission. Sur un clone frais le module manquera, le navigateur ` +
                    `journalisera un 404, et toute spec E2E assertant « 0 console error » ` +
                    `échouera — invisible depuis ce poste. Suivre le fichier, ou garantir son ` +
                    `émission et l'inscrire dans IMPORT_EXEMPTIONS avec son témoin.`
            );
            continue;
        }
        // The witness: the cited mechanism must REALLY exist. An exemption naming a
        // vanished guarantor is worse than no exemption — it reassures.
        const garant = path.join(ROOT, ex.garantiPar);
        if (!fs.existsSync(garant) || !fs.readFileSync(garant, "utf8").includes(ex.temoin)) {
            errors.push(
                `APP-06 IMPORT_EXEMPTIONS["${spec}"] désigne \`${ex.temoin}\` dans ` +
                    `\`${ex.garantiPar}\` comme garant de l'émission — INTROUVABLE. La dispense ` +
                    `ne repose plus sur rien, et le 404 peut revenir sans que rien ne bouge.`
            );
        }
    }
}

/**
 * APP-07 — every registration targeting a GATED plugin lives between block markers.
 *
 * ⚠️ The class closed here is the inert button's, and it stayed open because the
 * HTML half of the gating was guarded (APP-04/05) and the JS half not at all.
 *
 * `build-deploy.cjs` strips the `GEOLEAF-DEPLOY:GATED-BLOCK <name>` block from
 * `init.js` on variants that do not embark that plugin. A bundle reference placed
 * OUTSIDE the block would survive the removal: the lazy resolver would be
 * registered on a bundle-less variant, `isLazyAvailable()` would return `true` (it
 * probes no file), the button would be painted — and the click would leave on a 404
 * `import()`. That is the state measured on 2026-08-05 on `deploy-core`: three
 * inert `editor` buttons the accessibility audit validated, since they carry a
 * valid accessible name and role.
 *
 * ## Why the implication goes this way, and not the other
 *
 * We do NOT require a block to exist for every gated plugin — `offline-ui` is not
 * registered from `init.js` (it is eager, and stays so: its `wireEngineSignals()`
 * carries the eviction alert), and requiring it would redden on a legitimate
 * absence. We require that **if** the bundle is named, then it is framed. Adding an
 * unmarked reference turns red; that is the dangerous direction, and the one
 * guarded.
 *
 * The reverse direction — markers vanish while the removal depends on them — is
 * held by `stripGatedInitBlock`, which THROWS when it cannot find them. The two
 * guards complement each other: neither can go green while checking nothing.
 *
 * ⚠️ The paragraph above cited `offline-ui` **and `cog`** as absent from `init.js`
 * until 2026-08-08, and that was already wrong: `init.js` carries
 * `gl.plugins.registerLazy("cog", () => import("./dist/geoleaf-cog.plugin.js"))` —
 * exactly the needle this guard loops on. `cog` is thus COVERED by APP-07; reading
 * it here as a legitimate absence concluded the opposite of what the guard really
 * does.
 */
if (init !== null) {
    const initLines = init.split("\n");
    for (const name of GATED_PLUGINS) {
        const needle = `geoleaf-${name}.plugin.js`;
        if (!init.includes(needle)) continue; // this plugin is not registered from init.js

        const startIdx = initLines.findIndex((l) =>
            l.includes(`GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── START`)
        );
        const endIdx = initLines.findIndex((l) =>
            l.includes(`GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── END`)
        );

        if (startIdx === -1 || endIdx === -1) {
            errors.push(
                `APP-07 init.js nomme ${needle} mais ne porte pas la paire de marqueurs ` +
                    `\`GEOLEAF-DEPLOY:GATED-BLOCK ${name}\` START/END. build-deploy.cjs ne peut ` +
                    `donc pas retirer l'enregistrement sur une variante qui n'embarque pas ce ` +
                    `bundle : le créneau paresseux serait peint et le clic partirait en 404.`
            );
            continue;
        }
        if (endIdx < startIdx) {
            errors.push(
                `APP-07 les marqueurs \`GEOLEAF-DEPLOY:GATED-BLOCK ${name}\` sont inversés ` +
                    `(END ligne ${endIdx + 1} avant START ligne ${startIdx + 1}).`
            );
            continue;
        }

        const outside = initLines
            .map((line, i) => ({ line, i }))
            .filter(({ line, i }) => line.includes(needle) && (i < startIdx || i > endIdx))
            .map(({ i }) => i + 1);
        if (outside.length) {
            errors.push(
                `APP-07 init.js nomme ${needle} HORS du bloc gaté (ligne(s) ${outside.join(", ")} ` +
                    `— le bloc va de ${startIdx + 1} à ${endIdx + 1}). Cette référence survivrait ` +
                    `au retrait par variante et recréerait le bouton inerte. Déplacer ` +
                    `l'enregistrement entre les marqueurs.`
            );
        }
    }
}

/**
 * APP-09 — the application's CSP policy is COMPARED, not merely present.
 *
 * ⚠️ What this rule closes, measured on 2026-08-07: one could inject `'unsafe-eval'`
 * into `index.html`'s CSP tag and this gate came out **GREEN**. The tag even
 * carried, in a comment right above, the admission "no gate reads this tag" — the
 * deliverable's most exposed security policy was the one thing in the file nobody
 * re-read.
 *
 * ## Two layers, and the second exists because the first can be worked around
 *
 * ① `EXPECTED_CSP` is the expected policy, spelled out here in full. Any drift turns
 *    red — directive added, removed, source added or removed —, **in both
 *    directions**. A comparison looking only at "the expected directives are there"
 *    would go green before an added source, yet that is the dangerous mutation.
 *
 * ② `FORBIDDEN_TOKENS` forbids a small token set **whatever** `EXPECTED_CSP` says.
 *    Without this second layer, the gate would be "repairable" by aligning the
 *    expectation onto the wrong change — a one-line gesture that looks like routine
 *    maintenance. The day someone adds `'unsafe-eval'` and updates the constant in
 *    the same breath, ① says yes and ② says no. The only arrangement where the gate
 *    survives its own maintenance.
 *
 * 🛑 **It compares a DECLARATION, not a behaviour** — exactly as `PARITY-11`
 * compares command lists and not verdicts. A correct CSP in the HTML does not prove
 * the page violates nothing: that side is held by the violation tests of
 * `e2e/18-security.spec.js` and by `scripts/probe-csp-origins.mjs`. Do not expect
 * from this rule what it cannot carry.
 */
const EXPECTED_CSP = {
    "default-src": ["'self'"],
    // `blob:` REMOVED from `script-src` on 2026-08-08, after a browser verdict on
    // both variants — not by reasoning. Motive: creating a worker from a `blob:` URL
    // falls under `worker-src` (kept below), with `child-src` as the CSP2 fallback
    // (kept too); `script-src` was exercised by no measured path.
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    // `blob:` ADDED on 2026-08-18, after a browser verdict on both variants — not by
    // reasoning, and it is the same protocol as the `blob:` removal from
    // `script-src` just above. Measured motive: the cog plugin's `createCanvas()`
    // PREFERS `OffscreenCanvas` when usable (it is), and `canvasToDataUrl()` then
    // derives a `blob:` URL from it — the normal path, not an edge case. Probed on
    // the `demo.full` and `demo` vhosts: the `blob:` image is REFUSED naming
    // `img-src`, while a `data:` witness loads — so the measurement really bears on
    // the policy and not on a broken image. The failure was MUTE: no E2E spec covers
    // cog, the tile simply did not display.
    // ⚠️ The widening is narrow: a `blob:` URL is same-origin by construction and can
    // only designate what the page itself fabricated. It opens no origin.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": ["'self'", "https:"],
    "font-src": ["'self'", "data:"],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "upgrade-insecure-requests": [],
};

/** Tokens forbidden everywhere, independently of EXPECTED_CSP — see ② above. */
const FORBIDDEN_TOKENS = ["'unsafe-eval'", "'unsafe-inline'", "*"];

if (html !== null) {
    // ⚠️ The capture can NOT be `content=["']([^"']+)["']`. A CSP value contains
    // apostrophes (`'self'`, `'none'`), so a class excluding both quote kinds stops
    // at the first `'` and yields only `default-src `. Written that way, the rule
    // came out RED at rest announcing 11 vanished directives that were all there —
    // and a guard red for the wrong reason is indistinguishable from a working
    // guard. The delimiter is therefore chosen on the OPENING quote, and it alone
    // closes the capture.
    const meta =
        html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) ??
        html.match(/<meta\s+http-equiv='Content-Security-Policy'\s+content='([^']*)'/i);
    if (!meta) {
        errors.push(
            'APP-09 index.html ne porte plus de `<meta http-equiv="Content-Security-Policy">`. ' +
                "Le livrable partirait sans politique, et cette règle sortirait verte en ne " +
                "comparant rien — c'est le mode d'échec qu'elle existe pour éviter."
        );
    } else {
        /** @type {Record<string, string[]>} */
        const actual = {};
        for (const part of meta[1].split(";")) {
            const tokens = part.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) continue;
            actual[tokens[0]] = tokens.slice(1);
        }

        const seen = new Set(Object.keys(actual));
        for (const [directive, expected] of Object.entries(EXPECTED_CSP)) {
            if (!seen.has(directive)) {
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` a disparu d'index.html. Si le ` +
                        `retrait est voulu, mettre EXPECTED_CSP à jour DANS LE MÊME commit — la ` +
                        `politique attendue est un choix, pas un constat.`
                );
                continue;
            }
            seen.delete(directive);
            const got = [...actual[directive]].sort();
            const want = [...expected].sort();
            if (got.join(" ") !== want.join(" ")) {
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` a dérivé — attendu ` +
                        `[${want.join(" ") || "aucune source"}], trouvé ` +
                        `[${got.join(" ") || "aucune source"}].`
                );
            }
        }
        for (const extra of seen) {
            errors.push(
                `APP-09 index.html déclare la directive CSP \`${extra}\`, absente de ` +
                    `EXPECTED_CSP. Une directive non déclarée élargit la politique sans revue.`
            );
        }

        // ⚠️ Tokens are searched in the ALREADY-PARSED structure, never the raw
        // string. Written as `meta[1].split(/\s+/)`, this loop did not bite: the
        // split leaves the semicolon glued to each directive's last token, so
        // `'unsafe-eval';` never equalled `'unsafe-eval'`. Verified on 2026-08-08 —
        // layer ② came out GREEN on the very mutation it exists to catch, while the
        // comment above claimed it caught it. The property was written before being
        // seen to bite; the defect this repo names "a guard never seen red guards
        // nothing", committed in the very guard that invokes it.
        for (const [directive, sources] of Object.entries(actual)) {
            for (const token of FORBIDDEN_TOKENS) {
                if (!sources.includes(token)) continue;
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` contient le jeton interdit ` +
                        `\`${token}\`. Cette interdiction ne dépend PAS d'EXPECTED_CSP : mettre ` +
                        `la constante à jour ne la lèvera pas, et c'est délibéré.`
                );
            }
        }
    }
}

/**
 * NGINX-01 — the `X-Content-Type-Options` header is set on EVERY vhost.
 *
 * ⚠️ It lived as `<meta http-equiv>` in `index.html`, where **no browser reads it**:
 * this header is honoured only in an HTTP response. The protection was thus absent
 * everywhere while appearing present — worse than absent, since it dampened
 * vigilance.
 *
 * The vhost count is **derived** from the file, never written here: a fourth block
 * added without the header must turn red, and a `3` constant written beside would
 * have come out green. Repo doctrine, the same that removed the invariant count
 * from this script's header.
 *
 * The motive for "every": nginx **does not inherit** `add_header` into a block that
 * declares its own. An omission on a single vhost is a complete, perfectly silent
 * hole.
 */
const NGINX_CONF = path.join(ROOT, "docker/nginx.dev.conf");
const NOSNIFF = /add_header\s+X-Content-Type-Options\s+["']?nosniff["']?/i;

if (!fs.existsSync(NGINX_CONF)) {
    errors.push(
        "NGINX-01 docker/nginx.dev.conf est INTROUVABLE. La règle ne peut plus rien vérifier — " +
            "si le fichier a déménagé, mettre ce chemin à jour plutôt que de retirer la règle."
    );
} else {
    const conf = fs.readFileSync(NGINX_CONF, "utf8");
    // Split by `server {` block — each slice runs to the next `server {`.
    const blocks = conf.split(/^server\s*\{/m).slice(1);
    if (blocks.length === 0) {
        errors.push(
            "NGINX-01 docker/nginx.dev.conf ne déclare AUCUN bloc `server` — la règle sortirait " +
                "verte en n'inspectant rien."
        );
    }
    const naked = blocks
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => !NOSNIFF.test(b))
        .map(({ b, i }) => {
            const name = b.match(/server_name\s+([^;]+);/);
            return name ? name[1].trim() : `bloc #${i + 1}`;
        });
    if (naked.length) {
        errors.push(
            `NGINX-01 ${naked.length} vhost(s) sur ${blocks.length} ne posent pas ` +
                `\`add_header X-Content-Type-Options "nosniff" always;\` — ${naked.join(", ")}. ` +
                `nginx n'hérite pas add_header dans un bloc qui déclare le sien : l'oubli est ` +
                `un trou complet et silencieux sur ce vhost.`
        );
    }
}

/**
 * APP-12 — descriptor ↔ boot parity: the discovered fleet and `init.js` name each
 * other, in both directions.
 *
 * It is the surviving half of "generate the boot from the descriptors", and the
 * refusal of the other half is MOTIVATED: the plugins zone of `init.js` is one
 * third comments encoding paid incidents (the inert button's 404, the `beforeBoot`
 * mechanism), and a generator would lose or freeze them; and APP-07 verifies
 * STATIC import paths, which a loop over a manifest would make unverifiable. What
 * generation was meant to kill is DRIFT — a plugin shipped without a boot
 * registration, or a registration targeting a bundle no variant ships. That drift
 * is what is guarded here, without touching `init.js`'s shape.
 *
 * ⚠️ Direction 1 (shipped without boot): a plugin whose bundle goes into the deploy
 * but that no `import()` of init.js names would be shipped dead weight — present on
 * the client's disk, reachable by nobody. Named exception: `offline-ui`, loaded
 * EAGER by its gated `<script>` tag of index.html, never registered from init.js
 * (APP-07 documents it).
 * Direction 2 (boot without bundle): an `import()` targeting a bundle no
 * package.json#geoleaf descriptor declares is the deferred 404 — the button paints,
 * the click breaks.
 */
{
    const { discoverPlugins } = require("./lib/discover-plugins.cjs");
    const fleet = discoverPlugins();
    // Loaded by an index.html `<script>` tag, never registered from init.js.
    // `offline-ui`: its `wireEngineSignals()` surfaces QuotaExceededError and cache
    // eviction to the user — lazy, the listener would never exist.
    // `routing`: its entry point is a feature-info `action` widget, whose guard
    // evaluates on `isLoaded()` ALONE. Lazy, it would mask its own entry point and
    // nothing would ever trigger the load that would display it.
    const EAGER_EXCEPTIONS = new Set(["offline-ui", "routing"]);
    if (init !== null) {
        const imported = new Set(
            [
                ...init.matchAll(
                    /import\s*\(\s*["']\.\/dist\/(geoleaf-[a-z0-9-]+\.plugin\.js)["']\s*\)/g
                ),
            ].map((m) => m[1])
        );
        for (const p of fleet) {
            if (EAGER_EXCEPTIONS.has(p.id)) continue;
            if (!imported.has(p.bundle)) {
                errors.push(
                    `APP-12 le plugin découvert \`${p.id}\` livre \`${p.bundle}\` mais init.js ` +
                        `ne l'importe nulle part — un bundle livré qu'aucun boot n'atteint est ` +
                        `un poids mort chez le client. L'enregistrer (registerLazy), ou le ` +
                        `déclarer eager avec son témoin.`
                );
            }
        }
        const declared = new Set(fleet.map((p) => p.bundle));
        for (const b of imported) {
            if (!declared.has(b)) {
                errors.push(
                    `APP-12 init.js importe \`./dist/${b}\` qu'aucun descripteur ` +
                        `package.json#geoleaf ne déclare — l'import() partira en 404 sur toute ` +
                        `variante, différé au premier clic.`
                );
            }
        }
    }
}

if (errors.length) {
    console.error(`\n✘ APP-TEMPLATE: ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}`);
    console.error("");
    process.exit(1);
}

// ⚠️ The count is DERIVED from this list, never written beside it. It read "7" while APP-08
// was being added — a written total is a second source of truth that can only diverge, which
// is the same doctrine that took the capability counts out of the core entry headers.
const HELD = [
    "bundle ESM",
    "boot()",
    "chemin des icônes",
    "commentaire mono-ligne",
    `${GATED_PLUGINS.length} <script> gatés`,
    "marqueur de préchargement mono-ligne",
    "imports résolvables sur un clone frais",
    "enregistrements gatés encadrés",
    `politique CSP comparée (${Object.keys(EXPECTED_CSP).length} directives)`,
    "nosniff sur chaque vhost",
    "marqueurs du bootstrap de poste + balise mono-ligne",
    "parité flotte découverte ↔ boot (2 sens)",
];

console.log(
    `✔ APP-TEMPLATE: ${path.relative(ROOT, APP)} — ${HELD.length} invariants tenus ` +
        `(${HELD.join(", ")}).`
);
