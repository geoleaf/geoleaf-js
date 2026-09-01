/**
 * `capabilities/offline/tile-budget.ts` — publishing the tile cache's ceiling.
 *
 * The module is tiny; what it carries is not. It is the ONLY link between the
 * profile and a Service Worker that can import nothing, and this ceiling is
 * what keeps an unbounded tile cache from getting the origin evicted — hence
 * `outbox` and `features` with it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { Log } from "../../../src/utils/log/index.js";
import {
    TILE_BUDGET_KEY,
    parseTileCacheBudget,
    publishTileCacheBudget,
} from "../../../src/capabilities/offline/tile-budget.js";

beforeEach(() => vi.clearAllMocks());

describe("parseTileCacheBudget", () => {
    it("accepte un entier positif", () => {
        expect(parseTileCacheBudget(1500)).toBe(1500);
    });

    it("accepte `0` — c'est une valeur SIGNIFIANTE, pas un rebut", () => {
        // `0` disables the bounding. Filtering it with the invalid values
        // would take from the integrator the only way to say "I want no ceiling".
        expect(parseTileCacheBudget(0)).toBe(0);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("tronque un décimal — un nombre d'entrées est entier", () => {
        expect(parseTileCacheBudget(120.7)).toBe(120);
    });

    it("rend `null` quand rien n'est déclaré, SANS crier", () => {
        expect(parseTileCacheBudget(undefined)).toBeNull();
        expect(parseTileCacheBudget(null)).toBeNull();
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("REFUSE et journalise ce qui n'est pas un nombre utilisable", () => {
        for (const bad of ["2000", -1, Number.NaN, Infinity, {}, []]) {
            expect(parseTileCacheBudget(bad)).toBeNull();
        }
        expect(Log.warn).toHaveBeenCalledTimes(6);
    });
});

describe("publishTileCacheBudget", () => {
    it("écrit sous la clé partagée avec le worker", async () => {
        const setPreference = vi.fn().mockResolvedValue(undefined);
        await publishTileCacheBudget({ setPreference }, 1500);
        expect(setPreference).toHaveBeenCalledWith(TILE_BUDGET_KEY, 1500);
    });

    it("écrit AUSSI quand rien n'est déclaré — sinon une valeur périmée survivrait", async () => {
        // 🛑 The case that matters. A profile that declared 500 then removes
        // the key would keep being trimmed at 500, with nothing in its
        // configuration saying so. Publishing `null` states "this profile
        // declares nothing" and hands back to the worker's fallback.
        const setPreference = vi.fn().mockResolvedValue(undefined);
        await publishTileCacheBudget({ setPreference }, null);
        expect(setPreference).toHaveBeenCalledWith(TILE_BUDGET_KEY, null);
    });

    it("une panne de stockage est journalisée, jamais jetée", async () => {
        // A profile must still load when persistence is unavailable, and the
        // worker has its fallback anyway.
        const setPreference = vi.fn().mockRejectedValue(new Error("QuotaExceededError"));
        await expect(publishTileCacheBudget({ setPreference }, 10)).resolves.toBeUndefined();
        expect(Log.warn).toHaveBeenCalled();
    });

    it("une façade absente ne casse rien", async () => {
        await expect(publishTileCacheBudget(null, 10)).resolves.toBeUndefined();
        await expect(publishTileCacheBudget({}, 10)).resolves.toBeUndefined();
    });
});
