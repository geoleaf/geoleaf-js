// @ts-check
// Connector primitives — a booted page whose routes can be trusted, and a session the spec
// writes and reads itself.
//
// WHY THE SERVICE WORKER IS BLOCKED, AND WHY THAT IS ASSERTED RATHER THAN ASSUMED. A worker
// that controls the page HANDLES the `GET`s, and a request it issues never reaches
// `page.route` — a spec that fulfils a `GET` there can then measure its own instrument. With
// `serviceWorkers: "block"`, measured on `deploy-core` under `E2E_TARGET=nginx`: `page.route`
// sees the GeoJSON worker's fetch, the vector tiles MapLibre loads in its own worker, and the
// PMTiles archive the main thread reads. `assertNoServiceWorker` keeps that explanation
// falsifiable: the day a worker controls these pages again, the specs fail on the witness
// instead of passing on a request nobody routed.
//
// ⚠️ `context.setOffline(true)` DOES NOT CUT A ROUTED REQUEST — measured on the same page: a
// fetch to a routed URL still resolved `200` while `navigator.onLine` was `false`. A spec that
// means "the network is gone" must abort the route itself (`internetdisconnected`), and flip
// `setOffline` only for what it is: the `online` / `offline` events and `navigator.onLine`.

import { expect } from "@playwright/test";

/** The connector's own database — `token-store.ts`, schema v1. */
const CONNECTOR_DB = "geoleaf-connector";
const CONNECTOR_STORE = "auth-tokens";

/**
 * Boots the app shell and waits until it is READY — `geoleaf:app:ready`, not only a native map —
 * then asserts that no Service Worker controls the page (see the header).
 *
 * 🛑 A NATIVE MAP IS NOT A BOOTED APPLICATION. The map exists before the profile's theme applies
 * its layers, sprites and terrain; a spec that cuts the network right after it cut the boot
 * itself. Measured on 18/09/2026 on `e2e/48`, under load: the profile's layers failed with
 * `ERR_INTERNET_DISCONNECTED` — requested AFTER the cut — and the tiles the spec was waiting for
 * were not requested within its five seconds, while MapLibre had started loading them. Alone,
 * the same test passed eight times out of eight.
 * @param {import('@playwright/test').Page} page
 */
async function bootWithoutServiceWorker(page) {
    await page.addInitScript(() => {
        document.addEventListener(
            "geoleaf:app:ready",
            () => {
                /** @type {any} */ (window).__geoleafAppReady = true;
            },
            { once: true }
        );
    });
    await page.goto("/");
    await page.waitForFunction(
        () =>
            /** @type {any} */ (window).__geoleafAppReady === true &&
            !!(/** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.()),
        null,
        { timeout: 30000 }
    );
    const controlled = await page.evaluate(
        () => !!navigator.serviceWorker && !!navigator.serviceWorker.controller
    );
    expect(
        controlled,
        "a Service Worker controls the page — its GETs would bypass page.route"
    ).toBe(false);
}

/**
 * Writes a session into the connector's store, exactly as a previous visit would have left it.
 *
 * The store is created with the connector's own schema when it does not exist yet: the
 * UI-only bootstrap never opens it, so a fresh page has no database at all.
 * @param {import('@playwright/test').Page} page
 * @param {{ baseUrl: string, token: string, expiresAt: number }} record
 */
async function seedConnectorToken(page, record) {
    await page.evaluate(
        ({ db, store, record }) =>
            new Promise((resolve, reject) => {
                const open = indexedDB.open(db, 1);
                open.onupgradeneeded = () => {
                    if (!open.result.objectStoreNames.contains(store)) {
                        open.result.createObjectStore(store, { keyPath: "baseUrl" });
                    }
                };
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const tx = open.result.transaction(store, "readwrite");
                    tx.objectStore(store).put(record);
                    tx.oncomplete = () => {
                        open.result.close();
                        resolve(undefined);
                    };
                    tx.onerror = () => reject(tx.error);
                };
            }),
        { db: CONNECTOR_DB, store: CONNECTOR_STORE, record }
    );
}

/**
 * Reads the stored session for `baseUrl` — `null` when there is none.
 *
 * ⚠️ An `open()` without a version CREATES an absent database, empty and at version 1 — after
 * which the connector's own `open(…, 1)` would never upgrade it and would find no store. The
 * upgrade is therefore aborted: reading must not create what it reads.
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<{ token: string, expiresAt: number } | null>}
 */
function readConnectorToken(page, baseUrl) {
    return page.evaluate(
        ({ db, store, baseUrl }) =>
            new Promise((resolve) => {
                const open = indexedDB.open(db);
                open.onupgradeneeded = () => open.transaction?.abort();
                open.onerror = () => resolve(null);
                open.onsuccess = () => {
                    const conn = open.result;
                    if (!conn.objectStoreNames.contains(store)) {
                        conn.close();
                        resolve(null);
                        return;
                    }
                    const get = conn.transaction(store, "readonly").objectStore(store).get(baseUrl);
                    get.onsuccess = () => {
                        conn.close();
                        resolve(get.result ?? null);
                    };
                    get.onerror = () => {
                        conn.close();
                        resolve(null);
                    };
                };
            }),
        { db: CONNECTOR_DB, store: CONNECTOR_STORE, baseUrl }
    );
}

/**
 * Records the connector's session events on `window.__connectorEvents`, in order.
 * @param {import('@playwright/test').Page} page
 */
async function recordConnectorEvents(page) {
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__connectorEvents = [];
        for (const name of [
            "geoleaf:connector:auth-error",
            "geoleaf:connector:token-refreshed",
            "geoleaf:connector:authenticated",
        ]) {
            document.addEventListener(name, () => w.__connectorEvents.push(name));
        }
    });
}

/**
 * The events recorded since {@link recordConnectorEvents}.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
function connectorEvents(page) {
    return page.evaluate(() => /** @type {any} */ (window).__connectorEvents ?? []);
}

export {
    bootWithoutServiceWorker,
    seedConnectorToken,
    readConnectorToken,
    recordConnectorEvents,
    connectorEvents,
};
