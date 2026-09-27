// @ts-check
/**
 * 68 — A FEATURE CREATED WITH THE EDITOR IS IN ITS LAYER, UNDER ITS IDENTITY
 *
 * 🛑 THE DEFECT, MEASURED ON 27/09/2026. Modifying and deleting went through the layer's store
 * (`GeoLeaf.Layers`); creating did not, and the created feature had no name:
 *  - a point placed with "add a point" vanished with its marker, drawn nowhere until reload;
 *  - a drawn shape stayed in the drawing layer with no identity — moving it was never
 *    persisted, and deleting it left its creation queued, back at the next load;
 *  - `feature-saved` carried `featureId: ""`, and nothing — search, `getFeatureById` — found it;
 *  - at the next load, the queued creation came back WITHOUT an identity (the device stores it
 *    as the form submitted it), one copy per restore pass, unfindable and uneditable.
 *
 * Each test below was seen red on the bundle built before the fix.
 *
 * ⚠️ THE SERVER IS A ROUTE, NOT A BACKEND, as in `44`: the layer's `write.endpoint` is
 * fulfilled by Playwright. The layer is `villes_principales`, loaded at boot by the default
 * theme, made editable, searchable and writable by rewriting the served bundle — its device-
 * first read is switched OFF, so what a reload shows of the capture is the restore's doing.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

const LAYER = "villes_principales";
const ENDPOINT = "https://backend.test/villes";
const WAIT_MS = 20_000;

/**
 * Makes the layer editable, searchable and writable, and answers its writes with `status`.
 * Routes go on the CONTEXT: the GeoJSON loader fetches from a Web Worker (`59`).
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @param {number | "unreachable"} status - What the write endpoint answers.
 */
async function armLayer(context, status) {
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: true };
        cfg.editableGeometryTypes = ["Point"];
        cfg.interactiveShape = true;
        cfg.offline = { ...(cfg.offline ?? {}), enabled: false };
        cfg.searchable = { fields: ["properties.ville"] };
        cfg.write = {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["ville"],
        };
        const field = cfg.attributes?.fields?.find((f) => f.field === "properties.ville");
        if (!field) throw new Error(`\`${LAYER}\` ne déclare plus le champ \`properties.ville\``);
        field.edit = {};
        await route.fulfill({ json: bundle });
    });
    // ⚠️ "unreachable" ABORTS at the network layer: `context.setOffline(true)` does not stop a
    // routed request — measured, the drain pushed the creation "offline" through the route.
    await context.route(`${ENDPOINT}**`, (route) =>
        status === "unreachable"
            ? route.abort("internetdisconnected")
            : status === 200
              ? route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify([
                        { id: 6801, ville: "créée", updated_at: "2026-09-27T10:00:00+00:00" },
                    ]),
                })
              : route.fulfill({ status, body: "" })
    );
}

/** Boots the page and waits for the layer's features. */
async function boot(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: WAIT_MS });
    await page.waitForFunction(
        (id) => {
            try {
                const count = /** @type {any} */ (window).GeoLeaf?.Layers?.getFeatureCount?.(id);
                return (count ?? 0) > 0;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: WAIT_MS }
    );
}

/** Loads the editor and records every `feature-saved` detail on `window.__saved`. */
async function loadEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15_000 }
    );
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__saved = [];
        w.__queued = 0;
        document.addEventListener("geoleaf:editor:feature-saved", (e) =>
            w.__saved.push(/** @type {CustomEvent} */ (e).detail)
        );
        document.addEventListener("geoleaf:editor:feature-sync-queued", () => (w.__queued += 1));
    });
}

/** Fills the open form for LAYER and saves it. */
async function fillAndSave(page, name) {
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 8000 });
    await page.locator(".gl-form-modal__layer select").selectOption(LAYER);
    const field = page.locator("#gl-field-ville");
    await expect(field).toBeVisible({ timeout: 5000 });
    await field.fill(name);
    await page.locator(".gl-form-modal__btn-save").click();
    await expect(page.locator(".gl-form-modal-panel")).toHaveCount(0, { timeout: 10_000 });
}

/** Places a point at the map's centre through "add a point", then fills its form. */
async function placePoint(page, name) {
    await page.evaluate(() => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const c = G.Core.getMap().getNativeMap().getCenter();
        G.Editor.AddForm.openAddForm({ lat: c.lat, lng: c.lng });
    });
    await fillAndSave(page, name);
}

/** The store's features of LAYER named `name`, as `{ id, propId }`. */
function heldNamed(page, name) {
    return page.evaluate(
        ({ id, n }) =>
            /** @type {any} */ (window).GeoLeaf.Layers.getFeatures(id)
                .filter((/** @type {any} */ f) => f?.properties?.ville === n)
                .map((/** @type {any} */ f) => ({
                    id: f.id ?? null,
                    propId: f.properties?.id ?? null,
                })),
        { id: LAYER, n: name }
    );
}

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

test("[editor] un point AJOUTÉ est dans sa couche, sous son identité, sans rechargement", async ({
    page,
    context,
}) => {
    const NAME = "E2E-68-ajout";
    await armLayer(context, 200);
    await boot(page);
    await loadEditor(page);

    await placePoint(page, NAME);
    await page.waitForFunction(() => /** @type {any} */ (window).__saved.length > 0, null, {
        timeout: WAIT_MS,
    });

    const state = await page.evaluate(
        ({ id, n }) => {
            const w = /** @type {any} */ (window);
            const L = w.GeoLeaf.Layers;
            const featureId = w.__saved[0].featureId;
            return {
                featureId,
                held: !!L.getFeatureById(id, featureId),
                found: L.search(n).some(
                    (/** @type {any} */ m) => m.layerId === id && m.featureId === featureId
                ),
            };
        },
        { id: LAYER, n: NAME }
    );
    // Before the fix: `featureId: ""`, held nowhere, found by nothing.
    expect(state.featureId, "la création n'a pas d'identité").toMatch(/^loc:/);
    expect(state.held, "la couche ne tient pas l'entité créée").toBe(true);
    expect(state.found, "la recherche ne trouve pas l'entité créée").toBe(true);
    expect(await heldNamed(page, NAME)).toHaveLength(1);
});

test("[editor] une forme TRACÉE passe à sa couche, et la déplacer atteint sa création", async ({
    page,
    context,
}) => {
    const NAME = "E2E-68-trace";
    // The server cannot be reached: the creation STAYS queued, and what the move does to it is
    // then readable.
    await armLayer(context, "unreachable");
    await boot(page);
    await loadEditor(page);
    await awaitSettledCamera(page);
    // ⚠️ Within the layer's zoom range: handed over, the feature is drawn by ITS layer, which
    // shows nothing below its `minzoom` — measured, the boot view is under it.
    await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().jumpTo({ zoom: 7 })
    );
    await page.waitForFunction(
        () => !(/** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().isMoving()),
        null,
        { timeout: WAIT_MS }
    );

    // Arm the point tool through the menu — the drawing engine is loaded by it (`09`).
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    await page.locator('button.gl-editor-tool-btn[data-tool="point"]').click();
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
        { timeout: WAIT_MS }
    );
    await page.waitForTimeout(300); // the pending setMode() — see `09`

    const AT = { x: 260, y: 200 };
    await page.locator(".maplibregl-canvas").click({ position: AT });

    await fillAndSave(page, NAME);
    await page.waitForFunction(() => /** @type {any} */ (window).__queued > 0, null, {
        timeout: 30_000,
    });

    const drawn = await page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const src = native.getSource("td-point");
        const data = src?.serialize?.().data ?? src?._data;
        return (data?.features ?? []).length;
    });
    expect(drawn, "la forme est restée dans la couche de dessin").toBe(0);
    expect(await heldNamed(page, NAME)).toHaveLength(1);

    // Selected THROUGH ITS LAYER — where the layer draws it — then moved and committed: the
    // gestures of `44`, on the feature just created.
    const where = await page.evaluate(
        ({ id, n }) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            const map = G.Core.getMap().getNativeMap();
            const f = G.Layers.getFeatures(id).find(
                (/** @type {any} */ x) => x.properties?.ville === n
            );
            const p = map.project(f.geometry.coordinates);
            const rect = map.getContainer().getBoundingClientRect();
            return { x: p.x + rect.left, y: p.y + rect.top };
        },
        { id: LAYER, n: NAME }
    );
    const [before] = await heldNamed(page, NAME);
    const recordOf = async () =>
        (await readStore(page, { db: GEOLEAF_DB, store: "features" })).find(
            (r) => r.localId === before.id
        );
    const placed = (await recordOf())?.feature?.geometry?.coordinates;

    await page.locator('button.gl-editor-tool-btn[data-tool="select"]').click();
    await page.mouse.click(where.x, where.y);
    await page.waitForFunction(
        (id) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-point");
            const data = src?.serialize?.()?.data ?? src?._data;
            // The copy the layer picker hands to the drawing engine carries the feature's id.
            return (data?.features ?? []).some((/** @type {any} */ f) => f.properties?.id === id);
        },
        before.id,
        { timeout: 10_000 }
    );
    await page.mouse.move(where.x, where.y);
    await page.mouse.down();
    await page.mouse.move(where.x + 40, where.y - 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Enter");

    // The move reaches the QUEUED creation's record — before the fix a drawn shape's moves were
    // never persisted — and the client key is not stored as one of its attributes.
    await expect
        .poll(async () => JSON.stringify((await recordOf())?.feature?.geometry?.coordinates), {
            timeout: 10_000,
            message: "le déplacement n'a pas atteint la création en file",
        })
        .not.toBe(JSON.stringify(placed));
    const record = await recordOf();
    expect(record.feature.properties).toEqual({ ville: NAME });
    const outbox = (await readStore(page, { db: GEOLEAF_DB, store: "outbox" })).filter(
        (r) => r.layerId === LAYER
    );
    expect(
        outbox.map((r) => r.kind),
        "la modification n'a pas rejoint la création"
    ).toEqual(["create"]);
});

test("[editor] au rechargement, une création en attente revient UNE fois, sous sa clé", async ({
    page,
    context,
}) => {
    const NAME = "E2E-68-rechargement";
    // The server refuses every write: the creation stays owed across the reload.
    await armLayer(context, 503);
    await boot(page);
    await loadEditor(page);

    await placePoint(page, NAME);
    await page.waitForFunction(() => /** @type {any} */ (window).__queued > 0, null, {
        timeout: 30_000,
    });
    const [entry] = (await readStore(page, { db: GEOLEAF_DB, store: "outbox" })).filter(
        (r) => r.layerId === LAYER
    );
    expect(entry?.localId, "la création n'est pas en file").toMatch(/^loc:/);

    await page.reload();
    await boot(page);

    // The restore runs on the boot's events; the capture is back once its layer holds it.
    await expect
        .poll(async () => (await heldNamed(page, NAME)).length, {
            timeout: WAIT_MS,
            message: "la création en attente n'est pas revenue au rechargement",
        })
        .toBeGreaterThan(0);
    // `app:ready` may come after the first pass: let every restore pass land before counting.
    await page.waitForTimeout(2000);

    // Before the fix: id-less, one copy per restore pass.
    expect(await heldNamed(page, NAME)).toEqual([{ id: entry.localId, propId: entry.localId }]);
});
