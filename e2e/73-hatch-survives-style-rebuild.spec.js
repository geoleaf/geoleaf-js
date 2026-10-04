// @ts-check
/**
 * 73 — A HATCHED LAYER KEEPS ITS PATTERN WHEN THE ENGINE REBUILDS THE STYLE
 *
 * A hatch is an image GeoLeaf draws on a canvas and hands to the engine (`map.addImage`); the
 * fill sub-layer names it in `fill-pattern`. An image is not part of the style. When a basemap
 * switch replaces the style, the engine first tries to DIFF the two styles — and on that path the
 * images survive. When the diff fails it rebuilds the style from scratch, with a new image
 * manager: the layers are carried by the transform, the images they name are not.
 *
 * 🛑 WHAT MAKES THE DIFF FAIL, measured here and read in MapLibre 6.7.0 — not a sprite or a
 * glyphs change, which the engine diffs. An incoming style that declares `centerAltitude` (a
 * command the diff emits and nothing implements), or `terrain` (its operation calls
 * `Map.setTerrain` on the wrong receiver and throws). The second also fails on the way OUT of
 * such a style, the terrain then being in the outgoing one.
 *
 * ⚠️ THE CONTROL IS THE FIRST TEST, and it is what makes the two others mean something: the same
 * switch through a style the engine can diff keeps the engine's style object, and the pattern.
 * The witness of a rebuild is that object's IDENTITY — the console warning is emitted once per
 * message and cannot tell two rebuilds apart.
 *
 * ⚠️ THE PATTERN IS MEASURED, NOT DERIVED: the hatch images are read off the map before the
 * switch, with the fill layers naming them, on `tourism` — whose default theme shows a hatched
 * layer. No shipped profile pairs a hatched layer with a vector basemap, so the basemaps are
 * fixtures, same-origin: no third party decides the verdict.
 */

import { deflateSync, crc32 } from "node:zlib";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const VECTOR_KEY = "e2e-vector";
const STYLE_PATH = "/__e2e__/hatch-vector-style.json";
const STYLE_NAME = "e2e-hatch-fixture";
const DEM_SEGMENT = "__e2e_dem__";
const WAIT_MS = 30_000;

/** The fixture basemap the engine can diff: a background and one empty GeoJSON source. */
const DIFFABLE = {
    version: 8,
    name: STYLE_NAME,
    sources: {
        "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-background", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-base-fill", type: "fill", source: "e2e-base" },
    ],
};

/**
 * The incoming styles, by what each does to the engine's diff.
 * @type {{ name: string, rebuilds: boolean, rebuildsOnTheWayBack: boolean, style: (origin: string) => object }[]}
 */
const CASES = [
    {
        name: "un style que le moteur sait différencier garde les images (contrôle)",
        rebuilds: false,
        rebuildsOnTheWayBack: false,
        style: () => DIFFABLE,
    },
    {
        name: "un style qui déclare `centerAltitude` fait reconstruire le style",
        rebuilds: true,
        rebuildsOnTheWayBack: false,
        style: () => ({ ...DIFFABLE, centerAltitude: 100 }),
    },
    {
        name: "un style qui déclare `terrain` fait reconstruire le style, à l'aller et au retour",
        rebuilds: true,
        rebuildsOnTheWayBack: true,
        style: (origin) => ({
            ...DIFFABLE,
            sources: {
                ...DIFFABLE.sources,
                "e2e-dem": {
                    type: "raster-dem",
                    tiles: [`${origin}/${DEM_SEGMENT}/{z}/{x}/{y}.png`],
                    tileSize: 256,
                    encoding: "terrarium",
                    maxzoom: 4,
                },
            },
            terrain: { source: "e2e-dem" },
        }),
    },
];

/** A PNG chunk: length, type, data, CRC over type and data. */
function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** A flat 256 px elevation tile: Terrarium encodes sea level as RGB (128, 0, 0). */
function flatDemTile() {
    const size = 256;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, no interlace
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row[1 + x * 3] = 128;
    const pixels = Buffer.concat(Array.from({ length: size }, () => row));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(pixels)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

const DEM_TILE = flatDemTile();

/**
 * The hatch images on the map, the fill layers that name them, and what of both is gone.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ images: string[], layers: Record<string, string> } | null} expected What an earlier
 *   reading found — `null` on the first reading.
 */
function hatches(page, expected) {
    return page.evaluate((expected) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const images = native.listImages().filter((id) => id.startsWith("gl-hatch-"));
        /** @type {Record<string, string>} */
        const layers = {};
        for (const layer of native.getStyle().layers) {
            const pattern = layer.type === "fill" ? layer.paint?.["fill-pattern"] : null;
            if (typeof pattern === "string" && pattern.startsWith("gl-hatch-")) {
                layers[layer.id] = pattern;
            }
        }
        return {
            images: images.sort(),
            layers,
            missingImages: (expected?.images ?? []).filter((id) => !native.hasImage(id)),
            missingLayers: Object.keys(expected?.layers ?? {}).filter((id) => !layers[id]),
        };
    }, expected);
}

/** Marks the engine's style object, so a later reading can tell whether it was replaced. */
function markEngineStyle(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        /** @type {any} */ (window).__e2eEngineStyle = native.style;
    });
}

/** Whether the engine replaced its style object since {@link markEngineStyle}. */
function engineStyleReplaced(page) {
    return page.evaluate(() => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        return native.style !== /** @type {any} */ (window).__e2eEngineStyle;
    });
}

test.beforeEach(async ({ context }) => {
    // The raster basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    await context.route(`**/${DEM_SEGMENT}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: DEM_TILE })
    );
});

for (const scenario of CASES) {
    test(`[basemaps] les hachures traversent une bascule de fond — ${scenario.name}`, async ({
        page,
        context,
    }) => {
        /** @type {string[]} */
        const rebuildWarnings = [];
        page.on("console", (msg) => {
            if (msg.text().includes("Unable to perform style diff")) {
                rebuildWarnings.push(msg.text());
            }
        });
        await context.route(`**${STYLE_PATH}*`, (route) =>
            route.fulfill({ json: scenario.style(new URL(route.request().url()).origin) })
        );
        await armAppReadyWitness(page);
        await page.goto("/");
        await waitAppReadyWitness(page);
        // 🛑 The boot's own basemap activation is DEFERRED until the style is ready, and
        // `geoleaf:app:ready` does not wait for it: read before it has run, the active key is
        // `null` — and the way back below would ask for no basemap at all. Measured: one run in
        // three. A settled camera is the witness that the activation has run.
        await awaitSettledCamera(page);

        // 0. PRECONDITIONS — a hatch image on the map, and a fill layer naming it.
        await expect
            .poll(async () => (await hatches(page, null)).images.length, {
                timeout: WAIT_MS,
                message: "aucune hachure sur la carte : la spec ne mesure rien",
            })
            .toBeGreaterThan(0);
        const before = await hatches(page, null);
        expect(
            Object.keys(before.layers).length,
            "aucune couche ne nomme une hachure : la spec ne mesure rien"
        ).toBeGreaterThan(0);
        const rasterKey = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()
        );
        expect(rasterKey, "aucun fond actif au départ : le retour ne mesurerait rien").toBeTruthy();

        // 1. raster → vector: the style downloads, then the engine diffs it — or fails to.
        await markEngineStyle(page);
        await page.evaluate(
            ({ key, url }) => {
                const bl = /** @type {any} */ (window).GeoLeaf.Baselayers;
                bl.registerBaseLayer(key, {
                    type: "maplibre",
                    label: "E2E vector",
                    style: location.origin + url,
                });
                bl.setBaseLayer(key);
            },
            { key: VECTOR_KEY, url: STYLE_PATH }
        );
        await page.waitForFunction(
            (name) => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                return native.getStyle()?.name === name && native.isStyleLoaded() === true;
            },
            STYLE_NAME,
            { timeout: WAIT_MS }
        );

        // The witness: without it, a pattern still there would say nothing about a rebuild.
        expect(
            await engineStyleReplaced(page),
            scenario.rebuilds
                ? "le moteur n'a pas reconstruit le style : la spec ne mesure pas ce qu'elle annonce"
                : "le moteur a reconstruit un style qu'il devait différencier"
        ).toBe(scenario.rebuilds);
        expect(rebuildWarnings.length > 0, "l'avertissement de reconstruction du moteur").toBe(
            scenario.rebuilds
        );

        // The subject. Polled: the images are put back by the `style.load` handler.
        await expect
            .poll(async () => (await hatches(page, before)).missingImages, {
                timeout: 10_000,
                message: "hachures perdues par raster → vecteur",
            })
            .toEqual([]);
        expect(
            (await hatches(page, before)).missingLayers,
            "couches hachurées perdues par raster → vecteur"
        ).toEqual([]);

        // 2. vector → raster: an inline empty style.
        await markEngineStyle(page);
        await page.evaluate(
            (key) => /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key),
            rasterKey
        );
        await page.waitForFunction(
            (name) => {
                const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                return native.getStyle()?.name !== name && native.isStyleLoaded() === true;
            },
            STYLE_NAME,
            { timeout: WAIT_MS }
        );
        expect(
            await engineStyleReplaced(page),
            "reconstruction du style au retour vers le fond raster"
        ).toBe(scenario.rebuildsOnTheWayBack);
        await expect
            .poll(async () => (await hatches(page, before)).missingImages, {
                timeout: 10_000,
                message: "hachures perdues par vecteur → raster",
            })
            .toEqual([]);
        expect(
            (await hatches(page, before)).missingLayers,
            "couches hachurées perdues par vecteur → raster"
        ).toEqual([]);
    });
}
