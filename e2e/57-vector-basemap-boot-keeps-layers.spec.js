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
//
// 🛑 AND THE LABELS OF THOSE LAYERS. A label layer is not the adapter's: `label-renderer.ts` adds it
// to the engine directly, on its layer's source, so the arriving style erased it — the profile's own
// `candelabres` labels, built before the style landed — and nothing rebuilt it, the capability's
// bookkeeping still reading "shown". Seen red on the bundle before the fix. The fixture carries one
// `symbol` layer so that a REBUILT label can be told from a carried one: a rebuild reads the incoming
// style's first `text-font`; a carried layer keeps the font it was built with.

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
/** The label layer of `candelabres`, labelled at boot by the profile's default theme. */
const LABEL_LAYER = "gl-candelabres-label-text";
/** The only `text-font` of the fixture — no profile style and no GeoLeaf layer names it. */
const FIXTURE_FONT = ["E2E Fixture Sans"];
const WAIT_MS = 30_000;

/**
 * The fixture basemap: one GeoJSON source without a credit, its fill and its labels, over a
 * background. No `glyphs`: MapLibre draws the text locally, so no font server decides anything.
 */
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

/**
 * Boots the profile on the fixture vector basemap, whose style is HELD until `release()`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<{ release: () => void }>} Once settled, `setStyle` has requested the style and
 *   the profile's phase-1 layers are loaded — while the empty boot style is still the live one.
 */
async function bootOnHeldVectorBasemap(page, context) {
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
    return { release };
}

/**
 * Waits until the fixture style is the live one and fully loaded.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitStyleArrived(page) {
    await page.waitForFunction(
        (name) => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return native?.getStyle?.()?.name === name && native.isStyleLoaded() === true;
        },
        STYLE_NAME,
        { timeout: WAIT_MS }
    );
}

test("un fond vectoriel par défaut garde les couches créées pendant le téléchargement de son style", async ({
    page,
    context,
}) => {
    const { release } = await bootOnHeldVectorBasemap(page, context);

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
    await waitStyleArrived(page);

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

test("un fond vectoriel par défaut garde les étiquettes posées avant l'arrivée de son style, dans la police de ce style", async ({
    page,
    context,
}) => {
    const { release } = await bootOnHeldVectorBasemap(page, context);

    /** The label layer's `text-font`, or `null` when the layer is not in the live style. */
    const labelFont = () =>
        page.evaluate((id) => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return native.getLayer(id) ? (native.getLayoutProperty(id, "text-font") ?? []) : null;
        }, LABEL_LAYER);

    // 1. PRECONDITION — the labels exist BEFORE the style lands. Without it, labels built after the
    // arrival would read the fixture's font and pass this test having crossed no swap at all.
    await page.waitForFunction(
        (id) =>
            !!(
                /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()
                    ?.getNativeMap?.()
                    ?.getLayer?.(id)
            ),
        LABEL_LAYER,
        { timeout: WAIT_MS }
    );
    const built = await labelFont();
    expect(built, "les étiquettes ont été construites dans la police de la fixture").not.toEqual(
        FIXTURE_FONT
    );

    // 2. The style arrives.
    release();
    await waitStyleArrived(page);

    // 3. The labels are there, REBUILT against the incoming style.
    await expect
        .poll(labelFont, {
            timeout: 15_000,
            message: `${LABEL_LAYER} a été effacée par l'arrivée du style, ou portée sans être reconstruite`,
        })
        .toEqual(FIXTURE_FONT);
});
