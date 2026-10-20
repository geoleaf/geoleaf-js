// @ts-check
/**
 * 90 — A QUEUED WRITE DOES NOT FOLLOW A PROFILE SWITCH
 *
 * The drain resolves a write's target from the profile active at DRAIN time, and a profile
 * switch reloads the page, whose first drain replays what the previous page left. An edit
 * captured under one profile was thus sent, after a switch, to the endpoint of the other
 * profile's layer of the same id — with that profile's credentials, and no signal.
 *
 * What only this spec sees: the whole chain on the SHIPPED bundle — capture, real reload
 * onto another profile through `localStorage['gl-profile']`, boot drain, explicit drain.
 * The unit suite (`outbox-profile-routing.test.ts`) proves each seam; it cannot prove that
 * the reload carries the stamp across.
 *
 * ⚠️ The second profile is MADE homonymous here: `reunion-eclairage` ships no `sites_rosario`
 * layer and keeps its offline engine off, so its bundle is rewritten on the wire to switch the
 * engine on and declare the layer, writing to an endpoint this spec owns. The rewrite is witnessed twice — the route counts its interceptions, and the
 * page must expose the injected target — or the spec would pass on a profile that never had
 * the layer.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, readStore } from "./helpers/idb.js";

const ORIGIN = baseURL("core");
const LAYER = "sites_rosario";
const PROFILE_A = "tourism";
const PROFILE_B = "reunion-eclairage";
/** Profile A's endpoint: refused on the wire, so the capture stays queued. */
const HOST_A = "https://e2e-profil-a.invalid";
/** Profile B's endpoint: owned by this spec, every request to it is counted. */
const HOST_B = "https://e2e-profil-b.test";
/** The data file of B's homonymous layer, served by this spec. */
const B_DATA_FILE = "e2e-profil-b-sites.geojson";

test.use({ serviceWorkers: "block" });

/**
 * Boots and waits for the offline engine to be WIRED (see `28-offline-queue.spec.js`).
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForEngine(page) {
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

/**
 * Rewrites profile B's bundle on the wire: offline engine on, and a writable `sites_rosario`
 * layer whose writes go to `HOST_B`. With `data`, the layer also displays one entity of its own
 * (`Entité de B`), served by this spec — what lets a spec see the layer drawn at all.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ data?: boolean, offlineRead?: boolean }} [options] - `offlineRead` declares
 *   `offline.enabled` on B's layer, so its loader reads the device store first.
 * @returns {Promise<{ rewrites: () => number }>} How many times the bundle was rewritten — the witness
 *   that B really had the layer.
 */
async function rewriteProfileB(page, options = {}) {
    let rewrites = 0;
    await page.route(`**/profiles/${PROFILE_B}/profile-bundle.json*`, async (route) => {
        const response = await route.fetch();
        const bundle = await response.json();
        bundle.layersFile.layers.push({
            id: LAYER,
            configFile: `layers/${LAYER}/${LAYER}_config.json`,
            layerManagerId: bundle.layersFile.layers[0]?.layerManagerId,
        });
        // The shipped profile keeps its offline engine off: nothing would drain at all.
        // The defect needs a second profile that DOES drain, so it is switched on here.
        bundle.modules.offline = { ...bundle.modules.offline, enabled: true };
        bundle.layerConfigs[LAYER] = {
            id: LAYER,
            label: "Couche homonyme (E2E)",
            geometryType: "point",
            edition: { create: true, update: true, delete: true },
            write: {
                enabled: true,
                endpoint: `${HOST_B}/${LAYER}`,
                dialect: "collection",
                geometryProperty: "geom",
                properties: ["nom"],
            },
            ...(options.data ? { data: { directory: "data", file: B_DATA_FILE } } : {}),
            ...(options.offlineRead ? { offline: { enabled: true } } : {}),
        };
        if (options.data) {
            // ⚠️ A layer is DRAWN only if a theme shows it and it has a style. Without these
            // two, measured: the layer never loads (`hasLayer` false, its data never fetched),
            // and a verdict "A's capture is not on B's layer" comes out green on a layer that
            // does not exist. The style is borrowed from one B ships.
            bundle.layerConfigs[LAYER].styles = {
                directory: "styles",
                default: "defaut.json",
                available: [{ id: "defaut", label: "Défaut", file: "defaut.json" }],
            };
            bundle.layerStyleDocuments[LAYER] = {
                defaut: bundle.layerStyleDocuments.armoires.defaut,
            };
            bundle.themes.themes[0].layers.push({ id: LAYER, visible: true, style: "defaut" });
        }
        rewrites += 1;
        return route.fulfill({ response, json: bundle });
    });
    if (options.data) {
        await page.route(`**/${B_DATA_FILE}*`, (route) =>
            route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            id: "b-1",
                            geometry: { type: "Point", coordinates: [55.45, -20.88] },
                            properties: { id: "b-1", nom: "Entité de B" },
                        },
                    ],
                }),
            })
        );
    }
    return { rewrites: () => rewrites };
}

/**
 * Profile A: one capture on `sites_rosario`, held in the queue by a refused endpoint.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ entryId: string, profileId: string }>}
 */
async function captureUnderA(page) {
    await wipeOnOrigin(page, ORIGIN);
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((profile) => localStorage.setItem("gl-profile", profile), PROFILE_A);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForEngine(page);
    const captured = await page.evaluate(
        async ({ layer, host }) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const cfg = gl.Config.getActiveProfile().layers.find(
                (/** @type {any} */ l) => l.id === layer
            );
            cfg.write = {
                enabled: true,
                endpoint: `${host}/${layer}`,
                dialect: "collection",
                geometryProperty: "geom",
                properties: ["nom"],
            };
            const res = await gl.Storage.applyEdit({
                layerId: layer,
                kind: "create",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                    properties: { nom: "Saisi sous tourism" },
                },
            });
            return { entryId: res.entryId, profileId: gl.Config.getActiveProfileId() };
        },
        { layer: LAYER, host: HOST_A }
    );
    expect(captured.entryId, "la saisie doit entrer en file").toBeTruthy();
    expect(captured.profileId).toBe(PROFILE_A);
    return captured;
}

test.describe("90 — une écriture en file reste à son profil", () => {
    test("🛑 après une bascule vers un profil à couche homonyme, rien ne part vers sa cible", async ({
        page,
    }) => {
        /** @type {string[]} */
        const sentToB = [];

        await page.route(`${HOST_A}/**`, (route) => route.abort());
        await page.route(`${HOST_B}/**`, (route) => {
            sentToB.push(`${route.request().method()} ${route.request().url()}`);
            return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
        });
        const bundle = await rewriteProfileB(page);

        const captured = await captureUnderA(page);

        // ── Switch to profile B, made homonymous, then drain explicitly.
        await page.evaluate((profile) => localStorage.setItem("gl-profile", profile), PROFILE_B);
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForEngine(page);
        const endpointB = await page.evaluate((layer) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const cfg = gl.Config.getActiveProfile()?.layers?.find(
                (/** @type {any} */ l) => l.id === layer
            );
            return {
                active: gl.Config.getActiveProfileId(),
                endpoint: cfg?.write?.endpoint ?? null,
            };
        }, LAYER);
        expect(bundle.rewrites(), "le bundle du profil B doit avoir été réécrit").toBeGreaterThan(
            0
        );
        expect(endpointB).toEqual({ active: PROFILE_B, endpoint: `${HOST_B}/${LAYER}` });

        await page.evaluate(() => /** @type {any} */ (globalThis).GeoLeaf.Storage.pushOutbox());

        expect(sentToB, "aucune écriture du profil A ne part vers la cible du profil B").toEqual(
            []
        );
        const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
        const entry = rows.find((/** @type {any} */ r) => r.id === captured.entryId);
        expect(entry, "l'entrée attend, elle n'est ni envoyée ni supprimée").toBeTruthy();
        expect(entry.state).not.toBe("quarantined");
        expect(entry.profileId).toBe(PROFILE_A);
    });

    // 🛑 THE ENTITY, NOT ONLY THE ENTRY. The entry waits under its own profile, but the entity
    // it edits lives in the `features` store, shared by every profile of the origin. Two
    // readers drew it on B's homonymous layer: the boot restore, which merges every queued
    // creation, and — when B's layer reads the device first — the local read.
    for (const offlineRead of [false, true]) {
        const path = offlineRead ? "lecture locale de la couche" : "restauration du boot";
        test(`🛑 la saisie du profil A ne se dessine pas sur la couche homonyme de B (${path})`, async ({
            page,
        }) => {
            await page.route(`${HOST_A}/**`, (route) => route.abort());
            await page.route(`${HOST_B}/**`, (route) =>
                route.fulfill({ status: 201, contentType: "application/json", body: "[]" })
            );
            const bundle = await rewriteProfileB(page, { data: true, offlineRead });
            await page.addInitScript(() =>
                document.addEventListener("geoleaf:app:ready", () => {
                    /** @type {any} */ (globalThis).__e2eAppReady = true;
                })
            );

            await captureUnderA(page);

            await page.evaluate(
                (profile) => localStorage.setItem("gl-profile", profile),
                PROFILE_B
            );
            await page.reload({ waitUntil: "domcontentloaded" });
            await waitForEngine(page);
            expect(
                bundle.rewrites(),
                "le bundle du profil B doit avoir été réécrit"
            ).toBeGreaterThan(0);

            /**
             * Whether B's layer holds an entity of that name.
             *
             * @param {string} name
             */
            const drawn = (name) =>
                page.evaluate(
                    ({ layer, name }) => {
                        const gl = /** @type {any} */ (globalThis).GeoLeaf;
                        const features = gl?.Layers?.getFeatures?.(layer) ?? [];
                        return features.some((/** @type {any} */ f) => f?.properties?.nom === name);
                    },
                    { layer: LAYER, name }
                );
            // The restore pass runs on `geoleaf:app:ready`: the verdict waits for its trigger.
            await page.waitForFunction(
                () => /** @type {any} */ (globalThis).__e2eAppReady === true,
                null,
                { timeout: 25000 }
            );

            // The verdict: A's capture never appears on B's layer. Bounded, and long enough for
            // both restore passes to land — before the fix it appeared within it.
            const leaked = await expect
                .poll(() => drawn("Saisi sous tourism"), { timeout: 4000 })
                .toBe(true)
                .then(
                    () => true,
                    () => false
                );
            expect(leaked, "la saisie du profil A ne se dessine pas sous B").toBe(false);

            // Witness, AFTER the verdict so that a red names the defect: B's layer is drawn, from
            // its own data — a verdict on a layer never drawn would prove nothing.
            await expect.poll(() => drawn("Entité de B"), { timeout: 15000 }).toBe(true);
        });
    }
});
