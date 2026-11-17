// @ts-check
// A REMOUNTED application creates the profile's layers — they wait for the map's style instead
// of racing it. Measured on the delivered bundle, in the real engine.
//
// 🛑 THE DEFECT. MapLibre throws "Style is not done loading" on `addSource` while
// `isStyleLoaded()` is false. The GeoJSON loader created each layer as soon as its data was in
// hand, without waiting for the style. On a first boot the requests in front of the creation
// (the layer's default style, its data file) usually give the style time to finish; on a remount
// — `mount`, `unmount`, `mount` in one page — everything is cached and the creation came first.
// The profile loader swallowed the error, the layer was never registered, and `ready` resolved on
// a map without it. Seen red on the 3.20.0 bundle, both tests: 0 of 4 layers at every mount, and
// one "Style is not done loading" per layer.
//
// ⚠️ WHY `71-mount-remount` DID NOT SEE IT. Its layers read a file: the request alone leaves the
// style enough time. The race needs layers whose data is in hand at once, so the spec rewrites
// `reunion-eclairage`'s bundle (light, local) so that every file layer carries `inlineData`.
//
// ⚠️ THE SECOND TEST boots on a VECTOR default basemap (no profile of the repository does —
// measured, see `57-vector-basemap-boot-keeps-layers`): the basemap reloads the style at start,
// which opens the same window again. Its style is served by the spec, with nothing third-party.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { selectProfile } from "./helpers/boot.js";
import { BOOT_TIMEOUT, MAP_ID, bootPage, installSignals, unmount } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PROFILE = "reunion-eclairage";
const CYCLES = 10;
const STYLE_ERROR = "Style is not done loading";
const BASEMAP_KEY = "e2e-vector";
const STYLE_PATH = "/__e2e__/remount-vector-style.json";
const FIXTURE_STYLE = {
    version: 8,
    name: "e2e-remount-vector",
    sources: {},
    layers: [{ id: "e2e-background", type: "background", paint: { "background-color": "#eef" } }],
};

/**
 * Rewrites the profile's bundle: every file layer gets `inlineData`, and the ids the default
 * theme shows are collected — those are what each mount must give back.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ vectorBasemap: boolean }} opts
 * @returns {Promise<{ expected: Set<string>, routed: () => number }>}
 */
async function routeInlineProfile(context, { vectorBasemap }) {
    const expected = new Set();
    let routed = 0;
    await context.route(`**/profiles/${PROFILE}/profile-bundle.json**`, async (route) => {
        const bundle = await (await route.fetch()).json();
        const inline = new Set();
        for (const [id, layer] of Object.entries(bundle.layerConfigs ?? {})) {
            const l = /** @type {any} */ (layer);
            if (l.plugin || l.data?.vectorTiles || l.data?.realtime) continue;
            if (l.data) {
                delete l.data.file;
                delete l.data.dataUrl;
                delete l.data.format;
            }
            delete l.url;
            delete l.dataFile;
            delete l.offline;
            l.inlineData = { type: "FeatureCollection", features: [] };
            inline.add(id);
        }
        const themes = bundle.themes?.themes ?? [];
        const theme = themes.find((t) => t.id === bundle.themes?.defaultTheme);
        if (!theme)
            throw new Error("le bundle n'a plus de thème par défaut : la spec ne mord plus");
        for (const entry of theme.layers ?? []) {
            if (entry.visible && inline.has(entry.id)) expected.add(entry.id);
        }
        if (vectorBasemap) {
            const basemaps = bundle?.basemaps?.basemaps;
            if (!basemaps || typeof basemaps !== "object") {
                throw new Error(
                    "le bundle ne porte plus `basemaps.basemaps` : la spec ne mord plus"
                );
            }
            for (const definition of Object.values(basemaps)) {
                /** @type {any} */ (definition).defaultBasemap = false;
            }
            basemaps[BASEMAP_KEY] = {
                id: BASEMAP_KEY,
                label: "E2E vector",
                type: "maplibre",
                style: new URL(STYLE_PATH, route.request().url()).href,
                attribution: "© E2E",
                defaultBasemap: true,
            };
        }
        routed++;
        await route.fulfill({ json: bundle });
    });
    if (vectorBasemap) {
        await context.route(`**${STYLE_PATH}**`, (route) => route.fulfill({ json: FIXTURE_STYLE }));
    }
    return { expected, routed: () => routed };
}

/**
 * `GeoLeaf.mount()` OF THIS PROFILE, awaited to `ready` — as a host mounts it. ⚠️ Not
 * `mountAndWait()`: without `profile`, a mount boots the configuration's default profile, and
 * every layer of this one would be "missing" for a reason that is not the defect.
 *
 * @param {import('@playwright/test').Page} page
 */
async function mountProfile(page) {
    const outcome = await page.evaluate(
        async ({ id, profile }) => {
            const handle = /** @type {any} */ (window).GeoLeaf.mount(id, { profile });
            Object.assign(window, { __glHandle: handle });
            const timeout = new Promise((resolve) =>
                setTimeout(() => resolve("never settled"), 45_000)
            );
            return Promise.race([
                handle.ready.then(
                    () => "ready",
                    (/** @type {any} */ e) => `rejected: ${e.name} ${e.reason}`
                ),
                timeout,
            ]);
        },
        { id: MAP_ID, profile: PROFILE }
    );
    expect(outcome, "the mounted application's `ready`").toBe("ready");
}

/**
 * Waits until the fixture vector basemap is the active one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} where
 */
async function expectVectorBasemap(page, where) {
    await expect
        .poll(
            () =>
                page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()),
            { message: `${where}: the vector default basemap is not active`, timeout: BOOT_TIMEOUT }
        )
        .toBe(BASEMAP_KEY);
}

/**
 * The expected layers the application holds right now.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Set<string>} expected
 * @returns {Promise<string[]>}
 */
function presentLayers(page, expected) {
    return page.evaluate(
        (ids) => ids.filter((id) => /** @type {any} */ (window).GeoLeaf.Layers.hasLayer(id)),
        [...expected]
    );
}

for (const vectorBasemap of [false, true]) {
    const label = vectorBasemap ? "on a vector default basemap" : "on the profile's basemap";
    test(`ten remounts create every layer of the default theme — ${label}`, async ({
        page,
        context,
    }) => {
        test.setTimeout(300_000);
        /** @type {string[]} */
        const styleErrors = [];
        page.on("console", (m) => {
            if (m.text().includes(STYLE_ERROR)) styleErrors.push(m.text());
        });
        const { expected, routed } = await routeInlineProfile(context, { vectorBasemap });
        await selectProfile(page, PROFILE);
        await installSignals(page);
        await bootPage(page);

        // Non-vacuity: the bundle was rewritten, and the default theme shows inline layers.
        expect(routed(), "le bundle du profil n'a pas été réécrit").toBeGreaterThan(0);
        expect(expected.size, "aucune couche inline visible au thème par défaut").toBeGreaterThan(
            0
        );
        if (vectorBasemap) await expectVectorBasemap(page, "first boot");

        const sorted = [...expected].sort();
        expect((await presentLayers(page, expected)).sort(), "first boot").toEqual(sorted);

        for (let i = 1; i <= CYCLES; i++) {
            if (i > 1) await unmount(page);
            await mountProfile(page);
            if (vectorBasemap) await expectVectorBasemap(page, `mount ${i}`);
            expect((await presentLayers(page, expected)).sort(), `mount ${i}`).toEqual(sorted);
        }
        // Non-vacuity: one `app:ready` for the page's boot, one per mount — the remounts happened.
        expect(await page.evaluate(() => /** @type {any} */ (window).__glReady)).toBe(CYCLES + 1);
        expect(styleErrors, `« ${STYLE_ERROR} » written ${styleErrors.length}×`).toEqual([]);
    });
}
