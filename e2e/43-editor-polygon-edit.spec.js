// @ts-check
/**
 * 43 — EDITING AN EXISTING POLYGON REALLY PERSISTS
 *
 * 🛑 THE DEFECT CLASS IS THE ONE `38-editor-line-edit.spec.js` EXISTS FOR, AND THE LINE ALONE
 * DID NOT PROVE IT. The picker resolved a feature's identity by `hit.id` alone, and the core
 * then set `promoteId` on POINT sources only: on a line or polygon layer MapLibre handed back no
 * top-level id, `featureId` was `""`, and "select → edit → save" persisted NOTHING, without an
 * error. Two fixes close it now, and either alone is enough — read spec 38's header: this spec
 * turns red, like 38, only when BOTH are reverted (measured under Chromium and WebKit on
 * 12/09/2026). Spec 38 proves the line; a polygon goes through a different Terra Draw mode, a
 * different source (`td-polygon`) and a different drag — the whole feature, not a vertex — so
 * nothing about the line case said the polygon case held.
 *
 * ⚠️ SAME HARNESS AS 38, SAME REASONS — read its header for why the intercept is on
 * `profile-bundle.json`, why the network is cut, and why the subject is the OUTBOX rather than
 * an event. What differs is written here.
 *
 * ⚠️ THE SUBJECT IS `aires_protegees_nationales_sib`: loaded at boot, filled (a click inside
 * really hits the layer) and polygonal. Its shipped features carry no id at any level, like
 * every real polygon layer of this profile.
 *
 * ⚠️ THE SUBSTITUTE IS A `Polygon`, NEVER A `MultiPolygon`: the picker has no mode for the
 * latter and ignores it (`packages/plugins/editor/src/selection/layer-picker.ts`), so a
 * MultiPolygon would make this spec fail on a limit it does not test.
 *
 * ⚠️ THE CLICK POINT IS COMPUTED, NOT WRITTEN, AND IT IS NOT THE CENTROID. A concave ring can
 * leave its centroid outside the fill, where a click hits nothing and the failure would be
 * declared ten seconds later on `td-polygon`. A grid scan keeps, among the candidates a
 * ray-casting test puts inside, the one farthest from every vertex — from the loaded geometry.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";
import { goOffline } from "./helpers/offline.js";
import { armEditor } from "./helpers/editor.js";
import { awaitSettledCamera } from "./helpers/camera.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** The layer the substitute polygon takes the place of — loaded at boot, filled, polygonal. */
const LAYER = "aires_protegees_nationales_sib";

/** Identity the substitute polygon carries — in `properties` ONLY. */
const POLYGON_ID = "aire-7";

/**
 * Makes the polygon layer editable, and gives it ONE feature whose identity lives in
 * `properties`: the largest shipped `Polygon`, so the fill offers room to click and to drag.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armEditablePolygon(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: false };
        cfg.editableGeometryTypes = ["Polygon"];
        cfg.interactiveShape = true;
        cfg.write = {
            enabled: true,
            endpoint: "/api/aires",
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["Name"],
        };
        await route.fulfill({ json: bundle });
    });

    await page.route(`**/${LAYER}/data/${LAYER}.geojson**`, async (route) => {
        const fc = await (await route.fetch()).json();
        /** @param {number[][]} ring */
        const bboxArea = (ring) => {
            const xs = ring.map((c) => c[0]);
            const ys = ring.map((c) => c[1]);
            return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        };
        const polygons = (fc.features ?? []).filter(
            (/** @type {any} */ f) => f?.geometry?.type === "Polygon"
        );
        if (polygons.length === 0)
            throw new Error(`aucun Polygon dans les données de \`${LAYER}\``);
        const largest = polygons.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
            bboxArea(b.geometry.coordinates[0]) > bboxArea(a.geometry.coordinates[0]) ? b : a
        );
        await route.fulfill({
            json: {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        // 🛑 NO top-level `id` — the whole point, as in spec 38.
                        properties: { id: POLYGON_ID, Name: largest.properties?.Name ?? "Aire 7" },
                        geometry: largest.geometry,
                    },
                ],
            },
        });
    });
}

/**
 * A point inside `ring` (lng/lat) and the ring's bounds.
 *
 * @param {number[][]} ring
 * @returns {{ point: number[], bounds: number[][] }}
 */
function interiorPoint(ring) {
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
    ];
    /** Even-odd ray casting. */
    const inside = (/** @type {number} */ x, /** @type {number} */ y) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
    };
    const GRID = 24;
    /** @type {{ x: number, y: number, clearance: number } | null} */
    let best = null;
    for (let gx = 1; gx < GRID; gx++) {
        for (let gy = 1; gy < GRID; gy++) {
            const x = minX + ((maxX - minX) * gx) / GRID;
            const y = minY + ((maxY - minY) * gy) / GRID;
            if (!inside(x, y)) continue;
            const clearance = Math.min(...ring.map(([vx, vy]) => Math.hypot(vx - x, vy - y)));
            if (!best || clearance > best.clearance) best = { x, y, clearance };
        }
    }
    if (!best) throw new Error("aucun point intérieur trouvé dans le polygone substitué");
    return {
        point: [best.x, best.y],
        bounds: [
            [minX, minY],
            [maxX, maxY],
        ],
    };
}

/**
 * Page coordinates of `target.point`, once the polygon is RENDERED under it.
 *
 * 🛑 THE VIEW IS REPLAYED UNTIL THE FILL IS UNDER THE POINT, and the projection is taken in the
 * SAME evaluation that saw it: the application applies its own initial view asynchronously,
 * after the layers have loaded (measured in spec 38), so a view set once can be taken back
 * between a check and a click.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ point: number[], bounds: number[][] }} target
 */
async function projectInteriorPoint(page, target) {
    const handle = await page.waitForFunction(
        ({ id, point, bounds }) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            if (map.isMoving()) return null;
            const p = map.project(point);
            const onFill = map
                .queryRenderedFeatures([p.x, p.y])
                .some((/** @type {any} */ f) => f.layer.id.includes(id));
            if (!onFill) {
                // The framing is about WHAT is on screen, never about the camera's angle: given no
                // `pitch`/`bearing`, `fitBounds` would apply ZERO and flatten a tilted camera. ⚠️ The
                // flattening was once blamed for the lost drags (21/09/2026); the cause was a press
                // inside a handle's reach — see `pressPointClearOfHandles`.
                map.fitBounds(bounds, {
                    animate: false,
                    padding: 60,
                    pitch: map.getPitch(),
                    bearing: map.getBearing(),
                });
                return null;
            }
            // `project()` is in CONTAINER coordinates; the mouse wants PAGE ones (spec 38).
            const rect = map.getContainer().getBoundingClientRect();
            return { x: p.x + rect.left, y: p.y + rect.top };
        },
        { id: LAYER, ...target },
        { timeout: 30000, polling: 500 }
    );
    return /** @type {{ x: number, y: number }} */ (await handle.jsonValue());
}

/**
 * Radius, in px, within which Terra Draw's select mode takes a press for a HANDLE rather than for
 * the whole shape — the mode's `pointerDistance`, which the editor does not set, hence Terra Draw's
 * default. Plus a margin.
 */
const HANDLE_CLEARANCE_PX = 40 + 16;

/**
 * Page coordinates of a point on the selected polygon's fill, clear of every handle the selection
 * shows, nearest to `from`.
 *
 * 🛑 WHY THE PRESS POINT IS CHOSEN AFTER THE SELECTION, AND AWAY FROM THE HANDLES. In select mode,
 * Terra Draw decides what a drag means in a fixed order — resize, vertex, EDGE MIDPOINT, then the
 * whole shape — each within its `pointerDistance` of the press. A press 35-38 px from a midpoint
 * handle therefore inserted a vertex there and dragged it, and the shape stayed put. Measured on
 * 23/09/2026: that is every "lost" drag this spec ever recorded. The camera played a part only
 * because the handles are placed in SCREEN space when the shape is selected: a tilted camera
 * moved the long edge's handle out of reach (52.9 px at 60°), a flat one left it at 37.9 px. The
 * handles exist only once the shape is selected, hence the order.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} from Page coordinates of the selection click.
 * @returns {Promise<{ x: number, y: number }>}
 */
async function pressPointClearOfHandles(page, from) {
    const handle = await page.waitForFunction(
        ({ id, from, clearance }) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-point");
            const points = src?.serialize?.()?.data?.features ?? src?._data?.features ?? [];
            if (points.length === 0) return null;
            const handles = points.map((/** @type {any} */ f) =>
                map.project(f.geometry.coordinates)
            );
            const rect = map.getContainer().getBoundingClientRect();
            const origin = { x: from.x - rect.left, y: from.y - rect.top };
            const { width, height } = map.getContainer().getBoundingClientRect();
            /** @type {{ x: number, y: number, d: number } | null} */
            let best = null;
            for (let x = 8; x < width - 8; x += 6) {
                for (let y = 8; y < height - 8; y += 6) {
                    if (
                        handles.some(
                            (/** @type {any} */ h) => Math.hypot(h.x - x, h.y - y) < clearance
                        )
                    )
                        continue;
                    const d = Math.hypot(x - origin.x, y - origin.y);
                    if (best && d >= best.d) continue;
                    const onFill = map
                        .queryRenderedFeatures([x, y])
                        .some((/** @type {any} */ f) => f.layer.id.includes(id));
                    if (onFill) best = { x, y, d };
                }
            }
            return best && { x: best.x + rect.left, y: best.y + rect.top };
        },
        { id: "td-polygon", from, clearance: HANDLE_CLEARANCE_PX },
        { timeout: 10000, polling: 250 }
    );
    const found = /** @type {{ x: number, y: number } | null} */ (await handle.jsonValue());
    if (!found) throw new Error("aucun point du remplissage n'est à l'écart des poignées");
    return found;
}

/**
 * Deep equality for the small coordinate arrays this spec compares — `[lng, lat]`.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

test("[editor] éditer un polygone SANS `id` de premier niveau atteint bien l'outbox", async ({
    page,
    context,
}) => {
    await armEditablePolygon(page);
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

    /** @type {number[][]} */
    const shippedRing = await page.evaluate(
        (id) =>
            /** @type {any} */ (window).GeoLeaf.Layers.getFeatures(id)[0].geometry.coordinates[0],
        LAYER
    );
    const target = interiorPoint(shippedRing);

    await armEditor(page);
    await goOffline(context, page);

    // 🛑 No gesture before the camera is posed: a basemap applied late tilts it to `pitch: 60`
    // mid-drag, and the drag is lost in silence (see `helpers/camera.js`).
    await awaitSettledCamera(page);

    const inside = await projectInteriorPoint(page, target);
    await page.mouse.click(inside.x, inside.y);

    // 🛑 THE IDENTITY MUST HAVE BEEN RESOLVED — as in spec 38, a copy reaching Terra Draw is not
    // enough: the selection LOOKS fine on the defect.
    await page.waitForFunction(
        () => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-polygon");
            const data = src?.serialize?.()?.data ?? src?._data;
            return (data?.features?.length ?? 0) > 0;
        },
        null,
        { timeout: 10000 }
    );

    /** The outer ring Terra Draw currently holds — `null` when it holds nothing. */
    const tdRing = () =>
        page.evaluate(() => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-polygon");
            const data = src?.serialize?.()?.data ?? src?._data;
            return data?.features?.[0]?.geometry?.coordinates?.[0] ?? null;
        });

    // Drag the WHOLE feature from inside the fill — the polygon's own gesture — from a point clear
    // of the handles the selection shows (see `pressPointClearOfHandles`).
    //
    // ⚠️ The amorce below stays: Terra Draw arms the feature drag on the FIRST pointer move after
    // the `down`, so a short move before the real one is what a hand does anyway.
    const press = await pressPointClearOfHandles(page, inside);
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    // A short first move, then the real one — what a hand does anyway.
    await page.mouse.move(press.x + 5, press.y + 4, { steps: 2 });
    await page.waitForTimeout(120);
    await page.mouse.move(press.x + 30, press.y + 20, { steps: 16 });
    await page.mouse.up();
    // 🛑 JUDGED ON THE WHOLE RING, not on its first vertex: a vertex inserted and dragged at a
    // midpoint handle leaves `ring[0]` in place too, and reads exactly like a lost gesture. A
    // whole-shape drag keeps the vertex count and moves EVERY vertex.
    const dragged = await tdRing();
    const moved =
        Array.isArray(dragged) &&
        dragged.length === shippedRing.length &&
        dragged.every((c, i) => !deepEqual(c, shippedRing[i]));

    const lost = await page.evaluate((pt) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const src = map.getSource("td-polygon");
        const data = src?.serialize?.()?.data ?? src?._data;
        const rect = map.getContainer().getBoundingClientRect();
        return {
            vertices: data?.features?.[0]?.geometry?.coordinates?.[0]?.length ?? null,
            pitch: Math.round(map.getPitch()),
            zoom: +map.getZoom().toFixed(2),
            moving: map.isMoving(),
            terrain: !!map.getTerrain?.(),
            selected: data?.features?.[0]?.properties?.selected ?? null,
            hit: map
                .queryRenderedFeatures([pt.x - rect.left, pt.y - rect.top])
                .map((/** @type {any} */ q) => q.layer.id)
                .filter((/** @type {string} */ id) => id.startsWith("td-")),
        };
    }, press);
    expect(
        moved,
        `le drag n'a pas déplacé la forme ENTIÈRE dans Terra Draw (un sommet inséré compte aussi ` +
            `pour un échec : ${shippedRing.length} sommets livrés) — ` +
            `pas la persistance. État de la page : ${JSON.stringify(lost)}`
    ).toBe(true);

    // Enter leaves select mode → deselect → commit.
    await page.keyboard.press("Enter");

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
    // 🛑 THE IDENTITY ON THE WIRE — `""` is the defect in its final form.
    // The store's key since 17/09/2026 — the picker names the server identity (see spec 38).
    expect(entry.localId).toBe(`srv:${POLYGON_ID}`);

    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const stored = features.find((f) => f.serverId === POLYGON_ID);
    expect(stored, "l'entité éditée n'est pas dans le magasin local").toBeTruthy();
    expect(stored.feature.geometry.type).toBe("Polygon");
    const ring = stored.feature.geometry.coordinates[0];
    // A ring stays a ring: closed, and not reduced to a degenerate shape.
    expect(ring.length).toBeGreaterThan(3);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // And the edit is IN it: an update carrying the shipped geometry would prove only that
    // something was written, not that the drag was.
    expect(ring[0]).not.toEqual(shippedRing[0]);
});
