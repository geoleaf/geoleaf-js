/**
 * R5 — Tests app/app-namespace.ts (_app.AppLog, getProfilesBasePath, checkPlugins,
 *       showNotification).
 */
"use strict";

// vi.hoisted(): `vi.mock` is hoisted above the module body, so a factory closing over a
// module-level binding would run before that binding exists (TDZ). The require() used to
// hide it by calling the factory late.
const GeoLeafMock = vi.hoisted(() => ({}));

// helpers.ts reads the namespace via the pure accessor `ensureGeoLeaf()` (presets
// build, S1) and reads `location` from the global — no more `_g.location`.
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => GeoLeafMock,
    getGeoLeaf: () => GeoLeafMock,
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn() },
}));

// Helpers attaches to GeoLeaf._app as a side effect at load time; loaded once here and
// referenced through the named export.
import { _app } from "../../src/app/app-namespace.js";

describe("app/app-namespace (R5)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset GeoLeaf to a clean state each test
        Object.keys(GeoLeafMock).forEach((k) => delete GeoLeafMock[k]);
        GeoLeafMock._app = _app;
    });

    // ── AppLog ─────────────────────────────────────────────────────────────
    describe("AppLog", () => {
        it("log: console.debug appelé si search contient debug=true", () => {
            const origLocation = globalThis.location;
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: { search: "?debug=true" },
            });
            const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
            _app.AppLog.log("test message");
            expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "test message");
            spy.mockRestore();
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: origLocation,
            });
        });
        it("log: console.debug pas appelé sans debug=true", () => {
            const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
            _app.AppLog.log("test message");
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
        it("info: appelle console.info", () => {
            const spy = vi.spyOn(console, "info").mockImplementation(() => {});
            _app.AppLog.info("info msg");
            expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "info msg");
            spy.mockRestore();
        });
        it("error: appelle console.error", () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            _app.AppLog.error("err msg");
            expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "err msg");
            spy.mockRestore();
        });
        it("warn: appelle console.warn", () => {
            const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
            _app.AppLog.warn("warn msg");
            expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "warn msg");
            spy.mockRestore();
        });
    });

    // ── getProfilesBasePath ────────────────────────────────────────────────
    describe("getProfilesBasePath", () => {
        // getProfilesBasePath reads the global `location.pathname` (S1) — stub it.
        let origLocation;
        beforeEach(() => {
            origLocation = globalThis.location;
        });
        afterEach(() => {
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: origLocation,
            });
        });
        it("retourne ../profiles/ si pathname contient /demo/", () => {
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: { pathname: "/demo/index.html" },
            });
            expect(_app.getProfilesBasePath()).toBe("../profiles/");
        });
        it("retourne ./profiles/ si pathname ne contient pas /demo/", () => {
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: { pathname: "/" },
            });
            expect(_app.getProfilesBasePath()).toBe("./profiles/");
        });
    });

    // ── checkPlugins ───────────────────────────────────────────────────────
    describe("checkPlugins", () => {
        let warnSpy;
        beforeEach(() => {
            warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        });
        afterEach(() => warnSpy.mockRestore());

        it("warn si modules.storage et GeoLeaf.Storage absent", () => {
            _app.checkPlugins({ modules: { storage: {} } });
            expect(warnSpy).toHaveBeenCalledWith(
                "[GeoLeaf]",
                expect.stringContaining("Storage plugin is not loaded")
            );
        });
        // ⚠️ LE TEST DE LA GARDE `enableServiceWorker` EST RETIRÉ (tâche 3.13), et pas
        // relâché : la garde elle-même l'est. Elle ne s'est jamais déclenchée en production —
        // `grep -rl enableServiceWorker profiles/` rend 0, aucun profil ne pose la clé — et
        // son message était faux deux fois : il citait un `sw.js` disparu et promettait un
        // « background sync » que le worker n'a jamais eu. Un test qui n'atteint son sujet
        // qu'en fabriquant une config qu'aucun profil n'écrit ne garde pas un comportement,
        // il garde une branche.
        //
        // Ce qui reste gardé au-dessus est la vraie garde : `modules.storage` sans le plugin.
        it("un `modules.storage` sans clé connue ne fait plus qu'UN seul avertissement", () => {
            _app.checkPlugins({ modules: { storage: { enableServiceWorker: true } } });
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(
                "[GeoLeaf]",
                expect.stringContaining("Storage plugin is not loaded")
            );
        });
        it("pas de warn si cfg est null", () => {
            _app.checkPlugins(null);
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    // ── showNotification ───────────────────────────────────────────────────
    // S1.4: showNotification now delegates to notifyPrimitive.notify() and always
    // returns true. The guard-chain (UI.Notifications → _UINotifications → Log.debug)
    // has been replaced by the buffering primitive.
    describe("showNotification", () => {
        it("retourne toujours true", () => {
            const spy = vi.spyOn(console, "info").mockImplementation(() => {});
            const result = _app.showNotification("msg");
            expect(result).toBe(true);
            spy.mockRestore();
        });
        it("fallback console.info (pas de renderer enregistré dans les tests)", () => {
            const spy = vi.spyOn(console, "info").mockImplementation(() => {});
            _app.showNotification("hello");
            expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "hello");
            spy.mockRestore();
        });
        it("délègue au renderer si enregistré", async () => {
            const { createNotifyPrimitive } = await import(
                "../../src/utils/notify/notify.primitive.js"
            );
            const p = createNotifyPrimitive();
            const renderer = vi.fn();
            p.registerRenderer(renderer);
            p.notify("direct", "success");
            expect(renderer).toHaveBeenCalledWith("direct", "success");
        });
    });

    // ── _ensureModule (supprimé en S5) ─────────────────────────────────────
    // Le helper avait 0 appelant de production, et les chunks que ces tests lui passaient
    // ("poi", "route") n'existaient déjà plus. Garde anti-résurrection : il ne doit pas
    // revenir par mégarde avec un `GeoLeaf._loadModule` reconstruit à côté.
    it("n'expose plus _app._ensureModule (machinerie lazy purgée en S5)", () => {
        expect(_app._ensureModule).toBeUndefined();
    });
});
