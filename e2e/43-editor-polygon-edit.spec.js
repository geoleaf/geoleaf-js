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

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";
import { goOffline } from "./helpers/offline.js";
import { armEditor } from "./helpers/editor.js";

test.use({ baseURL: baseURL("full") });

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
                map.fitBounds(bounds, { animate: false, padding: 60 });
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

    // Drag the WHOLE feature from inside the fill — the polygon's own gesture.
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down();
    await page.mouse.move(inside.x + 30, inside.y + 20, { steps: 8 });
    await page.mouse.up();

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
