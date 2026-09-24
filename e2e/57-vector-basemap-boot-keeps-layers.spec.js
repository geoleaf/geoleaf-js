// @ts-check
// A VECTOR default basemap keeps, once its style has arrived, the data layers created while that
// style was downloading — measured on the delivered bundle, in the real engine.
//
// 🛑 THE DEFECT. With `style` given by URL, MapLibre downloads the style and only THEN runs the
// `transformStyle` GeoLeaf hands to `setStyle`, with the LIVE style as `previous` (6.7.0,
// `Style.setState`). GeoLeaf read what it owns when it BUILT that transform — before the download
// — so a layer created meanwhile was missing from it, and the arriving style erased the layer's
// source while the adapter still reported the layer present: every later `updateLayerData` wrote
// into a source that was gone. Seen red on the bundle built before the fix, `gl-src-e2e-late`
// absent. The kernel half of the proof is
// `packages/core/__tests__/basemaps/vector-basemap-boot-keeps-layers.test.ts`.
//
// ⚠️ NO PROFILE OF THE REPOSITORY BOOTS ON A VECTOR BASEMAP — measured: `tourism` and
// `reunion-eclairage` default to raster. The spec makes one: it rewrites `reunion-eclairage`'s
// bundle (light, local data) so that a vector entry is the default, and serves that entry's style
// itself. The fixture carries no tiles, no glyphs and no sprite, so that nothing third-party
// decides the verdict.
//
// ⚠️ THE STYLE IS HELD, NOT DELAYED. Its request proves `setStyle` ran; the spec then waits for the
// profile's initial layers AND creates its own through `GeoLeaf.Layers.create`, and only then lets
// the style through. A fixed delay would make the window a lottery; holding the response makes it
// certain.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, selectProfile } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PROFILE = "reunion-eclairage";
const BASEMAP_KEY = "e2e-vector";
const STYLE_PATH = "/__e2e__/vector-basemap-style.json";
const STYLE_NAME = "e2e-vector-fixture";
const CREDIT = "© E2E vector fixture";
const LATE_LAYER = "e2e-late";
const WAIT_MS = 30_000;

/** The fixture basemap: one GeoJSON source without a credit, and its layer, over a background. */
const FIXTURE_STYLE = {
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
 * Settles `promise`, or fails with `message` after `ms`.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function within(promise, ms, message) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() =>
        clearTimeout(timer)
    );
}

test("un fond vectoriel par défaut garde les couches créées pendant le téléchargement de son style", async ({
    page,
    context,
}) => {
    await selectProfile(page, PROFILE);
    // End of the profile's phase-1 loading — armed before any page script, so it cannot be missed.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__glPhase1 = -1;
        document.addEventListener(
            "geoleaf:layers:initial-loaded",
            (e) => {
                w.__glPhase1 = /** @type {any} */ (e).detail?.count ?? 0;
            },
            { once: true }
        );
    });

    // 1. The profile boots on a vector basemap whose style this spec serves.
    let patched = false;
    await context.route(`**/profiles/${PROFILE}/profile-bundle.json**`, async (route) => {
        const bundle = await (await route.fetch()).json();
        const basemaps = bundle?.basemaps?.basemaps;
        if (!basemaps || typeof basemaps !== "object") {
            throw new Error("le bundle ne porte plus `basemaps.basemaps` : la spec ne mord plus");
        }
        for (const definition of Object.values(basemaps)) {
            /** @type {any} */ (definition).defaultBasemap = false;
        }
        basemaps[BASEMAP_KEY] = {
            id: BASEMAP_KEY,
            label: "E2E vector",
            type: "maplibre",
            style: new URL(STYLE_PATH, route.request().url()).href,
            attribution: CREDIT,
            defaultBasemap: true,
        };
        patched = true;
        await route.fulfill({ json: bundle });
    });

    // 2. The style is HELD: its request proves `setStyle` ran; it is answered once released.
    /** @type {() => void} */
    let markRequested = () => {};
    const requested = new Promise((resolve) => {
        markRequested = () => resolve(undefined);
    });
    /** @type {() => void} */
    let release = () => {};
    const released = new Promise((resolve) => {
        release = () => resolve(undefined);
    });
    await context.route(`**${STYLE_PATH}**`, async (route) => {
        markRequested();
        await released;
        await route.fulfill({ json: FIXTURE_STYLE });
    });

    await page.goto("/");
    await bootMap(page);
    expect(patched, "le bundle du profil n'a pas été réécrit").toBe(true);

    await within(requested, WAIT_MS, "le fond vectoriel par défaut n'a jamais demandé son style");
    await page.waitForFunction(() => /** @type {any} */ (window).__glPhase1 >= 0, null, {
        timeout: WAIT_MS,
    });

    // 3. The integrator's layer, created while the basemap's style is still downloading.
    const landed = await page.evaluate(async (id) => {
        const gl = /** @type {any} */ (window).GeoLeaf;
        const native = gl.Core.getMap().getNativeMap();
        const center = native.getCenter();
        await gl.Layers.create({
            id,
            label: id,
            inlineData: {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [center.lng, center.lat] },
                        properties: {},
                    },
                ],
            },
        });
        return (
            !!native.getSource(`gl-src-${id}`) && native.getStyle().name !== "e2e-vector-fixture"
        );
    }, LATE_LAYER);
    expect(landed, "la couche n'a pas atteint la carte AVANT l'arrivée du style").toBe(true);

    // 4. The style arrives.
    release();
    await page.waitForFunction(
        (name) => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return native?.getStyle?.()?.name === name && native.isStyleLoaded() === true;
        },
        STYLE_NAME,
        { timeout: WAIT_MS }
    );

    // 5. What the kernel believes present IS present — the contradiction the report described.
    const registry = await page.evaluate(() => {
        const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
        const native = adapter.getNativeMap();
        const layers = adapter.getLayerRegistry();
        /** @type {string[]} */
        const gone = [];
        for (const id of layers.getAllLayerIds()) {
            const entry = layers.get(id);
            if (!native.getSource(entry.sourceId)) gone.push(entry.sourceId);
            for (const sub of entry.subLayerIds) if (!native.getLayer(sub)) gone.push(sub);
        }
        return { ids: layers.getAllLayerIds(), gone };
    });
    expect(registry.ids, "la couche créée n'est plus enregistrée").toContain(LATE_LAYER);
    expect(registry.ids.length, "le profil n'a chargé aucune couche").toBeGreaterThan(1);
    expect(
        registry.gone,
        "effacées par l'arrivée du style alors que le noyau les croit là"
    ).toEqual([]);

    // 6. Painted: the engine renders the late layer's feature.
    await expect
        .poll(
            () =>
                page.evaluate((id) => {
                    const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
                    const native = adapter.getNativeMap();
                    const layers = adapter
                        .getLayerRegistry()
                        .getSubLayerIds(id)
                        .filter((/** @type {string} */ sub) => native.getLayer(sub));
                    return layers.length ? native.queryRenderedFeatures({ layers }).length : 0;
                }, LATE_LAYER),
            {
                timeout: 15_000,
                message: "la couche créée pendant le téléchargement n'est pas peinte",
            }
        )
        .toBeGreaterThan(0);

    // 7. The vector basemap's declared credit reached its uncredited source.
    const credit = await page.evaluate(
        () =>
            /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().getStyle().sources[
                "e2e-base"
            ]?.attribution
    );
    expect(credit, "le crédit déclaré du fond vectoriel n'est pas posé").toBe(CREDIT);
});
