// @ts-check
// A basemap switch that replaces the style keeps the layers GeoLeaf places OUTSIDE the adapter's
// registry — measured on the delivered bundle, in the real engine, for the four families that do:
// the labels (core), the measure plugin, the COG plugin, and the editor's drawing engine
// (terra-draw).
//
// 🛑 THE DEFECT. `setStyle(next, { transformStyle })` carries into the incoming style what the
// adapter OWNS — its registered layers, the POI clusters, the sentinel. Every other layer was
// erased by the diff, and nothing brought it back:
//   - labels: the capability's bookkeeping still read "shown", so no zoom rebuilt them;
//   - measure and COG: their sources went, and the data in them;
//   - the editor: terra-draw writes through `getSource(id).setData` in a frame callback, so its
//     next render THREW a TypeError nothing caught — on the user's next click.
// Seen red on the bundle before the fix, on every family.
//
// ⚠️ BOTH DIRECTIONS. raster→vector downloads a style; vector→raster applies an inline empty
// style, synchronously. Two paths through the engine, one transform.
//
// ⚠️ THE FIXTURE IS SAME-ORIGIN: no tiles, no glyphs, no sprite, so nothing third-party decides the
// verdict — and one `symbol` layer whose `text-font` no profile names, which is how a label REBUILT
// against the incoming style is told from one merely carried.
//
// ⚠️ terra-draw's ids are MEASURED here, not listed: the layers the arming of a drawing tool added
// to the style, and the sources they read. The editor declares them the same way.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, selectProfile, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// deploy-full: the only variant that ships the COG plugin and the editor.
test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const PROFILE = "reunion-eclairage";
const RASTER_KEY = "street";
const VECTOR_KEY = "e2e-vector";
const STYLE_PATH = "/__e2e__/swap-vector-style.json";
const STYLE_NAME = "e2e-swap-fixture";
/** The only `text-font` of the fixture — no profile style and no GeoLeaf layer names it. */
const FIXTURE_FONT = ["E2E Fixture Sans"];
/** The label layer of `candelabres`, labelled at boot by the profile's default theme. */
const LABEL_LAYER = "gl-candelabres-label-text";
const COG_PATH = "/sample-cog.tif";
const COG_ID = "e2e-cog";
const COG_BYTES = fs.readFileSync(path.join(__dirname, "fixtures", "sample-cog.tif"));
const POINT_BTN = 'button.gl-editor-tool-btn[data-tool="point"]';
const WAIT_MS = 30_000;
/** `expect` whose failures do not stop the test — including its `poll`. */
const softExpect = expect.configure({ soft: true });

/** The measure plugin's own ids (`packages/plugins/measure/src/draw-layers.ts`). */
const MEASURE = {
    sources: [
        "gl-measure-lines",
        "gl-measure-polygons",
        "gl-measure-vertices",
        "gl-measure-labels",
        "gl-measure-preview",
    ],
    layers: [
        "gl-measure-polygons-fill",
        "gl-measure-polygons-line",
        "gl-measure-lines-layer",
        "gl-measure-preview-layer",
        "gl-measure-vertices-layer",
        "gl-measure-labels-layer",
    ],
};

/** The fixture basemap: a background, one empty GeoJSON source, its fill and its labels. */
const FIXTURE_STYLE = {
    version: 8,
    name: STYLE_NAME,
    sources: {
        "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-background", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-base-fill", type: "fill", source: "e2e-base" },
        {
            id: "e2e-base-label",
            type: "symbol",
            source: "e2e-base",
            layout: { "text-field": ["get", "name"], "text-font": FIXTURE_FONT },
        },
    ],
};

/**
 * Serves the COG fixture, honouring HTTP Range as `17-cog` does, so the bundled geotiff.js reads
 * it through its real partial-read path.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
async function routeCog(context) {
    await context.route("**/sample-cog.tif*", (route) => {
        const range = route.request().headers()["range"];
        const total = COG_BYTES.length;
        const headers = { "Content-Type": "image/tiff", "Accept-Ranges": "bytes" };
        const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
        if (!m) {
            return route.fulfill({
                status: 200,
                headers: { ...headers, "Content-Length": String(total) },
                body: COG_BYTES,
            });
        }
        const start = parseInt(m[1], 10);
        const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
        const chunk = COG_BYTES.subarray(start, end + 1);
        return route.fulfill({
            status: 206,
            headers: {
                ...headers,
                "Content-Range": `bytes ${start}-${end}/${total}`,
                "Content-Length": String(chunk.length),
            },
            body: chunk,
        });
    });
}

/**
 * Loads a lazy plugin, as its toolbar action would, and waits for its namespace.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} plugin The name `GeoLeaf.plugins.load` takes.
 * @param {string} namespace The `GeoLeaf` key the plugin mounts.
 */
async function loadPlugin(page, plugin, namespace) {
    await page.evaluate((name) => /** @type {any} */ (window).GeoLeaf.plugins.load(name), plugin);
    await page.waitForFunction(
        (ns) => typeof (/** @type {any} */ (window).GeoLeaf?.[ns]) === "object",
        namespace,
        { timeout: WAIT_MS }
    );
}

/**
 * Absolute viewport point at a fraction of the map canvas.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} fx
 * @param {number} fy
 */
async function onCanvas(page, fx, fy) {
    const box = await page.locator("#geoleaf-map canvas.maplibregl-canvas").first().boundingBox();
    if (!box) throw new Error("le canvas de la carte n'a pas de boîte");
    return { x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) };
}

/**
 * What of `ids` is missing from the live style, and what the measure sources hold.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ layers: string[], sources: string[] }} ids
 */
function survey(page, ids) {
    return page.evaluate(
        ({ layers, sources, measureSources, labelLayer }) => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const style = native.getStyle();
            /** @type {Record<string, number>} */
            const measured = {};
            for (const id of measureSources) {
                measured[id] = style.sources[id]?.data?.features?.length ?? -1;
            }
            return {
                style: style.name ?? null,
                missingLayers: layers.filter((id) => !native.getLayer(id)),
                missingSources: sources.filter((id) => !native.getSource(id)),
                measured,
                labelFont: native.getLayer(labelLayer)
                    ? (native.getLayoutProperty(labelLayer, "text-font") ?? [])
                    : null,
            };
        },
        { ...ids, measureSources: MEASURE.sources, labelLayer: LABEL_LAYER }
    );
}

test("un changement de style garde les étiquettes, la mesure, le COG et le tracé de l'éditeur", async ({
    page,
    context,
}) => {
    // Three lazy plugins, a real measure drawn at the pointer, two style swaps.
    test.setTimeout(120_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await serveBasemapTilesLocally(context);
    await routeCog(context);
    await context.route(`**${STYLE_PATH}*`, (route) => route.fulfill({ json: FIXTURE_STYLE }));
    await selectProfile(page, PROFILE);
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {});

    // 0. PRECONDITIONS — the raster basemap active, the profile's labels shown.
    await page.waitForFunction(
        (key) => /** @type {any} */ (window).GeoLeaf?.Baselayers?.getActiveKey?.() === key,
        RASTER_KEY,
        { timeout: WAIT_MS }
    );
    await page.waitForFunction(
        (id) => !!(/** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().getLayer(id)),
        LABEL_LAYER,
        { timeout: WAIT_MS }
    );

    // 1. A measure, drawn at the pointer.
    await loadPlugin(page, "measure", "Measure");
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Measure.startMeasure("distance"));
    for (const [fx, fy] of [
        [0.4, 0.4],
        [0.55, 0.55],
        [0.65, 0.45],
    ]) {
        const p = await onCanvas(page, fx, fy);
        await page.mouse.click(p.x, p.y);
    }
    const last = await onCanvas(page, 0.65, 0.45);
    await page.mouse.dblclick(last.x, last.y);
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.some(
                        (/** @type {any} */ f) => f.geometry?.type === "LineString"
                    )
                ),
            { timeout: 10_000, message: "la mesure de distance n'a pas été enregistrée" }
        )
        .toBe(true);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Measure.stopMeasure());

    // 2. A COG layer.
    await loadPlugin(page, "cog", "COG");
    await page.evaluate(
        async ({ url, id }) => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            await gl.COG.addLayer(location.origin + url, gl.Core.getMap().getNativeMap(), { id });
        },
        { url: COG_PATH, id: COG_ID }
    );

    // 3. The editor armed — terra-draw lays its layers; which ones is measured.
    await loadPlugin(page, "editor", "Editor");
    const order = () =>
        page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().getLayersOrder()
        );
    const beforeEditor = new Set(await order());
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    await page.locator(POINT_BTN).click();
    await expect(page.locator(POINT_BTN)).toHaveClass(/gl-editor-tool-btn--active/, {
        timeout: 8000,
    });
    await expect
        .poll(async () => (await order()).filter((id) => !beforeEditor.has(id)).length, {
            timeout: 15_000,
            message: "l'éditeur armé n'a posé aucune couche",
        })
        .toBeGreaterThan(0);
    const drawLayers = (await order()).filter((id) => !beforeEditor.has(id));
    const drawSources = await page.evaluate((ids) => {
        const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        return [...new Set(ids.map((id) => native.getLayer(id)?.source).filter(Boolean))];
    }, drawLayers);
    expect(drawSources.length, "les couches de l'éditeur ne lisent aucune source").toBeGreaterThan(
        0
    );

    const ids = {
        layers: [LABEL_LAYER, ...MEASURE.layers, COG_ID, ...drawLayers],
        sources: [...MEASURE.sources, COG_ID, ...drawSources],
    };
    const before = await survey(page, ids);
    expect(before.missingLayers, "absentes AVANT la bascule : la spec ne mesure rien").toEqual([]);
    expect(before.missingSources, "absentes AVANT la bascule : la spec ne mesure rien").toEqual([]);
    expect(before.measured["gl-measure-lines"], "la mesure n'a rien tracé").toBeGreaterThan(0);

    // 4. raster → vector: the style downloads, then the transform runs.
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
            return native.getStyle().name === name && native.isStyleLoaded() === true;
        },
        STYLE_NAME,
        { timeout: WAIT_MS }
    );
    // SOFT from here on: a red run names every family it lost, not only the first one.
    const onVector = await survey(page, ids);
    expect.soft(onVector.missingLayers, "couches effacées par raster → vecteur").toEqual([]);
    expect.soft(onVector.missingSources, "sources effacées par raster → vecteur").toEqual([]);
    expect
        .soft(onVector.measured, "données de mesure perdues par raster → vecteur")
        .toEqual(before.measured);
    expect
        .soft(onVector.labelFont, "étiquettes portées sans être reconstruites")
        .toEqual(FIXTURE_FONT);

    // 5. The editor draws on the new style: terra-draw renders into its own source.
    const point = await onCanvas(page, 0.5, 0.5);
    await page.mouse.click(point.x, point.y);
    await softExpect
        .poll(
            () =>
                page.evaluate((ids) => {
                    const style = /** @type {any} */ (window).GeoLeaf.Core.getMap()
                        .getNativeMap()
                        .getStyle();
                    return ids.reduce(
                        (n, id) => n + (style.sources[id]?.data?.features?.length ?? 0),
                        0
                    );
                }, drawSources),
            { timeout: 10_000, message: "terra-draw n'a rien rendu après la bascule" }
        )
        .toBeGreaterThan(0);
    // Cleanup, not the subject: the form the point opened is closed without persisting anything.
    await page.evaluate(() => {
        try {
            /** @type {any} */ (window).GeoLeaf.Editor.discardDraft();
        } catch {
            /* a draft the engine lost is not what this spec measures */
        }
    });

    // 6. vector → raster: an inline empty style, applied synchronously.
    await page.evaluate(
        (key) => /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key),
        RASTER_KEY
    );
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return !!native.getSource("__geoleaf_basemap__") && native.isStyleLoaded() === true;
        },
        null,
        { timeout: WAIT_MS }
    );
    const onRaster = await survey(page, ids);
    expect(onRaster.style, "le style vectoriel est resté en place").not.toBe(STYLE_NAME);
    expect.soft(onRaster.missingLayers, "couches effacées par vecteur → raster").toEqual([]);
    expect.soft(onRaster.missingSources, "sources effacées par vecteur → raster").toEqual([]);
    expect
        .soft(onRaster.measured, "données de mesure perdues par vecteur → raster")
        .toEqual(before.measured);

    expect(pageErrors, `exceptions non rattrapées : ${pageErrors.join(" | ")}`).toEqual([]);
});
