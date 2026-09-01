/**
 * Probe — does the report see what the store contains, and does the purge spare the
 * work?
 *
 * Six measurements, in a real Chromium, against the shipped bundle and the pygeoapi
 * backend:
 *
 *   M1 — a layer declared offline, never pulled → `declaredNeverPulled`?
 *   M2 — after `pullLayer()` → `pulled`, with `featureCount` and `lastPullAt` set?
 *   M3 — does `getStats()` finally count `features` and `outbox`?
 *   M4 — after a local edit → does `pendingCount` rise?
 *   M5 — does the export return that edit, with its geometry?
 *   M6 — does the purge remove the CACHE while leaving the outbox INTACT?
 *
 * 🛑 M6 IS THE MEASUREMENT THAT COUNTS, and the only one that cannot be proven in a
 * unit test. The original defect: a button destroying never-pushed edits. The unit
 * test proves the rule; here we prove that the button wired to the shipped bundle
 * applies that very rule. Between the two sit a facade, a plugin contract and a
 * deferred chunk.
 *
 * ⚠️ Versioned for the same reason as `probe-offline-pull.mjs`: a measurement that
 * cannot be replayed cannot be contradicted, so it fossilises.
 *
 * Prerequisite: the backend must be running.
 *   docker compose -f docker-compose.dev.yml up -d geoleaf-postgrest geoleaf-featureserv
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-sync-report.mjs
 * Exit  : 0 = the six measurements are taken · 2 = probe error
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
 * Counts both v4 stores directly, without going through the facade.
 *
 * ⚠️ INDEPENDENT read, deliberately: querying `getStats()` to verify `getStats()`
 * would only prove its consistency with itself. Here the database is read through a
 * path the measured code does not take.
 */
const readStores = () =>
    new Promise((resolve) => {
        const req = indexedDB.open("geoleaf-db");
        req.onerror = () => resolve({ err: String(req.error?.name) });
        req.onsuccess = () => {
            const db = req.result;
            const has = (n) => db.objectStoreNames.contains(n);
            if (!has("features") || !has("outbox")) {
                db.close();
                resolve({ err: "magasins v4 absents (base v3 ?)" });
                return;
            }
            const tx = db.transaction(["features", "outbox"], "readonly");
            const f = tx.objectStore("features").getAll();
            const o = tx.objectStore("outbox").getAll();
            tx.onerror = () => {
                db.close();
                resolve({ err: String(tx.error?.name) });
            };
            tx.oncomplete = () => {
                const rows = f.result ?? [];
                const entries = o.result ?? [];
                db.close();
                resolve({
                    features: rows.length,
                    featuresSynced: rows.filter((r) => r.syncState === "synced").length,
                    featuresPending: rows.filter((r) => r.syncState !== "synced").length,
                    outbox: entries.length,
                    outboxStates: [...new Set(entries.map((e) => e.state))],
                });
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
    // The storage engine is a DEFERRED chunk: without this wait, the report would
    // measure the facade's bounded wait and not the engine.
    await page.waitForFunction(() => !!globalThis.GeoLeaf?.Storage?.DB, null, { timeout: 25000 });
    // Start from a clean database: otherwise M1 would count what a previous run
    // left, and "never pulled" would be false without us seeing it.
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                const r = indexedDB.open("geoleaf-db");
                r.onerror = () => resolve(false);
                r.onsuccess = () => {
                    const db = r.result;
                    const names = ["features", "outbox", "preferences"].filter((n) =>
                        db.objectStoreNames.contains(n)
                    );
                    const tx = db.transaction(names, "readwrite");
                    names.forEach((n) => tx.objectStore(n).clear());
                    tx.oncomplete = () => {
                        db.close();
                        resolve(true);
                    };
                    tx.onerror = () => {
                        db.close();
                        resolve(false);
                    };
                };
            })
    );

    const report = (label, ms = 30000) =>
        withTimeout(
            page.evaluate(() => globalThis.GeoLeaf.Storage.getSyncReport()),
            ms,
            label
        );
    const forLayer = (r) => (Array.isArray(r) ? r.find((x) => x.layerId === LAYER) : r);

    // ── M1 — the case with NO observable until the cutoff ───────────────────────────────
    say("M1 — rapport AVANT tout rapatriement", JSON.stringify(forLayer(await report("M1"))));

    // ── M2 — after a real pull ─────────────────────────────────────────────────────────
    const pull = await withTimeout(
        page.evaluate((layer) => globalThis.GeoLeaf.Storage.pullLayer(layer), LAYER),
        90000,
        "M2-pull"
    );
    say("M2 — rapport du rapatriement", JSON.stringify(pull));
    say("M2 — rapport APRÈS", JSON.stringify(forLayer(await report("M2"))));

    // ── M3 — does the facade finally see the v4 stores? ─────────────────────────
    const stats = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.getStats()),
        20000,
        "M3"
    );
    say(
        "M3 — getStats()",
        JSON.stringify({ features: stats?.features, outbox: stats?.outbox, layers: stats?.layers })
    );
    say(
        "M3 — magasins lus DIRECTEMENT (contrôle)",
        JSON.stringify(await page.evaluate(readStores))
    );

    // ── M4 — a local edit, i.e. work that has no other copy ─────────────────────────────
    const edit = await withTimeout(
        page.evaluate(
            (layer) =>
                globalThis.GeoLeaf.Storage.applyEdit({
                    layerId: layer,
                    kind: "update",
                    localId: "srv:1",
                    feature: {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                        properties: { title: "saisie de terrain (sonde)" },
                    },
                }),
            LAYER
        ),
        20000,
        "M4-edit"
    );
    say("M4 — applyEdit", JSON.stringify(edit));
    say("M4 — rapport APRÈS la saisie", JSON.stringify(forLayer(await report("M4"))));

    // ── M5 — the export: the panel returned 0, it must return the edit ──────────────────
    const pending = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.DB.listPendingEdits()),
        20000,
        "M5"
    );
    say(
        "M5 — listPendingEdits()",
        JSON.stringify(
            Array.isArray(pending)
                ? pending.map((p) => ({
                      kind: p.kind,
                      localId: p.localId,
                      state: p.state,
                      hasGeometry: !!p.feature?.geometry,
                  }))
                : pending
        )
    );

    // ── M6 — THE MEASUREMENT THAT COUNTS: does the purge spare the work? ────────────────
    const beforePurge = await page.evaluate(readStores);
    const purge = await withTimeout(
        page.evaluate(() => globalThis.GeoLeaf.Storage.DB.purgeCachedFeatures()),
        20000,
        "M6"
    );
    const afterPurge = await page.evaluate(readStores);
    say("M6 — magasins AVANT purge", JSON.stringify(beforePurge));
    say("M6 — purgeCachedFeatures()", JSON.stringify(purge));
    say("M6 — magasins APRÈS purge", JSON.stringify(afterPurge));

    const outboxIntact = beforePurge?.outbox === afterPurge?.outbox && afterPurge?.outbox > 0;
    const cacheParti = afterPurge?.featuresSynced === 0 && beforePurge?.featuresSynced > 0;
    say(
        "M6 — VERDICT",
        `outbox intacte : ${outboxIntact ? "OUI" : "NON"} · cache purgé : ${cacheParti ? "OUI" : "NON"} · ` +
            `saisie conservée : ${afterPurge?.featuresPending > 0 ? "OUI" : "NON"}`
    );

    await browser.close();
};

run().catch((e) => {
    console.error("✗ sonde en échec :", e.message);
    process.exit(2);
});
