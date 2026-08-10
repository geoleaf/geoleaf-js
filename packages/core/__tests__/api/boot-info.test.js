/**
 */
/* Phase 5.35 - api/boot-info */

import { showBootInfo, BootInfo } from "../../src/kernel/api/boot-info.js";

// `boot-info.ts` logs nothing at import time (imports + function declarations only), so
// the spy being installed after the hoisted import changes nothing: it is in place well
// before any test calls `showBootInfo`.
const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

describe("api/boot-info (Phase 5.35)", () => {
    afterAll(() => {
        consoleSpy.mockRestore();
    });

    beforeEach(() => {
        consoleSpy.mockClear();
    });

    describe("BootInfo export", () => {
        it("exposes show, detectPlugins, buildMessage", () => {
            expect(BootInfo.show).toBe(showBootInfo);
            expect(typeof BootInfo.detectPlugins).toBe("function");
            expect(typeof BootInfo.buildMessage).toBe("function");
        });
    });

    describe("detectPlugins", () => {
        it("returns plugins from registry excluding core", () => {
            const GeoLeaf = { plugins: { getLoadedPlugins: () => ["core", "labels", "route"] } };
            expect(BootInfo.detectPlugins(GeoLeaf)).toEqual(["labels", "route"]);
        });

        it("returns empty when registry returns only core", () => {
            const GeoLeaf = { plugins: { getLoadedPlugins: () => ["core"] } };
            expect(BootInfo.detectPlugins(GeoLeaf)).toEqual([]);
        });

        it("fallback: detects storage (offline) when Storage.DB exists", () => {
            const GeoLeaf = { Storage: { DB: {} } };
            expect(BootInfo.detectPlugins(GeoLeaf)).toContain("storage (offline + IndexedDB)");
        });

        it("fallback: detects storage (cache) when Storage without DB", () => {
            const GeoLeaf = { Storage: {} };
            expect(BootInfo.detectPlugins(GeoLeaf)).toContain("storage (cache)");
        });

        it("fallback: detects labels when Labels.init is function", () => {
            const GeoLeaf = { Labels: { init: () => {} } };
            expect(BootInfo.detectPlugins(GeoLeaf)).toContain("labels");
        });
    });

    describe("buildMessage", () => {
        it("uses _version and returns title with version", () => {
            const GeoLeaf = { _version: "4.1.0", plugins: { getLoadedPlugins: () => [] } };
            const out = BootInfo.buildMessage(GeoLeaf);
            expect(out.title).toBe("GeoLeaf JS 4.1.0");
        });

        it("defaults version to VERSION_FALLBACK when missing", () => {
            const GeoLeaf = { plugins: { getLoadedPlugins: () => [] } };
            const out = BootInfo.buildMessage(GeoLeaf);
            expect(out.title).toContain("3.0.0-dev");
        });

        it("message is open source when no plugins", () => {
            const GeoLeaf = { plugins: { getLoadedPlugins: () => [] } };
            const out = BootInfo.buildMessage(GeoLeaf);
            expect(out.message).toBe("open source");
        });

        // The message used to be split on a hard-coded ["storage", "addpoi"] prefix
        // list that omitted `cog`. There is one class of plugin, so every loaded
        // plugin is listed the same way — cog included — and the toast carries no
        // qualifier in front of the list.
        it("lists every loaded plugin without singling any out", () => {
            const GeoLeaf = {
                plugins: { getLoadedPlugins: () => ["core", "storage", "cog", "print"] },
            };
            const out = BootInfo.buildMessage(GeoLeaf);
            expect(out.message).toBe("storage • cog • print");
        });
    });

    describe("showBootInfo", () => {
        it("returns early when GeoLeaf is null", () => {
            showBootInfo(null);
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it("returns early when debug.showBootInfo is false and force not set", () => {
            const GeoLeaf = {
                Config: { get: () => false },
                _version: "1.2.0",
                plugins: { getLoadedPlugins: () => [] },
            };
            showBootInfo(GeoLeaf);
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it("calls console.info when force is true", () => {
            const GeoLeaf = {
                Config: { get: () => false },
                _version: "1.2.0",
                plugins: { getLoadedPlugins: () => [] },
            };
            showBootInfo(GeoLeaf, { force: true });
            expect(consoleSpy).toHaveBeenCalled();
            expect(consoleSpy.mock.calls[0][0]).toContain("GeoLeaf");
            expect(consoleSpy.mock.calls[0][0]).toContain("1.2.0");
        });

        it("calls console.info when showBootInfo not disabled", () => {
            const GeoLeaf = {
                Config: { get: () => true },
                _version: "1.2.0",
                plugins: { getLoadedPlugins: () => [] },
            };
            showBootInfo(GeoLeaf);
            expect(consoleSpy).toHaveBeenCalled();
        });

        it("includes storage plugin info (with DB) in boot message", () => {
            const GeoLeaf = {
                Config: { get: () => true },
                _version: "4.1.0",
                Storage: { DB: { put: vi.fn() } },
                plugins: { getLoadedPlugins: () => [] },
            };
            showBootInfo(GeoLeaf, { force: true });
            expect(consoleSpy).toHaveBeenCalled();
            const msg = consoleSpy.mock.calls[0][0];
            expect(msg).toContain("4.1.0");
        });

        it("includes storage plugin (without DB) in boot message", () => {
            const GeoLeaf = {
                Config: { get: () => true },
                _version: "4.1.0",
                Storage: {},
                plugins: { getLoadedPlugins: () => [] },
            };
            showBootInfo(GeoLeaf, { force: true });
            expect(consoleSpy).toHaveBeenCalled();
        });

        // This assertion used to check only that the console had been called — it
        // passed whatever the message said, and the registry stub returned [] so no
        // module could have been listed anyway. It now pins the emitted string.
        it("logs the version and the loaded plugins", () => {
            const GeoLeaf = {
                Config: { get: () => true },
                _version: "4.1.0",
                plugins: { getLoadedPlugins: () => ["core", "storage", "print"] },
            };
            showBootInfo(GeoLeaf, { force: true });
            expect(consoleSpy).toHaveBeenCalledWith("[GeoLeaf] GeoLeaf JS 4.1.0 | storage • print");
        });
    });
});
