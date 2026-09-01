/**
 * Probe — does the bounded pull REALLY write into the `features` store?
 *
 * Four measurements, in a real Chromium, against the shipped bundle and the
 * pygeoapi backend:
 *
 *   M1 — is the `features` store empty at start? (else M2 proves nothing)
 *   M2 — after `GeoLeaf.Storage.pullLayer()`, what does it carry, in what shape?
 *   M3 — does the extent BOUND the pull? (discriminating check, not decorative)
 *   M4 — does the `maxFeatures` cap truncate HARD?
 *
 * 🛑 WHY THIS PROBE IS VERSIONED. An earlier local-read proof used an ad hoc,
 * never-committed probe: its measurement can no longer be replayed, hence no longer
 * contradicted. A number that cannot be re-measured does not go stale, it
 * fossilises.
 *
 * ⚠️ Targets `full` by default, like `e2e/30-sync-cycle.spec.js`: since the
 * `addpoi` merge it is the ONLY variant carrying editing and `offline-ui`, hence
 * the only one where the offline engine and the connector cohabit. `sites_rosario`
 * is loaded by NO theme — irrelevant here, the pull does not go through the layer
 * loader.
 *
 * Prerequisite: the backend must be running.
 *   docker compose -f docker-compose.dev.yml up -d geoleaf-postgrest geoleaf-featureserv
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-offline-pull.mjs
 * Exit  : 0 = the four measurements are taken · 2 = probe error
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;
const LAYER = "sites_rosario";

/** A hanging measurement measures nothing: every browser call is bounded. */
const withTimeout = (promise, ms, label) =>
    Promise.race([
        Promise.resolve(promise).catch((e) => `__ERR__ ${e.message}`),
        new Promise((r) => setTimeout(() => r(`__TIMEOUT__ (${label}, ${ms} ms)`), ms)),
    ]);

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

/**
 * Reads the `features` store from the page.
 *
 * Guards `objectStoreNames.contains` before any transaction (a v3 database would
 * throw `NotFoundError`), `onerror` on each request (without which the promise
 * NEVER resolves and the symptom is an unreadable timeout), and `db.close()`
 * before handing back.
 */
const readFeatures = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve({ err: String(req.error?.name) });
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("features")) {
                db.close();
                resolve({ err: "store `features` absent (base v3 ?)" });
                return;
            }
            const all = db.transaction(["features"], "readonly").objectStore("features").getAll();
            all.onerror = () => {
                db.close();
                resolve({ err: String(all.error?.name) });
            };
            all.onsuccess = () => {
                const rows = all.result ?? [];
                db.close();
                resolve({
                    total: rows.length,
                    byLayer: rows.reduce((acc, r) => {
                        acc[r.layerId] = (acc[r.layerId] ?? 0) + 1;
                        return acc;
                    }, {}),
                    withServerId: rows.filter((r) => r.serverId).length,
                    withVersion: rows.filter((r) => r.version?.kind === "timestamp").length,
                    states: [...new Set(rows.map((r) => r.syncState))],
                    sampleLocalIds: rows.slice(0, 3).map((r) => r.localId),
                });
            };
        };
    });

/** Empties the store between measurements — else M3 would count what M2 left. */
const wipeFeatures = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("features")) {
                db.close();
                resolve(false);
                return;
            }
            const tx = db.transaction(["features"], "readwrite");
            tx.objectStore("features").clear();
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => {
                db.close();
                resolve(false);
            };
        };
    });

const run = async () => {
    const browser = await chromium.launch({ args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs] });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
    });
    const page = await context.newPage();

    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#geoleaf-map", { timeout: 25000 });
    // The storage engine is a DEFERRED chunk: without this wait, `pullLayer` would
    // measure the facade's bounded wait and not the pull.
    await page.waitForFunction(() => !!globalThis.GeoLeaf?.Storage?.DB, null, { timeout: 25000 });

    // ── M1 — the starting state, without which M2 proves nothing ────────────────────────
    const before = await withTimeout(page.evaluate(readFeatures), 20000, "M1");
    say("M1 — store `features` AVANT tout rapatriement", JSON.stringify(before));

    // ── M2 — the full pull ──────────────────────────────────────────────────────────────
    const full = await withTimeout(
        page.evaluate((layer) => globalThis.GeoLeaf.Storage.pullLayer(layer), LAYER),
        90000,
        "M2-pull"
    );
    const after = await withTimeout(page.evaluate(readFeatures), 20000, "M2-read");
    say("M2 — rapport du rapatriement", JSON.stringify(full));
    say("M2 — store `features` APRÈS", JSON.stringify(after));

    // ── M3 — does the extent bound? ─────────────────────────────────────────────────────
    // bbox measured at preflight: 11 of the 27 features. An extent returning all 27
    // would prove nothing — the discriminating check is what makes the measurement.
    await withTimeout(page.evaluate(wipeFeatures), 20000, "M3-wipe");
    const bounded = await withTimeout(
        page.evaluate(
            (layer) =>
                globalThis.GeoLeaf.Storage.pullLayer(layer, {
                    bbox: [-60.66, -32.95, -60.62, -32.93],
                }),
            LAYER
        ),
        90000,
        "M3-pull"
    );
    const boundedStore = await withTimeout(page.evaluate(readFeatures), 20000, "M3-read");
    say(
        "M3 — emprise bornante",
        `rapport ${JSON.stringify(bounded)} · store ${JSON.stringify(boundedStore)}`
    );

    // ── M4 — does the cap truncate hard? ────────────────────────────────────────────────
    // The server paginates at 10: `ogc-api-loader` cuts AFTER a whole page and does
    // not truncate. A cap of 15 makes it return 20; only the orchestrator brings it
    // back to 15.
    await withTimeout(page.evaluate(wipeFeatures), 20000, "M4-wipe");
    const capped = await withTimeout(
        page.evaluate((layer) => {
            const layers = globalThis.GeoLeaf.Config.getActiveProfile().layers;
            const target = layers.find((l) => l.id === layer);
            target.offline.maxFeatures = 15;
            return globalThis.GeoLeaf.Storage.pullLayer(layer);
        }, LAYER),
        90000,
        "M4-pull"
    );
    const cappedStore = await withTimeout(page.evaluate(readFeatures), 20000, "M4-read");
    say(
        "M4 — plafond DUR (`maxFeatures: 15`, pages de 10)",
        `rapport ${JSON.stringify(capped)} · store ${JSON.stringify(cappedStore)}`
    );

    await browser.close();
};

run().catch((e) => {
    console.error("✗ sonde en erreur :", e);
    process.exit(2);
});
