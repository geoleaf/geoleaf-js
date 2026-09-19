// @ts-check
/**
 * e2e/52 — a server that renews every session and refuses every token does not make the queue
 * resume loop.
 *
 * 🛑 THE LOOP. A signing key out of step between two nodes, an audience set wrong: every 401
 * renewed with success, `token-refreshed` resumed the queue, and the next 401 renewed again. The
 * circuit closes as soon as the resume OPENS a pass instead of joining the running one — what a
 * requeue slower than the replay of the refused request makes it do — and nothing bounded it: the
 * renewals went on until the page closed. A renewed token the server refuses at once now holds
 * the renewals for one exchange window; the session is kept, and the queue waits.
 *
 * ⚠️ THE RACE IS FORCED, AND THAT IS THE WITNESS. With real timings on a workstation the resume
 * joins the running pass, and the loop does not close — measured with up to 2000 queued entries.
 * `requeueAll` is slowed here as a large queue on a slow device slows it, and the witness is the
 * THIRD write: the first pass sends and replays once, then halts on the 401; a third write can
 * only come from a pass the resume opened.
 *
 * Service Workers are blocked: every request this spec fills is routed.
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import {
    bootWithoutServiceWorker,
    seedConnectorToken,
    readConnectorToken,
    recordConnectorEvents,
    connectorEvents,
} from "./helpers/connector.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

const LAYER = "routes_principales";
const BASE = "https://backend.test";
const ENDPOINT = `${BASE}/rows`;
const AUTH = `${BASE}/auth`;
const PULLED_AT = "2026-09-01T08:00:00+00:00";
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const QUEUED = ["a1", "a2", "a3"];
/** How much slower than the replay the requeue is made — enough to close the circuit. */
const SLOW_REQUEUE_MS = 50;
/** The observation window: without the hold, dozens of renewals fit in it. */
const WINDOW_MS = 3000;

test.beforeEach(async ({ page, context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    // Whatever lies on the workstation must not configure the connector before the test does.
    await page.route("**/connector.local.js*", (route) =>
        route.fulfill({ status: 200, contentType: "application/javascript", body: "" })
    );
    // Makes the layer writable — the drain refuses a layer without a write target.
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: true };
        cfg.write = {
            enabled: true,
            endpoint: ENDPOINT,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        await route.fulfill({ json: bundle });
    });
});

/** Seeds the queued captures and their entities, as a tour leaves them. */
async function seedQueue(page) {
    const features = QUEUED.map((id) => ({
        layerId: LAYER,
        localId: `srv:${id}`,
        serverId: id,
        syncState: "pending",
        updatedAt: Date.now(),
        version: { kind: "timestamp", value: PULLED_AT },
        feature: {
            type: "Feature",
            properties: { id, nom: id },
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        },
    }));
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "features", records: features })).toBe(
        QUEUED.length
    );
    const entries = QUEUED.map((id, i) => ({
        seq: 301 + i,
        id: `update:${LAYER}:srv:${id}`,
        layerId: LAYER,
        localId: `srv:${id}`,
        kind: "update",
        state: "pending",
        attempts: 0,
        createdAt: Date.now(),
        baseVersion: { kind: "timestamp", value: PULLED_AT },
    }));
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "outbox", records: entries })).toBe(
        QUEUED.length
    );
}

test("[connector] un serveur qui renouvelle et refuse tout jeton ne fait pas boucler la reprise", async ({
    page,
}) => {
    const seen = { renewals: 0, writes: 0 };
    await page.route(`${AUTH}/refresh*`, async (route) => {
        seen.renewals += 1;
        // A NEW token each time, as a server that renews for real issues them.
        await route.fulfill({
            json: { token: `eyJyZW5ld${seen.renewals}.payload.sig`, expiresIn: 3600 },
        });
    });
    // The API refuses every token, the renewed ones included.
    await page.route(`${ENDPOINT}**`, async (route) => {
        seen.writes += 1;
        await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });

    await bootWithoutServiceWorker(page);
    await page.waitForFunction(
        () =>
            /** @type {any} */ (window).GeoLeaf?.Storage?.whenReady?.().then(
                () => true,
                () => false
            ),
        null,
        { timeout: 30000 }
    );
    await seedQueue(page);
    await seedConnectorToken(page, {
        baseUrl: BASE,
        token: STORED,
        expiresAt: Date.now() + 3600000,
    });
    await recordConnectorEvents(page);

    await page.evaluate(
        async ({ baseUrl, endpoint, slowMs }) => {
            const w = /** @type {any} */ (window);
            await w.GeoLeaf.plugins.load("connector");
            await w.GeoLeaf.Connector.configure({ baseUrl, auth: { endpoint } });
            // The forced race: a requeue slower than the replay of the refused request.
            const storage = w.GeoLeaf.Storage;
            const requeueAll = storage.requeueAll.bind(storage);
            storage.requeueAll = async (/** @type {string} */ reason) => {
                await new Promise((resolve) => setTimeout(resolve, slowMs));
                return requeueAll(reason);
            };
            void storage.pushOutbox();
        },
        { baseUrl: BASE, endpoint: AUTH, slowMs: SLOW_REQUEUE_MS }
    );

    // THE WITNESS: a third write — the resume opened a pass after the first one halted.
    await expect.poll(() => seen.writes, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(WINDOW_MS);

    // THE SUBJECT: one renewal over the window, not one per pass; and the session is kept.
    expect(seen.renewals).toBe(1);
    expect((await readConnectorToken(page, BASE))?.token).toBe("eyJyZW5ld1.payload.sig");
    expect(await connectorEvents(page)).not.toContain("geoleaf:connector:auth-error");
});
