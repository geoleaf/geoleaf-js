// @ts-check
// GeoLeaf inside a host page, measured on the delivered bundle in the real engine: the host's
// generic rules do not repaint GeoLeaf's controls, and GeoLeaf's fixed panels stay under the
// host's modal dialogs.
//
// 🛑 THE DEFECT. Every GeoLeaf rule lives in a `gl.*` cascade layer, and an UNLAYERED rule beats
// every layered one whatever its specificity. A host's `select { color: #e4e4e4; background:
// transparent }` thus overrode the colours the layer manager's selects carry, and the basemap
// credit inherited the host's light text: light on light, 1.24:1 for the three controls. Seen red
// on the bundle built before the fix. The remedy is `css/geoleaf-host-guard.css`, the one
// unlayered GeoLeaf sheet.
//
// ⚠️ The host sheet is ADOPTED (`document.adoptedStyleSheets`), not added by `addStyleTag`: the
// page's CSP refuses an inline `<style>`. An adopted sheet is unlayered author CSS, which is what
// a host page's stylesheet is.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootMapUntilLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

/** A dark host theme's generic rules: light text everywhere, transparent fields. */
const HOST_CSS = "body, select, div { color: #e4e4e4; } select { background: transparent; }";

const CONTROLS = [
    ".gl-layer-manager__basemap-select__select",
    ".gl-layer-manager__style-select",
    ".maplibregl-ctrl-attrib-inner",
];

/** WCAG AA for normal text. */
const MIN_RATIO = 4.5;

test("the layer manager's selects and the basemap credit stay readable under a host stylesheet", async ({
    page,
}) => {
    await bootMapUntilLoaded(page);
    for (const selector of CONTROLS) {
        await page.waitForSelector(selector, { state: "attached", timeout: 30_000 });
    }

    const ratios = await page.evaluate(
        ({ css, selectors }) => {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

            /** @param {string} c */
            const parse = (c) => {
                const m = c.match(/rgba?\(([^)]+)\)/);
                if (!m) throw new Error(`unparsed colour: ${c}`);
                const p = m[1]
                    .split(/[ ,/]+/)
                    .filter(Boolean)
                    .map(Number);
                return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
            };
            /** @param {{r:number,g:number,b:number,a:number}} top @param {{r:number,g:number,b:number,a:number}} under */
            const over = (top, under) => ({
                r: top.r * top.a + under.r * (1 - top.a),
                g: top.g * top.a + under.g * (1 - top.a),
                b: top.b * top.a + under.b * (1 - top.a),
                a: 1,
            });
            /** @param {{r:number,g:number,b:number}} c */
            const luminance = ({ r, g, b }) => {
                /** @param {number} v */
                const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            /** The background actually under `el`: its own and its ancestors', composited. */
            /** @param {Element} el */
            const backgroundOf = (el) => {
                const stack = [];
                for (let n = /** @type {Element | null} */ (el); n; n = n.parentElement) {
                    const c = parse(getComputedStyle(n).backgroundColor);
                    if (c.a > 0) {
                        stack.push(c);
                        if (c.a >= 1) break;
                    }
                }
                // Below a translucent stack lies the map; its tiles are taken as white, the
                // background the engine's credit box is designed for.
                let acc = { r: 255, g: 255, b: 255, a: 1 };
                for (const c of stack.reverse()) acc = over(c, acc);
                return acc;
            };

            return selectors.map((selector) => {
                const el = document.querySelector(selector);
                if (!el) return { selector, ratio: 0 };
                const bg = backgroundOf(el);
                const fg = over(parse(getComputedStyle(el).color), bg);
                const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
                return { selector, ratio: (hi + 0.05) / (lo + 0.05) };
            });
        },
        { css: HOST_CSS, selectors: CONTROLS }
    );

    for (const { selector, ratio } of ratios) {
        expect(ratio, `${selector} contrast`).toBeGreaterThanOrEqual(MIN_RATIO);
    }
});

// 🛑 THE DEFECT. The table panel is `position: fixed` in the host's page, at `z-index` 1100 —
// above the 1050 of common modal dialogs: a record the host opened from a table row had its
// bottom hidden under the panel. Seen red on the bundle built before the fix (1100).
test("the table panel sits under the host's modal dialogs, and follows the host's token", async ({
    page,
}) => {
    await bootMapUntilLoaded(page);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
        timeout: 10_000,
    });
    // Only the toolbar action builds the panel.
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
    await page.waitForSelector(".gl-table-panel", { state: "attached", timeout: 10_000 });

    const zIndex = () =>
        page.evaluate(() =>
            Number(
                getComputedStyle(/** @type {Element} */ (document.querySelector(".gl-table-panel")))
                    .zIndex
            )
        );
    expect(await zIndex()).toBeLessThan(1050);

    await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(":root { --gl-z-table-panel: 900; }");
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    expect(await zIndex()).toBe(900);
});
