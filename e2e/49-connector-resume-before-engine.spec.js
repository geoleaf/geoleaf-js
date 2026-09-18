// @ts-check
/**
 * e2e/49 — a session renewed BEFORE the offline engine is wired still brings the queue back.
 *
 * 🛑 THE ORDER OF A REAL BOOT. A host configures the connector before `GeoLeaf.boot()` — the
 * application shell does exactly that with `window.GEOLEAF_DEV_CONNECTOR`, which `init.js`
 * reads before preloading the profile's plugins. An expired session is renewed at that moment,
 * and `token-refreshed` reaches the queue resume while `GeoLeaf.Storage` has no engine yet: its
 * two gestures answer `engineUnavailable`. The capture a previous session set aside under
 * `authRequired` then stayed quarantined — the core's arming pass replays `pending` and
 * `failed`, never a quarantine.
 *
 * ⚠️ TWO LOADS. The first seeds what a previous session left: the capture set aside, and an
 * expired token. The second is the next morning, configured before boot.
 *
 * ⚠️ THE WITNESS OF THE ORDER is the core's own warning, « moteur hors-ligne non câblé », which
 * `Storage.requeueAll` prints while the engine is not wired. Without it, a green would say
 * nothing about this case: a renewal after boot resumes the queue anyway.
 *
 * Service Workers are blocked: every request this spec fills is routed, and a worker would
 * serve the profile's `GET`s past the routes.
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, seedStore, GEOLEAF_DB } from "./helpers/idb.js";
import { seedConnectorToken } from "./helpers/connector.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full"), serviceWorkers: "block" });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

const LAYER = "routes_principales";
const BASE = "https://backend.test";
const ENDPOINT = `${BASE}/rows`;
const AUTH = `${BASE}/auth`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const PULLED_AT = "2026-09-01T08:00:00+00:00";
const WRITTEN_AT = "2026-09-01T11:00:00+00:00";
const ASIDE = { seq: 101, id: `update:${LAYER}:srv:a1`, localId: "srv:a1" };

/**
 * Makes the layer writable — the drain refuses a layer without a write target — and answers
 * the renewal and the write.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
async function routeServers(context) {
    /** @type {{ renewals: number, sent: { method: string, authorization: string | undefined }[] }} */
    const seen = { renewals: 0, sent: [] };
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
    await context.route(`${AUTH}/refresh**`, async (route) => {
        seen.renewals += 1;
        await route.fulfill({ json: { token: RENEWED, expiresIn: 3600 } });
    });
    await context.route(`${ENDPOINT}**`, async (route) => {
        const request = route.request();
        seen.sent.push({
            method: request.method(),
            authorization: (await request.allHeaders()).authorization,
        });
        await route.fulfill({
            json: [{ id: "a1", nom: "vu", updated_at: WRITTEN_AT }],
        });
    });
    return seen;
}

/** Seeds the entity and its set-aside entry, as a tour whose session died leaves them. */
async function seedSetAsideCapture(page) {
    const feature = {
        layerId: LAYER,
        localId: ASIDE.localId,
        serverId: "a1",
        syncState: "pending",
        updatedAt: Date.now(),
        version: { kind: "timestamp", value: PULLED_AT },
        feature: {
            type: "Feature",
            properties: { id: "a1", nom: "a1" },
            geometry: { type: "Point", coordinates: [-60.64, -32.94] },
        },
    };
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "features", records: [feature] })).toBe(
        1
    );
    const entry = {
        seq: ASIDE.seq,
        id: ASIDE.id,
        layerId: LAYER,
        localId: ASIDE.localId,
        kind: "update",
        state: "quarantined",
        quarantine: "authRequired",
        attempts: 1,
        createdAt: Date.now(),
        baseVersion: { kind: "timestamp", value: PULLED_AT },
    };
    expect(await seedStore(page, { db: GEOLEAF_DB, store: "outbox", records: [entry] })).toBe(1);
}

test("[connector] une session renouvelée avant le câblage du moteur remet quand même la file en route", async ({
    page,
    context,
}) => {
    const seen = await routeServers(context);

    // ── Day one: what a previous session left behind ─────────────────────────────────────
    await page.goto("/");
    await page.waitForFunction(
        () =>
            /** @type {any} */ (window).GeoLeaf?.Storage?.whenReady?.().then(
                () => true,
                () => false
            ),
        null,
        { timeout: 30000 }
    );
    await seedSetAsideCapture(page);
    await seedConnectorToken(page, { baseUrl: BASE, token: STORED, expiresAt: Date.now() - 60000 });

    // ── The next morning: configured BEFORE boot, the session expired overnight ────────────
    /** @type {string[]} */
    const warnings = [];
    page.on("console", (message) => {
        if (message.type() === "warning") warnings.push(message.text());
    });
    await page.addInitScript(
        ({ baseUrl, endpoint }) => {
            /** @type {any} */ (window).GEOLEAF_DEV_CONNECTOR = { baseUrl, auth: { endpoint } };
        },
        { baseUrl: BASE, endpoint: AUTH }
    );
    await page.reload();
    await page.waitForFunction(
        () => !!(/** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.()),
        null,
        { timeout: 30000 }
    );

    // THE WITNESS FIRST: the renewal happened while the engine was not wired yet. Without it,
    // the subject below would pass or fail on a case this spec does not claim to test.
    expect(seen.renewals).toBe(1);
    expect(
        warnings.some((w) => w.includes("moteur hors-ligne non câblé")),
        "la session a été renouvelée après le câblage du moteur : ce n'est pas le cas éprouvé"
    ).toBe(true);

    // THE SUBJECT: the capture left the quarantine and was sent, with the renewed session.
    await expect.poll(() => seen.sent.length, { timeout: 30000 }).toBeGreaterThan(0);
    expect(seen.sent[0].authorization).toBe(`Bearer ${RENEWED}`);
    await expect
        .poll(
            async () => {
                const rows = await readStore(page, { db: GEOLEAF_DB, store: "outbox" });
                return rows.filter((r) => r.id === ASIDE.id).length;
            },
            { timeout: 15000 }
        )
        .toBe(0);
});
