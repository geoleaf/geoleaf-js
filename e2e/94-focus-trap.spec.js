/**
 * The keyboard stays inside a modal surface — on the delivered bundle, in a real browser.
 *
 * ## The defects
 *
 * 1. **The side panel.** The shared focus trap matched `[href]`, which takes the `<use href>`
 *    of the SVG glyph that `taxonomy` writes into the panel's title. An SVG element has no
 *    `offsetParent` property, so the visibility filter kept it, and it became the LAST
 *    focusable: Tab from the real last control was never wrapped. Measured during the
 *    capability recipe: 12 tabs out of 12 left the panel on the delivered bundle.
 * 2. **The share dialog.** Activating « Show the QR code » with the keyboard disabled then hid
 *    the focused button: the focus fell to `<body>`, and 10 tabs out of 12 then walked the page
 *    behind the dialog.
 *
 * ## What the spec demands
 *
 * Twelve tabs from inside each surface, and not one lands outside it. The side panel is opened
 * through the public façade and given a glyph like the one `taxonomy` draws — the subject is the
 * trap on the bundle a browser runs, not a demo feature.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const TABS = 12;

/**
 * Presses Tab `TABS` times and counts the presses after which the focus is outside `selector`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function escapes(page, selector) {
    let out = 0;
    for (let i = 0; i < TABS; i++) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(
            (sel) => !!document.querySelector(sel)?.contains(document.activeElement),
            selector
        );
        if (!inside) out++;
    }
    return out;
}

test.describe("piège de focus — la tabulation reste dans la surface", () => {
    test.beforeEach(async ({ page }) => {
        await installSignals(page);
        await bootPage(page);
        await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
    });

    test("panneau latéral au titre porteur d'un glyphe SVG : 0 sortie sur 12", async ({ page }) => {
        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "focus-e2e",
                    featureId: "focus-1",
                    properties: { title: "Panneau clavier" },
                    geometry: { type: "Point" },
                    lngLat: { lat: -32.95, lng: -60.64 },
                    point: { x: 0, y: 0 },
                },
                { layerId: "focus-e2e", fields: [{ field: "title", type: "text", label: "Titre" }] }
            );
        });
        const panel = page.locator(".gl-poi-sidepanel");
        await expect(panel).toHaveClass(/(^|\s)open(\s|$)/, { timeout: 10_000 });
        await expect(panel.locator("[data-action='close']")).toBeFocused();

        // The glyph `taxonomy` writes into the title: an SVG `<use href>`, AFTER every control.
        await page.evaluate(() => {
            const host = document.querySelector(".gl-poi-sidepanel");
            if (!host) throw new Error("le panneau latéral n'est plus `.gl-poi-sidepanel`");
            const ns = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(ns, "svg");
            const use = document.createElementNS(ns, "use");
            use.setAttribute("href", "#gl-e2e-glyph");
            svg.appendChild(use);
            host.appendChild(svg);
        });

        expect(await escapes(page, ".gl-poi-sidepanel")).toBe(0);
    });

    test("fenêtre de partage après « afficher le QR code » au clavier : 0 sortie sur 12", async ({
        page,
    }) => {
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Share.openShareDialog());
        const dialog = page.locator("#gl-share-modal");
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        const qrButton = dialog.locator(".gl-share-modal__qr-btn");
        await qrButton.focus();
        await page.keyboard.press("Enter");
        await expect(dialog.locator(".gl-share-modal__qr-container svg")).toBeVisible({
            timeout: 10_000,
        });

        expect(await escapes(page, "#gl-share-modal")).toBe(0);
    });
});
