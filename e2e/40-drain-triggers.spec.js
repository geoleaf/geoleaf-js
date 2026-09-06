// @ts-check
/**
 * 40 — THE CORE DRAINS WITHOUT AN EDITING PLUGIN (R7 criterion, task 1.6)
 *
 * 🛑 THIS FILE RUNS ON THE `core` VARIANT, AND THAT IS THE WHOLE ASSERTION. `deploy-core`
 * does NOT ship `@geoleaf-plugins/editor` — measured: `dist/geoleaf-editor.plugin.js` is
 * absent from it. Yet until 2026-09-05 the repo's only automatic drain trigger was an
 * `online` listener registered by that plugin. On this variant a queue of writes therefore
 * NEVER emptied — and the fact was visible nowhere: no suite ever loaded the editor-less
 * variant with captures owed.
 *
 * Three properties, exercised on the SHIPPED BUNDLE:
 *
 *   1. the network coming back empties the queue, with no editing plugin;
 *   2. a tab becoming visible triggers a drain — the field device waking with the radio
 *      already back, which nothing caught;
 *   3. the device does not work for nothing: hidden, it does not drain.
 *
 * ⚠️ WHAT WOULD PROVE NOTHING: a green on the network return alone. The opening drain (the
 * arming, which IS the "storage ready" trigger) would empty the queue on its own and the
 * test would pass with no listener in existence. Hence the negative control: the queue is
 * seeded AFTER boot, and its state is asserted before anything is triggered.
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";
import { GEOLEAF_DB, readStore } from "./helpers/idb.js";

const ORIGIN = baseURL("core");
const LAYER = "sites_rosario";

/**
 * Re-sets a write target on the layer, IN THE PAGE.
 *
 * Same motive as in `28-offline-queue.spec.js`: since DNS-05 the deliverable variants no
 * longer carry the bindings to the proof backend, hence `write.enabled: false`. The origin is
 * deliberately UNREACHABLE (`.invalid`, reserved by RFC 2606): this file proves WHEN a drain
 * happens, not what a server answers.
 *
 * @param {import('@playwright/test').Page} page
 */
async function ensureWriteTarget(page) {
    const posed = await page.evaluate((layer) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const cfg = gl?.Config?.getActiveProfile?.()?.layers?.find(
            (/** @type {any} */ l) => l.id === layer
        );
        if (!cfg) return false;
        cfg.write = {
            enabled: true,
            endpoint: `https://e2e-triggers.invalid/${layer}`,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        return true;
    }, LAYER);
    expect(posed, `la couche "${LAYER}" doit exister dans le profil actif`).toBe(true);
}

/** Boots and waits for the offline engine to be WIRED (not merely the facade mounted). */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
}

/** Seeds one capture and returns its entry id. */
async function seedOne(page, name) {
    return page.evaluate(
        async ({ layer, nom }) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const res = await gl.Storage.applyEdit({
                layerId: layer,
                kind: "create",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                    properties: { nom },
                },
            });
            if (!res.entryId) throw new Error(`applyEdit refusé : ${res.refused}`);
            return res.entryId;
        },
        { layer: LAYER, nom: name }
    );
}

/** How many entries are still owed to the server. */
async function owed(page) {
    const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
    return rows.filter((r) => r.state !== "synced").length;
}

test.describe("40 — les déclencheurs de drain vivent dans le core", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
        await boot(page);
        await ensureWriteTarget(page);
    });

    test("🛑 aucun plugin d'édition n'est chargé sur cette variante", async ({ page }) => {
        // The control that gives the whole file its meaning. If it falls, the three that
        // follow no longer prove what they claim — they would prove the PLUGIN's drain.
        const editor = await page.evaluate(
            () => typeof (/** @type {any} */ (globalThis).GeoLeaf?.Editor)
        );
        expect(editor).toBe("undefined");
    });

    test("un retour de réseau vide la file — sans plugin d'édition", async ({ page }) => {
        await seedOne(page, "cap-online");
        // Negative control: the capture really is OWED before anything is triggered.
        expect(await owed(page)).toBe(1);

        // The unreachable server answers… by accepting: what is under test is the
        // TRIGGERING, not the transport.
        await page.route("**/e2e-triggers.invalid/**", (route) =>
            route.fulfill({ status: 201, contentType: "application/json", body: '[{"id":42}]' })
        );
        await page.evaluate(() => window.dispatchEvent(new Event("online")));

        await expect.poll(() => owed(page), { timeout: 10000 }).toBe(0);
    });

    test("un onglet qui redevient visible draine — le réveil d'un appareil de terrain", async ({
        page,
    }) => {
        await seedOne(page, "cap-visible");
        expect(await owed(page)).toBe(1);

        await page.route("**/e2e-triggers.invalid/**", (route) =>
            route.fulfill({ status: 201, contentType: "application/json", body: '[{"id":43}]' })
        );
        // 🛑 THE FLOOR MUST BE WAITED OUT, AND THAT IS NOT A TEST CONVENIENCE: a user
        // switching between applications produces one `visibilitychange` per switch, and
        // without a floor each would cost a queue read and a drain. The arming drain, fired
        // at boot, has just set `_lastDrainAt`. This first attempt was SEEN RED: without the
        // wait the wake-up is ignored — the floor holds.
        //
        // ⚠️ 8 s AND NOT 5.2 s, AND THE MARGIN IS THE SUBJECT. `boot()` waits for the engine
        // to be WIRED, which PRECEDES the arming: the floor's reference instant is therefore
        // later — by a variable delay — than `boot()` returning. At 5.2 s the test passed
        // alone and failed under parallel load, i.e. it measured the machine.
        await page.waitForTimeout(8000);
        await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
                value: "hidden",
                configurable: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
            Object.defineProperty(document, "visibilityState", {
                value: "visible",
                configurable: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
        });

        await expect.poll(() => owed(page), { timeout: 10000 }).toBe(0);
    });

    test("🛑 onglet caché : AUCUNE requête — un appareil de terrain ne travaille pas pour rien", async ({
        page,
    }) => {
        await seedOne(page, "cap-hidden");
        let requests = 0;
        await page.route("**/e2e-triggers.invalid/**", (route) => {
            requests += 1;
            return route.fulfill({ status: 500, contentType: "application/json", body: "null" });
        });

        await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
                value: "hidden",
                configurable: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(1500);

        // The timer is STOPPED when the tab goes hidden, not merely skipped: a tick that
        // returns early still wakes the device.
        expect(requests).toBe(0);
        expect(await owed(page)).toBe(1);
    });
});
