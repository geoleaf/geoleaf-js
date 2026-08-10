/*!
 * GeoLeaf Core (offline capability) — tile cache ceiling
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description Publishes the Service Worker's opportunistic tile-cache ceiling.
 *
 * 🛑 WHY THIS EXISTS AT ALL — it is a data-loss guard, not a performance knob. Browsers evict
 * by ORIGIN, never by store. IndexedDB is capped (`maxCacheBytes`, LRU eviction, an event) and
 * holds `outbox` / `features`, i.e. field captures that have no other copy. The Service
 * Worker's `CACHE_TILES` was capped by nothing. Under disk pressure an unbounded tile cache can
 * therefore get the WHOLE origin evicted, unsynced captures included. And the measurement taken
 * for task 1.1 settles the "surely persistence protects us" objection: `persist()` was REFUSED
 * on a fresh headless profile (~800 MB quota) and GRANTED on the same origin in real Chrome
 * (~10 GB). Persistence is obtainable, never guaranteed — a field device meeting a production
 * origin for the first time starts in `bestEffort`.
 *
 * ⚠️ HOW IT REACHES THE WORKER — through IndexedDB, exactly like {@link
 * ../offline/data-origins.publishDataOrigins | the declared origins}, and for the same reason:
 * `sw-core.js` is copied verbatim into every deploy variant, with no bundler and no imports, so
 * it cannot read this module. A `postMessage` would be lost on every worker restart, and the
 * browser restarts it whenever it likes — typically when a field device wakes up offline, i.e.
 * at the worst possible moment. A preference survives.
 *
 * ⚠️ WHY A COUNT AND NOT BYTES. The Cache API exposes no per-entry size, and
 * `navigator.storage.estimate()` measures the whole origin rather than one store. A count is
 * the only portable, cheap bound. The byte equivalence is stated at
 * `specs/capacites/offline.md` §Arbitrage du stockage and nowhere else — writing it twice is
 * how the two copies diverge.
 *
 * @version 1.0.0
 */
"use strict";

import { Log } from "../../utils/log/index.js";

/**
 * Key under which the ceiling is stored, in the `preferences` store.
 *
 * ⚠️ Le préfixe n'est PAS `geoleaf:` — la gate EVENT-MAP scanne les littéraux `geoleaf:*` et
 * prendrait une clé de stockage pour un ÉVÉNEMENT non typé. Même motif que `DATA_ORIGINS_KEY`.
 *
 * Littéral PARTAGÉ : `sw-core.js` le code en dur, faute de pouvoir importer. La garde de source
 * de `__tests__/storage/sw-core-tile-budget.test.ts` vérifie que les deux disent la même chose ;
 * sans elle, une divergence sortirait silencieusement verte — c'est exactement ce que la version
 * de base du worker a fait pendant des mois (cause racine n° 2 de la roadmap hors-ligne).
 */
export const TILE_BUDGET_KEY = "offline.tileCacheMaxEntries";

/**
 * Normalises a declared ceiling, dropping what cannot be trusted.
 *
 * `0` is a MEANINGFUL value — it disables trimming — so it is not filtered out with the
 * rubbish. Anything that is not a finite, non-negative number is dropped and logged: the worker
 * then falls back to its own constant, which bounds. It never falls back to "no limit".
 *
 * @param value - Raw value read from the profile configuration.
 * @returns The ceiling in entries, or `null` when nothing usable was declared.
 */
export function parseTileCacheBudget(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        Log.warn(
            `[TileBudget] Ignored — not a non-negative number: ${String(value)}. ` +
                `The worker will use its built-in ceiling.`
        );
        return null;
    }
    return Math.floor(value);
}

/**
 * Publishes the ceiling where the Service Worker can read it.
 *
 * 🛑 IT WRITES EVEN WHEN NOTHING IS DECLARED, and that is the point. Skipping the write on
 * `null` would leave a PREVIOUS value in place: a profile that declared `500`, then dropped the
 * key, would keep being trimmed at 500 with nothing in its configuration saying so — and the
 * next reader would have no way of telling a deliberate ceiling from a leftover. Publishing
 * `null` states "this profile declares nothing", and the worker falls back to its own constant.
 * Same reasoning as `publishDataOrigins`, whose empty array is a REFUSAL rather than a silence.
 *
 * A storage failure is logged, never thrown: a profile still has to load when persistence is
 * unavailable, and the worker has a bounding fallback either way.
 *
 * @param db - The storage façade (`GeoLeaf.Storage.DB`).
 * @param maxEntries - Ceiling in entries, or `null` when the profile declares none.
 * @returns Resolves once written (or once the write has been given up on).
 *
 * @example
 * await publishTileCacheBudget(GeoLeaf?.Storage?.DB, 2000);
 */
export async function publishTileCacheBudget(
    db: { setPreference?: (key: string, value: unknown) => Promise<unknown> } | null | undefined,
    maxEntries: number | null
): Promise<void> {
    try {
        await db?.setPreference?.(TILE_BUDGET_KEY, maxEntries);
        Log.debug(
            maxEntries === null
                ? "[TileBudget] No ceiling declared — cleared; the worker uses its own."
                : `[TileBudget] Published tile cache ceiling for the worker: ${maxEntries}`
        );
    } catch (err) {
        Log.warn("[TileBudget] Could not publish the ceiling:", (err as Error).message);
    }
}
