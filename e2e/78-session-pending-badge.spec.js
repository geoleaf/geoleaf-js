// @ts-check
/**
 * 78 — A CAPTURE OF THIS SESSION SAYS IT IS OWED, AND STOPS SAYING IT ONCE DELIVERED
 *
 * 🛑 THE DEFECT. The "pending" badge — the orange stroke an entity owed to the server is drawn
 * with — was baked by the restore of pending edits alone, at boot. A capture made since the boot
 * was drawn like any other entity until the page was reloaded: the badge told the truth about
 * yesterday's work and nothing about today's. And it was a circle stroke only: a line or a
 * polygon owed to the server had no way to show it, reload or not.
 *
 * MEASURED BEFORE THE FIX, on the deployed bundle, by the gesture of the first test: the capture
 * reached its layer with no `_syncStatus`, and carried `"pending"` after a reload. The order the
 * product gives is why the fix is not one line: the core announces that the queue moved BEFORE
 * the capture is on its layer.
 *
 * ⚠️ WHAT IS NOT LOOKED AT: the colour of a pixel. The first test reads the flag on the layer's
 * copy of the entity — what the paint expression tests; the second reads that expression on the
 * strokes the engine holds, and that the engine accepted it.
 *
 * ⚠️ THE WRITE TARGET IS INJECTED, in the served bundle, never in `profiles/`: `deploy-full`
 * ships `sites_rosario` with its write target disabled, and no theme of the shipped profile
 * names the layer — it is put in the default theme here, or the capture is handed to no layer.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** Where the drain is told to write. Fulfilled here, so the delivery is the test's to time. */
const ENDPOINT = "https://backend.test/rows";
const TITLE = "E2E 78";

/**
 * Gives `sites_rosario` a write target and puts it on the map.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armLayer(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        if (!cfg) throw new Error("le bundle ne porte plus la couche `sites_rosario`");
        cfg.write = { ...cfg.write, enabled: true, endpoint: ENDPOINT };
        const theme = (bundle.themes?.themes ?? []).find(
            (/** @type {any} */ t) => t.id === bundle.themes.defaultTheme
        );
        if (!theme) throw new Error("le bundle ne nomme plus son thème par défaut");
        theme.layers.push({ id: "sites_rosario", visible: true, style: "defaut" });
        await route.fulfill({ json: bundle });
    });
}

/**
 * Captures a point of `sites_rosario` through the editor's form, and waits for it to be queued.
 *
 * @param {import("@playwright/test").Page} page
 */
async function captureAPoint(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15000 }
    );
    // `toggleMenu()` TOGGLES: toggling until the tool is reachable asserts the intent instead of
    // assuming the starting state (see spec 39).
    const pointBtn = page.locator('button.gl-editor-tool-btn[data-tool="point"]');
    for (let i = 0; i < 3 && !(await pointBtn.isVisible()); i++) {
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
        await page.waitForTimeout(300);
    }
    await expect(pointBtn).toBeVisible({ timeout: 10000 });
    await pointBtn.click();
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            try {
                return !!native?.getLayer?.("td-point");
            } catch {
                return false;
            }
        },
        null,
        { timeout: 20000 }
    );
    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 10000 });
    await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");
    await expect(page.locator("#gl-field-title")).toBeVisible({ timeout: 8000 });
    await page.locator("#gl-field-title").fill(TITLE);

    await page.evaluate(() => {
        /** @type {any} */ (window).__glQueued = false;
        document.addEventListener("geoleaf:editor:feature-sync-queued", () => {
            /** @type {any} */ (window).__glQueued = true;
        });
    });
    await page.locator(".gl-form-modal__btn-save").click();
    await page.waitForFunction(() => /** @type {any} */ (window).__glQueued === true, null, {
        timeout: 30000,
    });
}

/**
 * The capture as its LAYER holds it: whether it is there, and the flag its paint tests.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ onLayer: boolean, badge: unknown }>}
 */
function capture(page) {
    return page.evaluate((title) => {
        const held = /** @type {any} */ (window).GeoLeaf.Layers.getFeatures("sites_rosario").find(
            (/** @type {any} */ f) => f.properties?.title === title
        );
        return { onLayer: !!held, badge: held?.properties?._syncStatus ?? null };
    }, TITLE);
}

test("[offline] une saisie de la session porte le liseré sans rechargement, et le perd une fois livrée", async ({
    page,
    context,
}) => {
    test.setTimeout(150000);
    await armLayer(page);
    // The write is HELD in flight, not refused: a refused creation is put off for a minute or
    // so, and the delivery below would wait on that backoff instead of on the test.
    let arrived = 0;
    /** @type {() => void} */
    let deliver = () => {};
    const held = new Promise((resolve) => {
        deliver = () => resolve(undefined);
    });
    await context.route(`${ENDPOINT}**`, async (route) => {
        arrived += 1;
        await held;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: 7801, updated_at: "2026-10-04T12:00:00+00:00" }]),
        });
    });

    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await captureAPoint(page);

    // --- the subject: owed, and SAYING so, with no reload --------------------------------------
    await expect
        .poll(() => capture(page), {
            timeout: 15000,
            message: "la saisie de la session est sur sa couche sans le liseré « en attente »",
        })
        .toEqual({ onLayer: true, badge: "pending" });
    // The witness: it IS owed — the write left and has not been answered.
    await expect.poll(() => arrived, { timeout: 15000 }).toBeGreaterThan(0);

    // --- delivered: the badge leaves with the debt ---------------------------------------------
    deliver();
    await expect
        .poll(() => capture(page), {
            timeout: 30000,
            message: "la saisie livrée porte encore le liseré",
        })
        .toEqual({ onLayer: true, badge: null });
});

test("[offline] le trait d'une ligne et le contour d'un polygone lisent le liseré", async ({
    page,
}) => {
    test.setTimeout(90000);
    /** @type {string[]} */
    const styleErrors = [];
    page.on("console", (message) => {
        if (message.type() === "error" && /line-(color|width)|expression/i.test(message.text())) {
            styleErrors.push(message.text());
        }
    });
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // The strokes of the layers the default theme draws: a line's own, a polygon's outline.
    await page.waitForFunction(
        () => {
            const map = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            const layers = map?.getStyle?.()?.layers ?? [];
            return layers.some(
                (/** @type {any} */ l) => l.type === "line" && /^gl-.*-line$/.test(l.id)
            );
        },
        null,
        { timeout: 30000 }
    );
    const strokes = await page.evaluate(() => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const reads = (/** @type {unknown} */ expr) =>
            JSON.stringify(expr ?? null).includes('["feature-state","syncStatus"]');
        return map
            .getStyle()
            .layers.filter((/** @type {any} */ l) => l.type === "line" && /^gl-.*-line$/.test(l.id))
            .map((/** @type {any} */ l) => ({
                id: l.id,
                color: reads(map.getPaintProperty(l.id, "line-color")),
                width: reads(map.getPaintProperty(l.id, "line-width")),
            }));
    });
    // Non-vacuity: there are strokes to read.
    expect(strokes.length, "aucun trait de couche sur la carte").toBeGreaterThan(0);
    expect(
        strokes.filter((/** @type {any} */ s) => !s.color || !s.width),
        "des traits ne lisent pas le liseré « en attente »"
    ).toEqual([]);
    // And the engine took the expression: a stroke it refused is not drawn, and it says so.
    expect(styleErrors, `le moteur a refusé une peinture : ${styleErrors.join(" | ")}`).toEqual([]);
});
