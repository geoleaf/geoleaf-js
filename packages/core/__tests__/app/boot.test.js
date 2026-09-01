/**
 * R5 — Tests app/boot.ts (startApp, GeoLeaf.boot).
 */
"use strict";

// boot.ts / helpers.ts read the namespace via the pure accessor `ensureGeoLeaf()`
// (presets build, S1) — mock it to return a single shared namespace so the handle
// below, helpers' `_app`, and boot's registrations all point at the same object.
const { mockGeoLeaf } = vi.hoisted(() => ({ mockGeoLeaf: {} }));
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mockGeoLeaf,
    getGeoLeaf: () => mockGeoLeaf,
}));

// Load helpers to populate _app
import "../../src/app/app-namespace.js";
import * as bootModule from "../../src/app/boot.js";
const _app = bootModule._app;
const GeoLeaf = mockGeoLeaf;

describe("app/boot (R5)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete GeoLeaf.loadConfig;
        delete GeoLeaf.Config;
        sessionStorage.clear();
        // Reset double-boot guard so each test gets a fresh startApp
        _app._appStarted = false;
        // Reset ModuleRegistry state so startApp can re-register modules.
        // S6 Lot 1: `destroy()` now re-arms the registry, so we use the public API instead of
        // forcing the private `_initialized = false`. That crutch was hiding the bug it could
        // have revealed — destroy() never reset the flag, so create → destroy → recreate was a
        // silent no-op in production.
        if (GeoLeaf._registry) {
            GeoLeaf._registry.destroy();
            // Still poking `_modules`: `register()` is idempotent and returns early on a known
            // id, so a stale instance from the previous test would survive. That is debt C-6
            // (recreate keeps stale capability modules) — out of this lot's scope.
            for (const id of ["route", "labels", "legend", "search", "share"]) {
                GeoLeaf._registry._modules?.delete(id);
            }
        }
    });

    describe("startApp", () => {
        // "returns early if GeoLeaf not found" removed (presets build, S1): the namespace
        // is read via `ensureGeoLeaf()`, which never returns a falsy value (it creates an
        // empty namespace on demand) — and boot.ts would throw at module-eval if it did
        // (it assigns `GeoLeaf._app`). The `if (!GeoLeaf)` guard in startApp is a dead
        // defensive branch that can no longer be driven by nulling a property post-load.
        it("returns early if loadConfig absent", async () => {
            const errorSpy = vi.spyOn(_app.AppLog, "error").mockImplementation(() => {});
            await _app.startApp();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("loadConfig"));
            errorSpy.mockRestore();
        });
        it("loads config et calls registry.init avec baseCfg", async () => {
            const cfg = {
                map: {
                    bounds: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            GeoLeaf.loadConfig = vi.fn((opts) => {
                setTimeout(() => opts.onLoaded(cfg), 0);
            });
            GeoLeaf._registry.init = vi.fn().mockResolvedValue(undefined);
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(GeoLeaf.loadConfig).toHaveBeenCalled();
            expect(GeoLeaf._registry.init).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    map: expect.objectContaining({
                        bounds: [
                            [0, 0],
                            [1, 1],
                        ],
                    }),
                })
            );
        });
        it("uses loadActiveProfileResources if Config is present (registry.init avec profileCfg)", async () => {
            const profileCfg = {
                map: {
                    bounds: [
                        [0, 0],
                        [1, 1],
                    ],
                },
            };
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            GeoLeaf.Config = {
                loadActiveProfileResources: vi.fn().mockResolvedValue(profileCfg),
                getCategories: vi.fn(),
            };
            GeoLeaf._registry.init = vi.fn().mockResolvedValue(undefined);
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(GeoLeaf._registry.init).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    map: expect.objectContaining({
                        bounds: [
                            [0, 0],
                            [1, 1],
                        ],
                    }),
                })
            );
        });
    });

    describe("GeoLeaf.boot", () => {
        it("calls startApp si document already ready", async () => {
            Object.defineProperty(document, "readyState", {
                value: "complete",
                configurable: true,
            });
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            GeoLeaf.boot();
            await new Promise((r) => setTimeout(r, 20));
            expect(GeoLeaf.loadConfig).toHaveBeenCalled();
        });
    });

    describe("startApp — branches supplémentaires", () => {
        it("bootInfo.show appelé sur geoleaf:app:ready si bootInfo.show présent", () => {
            const showFn = vi.fn();
            GeoLeaf.bootInfo = { show: showFn };
            GeoLeaf.loadConfig = vi.fn(); // never resolves — ok for this test
            _app.startApp(); // registers listener synchronously (before first await)
            document.dispatchEvent(new Event("geoleaf:app:ready"));
            expect(showFn).toHaveBeenCalledWith(GeoLeaf);
            delete GeoLeaf.bootInfo;
        });
        it("geoleaf:app:ready sans bootInfo — pas d'erreur", () => {
            GeoLeaf.loadConfig = vi.fn();
            _app.startApp();
            expect(() => document.dispatchEvent(new Event("geoleaf:app:ready"))).not.toThrow();
        });
        it("lit profil valide depuis sessionStorage → profileId dans loadConfig", async () => {
            sessionStorage.setItem("gl-selected-profile", "mon-profil");
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(GeoLeaf.loadConfig).toHaveBeenCalledWith(
                expect.objectContaining({ profileId: "mon-profil" })
            );
        });
        it("warn si profil sessionStorage format invalide", async () => {
            sessionStorage.setItem("gl-selected-profile", "invalid profile!!!");
            const warnSpy = vi.spyOn(_app.AppLog, "warn").mockImplementation(() => {});
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("sessionStorage profile rejected"),
                expect.any(String)
            );
            warnSpy.mockRestore();
        });
        it("warn si sessionStorage.getItem throw", async () => {
            const getItemSpy = vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
                throw new Error("storage error");
            });
            const warnSpy = vi.spyOn(_app.AppLog, "warn").mockImplementation(() => {});
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Unable to read sessionStorage"),
                expect.any(Error)
            );
            warnSpy.mockRestore();
            getItemSpy.mockRestore();
        });
        it("error si loadConfig appelle onError", async () => {
            GeoLeaf.loadConfig = vi.fn((opts) =>
                setTimeout(() => opts.onError(new Error("load failed")), 0)
            );
            const errorSpy = vi.spyOn(_app.AppLog, "error").mockImplementation(() => {});
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Error loading config"),
                expect.any(Error)
            );
            errorSpy.mockRestore();
        });
        it("warn si loadActiveProfileResources throw → registry.init appelé avec baseCfg", async () => {
            GeoLeaf.loadConfig = vi.fn((opts) => setTimeout(() => opts.onLoaded({}), 0));
            GeoLeaf.Config = {
                loadActiveProfileResources: vi.fn().mockRejectedValue(new Error("profile error")),
                getCategories: vi.fn(),
            };
            const warnSpy = vi.spyOn(_app.AppLog, "warn").mockImplementation(() => {});
            GeoLeaf._registry.init = vi.fn().mockResolvedValue(undefined);
            await _app.startApp();
            await new Promise((r) => setTimeout(r, 10));
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Error loading profile resources"),
                expect.any(Error)
            );
            expect(GeoLeaf._registry.init).toHaveBeenCalledWith(expect.anything(), {});
            warnSpy.mockRestore();
        });
    });

    describe("GeoLeaf.boot — branches supplémentaires", () => {
        it("boot() avec onPerformanceMetrics → GeoLeaf._perfCallback défini", () => {
            Object.defineProperty(document, "readyState", {
                value: "complete",
                configurable: true,
            });
            const cb = vi.fn();
            const origStartApp = _app.startApp;
            // `app-types.ts` declares startApp as `() => Promise<void>` — the double must
            // honour it: GeoLeaf.boot() attaches .catch() to the returned promise (Q1.4).
            _app.startApp = vi.fn(() => Promise.resolve());
            GeoLeaf.boot({ onPerformanceMetrics: cb });
            expect(GeoLeaf._perfCallback).toBe(cb);
            _app.startApp = origStartApp;
        });
        it("boot() avec beforeBoot → GeoLeaf._beforeBootCallback défini", () => {
            Object.defineProperty(document, "readyState", {
                value: "complete",
                configurable: true,
            });
            const hook = vi.fn();
            const origStartApp = _app.startApp;
            // `app-types.ts` declares startApp as `() => Promise<void>` — the double must
            // honour it: GeoLeaf.boot() attaches .catch() to the returned promise (Q1.4).
            _app.startApp = vi.fn(() => Promise.resolve());
            GeoLeaf.boot({ beforeBoot: hook });
            expect(GeoLeaf._beforeBootCallback).toBe(hook);
            _app.startApp = origStartApp;
            delete GeoLeaf._beforeBootCallback;
        });
        it("boot() quand readyState=loading → addEventListener DOMContentLoaded", () => {
            Object.defineProperty(document, "readyState", {
                value: "loading",
                configurable: true,
            });
            const addEventSpy = vi.spyOn(document, "addEventListener");
            const origStartApp = _app.startApp;
            _app.startApp = vi.fn(() => Promise.resolve());

            GeoLeaf.boot();

            // This assertion bore on the listener's IDENTITY
            // (`toHaveBeenCalledWith("DOMContentLoaded", _app.startApp)`).
            // Since `boot()` attaches a rejection handler, the listener is a
            // synchronous wrapper and the identity no longer holds. What it
            // really guaranteed is the DEFERRAL — verified here directly,
            // which is stronger: the identity only implied the deferral by deduction.
            const call = addEventSpy.mock.calls.find(([type]) => type === "DOMContentLoaded");
            expect(call).toBeDefined();
            expect(_app.startApp).not.toHaveBeenCalled();

            // And the listener set does trigger the sequence when the event arrives.
            call[1]();
            expect(_app.startApp).toHaveBeenCalledTimes(1);

            _app.startApp = origStartApp;
            addEventSpy.mockRestore();
            Object.defineProperty(document, "readyState", {
                value: "complete",
                configurable: true,
            });
        });
    });
});
