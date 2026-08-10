// @ts-check
// Perf roadmap Sprint 4 (F-TOOL-3) — Web Vitals capture for e2e.
//
// Injects the `web-vitals` library (IIFE build, global `webVitals`) into the page
// BEFORE any page script runs, so LCP/INP/CLS observers are armed early enough to
// catch the largest paint and first interactions. Values accumulate on
// `window.__webVitals` and are read back after the test drives a few interactions.
//
// IMPORTANT: web-vitals is a devDependency injected at TEST runtime only — it is
// NEVER imported into packages/core/src, so the shipped bundle is unaffected
// (prove it: `npm run size` stays at ~70 KB gz). These metrics share the FPS
// posture (Sprint 2 finding): captured under E2E_HW_GL=1 but NOT gated — under the
// WSLg virtualized GPU, paint/interaction timings are not representative.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Absolute path to the web-vitals IIFE build (root node_modules). */
function resolveIifePath() {
    // Repo-relative path first (robust against the package's `exports` map).
    const local = path.join(
        __dirname,
        "..",
        "..",
        "node_modules",
        "web-vitals",
        "dist",
        "web-vitals.iife.js"
    );
    if (fs.existsSync(local)) return local;
    // Fallback: locate via the package.json (always exported).
    const pkgDir = path.dirname(require.resolve("web-vitals/package.json"));
    return path.join(pkgDir, "dist", "web-vitals.iife.js");
}

// web-vitals IIFE source, read once. The IIFE declares a top-level `var webVitals`
// — but Playwright evaluates each addInitScript in its OWN function scope, so that
// `var` does NOT leak to `window`. The fix: concatenate the library and the
// handler registration into a SINGLE init script, so the in-scope `webVitals`
// binding is visible to the registration closure (no global needed).
const WV_IIFE_SOURCE = fs.readFileSync(resolveIifePath(), "utf8");

const REGISTER_SRC = `
;(function () {
  var store = { lcp: null, inp: null, cls: null };
  window.__webVitals = store;
  if (typeof webVitals === 'undefined' || !webVitals) return;
  var opts = { reportAllChanges: true };
  webVitals.onLCP(function (m) { store.lcp = m.value; }, opts);
  webVitals.onINP(function (m) { store.inp = m.value; }, opts);
  webVitals.onCLS(function (m) { store.cls = m.value; }, opts);
})();
`;

/**
 * Arm Web Vitals collection on `page`. MUST be called BEFORE `page.goto(...)`:
 * the init script applies to the next navigation, so observers exist before the
 * page paints / handles its first input.
 * @param {import('@playwright/test').Page} page
 */
async function injectWebVitals(page) {
    // Single script: library + registration share one function scope, so the
    // registration closure can reach the IIFE's `webVitals` binding directly.
    await page.addInitScript({ content: WV_IIFE_SOURCE + "\n" + REGISTER_SRC });
}

/**
 * Read the accumulated Web Vitals. Any metric not yet observed is null.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ lcp: number|null, inp: number|null, cls: number|null }>}
 */
async function readWebVitals(page) {
    return page.evaluate(() => window.__webVitals || { lcp: null, inp: null, cls: null });
}

export { injectWebVitals, readWebVitals };
