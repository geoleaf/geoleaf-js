#!/usr/bin/env node
"use strict";
/**
 * check-app-payload.cjs — the APPLICATION's weight, not the core's alone.
 *
 * ## The hole this gate closes
 *
 * `check-bundle-size.cjs` measures the closure of the core's STATIC imports and goes
 * green at ~183 / 300 KB gz. That is right, and it is 12 % of what a page loads. The
 * remaining 88 % — profile data, eager plugins, CSS, icons — were weighed by NOTHING.
 *
 * The consequence is not theoretical: at the time this gate was written, `icons/fav.png`
 * weighed 172.7 KB gz — more than the entire core bundle — on a `<link rel="icon">`,
 * and nobody had seen it, because no instrument looked there. A weight reduction no
 * gate holds re-degrades; that is the gate's entire rationale.
 *
 * ⚠️ **This gate does not replace `check-bundle-size.cjs` and never compares to it.**
 * The two measure two objects: one what an INTEGRATOR embarks by importing the package,
 * the other what a USER downloads by opening the page. Merging them would mean losing
 * whichever of the two is not at fault the day one of them goes red.
 *
 * ## What is weighed, and where it comes from
 *
 * No list is written here. Everything is derived by `lib/boot-assets.cjs`, THE SAME
 * module `build-deploy.cjs` uses to inject `STATIC_ASSETS` and the `modulepreload`s —
 * one corpus, two consumers. Two line items:
 *
 *   • **the shell** — `deriveBootCriticalAssets()`: what the patched markup references,
 *     what the entry imports statically, and the root config;
 *   • **the data** — `deriveFirstScreenData()`: the profile bundle, plus the file of
 *     each layer the default theme lights up.
 *
 * ## ⚠️ The blind spot, named rather than silent
 *
 * `init.js` preloads in its `beforeBoot` hook the plugins THE PROFILE demands
 * (`realtime-layer` when a layer declares `data.realtime.enabled`, `connector` when
 * `showCredentialButton` is true, and now `geocoding`). Those `import()`s are invisible
 * to the markup, hence invisible here. The number stays RIGHT for what it measures —
 * what the document requests — but it is not the network total.
 *
 * ⚠️ **Do not write that blind spot's total here.** This paragraph priced "~14 KB gz"
 * over TWO plugins until 2026-08-08; `geocoding`'s entry made it stale without anything
 * saying so, and the list will grow again — the same treatment is planned for `editor`
 * and `table`, same conditions. A prose total over a moving list is a second source of
 * truth (the count derives): the measurement is made by reading `init.js`'s
 * `beforeBoot` hook, which is the list itself.
 *
 * Catching it would require replaying `init.js`'s activation logic in a build script,
 * i.e. a second copy free to diverge — the exact defect this module avoids elsewhere.
 * We prefer an honest number over a named perimeter to a complete number over a lying
 * one. The network total is measured in the browser, and a waterfall-backed browser
 * measurement will do it.
 *
 * ## Why `deploy-coverage` is not gated
 *
 * It is an INSTRUMENTED variant: its bundle carries the coverage counters of
 * `packages/core/rollup.config.mjs` and weighs more by construction. Gating it would
 * require a second threshold that says nothing about the product, and the instrument's
 * first version bump would redden it without a shipped byte moving. It is named here
 * rather than omitted: a variant absent without a reason is indistinguishable from a
 * forgotten one.
 *
 * ## Threshold anchoring
 *
 * `warn = ⌈measured × 1.02⌉`, `fail = ⌈measured × 1.05⌉`.
 *
 * 🛑 **This paragraph stated the inherited rule — `×1.15` / `×1.30` — "and it is not
 * reinvented" until 2026-08-08, while the BUDGETS block refutes it 40 lines below.**
 * Both inherited calibrations were tried here and caught out, each time by a mutation
 * that PASSED: `×1.30` let the 172.7 KB gz favicon come back (+12.9 %), and `×1.10`
 * only rendered a WARNING on `cog` returning eager (+8.5 %) — and `ci:local` does not
 * redden on a warning. The record of both reads in the BUDGETS block, and it is
 * authoritative.
 *
 * ⚠️ **What the contradiction cost**: a reader coming to calibrate a NEW budget read
 * here a 30 % margin the measurement proved incapable of reddening on the return of the
 * very defect that had the gate written. What stays true of it, and is the substance: a
 * margin set by feel is a decorative guard — the old per-plugin table ranged from
 * +1.5 % to +217 %, and the one at +217 % could catch nothing. It is the RULE that
 * differs, not the rationale: a plugin bundle's weight drifts slowly by code accretion,
 * a page payload moves by one single asset that commonly weighs 10 % of it.
 *
 * 🔻 **Thresholds ratchet DOWNWARD.** After any slimming, re-anchor. A budget left
 * above the measurement hands the margin to whoever will re-spend it.
 *
 * ## Usage
 *
 *     node scripts/check-app-payload.cjs            # gate
 *     node scripts/check-app-payload.cjs --detail   # + the per-asset detail
 *
 * @module scripts/check-app-payload
 */

const fs = require("node:fs");
const path = require("node:path");

const {
    extractEagerChunks,
    deriveBootCriticalAssets,
    deriveFirstScreenData,
    gzipSize,
} = require("./lib/boot-assets.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");
const DETAIL = process.argv.includes("--detail");

// ── Per-variant budgets (gz, KB) ─────────────────────────────────────────
//
// The active values are those of the LAST history line below, never a date frozen in
// this header. ⚠️ This comment said "measured on 07/08 […] still to come: geometry
// simplification" until 2026-08-08, while that step was settled and recorded three
// lines lower: the header announced as upcoming a plateau its own history attested.
// The history is authoritative.
//
// 🛑 **THE INHERITED ANCHORING RULE WAS TRIED HERE, AND IT CANNOT GO RED.**
//
// `warn = ⌈measured × 1.15⌉`, `fail = ⌈measured × 1.30⌉` is right for a PLUGIN BUNDLE,
// whose weight drifts slowly, by code accretion. A page payload does not drift that
// way: a SINGLE asset commonly weighs 10 % of it. Measured in place — restoring the
// 172.7 KB gz favicon that had just been removed costs **+12.9 %** on `deploy-full`,
// so the gate would have stayed GREEN on the exact return of the defect that had it
// written. A 30 % margin hands out the next 30 % in advance.
//
// ⚠️ AND `×1.10` NEITHER — second calibration caught out, by the same method.
// Putting `cog` (99.8 KB gz, the heaviest plugin) back as an eager tag only costs
// **+8.5 %** once the base is down to 1,173: the gate came out as a WARNING, and
// `ci:local` does not redden on a warning. The exact return of the defect just removed
// would have passed. A threshold is not calibrated on what feels reasonable, but on
// the smallest regression one refuses to let through — here, a plugin put back eager.
//
// Retained rule — `warn = ⌈measured × 1.02⌉`, `fail = ⌈measured × 1.05⌉`. What it
// tolerates is measurable: at identical source, two builds only vary by hashed chunk
// names, i.e. a few hundred bytes. 5 % is ~58 KB — nobody gets there without meaning
// to. The budget is then edited BY HAND, with the matching history line.
//
//   deploy-core : 1,192.5 measured → warn 1,217, fail 1,253
//   deploy-full : 1,223.9 measured → warn 1,249, fail 1,286
//
// 📉 Ratchet history, so the descent is readable and a climb shows:
//   07/08 — 1,195.2 / 1,326.4  (after the favicon removal: −171.6 KB gz)
//   07/08 — 1,142.2 / 1,173.4  (after 7 plugins made lazy: −153.0 KB gz on `full`)
//   07/08 —   914.6 /   946.0  (after coordinate rounding: −227.9 KB gz)
//   ⇒ start 1,367 / 1,497 → arrival 914.6 / 946.0, i.e. −36.8 % on `deploy-full`.
//   08/08 — 1,193.5 / 1,224.9  (after self-hosting MapLibre: +278.9 KB gz) 🔺 CLIMB
//   08/08 — 1,192.5 / 1,223.9  (after the chunk-labels merge: −1.0 KB gz, one request fewer)
//   08/08 — 1,199.9 / 1,231.2  (MapLibre 5.21.0 → 6.2.0: +4.9 KB gz) 🔺 climb, rationale below
//
// 🔺 Second climb, by far the smallest — but its MEANING is what matters here.
//
// v6 is ESM-only: the engine goes from one file (274.4 KB gz) to three modules plus a
// shim (139.1 + 133.6 + 6.0 + ~0), i.e. **+4.9 KB gz** for the same engine. The shell
// goes from 14 to 17 assets: exactly the three modules `boot-assets.cjs`'s closure
// brings into the pre-cache, and that no derivation saw before it.
//
// 🛑 **ON THIS LINE ITEM, A DROP IS A SYMPTOM, NOT A GAIN.** The engine's modules are
// named in NO markup: they only enter the measurement through the closure. If it stops
// matching (different minifier, renamed chunk), this total **drops by about 140 KB**
// and the gate congratulates — while measuring an application that can no longer paint
// a map offline. Read the detail line by line (`--detail`), never the total alone: the
// five `vendor/maplibre-gl/*` entries must be there.
//
// 🔺 **THE RATCHET'S FIRST CLIMB, AND IT SPENDS NO MARGIN.**
//
// The 🔻 doctrine above stays whole: a budget left above the measurement hands the
// margin to whoever will re-spend it. That is not what happens here, and the rationale
// must be read before being believed.
//
// These 278.9 KB gz are MapLibre. **The user was already downloading them** — from
// `unpkg.com`, at every first load. They escaped this gate for a reason that has
// nothing to do with weight: `extractHtmlAssetRefs` (`lib/boot-assets.cjs`) sets aside
// cross-origin URLs, because `cache.addAll()` would reject the pre-cache batch on any
// of them. **This gate was thus not measuring the payload, it was measuring the
// same-origin payload** — and the gap between the two was 278.9 KB, i.e. 23 % of the
// page, invisible.
//
// Self-hosting does not make the page one byte heavier: it brings into the measurement
// what was slipping out of it. What the number gains in passing is honesty, not fat —
// and what the deploy output gains is one origin fewer (a DNS + TCP + TLS), a version
// drift made impossible (`require.resolve`), and MapLibre in the worker's pre-cache,
// hence a map that works on the second load offline.
//
// ⚠️ **The consequence going forward: the next person reading "1,224.9" must not
// compare it to the "946.0" of the line above.** The two do not measure the same
// perimeter. The honest comparison is 946.0 + 278.9 = 1,224.9 — exactly zero
// regression. The ratchet resumes its descent from here, on a perimeter finally
// complete.
//
// ⚠️ An intermediate plateau existed at 889.6 / 921.1, Douglas-Peucker enabled at
// 11 m. It was ABANDONED: DP only returned 24.8 KB gz more (10 % of the gain) for a
// geometric deviation reaching 11 m, i.e. ~21 px at zoom 18. The full record is in
// `build-deploy.cjs`, at the `GEOJSON_TOLERANCE_DEG` comment. Do not "reclaim" those
// 25 KB without re-reading that record.
const BUDGETS = {
    "deploy-core": { warn: 1217, fail: 1253 },
    "deploy-full": { warn: 1249, fail: 1286 },
};

// Variants deliberately out of budget, with their reason. ⚠️ The reason is not
// decorative: without it, the exclusion re-reads six months later as an oversight.
const NOT_BUDGETED = {
    "deploy-coverage":
        "variante instrumentée (compteurs de couverture) — pèse plus par construction",
};

const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
};
const kb = (bytes) => (bytes / 1024).toFixed(1);

/**
 * Weighs a deployed variant: the derived shell plus the first-screen data.
 *
 * @param {string} variant Variant directory name (e.g. `deploy-full`).
 * @returns {{ shell: number, data: number, total: number, assets: string[], files: string[],
 *   remote: string[], themeId: string, detail: Array<{ url: string, gz: number, kind: string }> }}
 * @throws {Error} Propagated from the derivations — unreadable entry, extractor gone
 *   blind, derived URL with no file behind it, theme that lights up no layer.
 */
function weighVariant(variant) {
    const dir = path.join(DEPLOY, variant);
    const patchedHtml = fs.readFileSync(path.join(dir, "index.html"), "utf-8");
    const eagerChunks = extractEagerChunks(path.join(dir, "dist", "geoleaf.esm.js"));
    const { assets } = deriveBootCriticalAssets({ outDir: dir, patchedHtml, eagerChunks });
    const { themeId, files, remote } = deriveFirstScreenData(dir);

    const detail = [];
    let shell = 0;
    for (const url of assets) {
        const gz = gzipSize(path.join(dir, url.split("?")[0]));
        shell += gz;
        detail.push({ url, gz, kind: "shell" });
    }
    let data = 0;
    for (const rel of files) {
        const gz = gzipSize(path.join(dir, rel));
        data += gz;
        detail.push({ url: rel, gz, kind: "data" });
    }
    detail.sort((a, b) => b.gz - a.gz);
    return { shell, data, total: shell + data, assets, files, remote, themeId, detail };
}

function main() {
    if (!fs.existsSync(DEPLOY)) {
        console.error(
            `${c.red}✗${c.reset}  deploy/ absent — bâtir d'abord : ` +
                `npx turbo run build && npm run build:deploy`
        );
        process.exit(1);
    }

    const present = fs
        .readdirSync(DEPLOY, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    // Anti-empty-gate. A gate that finds no subject must GO RED, not congratulate:
    // it is the class `probe-gate-visibility.cjs` watches across the repo, and the one
    // that let a boot probe come out green with its marker deleted.
    const budgeted = Object.keys(BUDGETS).filter((v) => present.includes(v));
    if (budgeted.length === 0) {
        console.error(
            `${c.red}✗${c.reset}  aucune des ${Object.keys(BUDGETS).length} variantes budgétées ` +
                `n'est dans deploy/ (présentes : ${present.join(", ") || "aucune"}). ` +
                `Une gate sans sujet ne garde rien.`
        );
        process.exit(1);
    }

    console.log(`\n${c.cyan}── 📦 Payload de première page (application, pas core) ──${c.reset}\n`);

    let failed = false;
    let warned = false;

    for (const variant of budgeted) {
        const { shell, data, total, assets, files, remote, themeId, detail } =
            weighVariant(variant);
        const budget = BUDGETS[variant];
        const totalKb = total / 1024;

        console.log(`${c.cyan}${variant}${c.reset}`);
        console.log(
            `${c.dim}   shell   ${String(assets.length).padStart(3)} assets dérivés` +
                `${" ".repeat(6)}${kb(shell).padStart(8)} Ko gz${c.reset}`
        );
        console.log(
            `${c.dim}   données ${String(files.length).padStart(3)} fichiers (thème « ${themeId} »)` +
                `${remote.length ? `, ${remote.length} distante(s)` : ""}` +
                `   ${kb(data).padStart(6)} Ko gz${c.reset}`
        );

        if (DETAIL) {
            for (const d of detail.slice(0, 12)) {
                console.log(
                    `${c.dim}      ${kb(d.gz).padStart(8)} Ko  ${d.kind.padEnd(5)}  ${d.url}${c.reset}`
                );
            }
        }

        const verdict = `${kb(total)} / ${budget.fail} Ko gz`;
        if (totalKb > budget.fail) {
            console.log(`${c.red}✗  DÉPASSEMENT — ${verdict} (fail > ${budget.fail})${c.reset}\n`);
            failed = true;
        } else if (totalKb > budget.warn) {
            console.log(
                `${c.yellow}⚠  au-dessus du seuil d'alerte — ${verdict} ` +
                    `(warn > ${budget.warn})${c.reset}\n`
            );
            warned = true;
        } else {
            console.log(`${c.green}✓  dans le budget — ${verdict}${c.reset}\n`);
        }
    }

    for (const [variant, motive] of Object.entries(NOT_BUDGETED)) {
        if (present.includes(variant)) {
            console.log(`${c.dim}   ${variant} — non budgétée : ${motive}${c.reset}`);
        }
    }

    // The tally is DERIVED from the list, never hand-written, after the
    // "7 invariants held" that `verify-app-template.cjs` kept printing while an eighth
    // was being added to it.
    console.log(
        `\n${c.dim}${budgeted.length} variante(s) pesée(s). ` +
            `⚠️ Objet distinct de \`npm run size\`, qui mesure la clôture statique du CORE.${c.reset}`
    );

    if (failed) process.exit(1);
    if (warned) console.log(`${c.yellow}⚠  alerte(s) — le build n'échoue pas.${c.reset}`);
    console.log(`${c.green}✓  Payload applicatif dans les budgets.${c.reset}\n`);
}

try {
    main();
} catch (err) {
    console.error(`${c.red}✗${c.reset}  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}
