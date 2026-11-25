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
    // Text, not fields: a host's bare `div { color }` repainted them too — measured 17:1 → 1.2:1
    // for the scale, 4.7:1 → 1.2:1 for the credit line (17/11/2026).
    ".gl-scale-graphic-line",
    ".gl-scale-zoom",
    ".gl-scale-coordinates",
    ".gl-branding__content",
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

// 🛑 THE DEFECT, B. Apart from the table panel, GeoLeaf's surfaces carried hard-coded stacking
// levels — the geocoding bar at 1500, the feature and filter panels at 1100, its own windows from
// 2000 to 20000 — and GeoLeaf has no stacking root of its own: its toolbar, panels and selectors
// are inserted NEXT TO the map, in the host's element. A host dialog at the common 1055 was thus
// covered by GeoLeaf. What is measured is the COVERING, not the level: a host dialog is opened
// over the whole page and, at the centre of every visible GeoLeaf surface, the element on top must
// be the host's. Only GeoLeaf's signals (boot veil, notifications, update banner) stay above.
const SIGNALS = ["#gl-loader", "#gl-notifications", ".gl-sw-update"];

/**
 * The GeoLeaf surfaces that draw over a host dialog at 1055.
 * @param {import("@playwright/test").Page} page
 */
function surfacesOverHostDialog(page) {
    return page.evaluate((signals) => {
        const dialog = document.createElement("div");
        dialog.id = "host-dialog-probe";
        Object.assign(dialog.style, { position: "fixed", inset: "0", zIndex: "1055" });
        document.body.appendChild(dialog);
        const over = [];
        for (const el of document.querySelectorAll("body *")) {
            if (el === dialog || !(el instanceof HTMLElement)) continue;
            const named = [el.id, ...el.classList].some((n) => n.startsWith("gl-"));
            if (!named || signals.some((s) => el.closest(s))) continue;
            const cs = getComputedStyle(el);
            if (cs.position !== "fixed" && cs.position !== "absolute") continue;
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            const top = document.elementFromPoint(x, y);
            // A signal (the boot veil still fading out, a notification) is above by decision:
            // a point it covers says nothing about the surface under it.
            if (top && signals.some((sel) => top.closest(sel))) continue;
            if (top && top !== dialog && !dialog.contains(top)) {
                const name = el.id ? `#${el.id}` : `.${[...el.classList][0]}`;
                const above = top.id
                    ? `#${top.id}`
                    : `${top.tagName.toLowerCase()}.${[...top.classList][0] ?? ""}`;
                over.push(
                    `${name} (z ${cs.zIndex}) under ${above} (z ${getComputedStyle(top).zIndex})`
                );
            }
        }
        dialog.remove();
        return [...new Set(over)];
    }, SIGNALS);
}

for (const [name, viewport] of /** @type {const} */ ([
    ["desktop", { width: 1400, height: 900 }],
    ["mobile", { width: 390, height: 800 }],
])) {
    test(`a host dialog at 1055 covers every GeoLeaf surface but its signals — ${name}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await bootMapUntilLoaded(page);
        expect(await surfacesOverHostDialog(page), "at boot").toEqual([]);

        // The filter panel is one of the fixed surfaces; open it the way a user does.
        const toggle = page.locator("#gl-filter-toggle");
        if (await toggle.isVisible()) {
            await toggle.click();
            await page.waitForSelector("#gl-filter-panel", { state: "visible", timeout: 10_000 });
            expect(await surfacesOverHostDialog(page), "filter panel open").toEqual([]);
        }
    });
}

/**
 * Opens the editor's field form the way the placement callback does, at the map's centre.
 * @param {import("@playwright/test").Page} page
 */
async function openEditorForm(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor?.AddForm) === "object",
        null,
        { timeout: 15_000 }
    );
    await page.evaluate(() => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const { lat, lng } = G.Core.getMap().getNativeMap().getCenter();
        return G.Editor.AddForm.openAddForm({ lat, lng });
    });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 10_000 });
}

// A host opens its own dialog FROM the field form — a many2one's "Search more", a confirmation.
// The form is a GeoLeaf window, and a window stays under the host's dialogs like every other
// surface. The boot-time sweep above never had the form open: this one does.
for (const [name, viewport] of /** @type {const} */ ([
    ["desktop", { width: 1400, height: 900 }],
    ["mobile", { width: 390, height: 800 }],
])) {
    test(`a host dialog at 1055 covers the editor's open field form — ${name}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await bootMapUntilLoaded(page);
        await openEditorForm(page);
        expect(await surfacesOverHostDialog(page), "field form open").toEqual([]);
    });
}

// 🛑 THE STACKING IS NOT THE WHOLE CONTRACT. The form's focus trap listens on `document`: with a
// host dialog opened over the form and holding the focus, Escape is the HOST's key — it closes the
// host's dialog, and must not also close (or ask to discard) the GeoLeaf form under it.
test("Escape in a host dialog over the field form leaves the form open", async ({ page }) => {
    await bootMapUntilLoaded(page);
    await openEditorForm(page);
    await page.evaluate(() => {
        const dialog = document.createElement("div");
        dialog.id = "host-dialog-probe";
        dialog.setAttribute("role", "dialog");
        Object.assign(dialog.style, { position: "fixed", inset: "0", zIndex: "1055" });
        const button = document.createElement("button");
        button.textContent = "host";
        dialog.appendChild(button);
        document.body.appendChild(dialog);
        button.focus();
    });
    await expect(page.locator("#host-dialog-probe button")).toBeFocused();
    await page.keyboard.press("Escape");
    // Let a discard confirmation, if any, be created before judging.
    await page.waitForTimeout(300);
    await expect(page.locator(".gl-form-modal-panel")).toHaveCount(1);
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible();
});
