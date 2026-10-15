// @ts-check
/**
 * 86 — AN ICON THE LIBRARY IS ABOUT TO REGISTER RAISES NO "MISSING IMAGE" WARNING
 *
 * A point layer born empty and filled afterwards draws its icons (spec 85). What it also did
 * was make the engine complain, once per image the write named:
 *
 *     Image "<id>" could not be loaded. Please make sure you have added the image before it
 *     is needed with map.addImage(), …
 *
 * The written features reach the source carrying their `symbolId`; the images those ids name
 * are registered by a step that is asynchronous — and that waited for the style to settle,
 * which a source loading its data keeps it from doing. The worker asked for the images in
 * between, was told there were none, and got them a moment later: nothing missing on screen,
 * one line per image in the host's console.
 *
 * The case that produces it every time is the EARLY write: the page opens on a search already
 * asked for, so the first write leaves as soon as the map is ready, naming every category at
 * once, before anything has registered a single image. Hence the writes below start from
 * `geoleaf:map:ready`, not from an idle application.
 *
 * 🛑 THE SPRITE IS SERVED LATE HERE, ON PURPOSE. Whether the engine asks before or after the
 * images land is a race, and on a fast local server the fixture lost it one run in two: a guard
 * that is red by luck guards nothing. A sprite that takes a moment to arrive is the ordinary
 * condition of a real network, and it makes the old order lose every time. It also bounds what
 * this spec can see: once the sprite is in, EVERY image it holds is registered at once, so only
 * a write that leaves BEFORE that can name an image the engine does not hold — which is why the
 * later writes below follow the first one closely instead of waiting for an idle application.
 *
 * Target: `deploy-full`, profile `tourism` — its `modules.taxonomy` binds `hebergements` by id
 * to a taxonomy with icons, and the layer belongs to a theme the boot does not load, so its id
 * is free. One point per LEAF of that taxonomy, read from the profile: the write names every
 * image the taxonomy can name.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { bootMapUntilIdle } from "./helpers/boot.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

/** The layer id the profile's taxonomy is bound to. */
const LAYER = "hebergements";
const WAIT_MS = 20_000;
/** How late the sprite is served, and how long after the first write the second one leaves. */
const SPRITE_DELAY_MS = 1_500;
const SECOND_WRITE_MS = 300;
/** The engine's own wording — narrow enough not to match the boot's "profile could not be loaded". */
const MISSING_IMAGE = /Image ".*" could not be loaded/;

/**
 * Every leaf of the taxonomy the layer is bound to, as the pair a feature carries.
 * @returns {Array<[string, string]>}
 */
function taxonomyLeaves() {
    const file = fileURLToPath(
        new URL("../profiles/tourism/config/plugins/taxonomy.json", import.meta.url)
    );
    const taxonomy = JSON.parse(readFileSync(file, "utf8")).taxonomies["poi-cat"];
    return Object.entries(taxonomy.categories).flatMap(([categoryId, category]) =>
        Object.keys(/** @type {any} */ (category).subcategories ?? {}).map(
            (subcategoryId) => /** @type {[string, string]} */ ([categoryId, subcategoryId])
        )
    );
}

const LEAVES = taxonomyLeaves();

/**
 * Runs IN THE PAGE. Builds one point per leaf, laid out on a grid around the middle of the
 * canvas — far enough apart that no icon hides another — and hands them to the layer.
 *
 * `slot` is the leaf's rank in the WHOLE taxonomy, so a leaf written later lands on its own
 * cell, never on a point already there.
 *
 * @param {{ id: string, how: "setData" | "mergeFeatures" | "addFeature",
 *   leaves: Array<[string, string, number]> }} step
 */
function write(step) {
    const G = /** @type {any} */ (window).GeoLeaf;
    const map = G.Core.getMap().getNativeMap();
    const canvas = map.getCanvas();
    // The camera the layout is computed on is kept: at `map:ready` it is not yet the one the
    // profile settles on, and the reading must look where the points were put.
    const w = /** @type {any} */ (window);
    w.__e2eCamera ??= { center: map.getCenter().toArray(), zoom: map.getZoom() };
    map.jumpTo(w.__e2eCamera);
    const COLUMNS = 5;
    const CELL_PX = 90;
    const features = step.leaves.map(([categoryId, subcategoryId, slot]) => {
        const x = canvas.clientWidth / 2 + ((slot % COLUMNS) - 2) * CELL_PX;
        const y = canvas.clientHeight / 2 + (Math.floor(slot / COLUMNS) - 1) * CELL_PX;
        return {
            type: "Feature",
            id: `leaf-${slot}`,
            // What the profile's taxonomy reads to resolve an icon.
            properties: { id: `leaf-${slot}`, categoryId, subcategoryId },
            geometry: { type: "Point", coordinates: map.unproject([x, y]).toArray() },
        };
    });
    if (step.how === "setData") G.Layers.setData(step.id, features);
    if (step.how === "mergeFeatures") G.Layers.mergeFeatures(step.id, features);
    if (step.how === "addFeature") for (const f of features) G.Layers.addFeature(step.id, f);
}

/** The leaves at the given ranks, each with its rank. */
function slots(ranks) {
    return ranks.map((n) => /** @type {[string, string, number]} */ ([...LEAVES[n], n]));
}

const ALL = LEAVES.map((_, n) => n);

/**
 * Arms the writes — the layer is created EMPTY and filled in the same breath, from the first
 * `geoleaf:map:ready`, each further write following `SECOND_WRITE_MS` behind the previous one —
 * then boots, and returns the engine's complaints as they come.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ how: "setData" | "mergeFeatures" | "addFeature", ranks: number[] }>} writes
 * @returns {Promise<string[]>} The "missing image" lines, a live array.
 */
async function bootWritingAtMapReady(page, writes) {
    /** @type {string[]} */
    const complaints = [];
    page.on("console", (msg) => {
        if (MISSING_IMAGE.test(msg.text())) complaints.push(msg.text());
    });
    await page.context().route("**/icons/sprite_tourism.svg**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, SPRITE_DELAY_MS));
        await route.continue();
    });
    // The page-side helper travels as an init script of its own: one is serialized alone, and
    // the page's CSP refuses to evaluate a string.
    await page.addInitScript({ content: `window.__e2eWrite = ${write.toString()};` });
    await page.addInitScript(
        ([id, steps, gapMs]) => {
            document.addEventListener(
                "geoleaf:map:ready",
                async () => {
                    const w = /** @type {any} */ (window);
                    try {
                        await w.GeoLeaf.Layers.create({
                            id,
                            label: "E2E — written icons",
                            geometry: "point",
                            showIconsOnMap: true,
                            // One icon per point is what is counted: no bubble may swallow one.
                            clustering: { enabled: false },
                            inlineData: { type: "FeatureCollection", features: [] },
                        });
                        for (const [n, step] of steps.entries()) {
                            if (n > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
                            w.__e2eWrite(step);
                        }
                        w.__e2eWrites = "done";
                    } catch (err) {
                        w.__e2eWrites = `failed: ${String(err)}`;
                    }
                },
                { once: true }
            );
        },
        /** @type {[string, any[], number]} */ ([
            LAYER,
            writes.map((w) => ({ id: LAYER, how: w.how, leaves: slots(w.ranks) })),
            SECOND_WRITE_MS,
        ])
    );
    await bootMapUntilIdle(page);
    await awaitSettledCamera(page);
    // The fixture's own witness: a write that never left would make every verdict below vacuous.
    await expect
        .poll(() => page.evaluate(() => /** @type {any} */ (window).__e2eWrites), {
            timeout: WAIT_MS,
        })
        .toBe("done");
    // The theme the boot applies AFTER `map:ready` hides every layer it does not list, this one
    // included: shown again, and the camera put back on the points, so that "drawn" can be read.
    await page.evaluate((id) => {
        const w = /** @type {any} */ (window);
        w.GeoLeaf.GeoJSON.showLayer(id);
        if (w.__e2eCamera) w.GeoLeaf.Core.getMap().getNativeMap().jumpTo(w.__e2eCamera);
    }, LAYER);
    return complaints;
}

/** What the engine and the store hold for the layer, in one reading. */
function reading(page) {
    return page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const adapter = G.Core.getMap();
        const map = adapter.getNativeMap();
        const sub = adapter
            .getLayerRegistry()
            .getSubLayerIds(id)
            .find((s) => s.endsWith("-symbol"));
        const features = G.Layers.getFeatures(id);
        const symbolIds = [...new Set(features.map((f) => f.properties?.symbolId ?? null))];
        return {
            written: features.length,
            // Every stored feature names an icon, and the engine holds its image.
            everyFeatureNamesAnIcon: symbolIds.length > 0 && !symbolIds.includes(null),
            everyIconHasItsImage: symbolIds.every((s) => s !== null && map.hasImage(s)),
            iconsDrawn: sub
                ? new Set(map.queryRenderedFeatures({ layers: [sub] }).map((f) => f.id)).size
                : null,
        };
    }, LAYER);
}

/** Every leaf has its point, which names an icon, has its image, and is drawn. */
const EVERY_LEAF_DRAWN = {
    written: LEAVES.length,
    everyFeatureNamesAnIcon: true,
    everyIconHasItsImage: true,
    iconsDrawn: LEAVES.length,
};

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
});

test("[geojson] née vide, remplie par `setData` dès `map:ready` : toutes les icônes, aucun avertissement d'image", async ({
    page,
}) => {
    const complaints = await bootWritingAtMapReady(page, [{ how: "setData", ranks: ALL }]);
    await expect.poll(() => reading(page), { timeout: WAIT_MS }).toEqual(EVERY_LEAF_DRAWN);
    expect(complaints).toEqual([]);
});

test("[geojson] une écriture ultérieure qui nomme des images jamais vues n'avertit pas davantage", async ({
    page,
}) => {
    // The first write names ONE image; the second names all the others for the first time.
    const complaints = await bootWritingAtMapReady(page, [
        { how: "setData", ranks: [0] },
        { how: "setData", ranks: ALL },
    ]);
    await expect.poll(() => reading(page), { timeout: WAIT_MS }).toEqual(EVERY_LEAF_DRAWN);
    expect(complaints).toEqual([]);
});

// The unit mutations reach the engine as a DIFF, by another road than a whole-collection write.
test("[geojson] née vide, remplie par `mergeFeatures` puis `addFeature` : aucun avertissement d'image", async ({
    page,
}) => {
    const last = LEAVES.length - 1;
    const complaints = await bootWritingAtMapReady(page, [
        { how: "mergeFeatures", ranks: ALL.slice(0, last) },
        { how: "addFeature", ranks: [last] },
    ]);
    await expect.poll(() => reading(page), { timeout: WAIT_MS }).toEqual(EVERY_LEAF_DRAWN);
    expect(complaints).toEqual([]);
});
