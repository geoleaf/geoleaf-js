/**
 * FILET 2 — the REAL `_getAPIController()`.
 *
 * This getter (`built-in/api/controller.ts:319-339`) is the assembly point of the whole API:
 * it runs the `security → config → api` setup chain, then builds and initialises the
 * `APIController`. It is also the exact thing that broke in `192c6865` (S4) — the
 * `APIController` was built at import with **0 managers** — and the revert (`eae711fa`) took
 * two hours and a browser E2E to find it.
 *
 * WHY NO EXISTING TEST COVERS IT — the reason is structural, not laziness:
 *
 *   `_APIController` is installed via `Object.defineProperty(_gl, "_APIController", { get })`
 *   (`controller.ts:346-350`) with **no setter**. So `GeoLeaf._APIController = mock` THROWS
 *   ("Cannot set property ... which has only a getter"). Every existing test therefore either
 *   `vi.mock`s `controller.js` away — which deletes the `defineProperty` and thus the object
 *   under test — or overwrites the property before the real module loads. Both are blind.
 *   `__tests__/api/controller.test.js:52` even asserts `managersCount === 3`, but on a
 *   controller wired BY HAND: it plants `GeoLeaf.API` itself, pre-satisfying the very
 *   precondition the getter exists to guarantee. Delete the setup chain and it stays green.
 *
 *   And `boot-golden-master.test.js:88` lists `"_APIController"` among the frozen facade keys,
 *   but `Object.keys()` does NOT invoke getters — it sees the NAME, never the body.
 *
 * So this file does exactly what no other one can: it loads the real globals chain and READS
 * the property, letting the real getter run. It must never mock `controller.js`, and must never
 * plant `GeoLeaf.API` — doing either re-creates the blind spot it exists to close.
 *
 * One file = one boot scenario: `pool: 'forks'` + `isolate: true` gives a fresh process per
 * FILE, and `globalThis.GeoLeaf` is a shared singleton. Do not add a second scenario here.
 */
"use strict";

describe("APIController — le VRAI getter (l'oracle de S4)", () => {
    let GeoLeaf;
    let health;

    beforeAll(async () => {
        // The real chain — NOT mocked. Heavy deps (MapLibre…) are mocked by __tests__/setup.js.
        await import("../../src/globals/globals.js");
        GeoLeaf = globalThis.GeoLeaf;

        // Reading the property IS the trigger: the accessor runs `_getAPIController()`, which
        // runs the setup chain, then `new APIController()` + `.init()`.
        health = GeoLeaf._APIController.getHealthStatus();
    });

    it("assemble les 3 managers — `managers: 0` EST la panne de S4", () => {
        expect(health.managersCount).toBe(3);
        expect(health.managers).toBe(3);
    });

    it("s'initialise sans erreur et obtient l'accès aux modules", () => {
        // `hasModuleAccess: false` is what `_setupModuleAccess()` returns when the manager
        // lookups came back null — the downstream symptom of a broken setup chain.
        expect(health.isInitialized).toBe(true);
        expect(health.hasModuleAccess).toBe(true);
        expect(health.errors).toEqual([]);
    });

    it("expose les 3 managers nommés que `loadConfig()` consomme", () => {
        const ctrl = GeoLeaf._APIController;
        expect(ctrl.managers.module).toBeDefined();
        expect(ctrl.managers.initialization).toBeDefined();
        expect(ctrl.managers.factory).toBeDefined();
    });

    it("le contrat de boot tient : `GeoLeaf.Config.init` est là avant tout `loadConfig()`", () => {
        // `boot-core.ts:143` calls `loadConfig()` BEFORE `registry.init()` (:240), and
        // `initialization-manager.ts:156-161` throws if `Config.init` is not a function.
        // That inversion is why the setup chain runs in the getter at all.
        expect(typeof GeoLeaf.Config?.init).toBe("function");
        expect(typeof GeoLeaf.loadConfig).toBe("function");
    });

    it("le getter n'a pas de setter — c'est pourquoi les autres tests sont aveugles", () => {
        // Documents the constraint rather than leaving the next reader to rediscover it by
        // writing a test that throws. If a setter ever appears, this file's premise changes.
        const descriptor = Object.getOwnPropertyDescriptor(GeoLeaf, "_APIController");
        expect(typeof descriptor.get).toBe("function");
        expect(descriptor.set).toBeUndefined();
    });
});
