/**
 */
/* Phase 5.30 - theme-loader */

vi.mock("../../src/utils/log/index.js", () => ({ Log: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock("../../src/utils/general/fetch-helper.js", () => ({
    FetchHelper: {
        get: vi.fn(() => Promise.resolve({ themes: [{ id: "light", label: "Light" }] })),
    },
}));
import { ThemeLoader } from "../../src/kernel/themes/theme-loader.js";
import { FetchHelper } from "../../src/utils/general/fetch-helper.js";

describe("themes/theme-loader (Phase 5.30)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ThemeLoader.clearCache();
    });

    it("loadThemesConfig returns a Promise", () => {
        const p = ThemeLoader.loadThemesConfig("profile1");
        expect(p).toBeInstanceOf(Promise);
    });

    it("loadThemesConfig returns cached config on second call", async () => {
        const config = { themes: [{ id: "light", label: "Light" }] };
        FetchHelper.get.mockResolvedValue(config);
        const first = await ThemeLoader.loadThemesConfig("p2");
        expect(first).toHaveProperty("themes");
        const second = await ThemeLoader.loadThemesConfig("p2");
        expect(second).toEqual(first);
        expect(FetchHelper.get).toHaveBeenCalledTimes(1);
    });

    it("_validateConfig throws for non-object config", () => {
        expect(() => ThemeLoader._validateConfig(null)).toThrow("Invalid theme configuration");
    });

    it("_validateConfig returns default config when themes missing", () => {
        const cfg = ThemeLoader._validateConfig({ config: {} });
        expect(Array.isArray(cfg.themes)).toBe(true);
        expect(cfg.themes.length).toBe(0);
    });

    it("_validateConfig filters out themes without id and normalizes defaultTheme", () => {
        const cfg = ThemeLoader._validateConfig({
            config: {},
            themes: [{ label: "no-id" }, { id: "ok", label: "OK" }],
            defaultTheme: "missing",
        });
        expect(cfg.themes.length).toBe(1);
        expect(cfg.themes[0].id).toBe("ok");
        expect(cfg.defaultTheme).toBe("ok");
    });

    it("clearCache removes cached entry for a profile", async () => {
        FetchHelper.get.mockResolvedValue({ themes: [{ id: "light", label: "Light" }] });
        await ThemeLoader.loadThemesConfig("p3");
        ThemeLoader.clearCache("p3");
        const second = await ThemeLoader.loadThemesConfig("p3");
        expect(second).toHaveProperty("themes");
    });

    it("clearCache with no profileId clears all caches", async () => {
        FetchHelper.get.mockResolvedValue({ themes: [{ id: "t1", label: "T1" }] });
        await ThemeLoader.loadThemesConfig("pa");
        await ThemeLoader.loadThemesConfig("pb");
        ThemeLoader.clearCache();
        FetchHelper.get.mockClear();
        FetchHelper.get.mockResolvedValue({ themes: [{ id: "t2", label: "T2" }] });
        const a = await ThemeLoader.loadThemesConfig("pa");
        const b = await ThemeLoader.loadThemesConfig("pb");
        expect(FetchHelper.get).toHaveBeenCalledTimes(2);
        expect(a.themes[0].id).toBe("t2");
        expect(b.themes[0].id).toBe("t2");
    });

    it("loadThemesConfig returns same promise when load already in progress", async () => {
        let resolveFirst;
        const firstPromise = new Promise((r) => {
            resolveFirst = r;
        });
        FetchHelper.get.mockReturnValue(firstPromise);
        const p1 = ThemeLoader.loadThemesConfig("p-concurrent");
        const p2 = ThemeLoader.loadThemesConfig("p-concurrent");
        expect(p1).toBe(p2);
        resolveFirst({ themes: [{ id: "c", label: "C" }] });
        const result = await p1;
        expect(result.themes[0].id).toBe("c");
    });

    it("loadThemesConfig catch path on fetch failure", async () => {
        FetchHelper.get.mockRejectedValue(new Error("network error"));
        await expect(ThemeLoader.loadThemesConfig("p-fail")).rejects.toThrow("network error");
    });

    it("_validateConfig with defaultTheme that does not exist uses first theme", () => {
        const cfg = ThemeLoader._validateConfig({
            themes: [{ id: "a" }, { id: "b" }],
            defaultTheme: "nonexistent",
        });
        expect(cfg.defaultTheme).toBe("a");
    });

    it("_validateConfig with no defaultTheme uses first theme", () => {
        const cfg = ThemeLoader._validateConfig({
            themes: [{ id: "first" }, { id: "second" }],
        });
        expect(cfg.defaultTheme).toBe("first");
    });

    it("_validateConfig uses theme.layers array when provided", () => {
        const cfg = ThemeLoader._validateConfig({
            themes: [{ id: "t1", layers: ["layer-a", "layer-b"] }],
        });
        expect(Array.isArray(cfg.themes[0].layers)).toBe(true);
        expect(cfg.themes[0].layers).toHaveLength(2);
    });

    it("_validateConfig falls back to empty layers array when layers is not an array", () => {
        const cfg = ThemeLoader._validateConfig({
            themes: [{ id: "t2", layers: "not-an-array" }],
        });
        expect(cfg.themes[0].layers).toEqual([]);
    });

    it("_validateConfig throws when all themes are invalid (empty after filter)", () => {
        expect(() =>
            ThemeLoader._validateConfig({
                themes: [null, undefined, false],
            })
        ).toThrow();
    });

    it("loadThemesConfig uses demo basePath when pathname includes /demo/", async () => {
        Object.defineProperty(window, "location", {
            value: { pathname: "/demo/index.html", search: "" },
            writable: true,
        });
        FetchHelper.get.mockResolvedValueOnce({ themes: [{ id: "light" }] });
        await ThemeLoader.loadThemesConfig("p-demo");
        expect(FetchHelper.get).toHaveBeenCalledWith(
            expect.stringContaining("../profiles/p-demo/themes.json"),
            expect.any(Object)
        );
    });
});
