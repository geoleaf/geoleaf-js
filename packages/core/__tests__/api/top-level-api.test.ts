/**
 * Les onze méthodes de haut niveau — COMPORTEMENT, contre l'implémentation qui survit.
 *
 * ## Ce fichier remplace `api/geoleaf-api.test.js` (socle-init 7.7)
 *
 * L'ancien portait « Delegates to `_APIController` ; teste `_getAPIController` et API public » et
 * chargeait `kernel/api/geoleaf-api.js` **seul**. Ce module assignait alors les onze méthodes par
 * un `Object.assign`, en doublon de `globals/globals.api.ts` — et il gagnait, parce qu'il était
 * évalué en dernier. 7.7 a retiré ce doublon ; l'ancien fichier n'avait donc plus de sujet.
 *
 * 🛑 **Et le pré-vol de 7.7 s'était trompé sur ce point** : il annonçait que huit de ces dix tests
 * étaient « couverts ailleurs, par `api.test.js` et `api-extended.test.js` ». **Faux** — ces deux
 * fichiers chargeaient eux aussi `geoleaf-api.js` (via `api/geoleaf.api.js`), jamais la chaîne
 * `globals/`. Les trois fichiers éprouvaient donc la MÊME implémentation, celle qu'on supprimait,
 * et l'implémentation survivante n'avait **aucun test de comportement**. Les trois ont été
 * repointés plutôt que supprimés.
 *
 * ## Le faux contrôleur est un ACCESSEUR, et ce n'est pas un détail
 *
 * `kernel/api/controller.ts` n'installe le sien que s'il n'en trouve pas déjà un —
 * `getOwnPropertyDescriptor(gl, "_APIController")?.get`. Un faux posé en valeur simple ne le
 * retient pas et se fait écraser dès que la chaîne `globals/` est chargée. La forme accesseur est
 * aussi la forme RÉELLE en production : le harnais y gagne en fidélité, il ne contourne rien.
 *
 * ## Les deux tests qui n'existent NULLE PART ailleurs
 *
 * « `APIController` manquant » et « `APIController` en échec » éprouvent `requireController()` de
 * `globals/globals.api.ts`. Sans ces deux refus, un contrôleur en échec ne fait pas échouer le
 * boot : `geoleafLoadConfig()` rend `Promise.resolve(null)`, donc ni `onLoaded` ni `onError` ne
 * sont appelés, donc le `await` de `boot-core.ts` **ne se règle jamais**. `controller.ts` le dit
 * lui-même là où il libère le parking — il désigne l'accesseur validé comme ce qui transforme ce
 * silence en échec bruyant. C'est la garantie que 7.7 a portée d'un fichier à l'autre, et ces deux
 * tests sont son unique témoin.
 *
 * @see packages/core/src/globals/globals.api.ts — `requireController`, écrivain unique des onze
 * @see packages/core/__tests__/guards/top-level-api-single-writer.guard.test.ts — TLA-01/02
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGeoleafInit = vi.fn().mockReturnValue(null);
const mockGeoleafSetTheme = vi.fn().mockReturnValue(true);
const mockGeoleafLoadConfig = vi.fn().mockResolvedValue({});
const mockGetHealthStatus = vi.fn().mockReturnValue({ isInitialized: true });
const mockModuleAccessFn = vi.fn().mockReturnValue(null);
const mockGetMapInstance = vi.fn().mockReturnValue(null);
const mockGetAllMapInstances = vi.fn().mockReturnValue([]);
const mockRemoveMapInstance = vi.fn().mockReturnValue(false);
const mockGeoleafCreateMap = vi.fn().mockReturnValue(null);

/** Le namespace global, sans le typage ambiant — ce fichier manipule des faux. */
const GL = globalThis as unknown as Record<string, any>;

GL.GeoLeaf = GL.GeoLeaf || {};

const realController = {
    isInitialized: true,
    moduleAccessFn: mockModuleAccessFn,
    geoleafInit: mockGeoleafInit,
    geoleafSetTheme: mockGeoleafSetTheme,
    geoleafLoadConfig: mockGeoleafLoadConfig,
    getHealthStatus: mockGetHealthStatus,
    geoleafCreateMap: mockGeoleafCreateMap,
    managers: {
        factory: {
            getMapInstance: mockGetMapInstance,
            getAllMapInstances: mockGetAllMapInstances,
            removeMapInstance: mockRemoveMapInstance,
        },
    },
};

/** Le contrôleur que l'accesseur rend — échangeable par les deux tests de refus. */
let current: unknown = realController;

Object.defineProperty(GL.GeoLeaf, "_APIController", {
    get: () => current,
    configurable: true,
    enumerable: true,
});

// Le déféré est PORTEUR : la chaîne `globals/` lit `_APIController` au chargement, et un `import`
// statique se hisserait au-dessus de l'accesseur posé juste ci-dessus.
beforeAll(async () => {
    await import("../../src/globals/globals.api.js");
});

describe("GeoLeafTopLevelApi — les onze, contre `globals/globals.api.ts` (7.7)", () => {
    beforeEach(() => {
        current = realController;
        mockGeoleafInit.mockClear();
        mockGeoleafSetTheme.mockClear();
        mockGeoleafLoadConfig.mockClear();
    });

    it("GeoLeaf.init délègue à _APIController.geoleafInit", () => {
        GL.GeoLeaf.init({});
        expect(mockGeoleafInit).toHaveBeenCalledWith({});
    });

    it("GeoLeaf.setTheme délègue à _APIController.geoleafSetTheme", () => {
        GL.GeoLeaf.setTheme("dark");
        expect(mockGeoleafSetTheme).toHaveBeenCalledWith("dark");
    });

    it("GeoLeaf.loadConfig sur une entrée invalide jette TypeError", () => {
        expect(() => GL.GeoLeaf.loadConfig(null)).toThrow(TypeError);
        expect(() => GL.GeoLeaf.loadConfig(123)).toThrow(TypeError);
    });

    it("GeoLeaf.loadConfig délègue, chaîne comme objet", async () => {
        await GL.GeoLeaf.loadConfig("https://example.com/config.json");
        expect(mockGeoleafLoadConfig).toHaveBeenCalledWith("https://example.com/config.json");
        await GL.GeoLeaf.loadConfig({ center: [0, 0] });
        expect(mockGeoleafLoadConfig).toHaveBeenCalledWith({ center: [0, 0] });
    });

    // ── Les deux refus. Uniques dans tout le dépôt — voir l'en-tête. ──────────────────────────
    it("GeoLeaf.init JETTE si _APIController est absent", () => {
        current = undefined;
        expect(() => GL.GeoLeaf.init({})).toThrow(/APIController missing/);
    });

    it("GeoLeaf.init JETTE si _APIController est en échec", () => {
        current = { isInitialized: false, getHealthStatus: () => ({}) };
        expect(() => GL.GeoLeaf.init({})).toThrow(/failed state/);
    });

    it("GeoLeaf.getModule et hasModule délèguent au contrôleur", () => {
        mockModuleAccessFn.mockReturnValueOnce({ mod: 1 });
        expect(GL.GeoLeaf.getModule("Core")).toEqual({ mod: 1 });
        expect(mockModuleAccessFn).toHaveBeenCalledWith("Core");
        mockModuleAccessFn.mockReturnValueOnce({});
        expect(GL.GeoLeaf.hasModule("UI")).toBe(true);
        mockModuleAccessFn.mockReturnValueOnce(null);
        expect(GL.GeoLeaf.hasModule("Missing")).toBe(false);
    });

    it("GeoLeaf.getNamespace rend un membre du namespace par son nom", () => {
        expect(GL.GeoLeaf.getNamespace("init")).toBe(GL.GeoLeaf.init);
        expect(GL.GeoLeaf.getNamespace("")).toBeNull();
    });

    it("GeoLeaf.createMap, getMap, getAllMaps délèguent au contrôleur", () => {
        mockGeoleafCreateMap.mockReturnValueOnce({ map: 1 });
        expect(GL.GeoLeaf.createMap("el", {})).toEqual({ map: 1 });
        expect(mockGeoleafCreateMap).toHaveBeenCalledWith("el", {});
        mockGetMapInstance.mockReturnValueOnce({ id: "m1" });
        expect(GL.GeoLeaf.getMap("m1")).toEqual({ id: "m1" });
        mockGetAllMapInstances.mockReturnValueOnce([{ id: "m1" }]);
        expect(GL.GeoLeaf.getAllMaps()).toEqual([{ id: "m1" }]);
        expect(mockRemoveMapInstance).not.toHaveBeenCalled();
    });

    it("GeoLeaf.getHealth et getMetrics rendent getHealthStatus", () => {
        expect(GL.GeoLeaf.getHealth()).toEqual({ isInitialized: true });
        expect(GL.GeoLeaf.getMetrics()).toEqual({ isInitialized: true });
    });
});
