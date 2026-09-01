#!/usr/bin/env node
/**
 * Bundle size guard for @geoleaf/core.
 *
 * Gates on the artifact the browser actually downloads AND evaluates at boot:
 * the CDN entry `dist/geoleaf.esm.js` PLUS every chunk it imports **statically**
 * (`import …`/`export … from`). A `<script type="module">` resolves those static
 * imports synchronously before the entry finishes evaluating — so the real
 * load-time cost is the *transitive static-import closure*, not the entry alone.
 *
 * Why this rewrite (extractability audit, 2026-06-27): the
 * previous gate measured ONLY `geoleaf.esm.js` (~70 KB gz) and treated every file
 * in `dist/chunks/` as "lazy load on demand". That is FALSE for the ~10 chunks the
 * entry imports statically (route/table/legend/labels/themes/poi/geojson/layers/
 * core-utils/search are eager) — it under-counted the boot cost ~3.4× (~245 KB gz
 * real). Worse, a heavy dependency leaking into a manualChunk (e.g. chunk-core-utils)
 * would NOT grow the entry, so the old gate could not catch it. We now follow the
 * static graph from the entry and gate on the summed gzip — the true boot budget.
 *
 * Dynamic `import("./chunks/…")` edges (the genuinely lazy chunks + their tiny
 * stubs) are intentionally NOT followed: they load on demand, off the boot path.
 *
 * Multi-variant safety: `dist/chunks/` may hold chunks from several builds (with
 * different hashes). Walking the static graph from the real entry selects only the
 * chunks belonging to THIS bundle — never a blind sum of the directory.
 *
 * Note: `dist/esm/bundle-esm-entry.js` is NOT a boot metric — it is the granular
 * (preserveModules) entry for bundlers, a list of re-exports; reported for info only.
 *
 * Per-plugin budgets (Plugin Contract v1, S14): each plugin's shipped bundle
 * `packages/plugins/<name>/dist/geoleaf-<name>.plugin.js` has its own gz budget
 * (override table + default). A missing bundle is skipped with a warning. ⚠️ Do not read
 * that path as authoritative — it is DERIVED from the workspace registry
 * (`PLUGIN_BUNDLES`, see its comment); this line is prose, and it said
 * `packages/plugin-<name>/` — the pre-regrouping layout — for a while.
 *
 * Sourcemaps (perf roadmap S4, F-TOOL-3): the core build EMITS `.map` files. They are
 * not loaded at boot (devtools fetch them on demand), so they are reported and
 * soft-warned only (never hard-fail).
 *
 * ⚠️ This block said "they ARE published to npm" until 2026-08-10, and that is no longer
 * true of the JS maps. `packages/core/package.json` now carries `!dist/**\/*.js.map` in
 * `files[]`: the six JS maps are EMITTED (this gate reads them, and so does
 * `listEagerSources` below, which is the primitive behind `size:example`) but are NOT
 * SHIPPED. The two verbs came apart, and the reason is measured: the core is the only
 * publishable package without `src/` in `files[]`, so its JS maps resolved on 0 of 243
 * sources FROM INSIDE THE TARBALL — dead weight for a consumer, live instrument here.
 * `dist/geoleaf-main.min.css.map` still ships and must: it carries its 35 sources inline,
 * so it is self-contained and resolves without `src/`. Full motive recorded when the
 * core-JS-sourcemaps line settled on 2026-08-10.
 *
 * 🛑 Consequence for whoever reads a number here: this gate's figure measures the BUILD
 * OUTPUT, never the tarball. Do not quote it as "what npm ships" — `npm pack --dry-run`
 * is the only instrument that answers that question.
 *
 * Usage:
 *   node scripts/check-bundle-size.cjs            # core bundle — exits 1 on hard breach
 *   node scripts/check-bundle-size.cjs --plugins  # per-plugin bundles too
 *   require("./check-bundle-size.cjs").checkBundleSize({ log })       # from build-deploy
 *   require("./check-bundle-size.cjs").checkPluginBundles({ log })    # from build-deploy
 *
 * ## Sole size gate of the repo (T6.3, 2026-07-25)
 *
 * Until T6.3 a SECOND device called itself a size gate: `benchmark.cjs --ci`, wired
 * twice (ci.yml:147, ci-local.cjs). Its three assertions were all inert — the
 * tracked baseline `.benchmark-baseline.json` dated 2026-02-27 (Leaflet era) recorded
 * `geoleaf.esm.js` at 1 928 560 B against ~948 B measured today, i.e. −99.95 % against
 * a +5 % threshold, and the two others named `geoleaf-lite.esm.js`, an artifact deleted
 * at S4. It could only ever fail if its own baseline file disappeared. Two steps under
 * one label, and no stateable rule saying which one had authority.
 *
 * ⚠️ This file is now the ONLY device that can refuse a bundle regression, and it is
 * reached THREE ways — all three must stay:
 *   1. `npm run size`                                → ci.yml step + ci-local.cjs step
 *   2. `require()` from build-deploy.cjs   → every deploy variant build
 *   3. `require()` from golden-master.cjs         → the boot snapshot (bootGz)
 * Path (1) was ADDED by T6.3 and is not redundant with (2): before it, the budget sat
 * behind a deploy build, i.e. reachable only under `ci:local --e2e` and only at the
 * LAST step of the CI job. That blind spot is exactly what T6.3 closed — do not
 * "simplify" the step away as already covered.
 *
 * @version 2.4.0
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// ── Boot payload budget (gzip, KB) — the REAL load-time cost ────────────
// = entry `geoleaf.esm.js` + transitive closure of statically-imported chunks.
// Anchored on the real measured eager-boot total (244.9 KB gz / 830.7 KB raw,
// 2026-06-27) with headroom: warn +10 %, fail +22 %. Margins picked to trip on a
// real regression (a heavy dep leaking into the eager path, INCLUDING via a
// manualChunk) without crying wolf on normal feature growth. Ratchet DOWN after
// each feature extraction (e.g. table → plugin ≈ −10.6 KB gz) so the gate keeps
// guarding the new, lighter boot floor.
const BOOT_FAIL_GZ_KB = 300; // HARD — exceeding fails the build
const BOOT_WARN_GZ_KB = 270; // SOFT — warning only

// ── Kernel CSS budget (gzip, KB) — added S12 ───────────────────────────
// `dist/geoleaf-main.min.css` is the single stylesheet every integrator loads
// (exposed as the `./style.css` export). Nothing measured it before: this script
// only ever looked at JS, there is no stylelint in the repo, and the
// `verify:purgecss` gate is vacuous (its safelist exempts ~everything `gl-*`).
// A CSS regression was therefore invisible — S12 found geoleaf-theme.css inlined
// TWICE (a nested @import without layer(), +5.4 KB raw) that had gone unnoticed.
// Anchored on the post-S12 measurement (17.9 KB gz) with the same intent as the
// boot budget: warn ~+17 %, fail ~+34 %. Ratchet DOWN after future purges.
const CSS_FAIL_GZ_KB = 24; // HARD
const CSS_WARN_GZ_KB = 21; // SOFT

// ── Entry-only thresholds — REMOVED (S5) ───────────────────────────────
// There used to be BUNDLE_WARN_GZ_KB = 85 / BUNDLE_FAIL_GZ_KB = 100 here, guarding the size
// of `geoleaf.esm.js` alone. Since `kernel-exports.ts` (S4) much of the entry's content moved
// into chunks, so a threshold on the entry alone could no longer be reached by a regression of
// the payload. It measured nothing while looking like a guard, which is worse than no guard:
// the next reader would have trusted it. (The FAIL constant was exported but never even
// evaluated.) The entry size is still REPORTED below, as what it is: information.
// The real budget is the boot payload — entry + its static closure — above.

// ── Sourcemap budget (gzip, KB) — perf roadmap S4 ──────
// SOFT only — never gates the build (not a boot cost). Anchored with headroom — trips on a
// sourcemap config regression (e.g. maps doubling) only.
// The CLEAN-build baseline is ~275 KB gz (8 .map files), so 900 is well
// calibrated (~3× headroom). A reading in the thousands is almost always STALE ORPHANED
// .map files, not a regression: rollup's `output.dir` overwrites same-named chunks but never
// deletes renamed/removed ones, so repeated local builds pile up orphan chunk maps in
// dist/chunks/. Clean-rebuild (`rm -rf packages/core/dist`) before trusting a high number.
const SOURCEMAP_WARN_GZ_KB = 900; // SOFT — warning only, never fails

const ROOT = path.resolve(__dirname, "..");
// The core through the registry, like the plugins below (:144). The two halves of this
// gate read the same repo through two different means, and only the plugins' half
// survived a move. A stale DIST does not fail the budget: `gzipKB` returns `null`, the
// measurement is skipped, and the size gate goes green without having weighed.
const CORE_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const DIST = path.join(CORE_DIR, "dist");
const BUNDLE_FILE = path.join(DIST, "geoleaf.esm.js"); // chunked CDN bundle — boot artifact
const BUNDLE_MAP = path.join(DIST, "geoleaf.esm.js.map"); // entry sourcemap — shipped, not booted
const CHUNKS_DIR = path.join(DIST, "chunks"); // lazy chunks (+ their .map files)
const GRANULAR_ENTRY = path.join(DIST, "esm", "bundle-esm-entry.js"); // bundler entry — info only

// ── Per-plugin budgets (gzip, KB) — Plugin Contract v1, S14 ──
//
// TWO budgets per plugin since 2026-08-02, because a plugin has TWO costs and
// one number could not express both:
//   - `boot`  — the ENTRY file alone: what a page pays to load the plugin.
//   - `total` — every `.js` emitted in the plugin's `dist/`: what npm ships, lazy
//               chunks included.
// They are equal for the ten single-file plugins; they diverge for the three that split.
//
// ⚠️ WHY BOTH, and not just the total first asked for. Budgeting only the total
// would LOSE the boot signal exactly where it matters most: `print` ships 375 KB gz but
// boots on 37, so its entry could double and still sit far under any total-based fail.
// Budgeting only the entry is the original defect. Neither number alone guards.
//
// 🛑 AND THE FIRST ESTIMATE UNDERSTATED ITS OWN GISEMENT — measured 2026-08-02.
// It named `editor` (+46 KB gz of Terra Draw) as the case. There are THREE splitters,
// and `editor` is the SMALLEST of them:
//     editor          41.7 boot → 88.1 total   (+46.4, Terra Draw)
//     realtime-layer  11.6 boot → 223.4 total  (+211.8, protobuf)
//     print           37.4 boot → 375.7 total  (+338.3, jsPDF + html2canvas)
// ≈ 596 KB gz shipped and budgeted by nothing at all, not the 45.5 the line names.
//
// ANCHORING RULE, uniform and stated so it can be re-derived rather than guessed:
// warn = ceil(measured × 1.15), fail = ceil(measured × 1.30).
// The old table had no rule — its headroom ran from +1.5 % (`offline-ui`) to +217 %
// (`addpoi`), which is how the slack-budget defect happened: `addpoi` was budgeted 200/250 against 79
// measured, so it would have had to TRIPLE to warn. A guard never seen red guards nothing.
//
// ── RE-ANCHORED on the 2026-08-06 build ───────────────────────────
//
// The line above predicted it: « Ratchet DOWN after future purges — […] not minified yet,
// so their numbers WILL drop. » They did. 6.3′ turned `minify: true` on for the 13
// packages that were calling `pluginStack` without it (it is OPT-IN, and `editor` was the
// only one of fifteen to set it), and moved `offline-ui` onto the shared stack. Measured
// across every package bundle: 817 744 → 528 622 bytes gz, i.e. **−35 %**.
//
// 🛑 Why re-anchoring is NOT optional here, and why it needs its own line in the sprint:
// minifying makes every measure DROP, so no budget can fire on it. Nothing goes red, nothing
// asks to be looked at, and the table quietly becomes as slack as the one described above.
// A budget that cannot fire is indistinguishable from no budget at all — which is the exact
// defect this table was rewritten to fix four days ago.
//
// ⚠️ Two near-false-positives retired in passing, both TIGHTER than the two called out on
// 08-02 (`measure` at 0.5 KB, `offline-ui` at 0.7): `editor` sat at 47.9 against a warn of
// 48 — **0.1 KB** — and it was never touched by 6.3′, since it was the one package already
// minified. Its margin had been eaten by the addpoi merge, not by a regression.
//
// ⚠️ `realtime-layer` boot: ceil(4.5 × 1.15) = 6 and ceil(4.5 × 1.30) = 6 collide at this
// size. `fail` is lifted to 7 by hand so the two thresholds stay distinct — a warn that is
// also a fail cannot warn.
// 🛑 **RATCHET-DOWN PASS OF 2026-08-27 — eleven budgets, and it is the SAME MECHANISM as the
// minification pass above, replayed.** The minifier target moved `es2015` → `es2022` (see
// `packages/build-config/rollup.mjs` for why the old one was a circular motive), so esbuild
// stopped rewriting `async`/`await` into generator state machines: **every bundle dropped at
// once — 20.84 KB gz over the 15 plugins plus the core, −4.9 %**.
//
// That is exactly the state this table calls indistinguishable from having no budget: nothing
// reddens, nothing asks to be looked at, and every ceiling silently becomes slack. The pass was
// therefore mechanical — `ceil(×1.15)` / `ceil(×1.30)` on the clean measure, applied ONLY where
// it tightens, never where it would loosen. Four packages were already at or under their
// conforming threshold and were left alone.
//
// ⚠️ **And the measurement had to be taken on a PURGED `dist/`.** The first run of this pass
// read three copies of the jsPDF chunk, two of terra-draw and three of gtfs-rt — hashed chunks
// accumulated by successive `turbo run build --force` without a purge, which the `total` budget
// dutifully added up. It reported `print` at 653 KB against 324 and looked exactly like a
// regression. `node scripts/purge-dist.cjs` first, then the build, then the measure.
const PLUGIN_DEFAULT_GZ_KB = { boot: { warn: 40, fail: 60 }, total: { warn: 40, fail: 60 } };
const PLUGIN_BUDGETS_GZ_KB = {
    // print — entry holds the print logic only; jsPDF (+ optional html2canvas/dompurify)
    // ships in lazy chunks loaded on first PDF export. The boot budget keeps guarding the
    // re-inline regression; the total budget is what finally counts the 338 KB gz of chunks.
    print: { boot: { warn: 19, fail: 21 }, total: { warn: 286, fail: 323 } }, // 17.4 / 248.7
    // realtime-layer — protobuf decoding split into lazy chunks. Its old 100/130 budget sat
    // on an 11.6 KB entry: it could not fire either, for the same reason as addpoi.
    // ⚠️ boot `fail` lifted 6 → 7 by hand: at 4.5 KB the ×1.15 and ×1.30 rules collide.
    "realtime-layer": { boot: { warn: 5, fail: 6 }, total: { warn: 41, fail: 46 } }, // 4.5 / 35.2
    // editor — Terra Draw in a lazy chunk (manualChunks), loaded on first drawing tool.
    // ⚠️ Was 48/55 against 47.9 measured — 0.1 KB from crying wolf, the tightest of the table.
    // A purge removed 337 LOC of dead read surface from `field-renderer`, which `editor`
    // is now the only package to inline — 47.9 → 47.0 boot, 94.3 → 93.4 total.
    editor: { boot: { warn: 54, fail: 61 }, total: { warn: 108, fail: 122 } }, // 47.0 / 93.4
    // cog — geotiff.js. Minified at 6.3′: 161.8 → 99.7 KB gz.
    cog: { boot: { warn: 114, fail: 129 }, total: { warn: 114, fail: 129 } }, // 99.13
    // offline-ui (renamed from `storage` on 26/07/2026 — this key drifted for a
    // few hours and the plugin silently fell back to PLUGIN_DEFAULT_GZ_KB, see
    // assertBudgetKeysAlive() below): UI only since S14 Phase B — the offline engine
    // (IndexedDB / cache / download / sync) moved in-core (dynamic import(), out of this
    // budget). ⚠️ It was measured at 73.3 against a warn of 74 — 0.7 KB from crying wolf.
    // ⚠️ It was the LAST package on a hand-rolled rollup stack — no shared `pluginStack`, so
    // no `minify` flag to turn on. Moved onto the stack at 6.3′: 79.4 → 31.5 KB gz, −59 %.
    // Re-anchored again when `field-renderer` left its dependency list — the
    // responsive modal that came with the import went with it — 31.5 → 28.7.
    "offline-ui": { boot: { warn: 33, fail: 38 }, total: { warn: 33, fail: 38 } }, // 28.7
    // measure — Turf. ⚠️ Was measured at 44.5 against a warn of 45: 0.5 KB from firing, on
    // no regression at all. Re-anchored like the rest.
    measure: { boot: { warn: 25, fail: 28 }, total: { warn: 25, fail: 28 } }, // 21.5
    "file-import": { boot: { warn: 20, fail: 23 }, total: { warn: 20, fail: 23 } }, // 17.07
    flatgeobuf: { boot: { warn: 15, fail: 17 }, total: { warn: 15, fail: 17 } }, // 12.48
    // geocoding: zero npm deps (native fetch) + a small copied pill-search/CSS.
    geocoding: { boot: { warn: 7, fail: 8 }, total: { warn: 7, fail: 8 } }, // 5.78
    // table: zero npm deps — renderer + selection + export + the in-house OOXML (.xlsx)
    // writer inlined (rollup inlineDynamicImports).
    table: { boot: { warn: 18, fail: 20 }, total: { warn: 18, fail: 20 } }, // 15.10
    // taxonomy + feature-info reclassified into @geoleaf/core (SR0) — no longer standalone
    // plugin bundles; their weight is counted in the core boot closure (`npm run size`).
    connector: { boot: { warn: 10, fail: 12 }, total: { warn: 10, fail: 12 } }, // 8.56
    websocket: { boot: { warn: 5, fail: 6 }, total: { warn: 5, fail: 6 } }, // 4.3
    // routing / navigation — the navigation module's two halves, `lazyChunks: false`,
    // hence boot = total. Measured 2026-08-21 at the first pass: 1.56 and 1.49 KB gz.
    //
    // 🛑 THESE BUDGETS SIT ON SHELLS AND THEY REDDEN AS SOON AS CODE ARRIVES — that is
    // what happened, and it is the mechanism working, not a defect. `routing` was
    // anchored at 2/3 on the first measurement (1.56 KB gz, a shell); the two adapters
    // took it to 3.59 and the ratchet bit on the next pass. RE-measured then
    // RE-anchored, never inflated in advance: the ~20/28 target the spec sheet
    // announced is an order of magnitude to replace, and writing it here would have
    // set a ceiling 13× above the real — i.e. no ceiling.
    // ⚠️ `fail` raised 5 → 6 by hand: at 3.59 KB, ceil(×1.15) and ceil(×1.30) both
    // render 5. THIRD collision of that rule in this table — `realtime-layer`,
    // `navigation`, and this one: below about 7 KB, the 15 % gap between the two
    // thresholds is smaller than the rounding that produces them.
    // ⚠️ A budget is not re-anchored at every growth, otherwise the ratchet no longer
    // ratchets: it follows. It re-anchors when it BITES. Twice so far, and the trace
    // of both is what makes the third readable: 1.56 (shell) → 3.59 (the two
    // adapters) → 8.10 (the panel, the controller, the step list, the POI entry point
    // and geolocation).
    // ⚠️ This time `ceil(×1.15)` and `ceil(×1.30)` render 10 and 11: above about 7 KB
    // the rounding rule stops colliding, which it did on the three previous entries.
    //
    // 🛑 **RE-ANCHORED 8.10 → 11.05 on 2026-08-23** — the input path came in: field,
    // typed-coordinates reader, "click on the map" mode, optional seam to geocoding.
    // The ratchet BIT to make it happen, like the three previous times on this
    // package.
    //
    // ⚠️ None of these four pieces is lazy, and that is no oversight: they are what
    // makes the panel usable, so they load exactly when it does. An asynchronous jump
    // between a panel opening and its field appearing would save nothing and add a
    // waiting state to explain.
    //
    // `ceil(×1.15)` and `ceil(×1.30)` render 13 and 15: above the ~7 KB where the
    // rounding rule collides, hence no manual raise.
    routing: { boot: { warn: 13, fail: 15 }, total: { warn: 13, fail: 15 } }, // 11.05
    // ⚠️ `navigation` re-anchored 1.49 → 6.90 on 2026-08-21, and it BIT to make it
    // happen: the guidance engine landed there (projection, progression, hysteresis,
    // state machine), the three platform adapters, the maneuver UI and the camera —
    // plus `@turf/nearest-point-on-line` and `@turf/bearing`, which enter the entry
    // because projection is guidance's first move.
    //
    // 🛑 **Making it lazy INSIDE the package would be machinery without gain.** This
    // plugin is ALREADY `registerLazy`: its bundle is only fetched when the user
    // requests guidance — i.e. exactly when the engine is needed. A second
    // asynchronous jump would save nothing and add a waiting state to explain.
    //
    // ⚠️ This time `ceil(×1.15)` and `ceil(×1.30)` render 8 and 9: at 6.9 KB we are
    // just under the ~7 KB threshold where the rounding rule stops colliding — the
    // two values differ, so NO manual raise is needed here, for the first time in
    // this table on this package.
    //
    // 🛑 **RE-ANCHORED 6.90 → 9.03 on 2026-08-22, and the reason is worth more than
    // the number.** The line above says "the maneuver UI and the camera" among what
    // landed: they were NOT in. Nothing imported `ui/`, so tree-shaking removed them
    // whole — 6.90 KB measured a plugin unable to draw. Wiring the interface from
    // `startSession` brought the three files in, plus `engine/maneuver.ts`:
    // +2.13 KB gz.
    //
    // ⚠️ **The gate was thus GREEN partly BECAUSE the feature was missing.** A budget
    // measures what the bundle contains; it cannot know what it should contain, and
    // an involuntary removal reads there exactly like a successful optimization. The
    // exact counterpart of the E2E oracle that only queried the API: two green
    // instruments on the same hole, each blind on its side.
    //
    // ⚠️ `ceil(×1.15)` and `ceil(×1.30)` render 11 and 12 — well above the ~7 KB
    // where the rounding rule collides, hence no manual raise.
    //
    // 🛑 **RE-ANCHORED 9.03 → 12.36 on 2026-08-27 — and it is the SAME LESSON AS THE
    // LINE ABOVE, on the same package, five days later.** The 9.03 entry says the
    // maneuver UI and the camera "were NOT in", because nothing imported `ui/` and
    // tree-shaking removed them whole. Exactly that had ALSO happened to
    // `platform/wake-lock.ts` and `platform/voice.ts`: no production file imported
    // either, so both were shaken out, and 9.03 measured a plugin that could not keep
    // the screen awake and could not speak — while `keepScreenAwake: true` and
    // `voiceEnabled: true` sat in two profiles claiming otherwise.
    //
    // What the +3.33 KB gz actually buys: the two adapters themselves, the
    // announcement policy (`ui/announcer.ts`), the driver's arrow, the immersive seam,
    // and the manoeuvre icon masks — which had no `mask-image` at all, so the banner
    // painted a solid square.
    //
    // ⚠️ **So the warning written five days ago is now a MEASUREMENT, not a
    // hypothesis**: "the gate was GREEN partly BECAUSE the feature was missing". It
    // has been true twice on this package, and neither time could the budget see it —
    // a budget measures what a bundle CONTAINS and cannot know what it should. The
    // only instrument that found either one was counting importers.
    //
    // ⚠️ `ceil(×1.15)` and `ceil(×1.30)` render 15 and 17.
    //
    // 🛑 **RATCHETED DOWN 12.36 → 11.41 the same day, and this direction is NOT optional
    // either.** The 12.36 above was measured with 0.95 KB gz of DEAD stylesheet inside it:
    // `@geoleaf/host-runtime` injected its tooltip, modal-shell and confirm-dialog sheets at
    // module scope — a side effect rollup cannot remove — so nine plugin bundles carried
    // stylesheets whose JS had been shaken away. Making those three `*.lazy.css` and adopting
    // them at call time removed 5.05 KB gz across the fleet.
    //
    // ⚠️ **Leaving 15/17 on an 11.41 bundle would have been the defect this table names
    // twenty lines above**: "minifying makes every measure DROP, so no budget can fire on it
    // … a budget that cannot fire is indistinguishable from no budget at all". Removing waste
    // does exactly what minifying did — every measure drops at once, nothing reddens, and the
    // ceiling silently becomes 1.5× the thing it guards. `ceil(×1.15)` and `ceil(×1.30)` on
    // the clean measure render 14 and 15.
    //
    // 📌 The other fourteen were checked against the same formula in the same pass and none
    // needed moving: they are already at, or tighter than, what it prescribes.
    navigation: { boot: { warn: 13, fail: 14 }, total: { warn: 13, fail: 14 } }, // 10.52
    // position-share: zero npm deps — two transports, the loop, and a ten-line haversine
    // rather than a deep import into the core (PCB-01). ⚠️ Anchored the day it landed, and it
    // had to be: the default is 40/60, so a plugin measured at 4.4 sat 13× under its own
    // threshold — the budget would have passed whatever happened to it, which is the "green if
    // forgotten" case this table exists to close.
    "position-share": { boot: { warn: 5, fail: 6 }, total: { warn: 5, fail: 6 } }, // 4.4
};
// Plugins to scan — derived from package.json#workspaces, not typed
// out. The BUDGETS above stay hand-written on purpose: they are data (a measured
// threshold per plugin), whereas the list of plugins is a fact about the repo that
// can be read. Deriving the path also survives ARCHI S10 moving plugins under
// `packages/plugins/`, which the previous `path.join(ROOT, "packages", ...)`
// template would not have.
const PLUGIN_BUNDLES = require("./lib/packages.cjs")
    .plugins()
    .map((p) => ({
        name: p.pluginName,
        file: path.join(p.absDir, "dist", p.bundleFile),
    }));

// ── Default minimal logger (overridable by the caller) ──
const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
};
const defaultLog = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    warn: (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
    section: (m) => console.log(`\n${C.cyan}── ${m} ──${C.reset}\n`),
};

/** Gzipped size of a file, in KB. Returns null if the file is missing. */
function gzipKB(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return zlib.gzipSync(fs.readFileSync(filePath), { level: 9 }).length / 1024;
}

/** Raw size of a file, in KB. Returns null if the file is missing. */
function rawKB(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).size / 1024;
}

const fmt = (kb) => (kb == null ? "—" : `${kb.toFixed(1)} KB`);

/**
 * Extracts the STATIC import specifiers of a module's source.
 * Matches `… from "x"` (import/export-from) and side-effect `import "x"`.
 * Excludes dynamic `import("x")` (no `from`, and `import(` ≠ `import"`).
 * @param {string} code
 * @returns {string[]} unique specifiers
 */
function staticImportSpecifiers(code) {
    const specs = new Set();
    let m;
    const fromRe = /(?<![\w$.])from\s*["']([^"']+)["']/g;
    while ((m = fromRe.exec(code))) specs.add(m[1]);
    const sideRe = /(?<![\w$.])import\s*["']([^"']+)["']/g;
    while ((m = sideRe.exec(code))) specs.add(m[1]);
    return [...specs];
}

/**
 * Measures the REAL eager boot payload of a minified entry: the entry plus the
 * transitive closure of the chunks it imports STATICALLY, staying inside `distDir`.
 * Dynamic `import()` edges are not followed. Generalized from the default full
 * bundle to any preset output (S0) — `measureEagerBoot()` is the thin wrapper.
 * `chunkFiles` (added S4) is the chunk list the walk already computed — it used to be
 * thrown away and only its `.size` returned. `listEagerSources()` needs it to recover the
 * SOURCE paths behind the minified chunks, which is the only way to prove a capability is
 * really absent from a bundle rather than merely absent from its module registry.
 *
 * @param {string} entryFile path to the minified entry bundle
 * @param {string} distDir   dir the static closure must stay within
 * @returns {{ gz: number, raw: number, chunks: number, chunkFiles: string[] } | null} null if entry missing
 */
function measureEagerBootAt(entryFile, distDir) {
    if (!fs.existsSync(entryFile)) return null;
    const distRoot = path.resolve(distDir);
    const entry = path.resolve(entryFile);
    const visited = new Set();
    const chunks = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = queue.pop();
        if (visited.has(f)) continue;
        visited.add(f);
        if (!fs.existsSync(f)) continue;
        const code = fs.readFileSync(f, "utf8");
        for (const spec of staticImportSpecifiers(code)) {
            if (!spec.startsWith(".")) continue; // skip bare/external (e.g. maplibre-gl)
            const resolved = path.resolve(path.dirname(f), spec);
            if (!resolved.startsWith(distRoot)) continue; // stay inside distDir
            if (!visited.has(resolved)) {
                queue.push(resolved);
                if (resolved !== entry) chunks.add(resolved);
            }
        }
    }
    let gz = gzipKB(entry) || 0;
    let raw = rawKB(entry) || 0;
    for (const c of chunks) {
        gz += gzipKB(c) || 0;
        raw += rawKB(c) || 0;
    }
    return { gz, raw, chunks: chunks.size, chunkFiles: [...chunks] };
}

/**
 * The SOURCE files inside a bundle's eager boot closure (S4).
 *
 * Walks the same static-import closure as {@link measureEagerBootAt}, then reads each
 * artifact's `.map` and unions its `sources` array. Minified chunks say nothing about what
 * went into them; their sourcemaps say everything.
 *
 * This is the primitive behind `size:example`, and the only honest way to check the claim
 * "capability X is not in this bundle". Checking `GeoLeaf._registry` would NOT do: a
 * capability can be absent from the registry (gated off at runtime) and still be sitting in
 * the file, downloaded on every page load. That gap is precisely the phantom saving S4 had
 * to close — the removed `lazy/{legend,labels,themes}` shells produced exactly it.
 *
 * @param {string} entryFile path to the minified entry bundle
 * @param {string} distDir   dir the static closure must stay within
 * @returns {string[] | null} source paths (as recorded in the sourcemaps), or null if the
 *   entry is missing. Empty array if the build carries no sourcemaps.
 */
function listEagerSources(entryFile, distDir) {
    const boot = measureEagerBootAt(entryFile, distDir);
    if (boot == null) return null;
    const sources = new Set();
    for (const artifact of [path.resolve(entryFile), ...boot.chunkFiles]) {
        const mapFile = `${artifact}.map`;
        if (!fs.existsSync(mapFile)) continue;
        let map;
        try {
            map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
        } catch (_e) {
            continue; // unreadable map — skip, never throw from a measurement
        }
        for (const s of map.sources || []) sources.add(s.replace(/\\/g, "/"));
    }
    return [...sources];
}

/**
 * The default full-bundle eager boot payload — the hard-gated CDN metric.
 * Thin wrapper over {@link measureEagerBootAt} with the fixed full entry/dist.
 * @returns {{ gz: number, raw: number, chunks: number } | null} null if entry missing
 */
function measureEagerBoot() {
    return measureEagerBootAt(BUNDLE_FILE, DIST);
}

/**
 * Generalized static-import closure from an arbitrary entry, staying inside
 * `rootDir`. Returns gzipped + raw KB of the entry plus every module it imports
 * STATICALLY (dynamic `import()` not followed). Unlike {@link measureEagerBootAt}
 * it resolves missing extensions, so it works on `preserveModules` outputs whose
 * import specifiers carry no `.js`. Consumed by `golden-master.cjs`.
 * @param {string} entryFile absolute path to the entry module
 * @param {string} rootDir   absolute dir the closure must stay within
 * @returns {{ gz: number, raw: number, modules: number } | null} null if entry missing
 */
function measureStaticClosure(entryFile, rootDir) {
    if (!fs.existsSync(entryFile)) return null;
    const root = path.resolve(rootDir);
    const entry = path.resolve(entryFile);
    const visited = new Set();
    const modules = new Set();
    const queue = [entry];
    while (queue.length) {
        const f = queue.pop();
        if (visited.has(f)) continue;
        visited.add(f);
        if (!fs.existsSync(f)) continue;
        const code = fs.readFileSync(f, "utf8");
        for (const spec of staticImportSpecifiers(code)) {
            if (!spec.startsWith(".")) continue; // skip bare/external (e.g. maplibre-gl)
            let resolved = path.resolve(path.dirname(f), spec);
            if (!fs.existsSync(resolved)) {
                if (fs.existsSync(`${resolved}.js`)) resolved = `${resolved}.js`;
                else if (fs.existsSync(path.join(resolved, "index.js")))
                    resolved = path.join(resolved, "index.js");
            }
            if (!resolved.startsWith(root)) continue; // stay inside this variant's dist
            if (!visited.has(resolved)) {
                queue.push(resolved);
                if (resolved !== entry) modules.add(resolved);
            }
        }
    }
    let gz = gzipKB(entryFile) || 0;
    let raw = rawKB(entryFile) || 0;
    for (const c of modules) {
        gz += gzipKB(c) || 0;
        raw += rawKB(c) || 0;
    }
    return { gz, raw, modules: modules.size };
}

/**
 * Gzipped + raw size of the core sourcemaps (entry map + all dist/chunks/*.map).
 * @returns {{ gz: number, raw: number, files: number } | null} null if no map found.
 */
function measureSourcemaps() {
    let gz = 0;
    let raw = 0;
    let files = 0;
    const add = (filePath) => {
        const g = gzipKB(filePath);
        if (g == null) return;
        gz += g;
        raw += rawKB(filePath);
        files += 1;
    };
    add(BUNDLE_MAP);
    if (fs.existsSync(CHUNKS_DIR)) {
        for (const name of fs.readdirSync(CHUNKS_DIR)) {
            if (name.endsWith(".map")) add(path.join(CHUNKS_DIR, name));
        }
    }
    return files === 0 ? null : { gz, raw, files };
}

/**
 * Checks the CDN bundle against the budget policy.
 * Hard gate = the eager boot payload (entry + statically-imported chunks).
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if no hard budget is breached (build may proceed)
 */
function checkBundleSize(opts = {}) {
    const log = opts.log || defaultLog;
    log.section("📦 Budget bundle (@geoleaf/core)");

    const boot = measureEagerBoot();
    if (boot == null) {
        log.warn(
            `No built bundle found at ${path.relative(ROOT, BUNDLE_FILE)} — run a build first. Skipping budget check.`
        );
        return true;
    }

    const entryGz = gzipKB(BUNDLE_FILE);
    const entryRaw = rawKB(BUNDLE_FILE);
    const granularGz = gzipKB(GRANULAR_ENTRY);

    // The REAL boot cost: entry + the chunks it imports statically (the browser
    // loads them synchronously at boot). This is the hard-gated metric.
    log.info(
        `Boot payload (entry + ${boot.chunks} static chunks) : ${fmt(boot.gz)} gz / ${fmt(boot.raw)} raw — REAL load-time cost`
    );
    log.info(
        `            budget: warn > ${BOOT_WARN_GZ_KB} KB gz, fail > ${BOOT_FAIL_GZ_KB} KB gz`
    );
    log.info(
        `Entry only  geoleaf.esm.js : ${fmt(entryGz)} gz / ${fmt(entryRaw)} raw (informational, NOT a budget — the budget is the boot payload above)`
    );
    log.info(
        `Granular entry (bundlers, info only) : ${fmt(granularGz)} gz — dynamic import() chunks load on demand`
    );
    log.info("MapLibre GL JS — external peer dependency, out of bundle.");

    let ok = true;
    if (boot.gz > BOOT_FAIL_GZ_KB) {
        log.err(
            `Boot payload budget exceeded: ${boot.gz.toFixed(1)} KB gz > ${BOOT_FAIL_GZ_KB} KB gz. A heavy import likely leaked into the eager path (entry or a statically-imported chunk).`
        );
        ok = false;
    } else if (boot.gz > BOOT_WARN_GZ_KB) {
        log.warn(
            `Boot payload ${boot.gz.toFixed(1)} KB gz > ${BOOT_WARN_GZ_KB} KB gz soft threshold — review recent additions.`
        );
    } else {
        log.ok(`Boot payload within budget (${boot.gz.toFixed(1)} / ${BOOT_FAIL_GZ_KB} KB gz).`);
    }
    // Sourcemaps — tracked, soft-warn only. EMITTED, not shipped: see the file header.
    const maps = measureSourcemaps();
    if (maps == null) {
        log.info("Sourcemaps : none found (build without sourcemap, or pre-build) — skipping.");
    } else {
        log.info(
            `Sourcemaps (.map, ${maps.files} files) : ${fmt(maps.gz)} gz / ${fmt(maps.raw)} raw — build output, NOT in the npm tarball (JS maps excluded by files[])`
        );
        log.info(
            `            budget: warn > ${SOURCEMAP_WARN_GZ_KB} KB gz (soft — never fails the build)`
        );
        if (maps.gz > SOURCEMAP_WARN_GZ_KB) {
            log.warn(
                `Sourcemaps ${maps.gz.toFixed(1)} KB gz > ${SOURCEMAP_WARN_GZ_KB} KB gz soft threshold — check the sourcemap config (a regression may have inflated them).`
            );
        } else {
            log.ok(
                `Sourcemaps within soft budget (${maps.gz.toFixed(1)} / ${SOURCEMAP_WARN_GZ_KB} KB gz).`
            );
        }
    }

    return ok;
}

/**
 * Every key of `PLUGIN_BUDGETS_GZ_KB` must name a plugin that still exists in the
 * registry. Same doctrine as `test-scope.cjs`'s `assertExclusionKeysAlive()`: a
 * dead key is always an error (a plugin was renamed or removed and the override
 * wasn't re-keyed), whereas a plugin ABSENT from this table is the normal case —
 * it just falls back to `PLUGIN_DEFAULT_GZ_KB`.
 *
 * This is exactly the failure that let `offline-ui` (renamed from `storage`)
 * fall off its real 74/86 KB budget onto the default 40/60 KB one —
 * silently, because a stale object key is not a syntax error. `fail: 60` then
 * looked like "a heavy import leaked in" when nothing had leaked at all.
 *
 * @returns {void}
 */
function assertBudgetKeysAlive() {
    const alive = new Set(PLUGIN_BUNDLES.map((p) => p.name));
    const dead = Object.keys(PLUGIN_BUDGETS_GZ_KB).filter((name) => !alive.has(name));
    if (dead.length) {
        throw new Error(
            `check-bundle-size.cjs: PLUGIN_BUDGETS_GZ_KB names a plugin that no longer exists — ` +
                `it no longer overrides anything, and the plugin it meant has silently fallen back to ` +
                `PLUGIN_DEFAULT_GZ_KB.\n` +
                dead.map((name) => `  - "${name}"`).join("\n") +
                `\nKnown plugins: ${PLUGIN_BUNDLES.map((p) => p.name).join(", ")}\n` +
                `Re-key the entry on the plugin's current name, or remove it if the override no longer applies.`
        );
    }
}

/**
 * Every `.js` file a plugin ships, gzipped, in KB — entry included, lazy chunks included.
 *
 * This is the half first missing: the gate weighed `dist/<entry>.js` and nothing else,
 * so anything rollup moved into a `manualChunks` split left the budget WITHOUT A DECISION.
 * `.map` files are deliberately excluded — sourcemaps ship to npm but are never fetched by
 * a running page, and the core half of this script tracks them under their own soft budget.
 *
 * @param {string} distDir absolute path to the plugin's `dist/`
 * @returns {{ total: number, files: {name: string, gz: number}[] } | null} null if unbuilt
 */
function pluginDistWeight(distDir) {
    if (!fs.existsSync(distDir)) return null;
    const files = fs
        .readdirSync(distDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => ({ name: f, gz: gzipKB(path.join(distDir, f)) }))
        .filter((f) => f.gz != null)
        .sort((a, b) => b.gz - a.gz);
    if (!files.length) return null;
    return { total: files.reduce((s, f) => s + f.gz, 0), files };
}

/**
 * Verdict of one measurement against one { warn, fail } pair.
 * @returns {"fail"|"warn"|"ok"}
 */
function budgetVerdict(gz, budget) {
    if (gz > budget.fail) return "fail";
    if (gz > budget.warn) return "warn";
    return "ok";
}

/**
 * Marker classes of the stylesheets `@geoleaf/host-runtime` ships, and the seam that owns each.
 *
 * 🛑 **The oracle, and why it works on a MINIFIED bundle.** Each of these classes is written
 * twice when the seam is really used — once in the stylesheet, once by the JS that sets
 * `className`. Class names survive minification (they are strings the DOM must match), so the
 * COUNT separates the two states without needing a symbol table: **exactly one occurrence means
 * the stylesheet is there and its code is not** — an orphan.
 *
 * ## Why this check lives here and not with the dead-CSS gate
 *
 * `verify-purgecss` compares SOURCE stylesheets to SOURCE class names, and by that measure these
 * sheets are alive: `editor` uses all three. The waste is invisible from source because it is a
 * property of the BUNDLE — of which packages inlined a side effect they never call. This gate is
 * the one that already opens every built bundle, and it runs after the build; purgecss runs
 * before it.
 */
const HOST_RUNTIME_SHEETS = [
    { cls: "gl-form-modal-panel", sheet: "modal-shell", seam: "createModalShell" },
    { cls: "gl-form-modal-confirm", sheet: "confirm-dialog", seam: "confirmDialog" },
    { cls: "gl-tooltip", sheet: "tooltip", seam: "wireTooltips" },
];

/**
 * Fails when a bundle carries a host-runtime stylesheet whose code was tree-shaken away.
 *
 * ## What this catches, measured
 *
 * On 2026-08-27, nine plugin bundles carried 5.05 KB gz of stylesheet for dialogs that were not
 * in them, adopted into `document.adoptedStyleSheets` on every page load. The cause was a
 * module-scope `import "../css/x.css"` in the seam: the build turns that into an unconditional
 * adoption, which is a side effect rollup cannot remove — so the JS went and the CSS stayed.
 *
 * ⚠️ **A unit test cannot replace this.** Under vitest the CSS injector never runs, so putting
 * the module-scope import back passes every suite in the repository — verified by mutation. The
 * defect only exists in the rollup output, so only the rollup output can testify.
 *
 * The remedy, if this ever reddens: name the sheet `*.lazy.css` (which makes
 * `csp-style-inject.mjs` emit no injection at all) and adopt it inside the function that builds
 * the DOM, through `adoptStylesheet(css, key)`. Renaming the import form alone is NOT enough —
 * `rollup-plugin-postcss` emits `export default <css>` either way and appends the injector all
 * the same.
 *
 * @param {string} name - The plugin's name, for the message.
 * @param {string} file - Path to its built bundle.
 * @param {typeof defaultLog} log - Where to report.
 * @returns {boolean} true when no orphaned stylesheet is present.
 */
function checkOrphanStylesheets(name, file, log) {
    let src;
    try {
        src = fs.readFileSync(file, "utf8");
    } catch {
        return true;
    }
    const orphans = HOST_RUNTIME_SHEETS.filter(
        ({ cls }) => (src.match(new RegExp(cls, "g")) || []).length === 1
    );
    for (const { sheet, seam } of orphans) {
        log.err(
            `${name}: la feuille \`${sheet}\` de host-runtime est dans le bundle, mais \`${seam}\` n'y est pas — ` +
                `une feuille adoptée au chargement pour un composant absent. Voir checkOrphanStylesheets.`
        );
    }
    return orphans.length === 0;
}

/**
 * Checks each plugin against its per-plugin budgets — BOOT (entry alone) and TOTAL
 * (every emitted `.js`). See PLUGIN_BUDGETS_GZ_KB for why both are needed.
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if no hard budget is breached (build may proceed)
 */
function checkPluginBundles(opts = {}) {
    const log = opts.log || defaultLog;
    assertBudgetKeysAlive();
    log.section("📦 Budget bundle (plugins) — boot (entrée) + total (tout le dist/)");

    let allOk = true;
    for (const { name, file } of PLUGIN_BUNDLES) {
        const budget = PLUGIN_BUDGETS_GZ_KB[name] || PLUGIN_DEFAULT_GZ_KB;
        const boot = gzipKB(file);
        if (boot == null) {
            log.warn(
                `${name}: no built bundle at ${path.relative(ROOT, file)} — run a build first. Skipping.`
            );
            continue;
        }
        const weight = pluginDistWeight(path.dirname(file));
        const total = weight ? weight.total : boot;
        const split = weight && weight.files.length > 1;

        const bootVerdict = budgetVerdict(boot, budget.boot);
        const totalVerdict = budgetVerdict(total, budget.total);
        if (bootVerdict === "fail" || totalVerdict === "fail") allOk = false;
        // A correctness check, not a budget: an orphaned stylesheet is weight the bundle should
        // not carry AT ALL, so it fails rather than warns — a warn would leave it in place.
        if (!checkOrphanStylesheets(name, file, log)) allOk = false;

        // A split plugin gets its chunk list printed on breach: "the total is over" is not
        // actionable on its own — which chunk grew is.
        const detail = split
            ? ` [${weight.files.map((f) => `${f.name} ${f.gz.toFixed(1)}`).join(" · ")}]`
            : "";

        if (bootVerdict === "fail") {
            log.err(
                `${name}: boot ${boot.toFixed(1)} KB gz > ${budget.boot.fail} KB gz (fail). A heavy import likely leaked into the entry.${detail}`
            );
        } else if (bootVerdict === "warn") {
            log.warn(
                `${name}: boot ${boot.toFixed(1)} KB gz > ${budget.boot.warn} KB gz (warn) — review recent additions.`
            );
        }

        // Only reported for a SPLIT plugin: on a single-file one the total IS the entry, so
        // printing it again would double every breach and make the gate look twice as loud as
        // it is. The budget still applies — `allOk` was computed above, before this guard.
        if (split && totalVerdict === "fail") {
            log.err(
                `${name}: total ${total.toFixed(1)} KB gz > ${budget.total.fail} KB gz (fail). A lazy chunk grew, or a new one appeared.${detail}`
            );
        } else if (split && totalVerdict === "warn") {
            log.warn(
                `${name}: total ${total.toFixed(1)} KB gz > ${budget.total.warn} KB gz (warn) — review the chunk list.${detail}`
            );
        }

        if (bootVerdict === "ok" && totalVerdict === "ok") {
            const totalCol = split ? ` · total ${total.toFixed(1)} / ${budget.total.fail}` : "";
            log.ok(`${name}: boot ${boot.toFixed(1)} / ${budget.boot.fail} KB gz${totalCol}`);
        }
    }
    return allOk;
}

/**
 * Checks the shipped kernel stylesheet against the CSS budget.
 * @param {{ log?: typeof defaultLog }} [opts]
 * @returns {boolean} true if the hard budget holds (build may proceed)
 */
function checkCssBundle(opts = {}) {
    const log = opts.log || defaultLog;
    log.section("🎨 Budget CSS (@geoleaf/core)");

    const file = path.join(DIST, "geoleaf-main.min.css");
    const gz = gzipKB(file);
    if (gz == null) {
        log.warn(
            `no built stylesheet at ${path.relative(ROOT, file)} — run a build first. Skipping.`
        );
        return true;
    }
    if (gz > CSS_FAIL_GZ_KB) {
        log.err(
            `geoleaf-main.min.css: ${gz.toFixed(1)} KB gz > ${CSS_FAIL_GZ_KB} KB gz (fail). ` +
                `Check for a duplicated @import (a nested one without layer() inlines its target twice).`
        );
        return false;
    }
    if (gz > CSS_WARN_GZ_KB) {
        log.warn(
            `geoleaf-main.min.css: ${gz.toFixed(1)} KB gz > ${CSS_WARN_GZ_KB} KB gz (warn) — review recent additions.`
        );
        return true;
    }
    log.ok(`geoleaf-main.min.css: ${gz.toFixed(1)} / ${CSS_FAIL_GZ_KB} KB gz`);
    return true;
}

module.exports = {
    checkBundleSize,
    checkPluginBundles,
    checkCssBundle,
    assertBudgetKeysAlive,
    // Exported for probe-gate-visibility.cjs's mutation test only — it plants a
    // dead key on this SAME object and asserts assertBudgetKeysAlive() throws, then
    // removes it. Not meant for consumption otherwise; the getter functions above
    // are the real API.
    PLUGIN_BUDGETS_GZ_KB,
    measureEagerBoot,
    measureEagerBootAt,
    measureStaticClosure,
    listEagerSources,
    gzipKB,
    BOOT_FAIL_GZ_KB,
    BOOT_WARN_GZ_KB,
    CSS_FAIL_GZ_KB,
    CSS_WARN_GZ_KB,
};

// Run standalone
if (require.main === module) {
    const withPlugins = process.argv.includes("--plugins");
    const coreOk = checkBundleSize();
    const cssOk = checkCssBundle();
    const pluginsOk = withPlugins ? checkPluginBundles() : true;
    process.exitCode = coreOk && cssOk && pluginsOk ? 0 : 1;
}
