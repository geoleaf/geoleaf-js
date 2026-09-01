"use strict";

/**
 * Shared PurgeCSS configuration for GeoLeaf-JS.
 *
 * Single source of truth for the CSS sources, content globs and safelist used by
 * BOTH the informational audit (`scripts/audit-cleanup.cjs`) and the blocking
 * dead-CSS CI gate (`scripts/verify-purgecss.cjs`).
 *
 * `content` widened from `core + addpoi + storage` to EVERY workspace plus
 * the HTML templates / demo scripts, so classes referenced outside
 * `packages/core` are seen and not reported as dead.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const toFwd = (p) => p.replace(/\\/g, "/");

// ── Safelist = INTENTIONAL and PERMANENT exemptions only ─────────────────────
//
// It used to read `[/^maplibre/, /^leaflet/, /^gl-/, /^geoleaf/]`. Those last two
// are the project's own prefixes, so they exempted **783 of the 812** classes
// declared under `packages/*/src/**/*.css` (96.4 %): the gate reported "0 dead CSS
// selectors" while verifying essentially nothing, and — worse — could not have
// caught the deletion of a LIVE selector either. Measured: dropping the
// two blanket entries surfaces 425 rejected selectors it had never looked at.
//
// What belongs here: ONLY what PurgeCSS cannot see *by construction*, i.e. a class
// name assembled at runtime from a variable, or injected by a third party.
// Everything else — including deliberately-offered-but-unused utility classes —
// goes to the BASELINE (see verify-purgecss.cjs), so it stays visible as known
// state instead of being silently exempted forever.
//
// ⚠️ "By construction" is the whole test, and it is NOT the same as "PurgeCSS
// currently rejects it". A runtime-assembled class often survives by accident,
// because some unrelated line happens to spell it out — `gl-toast--info` is only
// seen thanks to a `classList.contains()` check at notifications.ts, and
// `gl-print-btn--pdf` only thanks to a querySelector in a *test* file. Its
// siblings (`--error`, `--warning`, `--jpg`) have no such twin and were rejected.
// Basing the safelist on what the tool happens to catch reproduces that lottery;
// basing it on the assembly site does not. Each entry below therefore cites the
// line that builds the name — if you cannot cite one, it does not belong here.
const SAFELIST = {
    standard: [
        // Third-party: injected by the mapping libs, never written in our source.
        /^maplibre/,
        /^leaflet/,
        // `${classPrefix}--collapsed` — kernel/ui/collapsible-toggle.ts.
        // Currently redundant (all 5 resulting classes happen to appear literally
        // elsewhere) — kept deliberately: the prefix is a parameter, so the day a
        // caller stops spelling its modifier out, the class silently goes dark.
        /--collapsed$/,
        // `${classPrefix}__toggle` — kernel/ui/collapsible-toggle.ts. SAME
        // helper as `--collapsed` above, and the exact case that entry warns about:
        // this one was missing while its twin was present, so the collapse BUTTON of
        // both controls that use the helper was reported dead and frozen as such in
        // the baseline — 4 entries for `gl-map-legend__toggle` (capabilities/legend/
        // legend-control.ts) and 7 for `gl-layer-manager__toggle` (modules/
        // built-in/layer-manager/control.ts). Neither call site spells the name out,
        // so the lottery this file describes came up empty for both. Purging "what
        // the baseline says" would have deleted a live style.
        // ⚠️ Matches `*__toggle` only — `gl-filter-panel__toggle-icon` and
        // `__toggle-btn` are literals and stay under the gate.
        /__toggle$/,
        // `gl-notifications--${config.position}` — toast-renderer/notifications.ts.
        /^gl-notifications--/,
        // `gl-geocoding-ctrl--${position}` — plugin-geocoding/src/control.ts.
        /^gl-geocoding-ctrl--/,
        // `gl-toast gl-toast--${type}` — toast-renderer/notifications.ts.
        // Enumerated, not `/^gl-toast--/`: `type` is the closed union `NotifyType`
        // (types.ts), so these four are all the site can emit. A bare prefix
        // would also exempt the toast's OTHER modifiers (`--visible`, `--removing`,
        // `--sliding-up/down`), which are applied from literals and must stay under
        // the gate — `--sliding-down` is in fact dead and is baselined as such.
        // Adding a 5th NotifyType makes the gate flag its CSS loudly; that is the
        // intended failure mode, and it is why the union is mirrored rather than
        // approximated.
        /^gl-toast--(info|success|warning|error)$/,
        // `gl-nav-banner__icon--${cssToken(step.maneuver)}` and the same for the modifier —
        // plugins/navigation/src/ui/maneuver-banner.ts:128-129. Both halves come from the
        // provider's manoeuvre vocabulary (OSRM `maneuver.type` / `maneuver.modifier`), so the
        // set is open in principle and NOTHING spells any of them out in source. The prefix is
        // therefore the honest shape here, not an enumeration: an enumeration would silently go
        // stale the first time a provider emits a token this repository has not met.
        // ⚠️ These styles were absent altogether until 27/08/2026 — the rule declared
        // `mask-size`/`repeat`/`position` and never a `mask-image`, so the icon painted a solid
        // 2rem square of `currentcolor`. Nothing could see it: the classes are assembled, so no
        // static analysis reached them, and the banner itself was hidden behind the theme bar.
        /^gl-nav-banner__icon--/,
        // `gl-print-btn gl-print-btn--${fmt}` — plugin-print/src/modal-renderer.ts.
        // `fmt` comes from `config.exportFormats ?? ["pdf", "jpg"]`, so it is open
        // in principle; only these two defaults have styles, hence the enumeration.
        /^gl-print-btn--(pdf|jpg)$/,
    ],
    // Full selectors PurgeCSS cannot statically verify because they combine a
    // live `gl-` class with an attribute / pseudo / descendant part (e.g.
    // `.gl-form-label[data-required="true"]::after`,
    // `.gl-cache-modal[style*="display: flex"] .gl-cache-modal__content`).
    // Reviewed — live styles toggled at runtime, not dead CSS.
    // `gl-poi-form-info` removed at PLUGINS S10: it was frozen here on the
    // assumption it was "live styles toggled at runtime", but nothing built it —
    // it was the legacy DOM-renderer info box, dead since S2 and deleted with
    // poi-form.css. A greedy entry must guard a class the code actually emits.
    greedy: [/gl-cache-modal/, /gl-form-label/],
};

// Package directories come from the REGISTRY, not from a glob.
//
// `packages/*/src/**` simply stopped matching after the nesting: a stale glob raises
// no error, and purgecss would then have purged live CSS believing it dead. But
// widening it to `packages/**/src/**` traverses `node_modules` — measured: 13
// dependency `.ts` files entered the scanned content, which masks genuinely dead CSS.
//
// The registry gives the exact directories: no stray traversal, no depth
// sensitivity. `_plugin-template` is added explicitly — it sits outside workspaces
// (`!packages/_*`) but its CSS was covered by the old glob, and the perimeter must
// stay identical.
const REGISTRY = require("./packages.cjs");
const PKG_DIRS = [
    ...REGISTRY.all().map((p) => p.absDir),
    path.join(ROOT, "packages", "_plugin-template"),
];

// CSS under audit: every workspace's source CSS (core + all plugins + field-renderer).
const CSS_GLOBS = PKG_DIRS.map((d) => toFwd(path.join(d, "src", "**", "*.css")));

// Content scanned for class usage: every workspace's TS source + the committed
// HTML templates / demo scripts. The generated `deploy/**` artifacts are NOT
// scanned on purpose: they are gitignored and absent in CI at gate time (the
// purgecss gate runs before the build step), and they are derived entirely from
// these source templates — so including them would make the gate non-deterministic
// without adding any unique class reference. Deploy *bundles* (.js) are likewise
// excluded — minified bundles embed every class name as a string and would mask
// genuinely-dead CSS.
// T2 — the app lives in its own workspace; its directory comes from the REGISTRY.
// `requireByDirName` throws when the directory is renamed, where a stale literal glob
// would simply stop matching: purgecss would then watch live selectors die, and the
// baseline would redden with the source untouched. The two files are ENUMERATED, not
// globbed as `*.js`: `connector.local.js` is git-ignored and exists only on a dev box,
// so hoovering it up would make the gate differ between that box and CI.
const APP_DIR = REGISTRY.requireByDirName("geoleaf-app").absDir;

// The app's two content files, ENUMERATED (see above) and exported separately so the
// gate can assert they still resolve. The distinction matters: the derived
// `PKG_DIRS.map(src/**/*.ts)` patterns are ALLOWED to match nothing — several
// workspaces legitimately ship no TS or no CSS — so a blanket "no empty glob" check
// would be false. These two are literal paths to files that must exist, and they are
// the only ones whose muteness would silently shrink the gate's coverage.
const ENUMERATED_CONTENT = [
    toFwd(path.join(APP_DIR, "index.html")),
    toFwd(path.join(APP_DIR, "init.js")),
];

const CONTENT_GLOBS = [
    ...PKG_DIRS.map((d) => toFwd(path.join(d, "src", "**", "*.ts"))),
    ...ENUMERATED_CONTENT,
    // (T1b) `demo/**` globs removed with the demo layer. A glob matching nothing
    // is worse than absent — it reads as coverage and provides none.
];

/**
 * Run PurgeCSS over the shared inputs. CSS is read manually and passed as raw
 * objects (PurgeCSS cannot resolve Windows backslash paths as CSS sources).
 * @returns {Promise<{cssFiles: string[], results: Array<{rejected?: string[], _file?: string}>}>}
 */
async function purge() {
    const { PurgeCSS } = require("purgecss");
    const { glob } = require("glob");

    const nested = await Promise.all(CSS_GLOBS.map((g) => glob(g)));
    const cssFiles = nested.flat();
    const cssRaw = cssFiles.map((f) => ({
        raw: fs.readFileSync(f, "utf8"),
        extension: "css",
        _file: f,
    }));

    const results = await new PurgeCSS().purge({
        css: cssRaw.map(({ raw, extension }) => ({ raw, extension })),
        content: CONTENT_GLOBS,
        rejected: true,
        rejectedCss: false,
        variables: false,
        safelist: SAFELIST,
    });

    // Re-attach filenames (results come back in input order).
    results.forEach((r, i) => {
        r._file = cssRaw[i]?._file;
    });
    return { cssFiles, results };
}

// Only `purge` (the runner) and `ROOT` (used for relative-path display by the
// gate) are part of the module's surface; the globs/safelist/toFwd are internal.
module.exports = { ROOT, purge, CSS_GLOBS, CONTENT_GLOBS, ENUMERATED_CONTENT };
