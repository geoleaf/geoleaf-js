/**
 * Phase 60 — Step 2.5: src/kernel/api/initialization-manager.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIInitializationManager } from "../../src/kernel/api/initialization-manager.js";

describe("api/initialization-manager (step 2.5)", () => {
    let manager;

    beforeEach(() => {
        manager = new APIInitializationManager();
    });

    it("instancie avec isReady et stats", () => {
        expect(manager.isReady).toBe(true);
        expect(manager.stats.initCalls).toBe(0);
        expect(manager.stats.configLoads).toBe(0);
    });

    it("init exige options object et getModule function", () => {
        expect(() => manager.init(null, () => ({}))).toThrow();
        expect(() => manager.init({}, null)).toThrow();
    });

    it("init exige Core with init", () => {
        const getModule = vi.fn().mockReturnValue(null);
        expect(() => manager.init({}, getModule)).toThrow(/Core/);
        getModule.mockReturnValue({});
        expect(() => manager.init({}, getModule)).toThrow(/Core/);
    });

    it("init calls Core.init with normalized options", () => {
        const coreInit = vi.fn().mockReturnValue({ map: true });
        const getModule = (name) => (name === "Core" ? { init: coreInit } : null);
        const result = manager.init({ target: "#map" }, getModule);
        expect(result).toEqual({ map: true });
        expect(coreInit).toHaveBeenCalled();
        expect(manager.stats.initCalls).toBe(1);
    });

    it("setTheme exige theme string et getModule", () => {
        expect(manager.setTheme("", () => ({}))).toBe(false);
        expect(manager.setTheme("dark", null)).toBe(false);
    });

    it("setTheme exige UI avec applyTheme ou setTheme", () => {
        const getModule = (name) => (name === "UI" ? null : null);
        expect(manager.setTheme("dark", getModule)).toBe(false);
        const getModuleNoTheme = (name) => (name === "UI" ? {} : null);
        expect(manager.setTheme("dark", getModuleNoTheme)).toBe(false);
    });

    it("setTheme calls UI.applyTheme if present", () => {
        const applyTheme = vi.fn().mockReturnValue(true);
        const getModule = (name) => (name === "UI" ? { applyTheme } : null);
        expect(manager.setTheme("dark", getModule)).toBe(true);
        expect(applyTheme).toHaveBeenCalledWith("dark");
    });

    it("loadConfig exige input et getModule", async () => {
        await expect(manager.loadConfig(null, () => ({}))).rejects.toThrow();
        await expect(manager.loadConfig("url", null)).rejects.toThrow();
    });

    it("loadConfig exige Config with init", async () => {
        const getModule = (name) => (name === "Config" ? null : null);
        await expect(manager.loadConfig("url", getModule)).rejects.toThrow(/Config/);
    });
});

// ── T22 — initialization-manager.ts branch coverage ─────────────────────────
describe("api/initialization-manager — T22 branch coverage", () => {
    let manager;

    beforeEach(() => {
        manager = new APIInitializationManager();
    });

    it("setTheme uses UI.setTheme when applyTheme absent", () => {
        const setTheme = vi.fn().mockReturnValue(true);
        const getModule = (n) => (n === "UI" ? { setTheme } : null);
        expect(manager.setTheme("dark", getModule)).toBe(true);
        expect(setTheme).toHaveBeenCalledWith("dark");
    });

    it("setTheme uses UI.theme() when applyTheme and setTheme absent", () => {
        const theme = vi.fn().mockReturnValue(true);
        const getModule = (n) => (n === "UI" ? { theme } : null);
        expect(manager.setTheme("dark", getModule)).toBe(true);
        expect(theme).toHaveBeenCalledWith("dark");
    });

    it("setTheme returns false when UI has no theme methods", () => {
        const getModule = (n) => (n === "UI" ? {} : null);
        expect(manager.setTheme("dark", getModule)).toBe(false);
    });

    it("init with options.map object uses mapOpts.target/center/zoom directly", () => {
        const coreInit = vi.fn().mockReturnValue({ ok: true });
        const getModule = (n) => (n === "Core" ? { init: coreInit } : null);
        const result = manager.init(
            { map: { target: "#map", center: [48, 2], zoom: 10 } },
            getModule
        );
        expect(result).toEqual({ ok: true });
        const opts = coreInit.mock.calls[0][0];
        expect(opts.center).toEqual([48, 2]);
        expect(opts.zoom).toBe(10);
    });

    it("init throws when no target found in options", () => {
        const coreInit = vi.fn().mockReturnValue({});
        const getModule = (n) => (n === "Core" ? { init: coreInit } : null);
        expect(() => manager.init({}, getModule)).toThrow(/target/);
    });

    it("loadConfig with string URL resolves config", async () => {
        const configInit = vi.fn().mockResolvedValue({ data: [] });
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        const result = await manager.loadConfig("https://example.com/config.json", getModule);
        expect(result).toEqual({ data: [] });
        expect(configInit).toHaveBeenCalledWith(
            expect.objectContaining({ source: "url", url: "https://example.com/config.json" })
        );
    });

    it("loadConfig with object input (no url) uses data source", async () => {
        const configInit = vi.fn().mockResolvedValue({ ok: true });
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        await manager.loadConfig({ data: { profiles: [] } }, getModule);
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ source: "data" }));
    });

    it("loadConfig with object input (url present) uses url source", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        await manager.loadConfig({ url: "https://example.com/p.json" }, getModule);
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ source: "url" }));
    });

    it("loadConfig with autoEvent: false preserves autoEvent false", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        await manager.loadConfig({ data: {}, autoEvent: false }, getModule);
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ autoEvent: false }));
    });

    it("loadConfig cancels previous pendingPromise when one exists", async () => {
        manager.pendingPromise = new Promise(() => {}); // never resolves
        const configInit = vi.fn().mockResolvedValue({ fresh: true });
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        const result = await manager.loadConfig("url", getModule);
        expect(result).toEqual({ fresh: true });
    });

    it("loadConfig with non-string non-object input throws", async () => {
        const configInit = vi.fn();
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);
        await expect(manager.loadConfig(42, getModule)).rejects.toThrow();
    });

    it("reset with pendingPromise sets cancelled=true and clears state", () => {
        manager.pendingPromise = new Promise(() => {});
        manager.stats.initCalls = 5;
        manager.reset();
        expect(manager.pendingPromise).toBeNull();
        expect(manager.stats.initCalls).toBe(0);
    });

    it("reset without pendingPromise still clears stats", () => {
        manager.stats.configLoads = 3;
        manager.reset();
        expect(manager.stats.configLoads).toBe(0);
        expect(manager.pendingPromise).toBeNull();
    });

    it("getStats returns hasPendingRequest true when pendingPromise exists", () => {
        manager.pendingPromise = new Promise(() => {});
        const stats = manager.getStats();
        expect(stats.hasPendingRequest).toBe(true);
        expect(stats.isReady).toBe(true);
    });

    it("getStats returns hasPendingRequest false when no pendingPromise", () => {
        const stats = manager.getStats();
        expect(stats.hasPendingRequest).toBe(false);
    });
});
