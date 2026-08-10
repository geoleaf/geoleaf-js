/**
 * `capabilities/offline/tile-budget.ts` — la publication du plafond du cache de tuiles.
 *
 * Le module est minuscule ; ce qu'il porte ne l'est pas. Il est le SEUL lien entre le profil et
 * un Service Worker qui ne peut rien importer, et c'est ce plafond qui empêche un cache de
 * tuiles non borné de faire évincer l'origine — donc `outbox` et `features` avec.
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
        // `0` désactive le bornage. Le filtrer avec les valeurs invalides retirerait à
        // l'intégrateur le seul moyen de dire « je ne veux pas de plafond ».
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
        // 🛑 Le cas qui compte. Un profil qui déclarait 500 puis retire la clé continuerait
        // d'être taillé à 500, sans que rien dans sa configuration ne le dise. Publier `null`
        // énonce « ce profil ne déclare rien » et rend la main au repli du worker.
        const setPreference = vi.fn().mockResolvedValue(undefined);
        await publishTileCacheBudget({ setPreference }, null);
        expect(setPreference).toHaveBeenCalledWith(TILE_BUDGET_KEY, null);
    });

    it("une panne de stockage est journalisée, jamais jetée", async () => {
        // Un profil doit encore charger quand la persistance est indisponible, et le worker a
        // son repli de toute façon.
        const setPreference = vi.fn().mockRejectedValue(new Error("QuotaExceededError"));
        await expect(publishTileCacheBudget({ setPreference }, 10)).resolves.toBeUndefined();
        expect(Log.warn).toHaveBeenCalled();
    });

    it("une façade absente ne casse rien", async () => {
        await expect(publishTileCacheBudget(null, 10)).resolves.toBeUndefined();
        await expect(publishTileCacheBudget({}, 10)).resolves.toBeUndefined();
    });
});
