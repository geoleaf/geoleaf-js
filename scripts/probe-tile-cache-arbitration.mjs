#!/usr/bin/env node
/**
 * TILE-CACHE ARBITRATION PROBE — two tile paths, which one actually serves?
 *
 * WHY. The standing decision says "IndexedDB alone for tiles, and the SW reads it",
 * and executing it follows a non-negotiable order: *repair → SEE it serve → then
 * delete*. The preflight spelled it out: this arbitration is NOT preflown by symbol
 * grep. A non-zero count does not prove life (the symbols call each other inside
 * the dead region), a zero count does not prove death. **The arbitration is taken
 * on what a browser shows.**
 *
 * 🛑 WHAT WAS PROVEN, AND WHAT WAS NOT. `e2e/27-offline-idb.spec.js` establishes
 * that a tile **hand-seeded** into the `layers` store is re-served offline by the
 * worker's IndexedDB path. It says nothing of the **write** path: nobody has yet
 * seen the profile download deposit a tile in the database. Deleting the Cache API
 * branch without that measurement would remove the only path known to work in
 * favour of one only half seen.
 *
 * THE FOUR MEASUREMENTS, each printed with its reading:
 *   M1 — after the map displays, what does the `geoleaf-data-tiles` cache contain?
 *        The 08-02 spike found it ABSENT. If still empty, `tileCacheStrategy`'s
 *        Cache API branch caches nothing for the providers actually used — all
 *        cross-origin, hence opaque, hence refused by `isCacheableResponse`.
 *   M2 — does the `layers` store carry `resourceType: "tile"` records after a
 *        profile download? That is the WRITE path, never observed.
 *   M3 — does the `enableTileCache` flag reach the engine? Measured by what
 *        `ResourceEnumerator` enumerates, not by what the config declares.
 *   M4 — how many tile requests does the page emit, and toward which origins? That
 *        is what says whether the arbitration's subject is a raster background, a
 *        vector one, or both.
 *
 * IT VALIDATES, IT DOES NOT GUARD — same status as `probe-sw-observability.mjs`
 * and `probe-boot-contract.mjs`: it requires an up-to-date deploy and the dev
 * nginx, so it is neither in `ci:local` nor in `package.json`.
 *
 * ⚠️ Regenerate the deploy before believing a run — in THREE steps, the first not
 * optional: `npx turbo run build`, then `npm run build:deploy`, then
 * `node scripts/build-deploy-coverage.cjs`. `build-deploy.cjs` assembles from the
 * existing `dist/`, **it compiles nothing**: chaining it alone produces a stale
 * deploy WHILE EXITING 0.
 *
 * ⚠️ Targets `full` by default, and that is no detail: it is the only variant that
 * embarks `offline-ui`, hence the only one where the profile download is reachable
 * from the interface.
 *
 * Usage : E2E_TARGET=nginx node scripts/probe-tile-cache-arbitration.mjs
 * Exit  : 0 = the four measurements are taken · 2 = probe error
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL, hostResolverArgs } from "../e2e/helpers/base-url.js";

const VARIANT = process.env.PROBE_VARIANT || "full";
const TARGET_URL = `${baseURL(VARIANT)}/`;

/** A hanging measurement measures nothing: every browser call is bounded. */
const withTimeout = (promise, ms, label) =>
    Promise.race([
        Promise.resolve(promise).catch((e) => `__ERR__ ${e.message}`),
        new Promise((r) => setTimeout(() => r(`__TIMEOUT__ (${label}, ${ms} ms)`), ms)),
    ]);

const say = (label, detail) => console.log(`▸ ${label}\n     → ${detail}\n`);

const run = async () => {
    const browser = await chromium.launch({
        args: [...SOFTWARE_GL_ARGS, ...hostResolverArgs],
    });
    // No `serviceWorkers: "block"`: the worker is the subject.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    /** @type {{url: string, from: 'page'|'sw', phase: 'sent'|'failed'}[]} */
    const traffic = [];
    context.on("request", (r) =>
        traffic.push({ url: r.url(), from: r.serviceWorker() ? "sw" : "page", phase: "sent" })
    );
    context.on("requestfailed", (r) =>
        traffic.push({ url: r.url(), from: r.serviceWorker() ? "sw" : "page", phase: "failed" })
    );

    const page = await context.newPage();
    console.log(
        `\n▸ ${TARGET_URL}   (variante « ${VARIANT} », E2E_TARGET=${process.env.E2E_TARGET || "ports"})\n`
    );

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
        timeout: 25000,
    });

    // The map must have requested tiles: without that, M1 would measure a cache we
    // have not yet had the chance to fill, and its emptiness would say nothing.
    await page
        .waitForFunction(
            () => {
                const m = /** @type {any} */ (globalThis).GeoLeaf?.Map?.getMap?.();
                return !!m && typeof m.isStyleLoaded === "function" && m.isStyleLoaded();
            },
            null,
            { timeout: 25000 }
        )
        .catch(() => console.log("  (style non signalé chargé — on poursuit, M4 le dira)"));
    await page.waitForTimeout(4000);

    // ── M4 first: what are we even talking about? ───────────────────────────────────────
    const tileLike = traffic.filter((t) => /\.(png|jpe?g|webp|pbf|mvt)(\?|$)/i.test(t.url));
    const byOrigin = new Map();
    for (const t of tileLike) {
        const o = new URL(t.url).origin;
        byOrigin.set(o, (byOrigin.get(o) ?? 0) + 1);
    }
    say(
        "M4 — trafic de tuiles observé (origine → nombre, `sw:` = émis par le worker)",
        byOrigin.size === 0
            ? "AUCUNE requête de tuile — la carte n'en a pas demandé, les autres mesures sont à lire avec ça en tête"
            : [...byOrigin.entries()]
                  .map(([o, n]) => {
                      const viaSw = tileLike.filter(
                          (t) => new URL(t.url).origin === o && t.from === "sw"
                      ).length;
                      return `${o} → ${n}${viaSw ? ` (dont ${viaSw} sw:)` : ""}`;
                  })
                  .join("\n       ")
    );

    // ── M1 — does the Cache API branch cache anything at all? ───────────────────────────
    const caches0 = await withTimeout(
        page.evaluate(async () => {
            const names = await caches.keys();
            const out = [];
            for (const n of names) {
                const c = await caches.open(n);
                out.push({ name: n, keys: (await c.keys()).length });
            }
            return out;
        }),
        15000,
        "M1"
    );
    const tilesBucket = Array.isArray(caches0)
        ? caches0.find((c) => c.name === "geoleaf-data-tiles")
        : null;
    say(
        "M1 — contenu de `geoleaf-data-tiles` (la branche Cache API de tileCacheStrategy)",
        !Array.isArray(caches0)
            ? String(caches0)
            : `${tilesBucket ? `${tilesBucket.keys} entrée(s)` : "cache ABSENT"}` +
                  `\n       tous les caches : ${caches0.map((c) => `${c.name}=${c.keys}`).join(" · ") || "aucun"}`
    );

    // ── M2 — does the write path deposit tiles in IndexedDB? ────────────────────────────
    // We call the engine, not the interface: the path the standing decision would keep.
    const before = await withTimeout(
        page.evaluate(async () => {
            const rows = await /** @type {any} */ (
                globalThis
            ).GeoLeaf?.Storage?.DB?.getAllLayers?.();
            return Array.isArray(rows) ? rows.length : null;
        }),
        15000,
        "M2-avant"
    );

    const download = await withTimeout(
        page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const cm = gl?.Storage?.CacheManager;
            if (!cm?.cacheProfile) return { ok: false, why: "CacheManager.cacheProfile absent" };
            const profileId = gl?.Config?.getActiveProfile?.()?.id ?? "tourism";
            try {
                const res = await cm.cacheProfile(profileId, {});
                return { ok: true, profileId, res: JSON.stringify(res)?.slice(0, 300) };
            } catch (e) {
                return { ok: false, why: String(e?.message ?? e) };
            }
        }),
        120000,
        "M2-download"
    );

    const stored = await withTimeout(
        page.evaluate(async () => {
            return new Promise((resolve) => {
                const req = indexedDB.open("geoleaf-db");
                req.onerror = () => resolve({ err: String(req.error?.name) });
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("layers")) {
                        db.close();
                        resolve({ err: "no layers store" });
                        return;
                    }
                    const all = db
                        .transaction(["layers"], "readonly")
                        .objectStore("layers")
                        .getAll();
                    all.onsuccess = () => {
                        /** @type {Record<string, number>} */
                        const byType = {};
                        for (const r of all.result ?? []) {
                            const t = String(r.resourceType ?? "—");
                            byType[t] = (byType[t] ?? 0) + 1;
                        }
                        db.close();
                        resolve({ total: (all.result ?? []).length, byType });
                    };
                    all.onerror = () => {
                        db.close();
                        resolve({ err: String(all.error?.name) });
                    };
                };
            });
        }),
        20000,
        "M2-après"
    );
    say(
        "M2 — le TÉLÉCHARGEMENT écrit-il des tuiles dans le store `layers` ?",
        `cacheProfile: ${JSON.stringify(download)}` +
            `\n       layers avant : ${before ?? "?"}` +
            `\n       layers après : ${JSON.stringify(stored)}`
    );

    // ── M3 — does the flag reach the engine? ────────────────────────────────────────────
    const flag = await withTimeout(
        page.evaluate(async () => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            const declared = gl?.Config?.get?.("modules.offline.cache.enableTileCache");
            const sel = await gl?.Storage?.Cache?.Storage?.loadLayerSelection?.(
                gl?.Config?.getActiveProfile?.()?.id ?? "tourism"
            ).catch(() => null);
            return {
                declaredByProfile: declared,
                persistedSelection: sel ? { includeTiles: sel.includeTiles } : null,
            };
        }),
        15000,
        "M3"
    );
    say(
        "M3 — `enableTileCache` : ce que le profil déclare vs ce que le moteur LIT",
        `${JSON.stringify(flag)}` +
            "\n       ⚠️ le moteur ne lit JAMAIS le drapeau : il lit `selection.includeTiles`," +
            "\n          écrit par l'interface (`selection-cache.ts`). Sans sélection persistée," +
            "\n          `ResourceEnumerator` n'énumère AUCUNE tuile — quel que soit le drapeau."
    );

    // ── M5 — is the Cache API branch EFFECTIVE offline? ─────────────────────────────────
    // The deciding measurement: a populated cache does not prove it SERVES. If a
    // tile it contains comes back off-network, then removing it loses working
    // behaviour.
    const cachedTileUrl = await withTimeout(
        page.evaluate(async () => {
            const c = await caches.open("geoleaf-data-tiles");
            const keys = await c.keys();
            return keys[0]?.url ?? null;
        }),
        15000,
        "M5-url"
    );

    let offlineVerdict = "aucune tuile en cache — rien à éprouver";
    if (typeof cachedTileUrl === "string" && cachedTileUrl) {
        await context.setOffline(true);
        await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 });
        const served = await withTimeout(
            page.evaluate(async (url) => {
                const res = await fetch(url, { cache: "no-store" });
                const buf = await res.arrayBuffer();
                return {
                    status: res.status,
                    type: res.headers.get("content-type"),
                    bytes: buf.byteLength,
                    placeholder: res.headers.get("X-GeoLeaf-Placeholder"),
                };
            }, cachedTileUrl),
            20000,
            "M5-fetch"
        );
        await context.setOffline(false);
        offlineVerdict =
            `${cachedTileUrl}\n       → ${JSON.stringify(served)}` +
            `\n       (status 504 + X-GeoLeaf-Placeholder=tile ⟹ la branche n'a PAS servi)`;
    }
    say("M5 — une tuile du cache API revient-elle HORS LIGNE ?", offlineVerdict);

    await context.close();
    await browser.close();
    console.log("── sonde terminée : les cinq mesures sont prises, l'arbitrage se prend dessus.\n");
};

run().catch((e) => {
    console.error("PROBE ERROR:", e);
    process.exitCode = 2;
});
