/**
 * The eleven top-level methods — BEHAVIOUR, against the surviving implementation.
 *
 * ## Ce fichier remplace `api/geoleaf-api.test.js` (socle-init 7.7)
 *
 * The old one carried "Delegates to `_APIController`; tests
 * `_getAPIController` and public API" and loaded `kernel/api/geoleaf-api.js`
 * **alone**. That module then assigned the eleven methods through an
 * `Object.assign`, duplicating `globals/globals.api.ts` — and it won,
 * because it was evaluated last. The dedup removed that duplicate; the old
 * file thus no longer had a subject.
 *
 * 🛑 **And the preflight got this point wrong**: it announced that eight of
 * these ten tests were "covered elsewhere, by `api.test.js` and
 * `api-extended.test.js`". **False** — those two files also loaded
 * `geoleaf-api.js` (via `api/geoleaf.api.js`), never the `globals/` chain.
 * The three files thus exercised the SAME implementation, the one being
 * deleted, and the surviving implementation had **no behaviour test**. The
 * three were repointed rather than deleted.
 *
 * ## The fake controller is an ACCESSOR, and that is not a detail
 *
 * `kernel/api/controller.ts` only installs its own if it does not already
 * find one — `getOwnPropertyDescriptor(gl, "_APIController")?.get`. A fake
 * set as a plain value does not hold it back and gets overwritten as soon
 * as the `globals/` chain loads. The accessor shape is also the REAL
 * production shape: the harness gains fidelity, it works around nothing.
 *
 * ## The two tests that exist NOWHERE else
 *
 * "`APIController` missing" and "`APIController` in failed state" exercise
 * `globals/globals.api.ts`'s `requireController()`. Without these two
 * refusals, a failed controller does not fail the boot:
 * `geoleafLoadConfig()` returns `Promise.resolve(null)`, so neither
 * `onLoaded` nor `onError` is called, so `boot-core.ts`'s `await` **never
 * settles**. `controller.ts` says it itself where it releases the parking —
 * it designates the validated accessor as what turns that silence into a
 * loud failure. That is the guarantee carried from one file to the other,
 * and these two tests are its only witness.
 *
 * @see packages/core/src/globals/globals.api.ts — `requireController`, single writer of the eleven
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

/** The global namespace, without the ambient typing — this file handles fakes. */
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

/** The controller the accessor returns — swappable by the two refusal tests. */
let current: unknown = realController;

Object.defineProperty(GL.GeoLeaf, "_APIController", {
    get: () => current,
    configurable: true,
    enumerable: true,
});

// The deferral is LOAD-BEARING: the `globals/` chain reads `_APIController`
// at load, and a static `import` would hoist above the accessor set just above.
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

    // ── The two refusals. Unique in the whole repo — see the header. ──────────────────────────
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
