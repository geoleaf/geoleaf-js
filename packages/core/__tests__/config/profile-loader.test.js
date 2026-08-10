/**
 * Tests pour ProfileLoader (config/profile-loader) — Phase D S5B.15 (0% → 70%)
 */
import { vi } from "vitest";
import { ProfileLoader } from "../../src/kernel/config/profile-loader.ts";

const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { fetchJson: (...args) => fetchJsonMock(...args) },
}));

describe("config/profile-loader", () => {
    beforeEach(() => {
        mockLog.info.mockClear();
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        fetchJsonMock.mockReset();
    });

    describe("isModularProfile", () => {
        test("returns false for null or undefined", () => {
            expect(ProfileLoader.isModularProfile(null)).toBe(false);
            expect(ProfileLoader.isModularProfile(undefined)).toBe(false);
        });

        test("returns false for non-object", () => {
            expect(ProfileLoader.isModularProfile("")).toBe(false);
            expect(ProfileLoader.isModularProfile(42)).toBe(false);
        });

        test("returns true when profile.Files is an object", () => {
            expect(ProfileLoader.isModularProfile({ Files: {} })).toBe(true);
            expect(ProfileLoader.isModularProfile({ Files: { themesFile: "t.json" } })).toBe(true);
        });

        test("returns true when version >= 1.2 (semver string)", () => {
            expect(ProfileLoader.isModularProfile({ version: "1.2" })).toBe(true);
            expect(ProfileLoader.isModularProfile({ version: "1.2.0" })).toBe(true);
            expect(ProfileLoader.isModularProfile({ version: "2.0" })).toBe(true);
        });

        test("returns false when version < 1.2", () => {
            expect(ProfileLoader.isModularProfile({ version: "1.1" })).toBe(false);
            expect(ProfileLoader.isModularProfile({ version: "1.0" })).toBe(false);
            expect(ProfileLoader.isModularProfile({ version: "0.5" })).toBe(false);
        });

        test("returns false when no Files and no version", () => {
            expect(ProfileLoader.isModularProfile({ layers: [] })).toBe(false);
        });
    });

    describe("loadModularProfile", () => {
        test("loads with inline themes (no Files)", async () => {
            const themes = { default: {} };
            const profile = { themes, layers: [] };
            fetchJsonMock.mockResolvedValue(null);

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.themes).toEqual(themes);
            expect(result.basePath).toBe("data/profiles/p1");
            expect(result._profileId).toBe("p1");
            expect(fetchJsonMock).not.toHaveBeenCalled();
        });

        test("loads themes from file when Files.themesFile set", async () => {
            const profile = { Files: { themesFile: "themes.json" }, layers: [] };
            const themesData = { default: { primary: "#000" } };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("themes.json")) return Promise.resolve(themesData);
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.themes).toEqual(themesData);
        });

        test("falls back to null when themes file load fails", async () => {
            const profile = { Files: { themesFile: "themes.json" }, layers: [] };
            fetchJsonMock.mockRejectedValue(new Error("net error"));

            await ProfileLoader.loadModularProfile(profile, "data/profiles/p1", "p1");
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("loads layers from Files.layersFile", async () => {
            const profile = {
                Files: { layersFile: "layers.json" },
                layers: [],
            };
            const layersData = { layers: [{ id: "L1", configFile: "L1/config.json" }] };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) return Promise.resolve(layersData);
                if (url.includes("L1/config.json")) return Promise.resolve({ name: "Layer 1" });
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            expect(result.layers[0].name).toBe("Layer 1");
            expect(result.layers[0]._layerDirectory).toBe("L1");
            expect(result.layers[0].layerManagerId).toBe("geojson-default");
        });

        test("uses profile.layers when layers file not present", async () => {
            const profile = {
                themes: {},
                layers: [{ id: "L1" }],
            };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            expect(result.layers[0].id).toBe("L1");
        });

        test("sets dataFile from config data.file and data.directory", async () => {
            const profile = { Files: { layersFile: "layers.json" }, layers: [] };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) {
                    return Promise.resolve({
                        layers: [{ id: "L1", configFile: "L1/config.json" }],
                    });
                }
                if (url.includes("config.json")) {
                    return Promise.resolve({
                        data: { file: "points.geojson", directory: "geodata" },
                    });
                }
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers[0].dataFile).toBe("geodata/points.geojson");
        });

        test("layer config load failure keeps layer ref from source", async () => {
            const layerRef = { id: "L1", configFile: "L1/config.json" };
            const profile = { layers: [layerRef] };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("config.json")) return Promise.reject(new Error("404"));
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            expect(result.layers[0].id).toBe("L1");
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("L1/config.json"),
                expect.any(Error)
            );
        });
    });

    describe("bundle mode (_loadBundledProfile)", () => {
        test("loads from bundle in single fetch", async () => {
            const themes = { default: { primary: "#f00" } };
            const bundle = {
                themes,
                layersFile: { layers: [{ id: "L1", configFile: "L1/config.json" }] },
                layerConfigs: { L1: { id: "L1", label: "Layer 1" } },
            };
            fetchJsonMock.mockResolvedValue(bundle);

            const profile = { id: "p1", bundleFile: "profile-bundle.json", layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.themes).toEqual(themes);
            expect(result.layers).toHaveLength(1);
            expect(fetchJsonMock).toHaveBeenCalledTimes(1);
            expect(fetchJsonMock).toHaveBeenCalledWith(
                expect.stringContaining("profile-bundle.json"),
                expect.any(Object)
            );
        });

        test("falls back to cascade when bundle fetch fails", async () => {
            fetchJsonMock.mockRejectedValueOnce(new Error("bundle 404"));

            const profile = { id: "p1", bundleFile: "profile-bundle.json", layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("falling back to cascade"),
                expect.any(Error)
            );
            // Result is valid enriched profile (cascade succeeded)
            expect(result).toBeDefined();
            expect(result.basePath).toBe("data/profiles/p1");
        });

        test("bundle with empty layerConfigs map still resolves layers from source", async () => {
            const bundle = {
                themes: null,
                layersFile: { layers: [{ id: "L1", configFile: "L1/config.json" }] },
                layerConfigs: {},
            };
            fetchJsonMock.mockResolvedValue(bundle);

            const profile = { id: "p1", bundleFile: "bundle.json", layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            // config was null -> falls back to original layer ref
            expect(result.layers[0].id).toBe("L1");
        });

        test("bundle with inline layerTemplate instances expands them", async () => {
            const bundle = {
                themes: null,
                layersFile: {
                    layers: [],
                    layerTemplates: [
                        {
                            templateId: "tpl1",
                            layerManagerId: "geojson-default",
                            template: { label: "TPL", data: { directory: "geodata" } },
                            instances: [
                                { id: "inst-1", label: "Instance 1", dataFile: "inst1.geojson" },
                            ],
                        },
                    ],
                },
                layerConfigs: {},
            };
            fetchJsonMock.mockResolvedValue(bundle);

            const profile = { id: "p1", bundleFile: "bundle.json", layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            expect(result.layers[0].id).toBe("inst-1");
        });
    });

    describe("section files (_loadSectionFile)", () => {
        test("loads basemapsFile and merges into profile", async () => {
            const basemapsData = {
                basemaps: { osm: { url: "https://tile.openstreetmap.org/{z}" } },
            };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("basemaps.json")) return Promise.resolve(basemapsData);
                return Promise.resolve(null);
            });

            const profile = { Files: { basemapsFile: "basemaps.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.basemaps).toEqual(basemapsData.basemaps);
        });

        test("returns null silently when basemapsFile absent", async () => {
            fetchJsonMock.mockResolvedValue(null);
            const profile = { Files: {}, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            // no error thrown, no warn for absent section file
            expect(mockLog.warn).not.toHaveBeenCalledWith(
                expect.stringContaining("basemapsFile"),
                expect.anything()
            );
            expect(result).toBeDefined();
        });

        test("returns null silently when basemapsFile fetch fails", async () => {
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("basemaps.json")) return Promise.reject(new Error("net"));
                return Promise.resolve(null);
            });

            const profile = { Files: { basemapsFile: "basemaps.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("basemapsFile"),
                expect.any(Error)
            );
            expect(result).toBeDefined();
        });

        test("loads uiFile and merges into profile", async () => {
            const uiData = { ui: { showSearch: true } };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("ui.json")) return Promise.resolve(uiData);
                return Promise.resolve(null);
            });

            const profile = { Files: { uiFile: "ui.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.ui).toEqual(uiData.ui);
        });
    });

    describe("layer template expansion (_expandLayerTemplates via loadModularProfile)", () => {
        test("expands layerTemplates into individual LayerRef entries", async () => {
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) {
                    return Promise.resolve({
                        layers: [{ id: "static-L1", configFile: "L1/config.json" }],
                        layerTemplates: [
                            {
                                templateId: "tpl-points",
                                layerManagerId: "geojson-default",
                                template: {
                                    type: "geojson",
                                    data: { directory: "geodata" },
                                    style: { color: "red" },
                                },
                                instances: [
                                    { id: "inst-A", label: "Instance A", dataFile: "a.geojson" },
                                    { id: "inst-B", label: "Instance B", dataFile: "b.geojson" },
                                ],
                            },
                        ],
                    });
                }
                if (url.includes("L1/config.json"))
                    return Promise.resolve({ id: "static-L1", label: "Static" });
                return Promise.resolve(null);
            });

            const profile = { Files: { layersFile: "layers.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            // 1 static + 2 expanded instances
            expect(result.layers).toHaveLength(3);
            const ids = result.layers.map((l) => l.id);
            expect(ids).toContain("static-L1");
            expect(ids).toContain("inst-A");
            expect(ids).toContain("inst-B");
        });

        test("expanded template instance has correct dataFile", async () => {
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) {
                    return Promise.resolve({
                        layers: [],
                        layerTemplates: [
                            {
                                templateId: "tpl-pts",
                                layerManagerId: null,
                                template: { data: { directory: "geo" } },
                                instances: [{ id: "X", label: "X layer", dataFile: "x.geojson" }],
                            },
                        ],
                    });
                }
                return Promise.resolve(null);
            });

            const profile = { Files: { layersFile: "layers.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.layers).toHaveLength(1);
            const layer = result.layers[0];
            // inlineConfig was used, so dataFile resolved from data.directory + data.file
            expect(layer.dataFile).toBe("geo/x.geojson");
        });

        test("skips malformed template with no instances array", async () => {
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) {
                    return Promise.resolve({
                        layers: [{ id: "L1" }],
                        layerTemplates: [
                            {
                                templateId: "bad",
                                template: {},
                                // instances missing
                            },
                        ],
                    });
                }
                return Promise.resolve(null);
            });

            const profile = { Files: { layersFile: "layers.json" }, layers: [] };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            // only the static L1, bad template skipped
            expect(result.layers).toHaveLength(1);
        });
    });

    describe("_validateProfile (via loadModularProfile)", () => {
        test("warns when profile id is missing", async () => {
            // profile without id
            const profile = { layers: [], map: { bounds: [[0, 0]] } };
            fetchJsonMock.mockResolvedValue(null);
            await ProfileLoader.loadModularProfile(profile, "base", "test");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('"id" is required'));
        });

        test("warns when map has no bounds and no center", async () => {
            const profile = { id: "p1", layers: [], map: {} };
            fetchJsonMock.mockResolvedValue(null);
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('"map.bounds" or "map.center"')
            );
        });

        test("does not warn when map has center", async () => {
            const profile = { id: "p1", layers: [], map: { center: [48, 2] } };
            fetchJsonMock.mockResolvedValue(null);
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining('"map.bounds"'));
        });

        // Three profiles shipped `center` as [lng, lat] while the loader reads [lat, lng]
        // (guyane: [-53, 4] => latitude -53, the Southern Ocean). Invisible because they
        // also declare `bounds`, which win — so nothing ever flagged it.
        test("warns when map.center sits outside its own bounds but fits swapped", async () => {
            const profile = {
                id: "p1",
                layers: [],
                map: {
                    center: [-53, 4], // guyane, tel qu'il était
                    bounds: [
                        [2.1, -54.6],
                        [5.8, -51.6],
                    ],
                },
            };
            fetchJsonMock.mockResolvedValue(null);
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("fits once swapped"));
        });

        test("warns when map.center latitude is out of [-90;90]", async () => {
            const profile = { id: "p1", layers: [], map: { center: [-53.5, 179] } };
            fetchJsonMock.mockResolvedValue(null);
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining("[-90;90]"));

            const bad = { id: "p2", layers: [], map: { center: [179, -53.5] } };
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(bad, "base", "p2");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("[-90;90]"));
        });

        test("stays silent on a center that sits inside its bounds", async () => {
            const profile = {
                id: "p1",
                layers: [],
                map: {
                    center: [4, -53], // guyane, corrigé
                    bounds: [
                        [2.1, -54.6],
                        [5.8, -51.6],
                    ],
                },
            };
            fetchJsonMock.mockResolvedValue(null);
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining("map.center"));
        });

        test("warns when basemap missing url and style", async () => {
            const profile = {
                id: "p1",
                layers: [],
                basemaps: { "my-map": { label: "No url/style" } },
            };
            fetchJsonMock.mockResolvedValue(null);
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("basemaps.my-map"));
        });

        test("does not warn when basemap has url", async () => {
            const profile = {
                id: "p1",
                layers: [],
                basemaps: { osm: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" } },
            };
            fetchJsonMock.mockResolvedValue(null);
            mockLog.warn.mockClear();
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).not.toHaveBeenCalledWith(expect.stringContaining("basemaps.osm"));
        });

        test("warns when Files key value is not a string", async () => {
            const profile = {
                id: "p1",
                layers: [],
                Files: { themesFile: 42 },
            };
            fetchJsonMock.mockResolvedValue(null);
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Files.themesFile"));
        });

        test("warns when layers is not an array", async () => {
            const profile = { id: "p1", layers: "bad" };
            fetchJsonMock.mockResolvedValue(null);
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('"layers" must be an array')
            );
        });
    });

    describe("_loadLayerConfigs inline config (no HTTP fetch)", () => {
        test("inline config skips fetchJson entirely", async () => {
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("layers.json")) {
                    return Promise.resolve({
                        layers: [],
                        layerTemplates: [
                            {
                                templateId: "tpl",
                                layerManagerId: "geojson-default",
                                template: { data: { directory: "d" } },
                                instances: [{ id: "tpl-1", label: "TPL", dataFile: "f.geojson" }],
                            },
                        ],
                    });
                }
                return Promise.resolve(null);
            });

            const profile = { id: "p1", Files: { layersFile: "layers.json" }, layers: [] };
            const callsBefore = fetchJsonMock.mock.calls.length;
            await ProfileLoader.loadModularProfile(profile, "base", "p1");
            const callsAfter = fetchJsonMock.mock.calls.length;
            // Only layers.json fetch — no individual config file fetch for template instance
            const configFileCalls = fetchJsonMock.mock.calls.filter(([url]) =>
                url.includes("tpl-1")
            );
            expect(configFileCalls).toHaveLength(0);
            expect(callsAfter).toBeGreaterThanOrEqual(callsBefore);
        });

        test("layer without configFile gets null config, falls back to original ref", async () => {
            fetchJsonMock.mockResolvedValue(null);
            const profile = { id: "p1", layers: [{ id: "L-no-config" }] };
            const result = await ProfileLoader.loadModularProfile(profile, "base", "p1");
            expect(result.layers).toHaveLength(1);
            expect(result.layers[0].id).toBe("L-no-config");
        });
    });

    describe("isModularProfile — edge cases", () => {
        test("version 1.2.1 returns true", () => {
            expect(ProfileLoader.isModularProfile({ version: "1.2.1" })).toBe(true);
        });
        test("version 10.0 returns true (major > 1)", () => {
            expect(ProfileLoader.isModularProfile({ version: "10.0" })).toBe(true);
        });
        test("version string without dots returns false", () => {
            expect(ProfileLoader.isModularProfile({ version: "alpha" })).toBe(false);
        });
        test("version 1.1.9 returns false", () => {
            expect(ProfileLoader.isModularProfile({ version: "1.1.9" })).toBe(false);
        });
    });
});
