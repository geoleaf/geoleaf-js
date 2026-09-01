// @ts-check
// Shared axe-core configuration for all GeoLeaf E2E accessibility tests.
// Uses @axe-core/playwright (AxeBuilder) — WCAG 2.1 A+AA tags, MapLibre canvas excluded.

import { AxeBuilder } from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa"];

/**
 * Selectors for MapLibre GL internals that cannot have accessible names by design.
 * Excluding them prevents false positives unrelated to application code.
 */
const MAPLIBRE_EXCLUDES = [".maplibregl-canvas", ".maplibregl-canvas-container"];

/**
 * axe rules disabled globally:
 * - svg-img-alt: MapLibre SVG icon sprites carry no text alternative by design.
 */
const DISABLED_RULES = ["svg-img-alt"];

/**
 * Waits until no CSS animation or transition is still RUNNING in the scanned scope.
 *
 * ⚠️ WHY THIS WAIT EXISTS — diagnosis of 2026-07-24.
 * `10-addpoi.spec.js` ([a11y] add form modal) failed **3 times out of
 * 4**, on *serious* `color-contrast` violations. It was not a contrast
 * defect:
 *
 *   | Scan moment               | panel opacity      | violations |
 *   | ------------------------- | ------------------ | ---------- |
 *   | at `toBeVisible()`        | **0**              | 3/5 dirty  |
 *   | after stabilisation       | 1                  | **0/5**    |
 *
 * `expect(locator).toBeVisible()` is satisfied as soon as the element has a
 * non-empty box: **opacity is not part of that criterion**. The scan thus
 * landed mid-fade, and `axe` measured INTERPOLATED colours — hence ratios
 * differing at every run (2.84 · 2.12 · 4.35) and colours (`#8a909b` on
 * `#f1f1f1`) that are the final state of nothing. Stabilised:
 * `rgb(15,23,42)` on white, ~16:1.
 *
 * The predicate bears on ANIMATIONS, not on a target opacity value: an
 * element can legitimately end at `opacity: 0.5` (disabled control), and
 * demanding `1` would wait for nothing. **Best-effort and bounded**: an
 * endless animation (spinner) must not block the scan, so the expiry is
 * swallowed and the scan happens anyway.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector] scope; the whole page if omitted
 */
async function waitAnimationsSettled(page, selector) {
    await page
        .waitForFunction(
            (sel) => {
                const roots = sel
                    ? [...document.querySelectorAll(sel)]
                    : [document.documentElement];
                if (!roots.length) return true;
                return roots.every((el) =>
                    typeof el.getAnimations === "function"
                        ? el
                              .getAnimations({ subtree: true })
                              .every((a) => a.playState !== "running")
                        : true
                );
            },
            selector,
            { timeout: 2000 }
        )
        .catch(() => {
            /* endless animation, or absent selector: scan the current state */
        });
}

/**
 * Runs a full-page WCAG 2.1 AA axe scan, excluding MapLibre GL internals.
 * Waits for in-flight animations to settle first (see {@link waitAnimationsSettled}).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('axe-core').AxeResults>}
 */
async function scanPage(page) {
    await waitAnimationsSettled(page);
    let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(DISABLED_RULES);
    for (const sel of MAPLIBRE_EXCLUDES) {
        builder = builder.exclude(sel);
    }
    return builder.analyze();
}

/**
 * Runs a WCAG 2.1 AA axe scan scoped to a single component by CSS selector.
 * Useful for modal dialogs, panels, or toolbars in isolation — i.e.
 * precisely the surfaces that open with a fade, hence the stabilisation
 * wait.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector CSS selector to scope the scan to
 * @returns {Promise<import('axe-core').AxeResults>}
 */
async function scanComponent(page, selector) {
    await waitAnimationsSettled(page, selector);
    return new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules(DISABLED_RULES)
        .include(selector)
        .analyze();
}

export { scanPage, scanComponent, waitAnimationsSettled };
