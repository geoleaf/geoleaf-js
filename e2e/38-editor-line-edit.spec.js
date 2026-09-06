// @ts-check
/**
 * 38 — EDITING AN EXISTING LINE REALLY PERSISTS
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. The picker resolved a feature's identity by `hit.id`
 * alone, and the core sets `promoteId` on POINT sources only — so on a line or polygon layer
 * MapLibre hands back NO top-level id. `featureId` was `""`, every downstream gate is guarded
 * on it, and "select → edit → save" therefore persisted NOTHING, without an error.
 *
 * ⚠️ THE SUITE COULD NOT HAVE SEEN IT. It declares no editable line layer anywhere and never
 * arms the selection tool. This spec supplies both by INTERCEPTION rather than by editing
 * `profiles/`, which is a shop window and not a fixture: `page.route` hands a shipped line
 * layer an `edition` + `write` block and a substitute feature. The shipped data would not do
 * on its own — no line feature of this profile carries an `id` at all, neither top-level nor
 * in `properties`, so there would be nothing to resolve.
 *
 * 🛑 WHAT IS ASSERTED, AND WHERE. The subject is the OUTBOX — the bytes that landed — never
 * an event. `e2e/helpers/idb.js` exists because the early offline defects all survived the
 * same way: a spec asserted that something *happened* and never that the right bytes did.
 *
 * ⚠️ The network is cut on purpose. Online, `auto-adapter` would POST to a `/api/` route the
 * static host answers with a 405 — a client error, which is NOT a transport failure, so
 * nothing would fall back to the queue and there would be nothing to read. Offline is also
 * the scenario the product is for.
 *
 * ⚠️ The SOURCE-vs-TILE half of the fix is proven in the unit suite
 * (`packages/plugins/editor/src/__tests__/layer-picker-branches.test.ts`), NOT here: observing
 * the clipping in a browser needs a line long enough to cross a tile boundary at the test's
 * zoom, which would measure the zoom rather than the correction.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";
import { goOffline } from "./helpers/offline.js";

test.use({ baseURL: baseURL("full") });

/** Identity the substitute line carries — in `properties` ONLY, like every real line layer. */
const LINE_ID = "cable-7";

/**
 * Makes a line layer editable, and gives it a feature whose identity lives in `properties`.
 *
 * ⚠️ THE INTERCEPT IS ON `profile-bundle.json`, NOT on the layer's own config file. The
 * deploy INLINES every layer config into one bundle at build time, so `<id>_config.json` is
 * never fetched at runtime — a route on it fires zero times and the test times out on a layer
 * that never loaded. Only a run against the real artefact says that.
 *
 * ⚠️ AND THE SUBJECT IS `routes_principales`, NOT the profile's `parcours` "démo édition"
 * layer: the latter is declared but its data is not loaded at boot, so there is nothing on
 * screen to click. The layer is chosen for being LOADED and LINEAR, which is all the defect
 * needs — its identity as a demo layer is not the subject.
 *
 * ⚠️ The substitute geometry REUSES the shipped feature's own coordinates. Inventing them
 * would tie the test to where the map happens to look, which is a property of the profile and
 * not of the code under test.
 */
async function armEditableLine(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: false };
        cfg.editableGeometryTypes = ["LineString"];
        cfg.interactiveShape = true;
        cfg.write = {
            enabled: true,
            endpoint: "/api/routes",
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        await route.fulfill({ json: bundle });
    });

    await page.route(`**/${LAYER}/data/${LAYER}.geojson**`, async (route) => {
        const fc = await (await route.fetch()).json();
        const line = (fc.features ?? []).find((f) => f?.geometry?.type === "LineString");
        if (!line) throw new Error(`aucune LineString dans les données de \`${LAYER}\``);
        await route.fulfill({
            json: {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        // 🛑 NO top-level `id` — the whole point. The core promotes an id on
                        // POINT sources only, so this is what a real line layer looks like.
                        properties: { id: LINE_ID, nom: "Câble 7" },
                        geometry: line.geometry,
                    },
                ],
            },
        });
    });
}

/** The layer the substitute line takes the place of — loaded at boot, and linear. */
const LAYER = "routes_principales";

/** Loads the lazy editor plugin and waits for its API — same gesture as the toolbar action. */
async function armEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15000 }
    );
    // 🛑 THROUGH THE MENU, not `Editor.setActiveTool`. That API sets the pill's active tool
    // and nothing else: the adapter is loaded by the menu's `onToolSelect`, so calling it
    // directly leaves Terra Draw unloaded and every later gesture lands on nothing.
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    await page.locator('button.gl-editor-tool-btn[data-tool="select"]').click();
    // Terra Draw arms asynchronously; `td-point` in the style proves `start()` has run.
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
}

/**
 * Screen position of the loaded line's MIDDLE vertex, through the live map's own projection.
 *
 * Read from the source rather than written here: a hard-coded coordinate would tie the test
 * to where this profile happens to look, which no part of the code under test decides.
 */
async function projectMidVertex(page, layerId) {
    // 🛑 THE MAP MUST BE ZOOMED IN FIRST, and this is not a convenience. The line layer
    // carries `minzoom: 5.9` while the profile opens at 4.2: it is simply NOT RENDERED at
    // boot, so `queryRenderedFeatures` returns the polygons underneath and the picker has
    // nothing to pick. Measured — and it is invisible to any test that stops at "the layer
    // has features".
    // 🛑 THE JUMP IS REPLAYED UNTIL THE LINE IS RENDERED, and that is not a precaution: the
    // application applies ITS initial view ASYNCHRONOUSLY, AFTER the layers have loaded. A
    // `jumpTo` fired as soon as `getFeatureCount > 0` is therefore taken back — measured: the
    // camera falls to `zoom 4.23`, where this layer (`minzoom` 6.02) renders NOTHING. The
    // original wait watched `getZoom() > 8`, which is TRANSIENTLY true right after the jump:
    // it passed, then the click landed on a map already back at 4.23, the picker had nothing
    // to pick, and the failure was declared ten seconds later on `td-linestring` — i.e. in the
    // wrong place.
    //
    // ⚠️ The wait now asks what the test REALLY needs: is the line on screen? A zoom level is
    // only a means of putting it there.
    await expect
        .poll(
            async () =>
                page.evaluate((id) => {
                    const G = /** @type {any} */ (window).GeoLeaf;
                    const map = G.Core.getMap().getNativeMap();
                    const coords = G.Layers.getFeatures(id)[0].geometry.coordinates;
                    if (map.getZoom() < 8) {
                        map.jumpTo({ center: coords[Math.floor(coords.length / 2)], zoom: 9 });
                        return 0;
                    }
                    return map.queryRenderedFeatures().filter((f) => f.layer.id.includes(id))
                        .length;
                }, layerId),
            { timeout: 30000, intervals: [500], message: "la ligne n'est jamais rendue à l'écran" }
        )
        .toBeGreaterThan(0);

    // 🛑 `project()` RETURNS CONTAINER COORDINATES, `page.mouse.click` EXPECTS PAGE ONES —
    // and the difference was zero only by luck. The map container does not sit at the corner
    // of the window: it lives under the application's chrome, and anything added there shifts
    // the click by as much. Measured at 41 px once the sync banner arrived (R7): the click
    // landed 41 px above the line, no selection happened anywhere, and the failure was
    // declared ten seconds later on `td-linestring`. The offset is now READ, never assumed.
    return page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const coords = G.Layers.getFeatures(id)[0].geometry.coordinates;
        const c = coords[Math.floor(coords.length / 2)];
        const map = G.Core.getMap().getNativeMap();
        const p = map.project(c);
        const rect = map.getContainer().getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
    }, layerId);
}

test("[editor] éditer une ligne SANS `id` de premier niveau atteint bien l'outbox", async ({
    page,
    context,
}) => {
    await armEditableLine(page);
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        (id) => {
            const L = /** @type {any} */ (window).GeoLeaf?.Layers;
            try {
                return (L?.getFeatureCount?.(id) ?? 0) > 0;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: 20000 }
    );

    await armEditor(page);
    await goOffline(context, page);

    // Click the middle of the line — a real click, so `queryRenderedFeatures` really hits.
    const mid = await projectMidVertex(page, LAYER);
    await page.mouse.click(mid.x, mid.y);

    // 🛑 THE IDENTITY MUST HAVE BEEN RESOLVED. Without it Terra Draw still receives a copy —
    // the selection LOOKS fine — and nothing downstream ever fires. Asserting the copy alone
    // would be green on the defect.
    await page.waitForFunction(
        () => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-linestring");
            const data = src?.serialize?.()?.data ?? src?._data;
            return (data?.features?.length ?? 0) > 0;
        },
        null,
        { timeout: 10000 }
    );

    // Drag the middle vertex — the gesture that marks the selection dirty.
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y - 40, { steps: 8 });
    await page.mouse.up();

    // Enter leaves select mode → deselect → commit. The editor binds it for this.
    await page.keyboard.press("Enter");

    // The subject: what LANDED. The outbox is keyed by `seq`, so insertion order is the read.
    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
                return rows.filter((r) => r.layerId === LAYER).length;
            },
            { timeout: 15000, message: "aucune écriture n'a atteint l'outbox" }
        )
        .toBeGreaterThan(0);

    const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
    const entry = rows.find((r) => r.layerId === LAYER);
    expect(entry.kind).toBe("update");
    // 🛑 THE IDENTITY ON THE WIRE. `""` here is the defect in its final form: an update
    // addressed to nothing, which the server cannot apply and no error announces.
    expect(entry.localId).toBe(LINE_ID);

    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const stored = features.find((f) => f.localId === LINE_ID);
    expect(stored, "l'entité éditée n'est pas dans le magasin local").toBeTruthy();
    expect(stored.feature.geometry.type).toBe("LineString");
});
