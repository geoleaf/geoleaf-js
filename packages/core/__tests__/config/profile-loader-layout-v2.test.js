/**
 * Tests pour ProfileLoader — layout profil v2 (Sprint S1 plugin-architecture).
 * Couvre : Files.featuresFile, Files.modules (bag plugins), bundle étendu
 * (features + modules), garde-fou skipBundle (debug) et validation Files.modules.
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

describe("config/profile-loader — layout v2", () => {
    beforeEach(() => {
        mockLog.info.mockClear();
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        fetchJsonMock.mockReset();
    });

    describe("Files.featuresFile", () => {
        test("spreads features file content at the merged profile root", async () => {
            const profile = {
                id: "p1",
                Files: { featuresFile: "config/core/features.json" },
                layers: [],
            };
            const features = {
                clusteringConfig: { enabled: true, strategy: "by-layer" },
            };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("features.json")) return Promise.resolve(features);
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.clusteringConfig).toEqual(features.clusteringConfig);
            expect(fetchJsonMock).toHaveBeenCalledWith(
                expect.stringContaining("config/core/features.json"),
                expect.any(Object)
            );
        });

        test("features file load failure is non-fatal (warn + profile loads)", async () => {
            const profile = {
                id: "p1",
                Files: { featuresFile: "config/core/features.json" },
                layers: [],
            };
            fetchJsonMock.mockRejectedValue(new Error("404"));

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result._profileId).toBe("p1");
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe("Files.modules (plugin config bag)", () => {
        test("fetches each declared file and builds the modules bag", async () => {
            const profile = {
                id: "p1",
                Files: {
                    modules: {
                        storage: "config/plugins/storage.json",
                        addpoi: "config/plugins/addpoi.json",
                    },
                },
                layers: [],
            };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("storage.json")) return Promise.resolve({ cache: true });
                if (url.includes("addpoi.json")) return Promise.resolve({ enabled: true });
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.modules).toEqual({
                storage: { cache: true },
                addpoi: { enabled: true },
            });
        });

        test("inline modules block overrides the file content per module (deepMerge)", async () => {
            const profile = {
                id: "p1",
                Files: { modules: { storage: "config/plugins/storage.json" } },
                modules: { storage: { cache: { ttl: 99 } }, print: { format: "A4" } },
                layers: [],
            };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("storage.json")) {
                    return Promise.resolve({ cache: { ttl: 10, enabled: true }, quota: 50 });
                }
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            // File values kept, inline wins on conflicts, inline-only modules kept.
            expect(result.modules.storage).toEqual({
                cache: { ttl: 99, enabled: true },
                quota: 50,
            });
            expect(result.modules.print).toEqual({ format: "A4" });
        });

        test("module file fetch failure warns and skips the entry", async () => {
            const profile = {
                id: "p1",
                Files: {
                    modules: {
                        storage: "config/plugins/storage.json",
                        addpoi: "config/plugins/addpoi.json",
                    },
                },
                layers: [],
            };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("storage.json")) return Promise.reject(new Error("404"));
                if (url.includes("addpoi.json")) return Promise.resolve({ enabled: true });
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.modules).toEqual({ addpoi: { enabled: true } });
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Files.modules.storage"),
                expect.any(Error)
            );
        });

        test("no Files.modules and no inline modules -> modules stays undefined", async () => {
            const profile = { id: "p1", Files: {}, layers: [] };
            fetchJsonMock.mockResolvedValue(null);

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.modules).toBeUndefined();
        });
    });

    describe("bundle étendu (features + modules)", () => {
        test("spreads bundle.features and merges bundle.modules with inline override", async () => {
            const bundle = {
                themes: null,
                layersFile: { layers: [] },
                layerConfigs: {},
                features: { clusteringConfig: { enabled: true } },
                modules: { storage: { cache: { ttl: 10 } } },
            };
            fetchJsonMock.mockResolvedValue(bundle);

            const profile = {
                id: "p1",
                bundleFile: "profile-bundle.json",
                modules: { storage: { cache: { ttl: 99 } } },
                layers: [],
            };
            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(fetchJsonMock).toHaveBeenCalledTimes(1);
            expect(result.clusteringConfig).toEqual({ enabled: true });
            expect(result.modules.storage).toEqual({ cache: { ttl: 99 } });
        });
    });

    describe("skipBundle (mode debug)", () => {
        test("ignores bundleFile and loads the cascade when skipBundle is true", async () => {
            const profile = {
                id: "p1",
                bundleFile: "profile-bundle.json",
                Files: { themesFile: "config/core/themes.json" },
                layers: [],
            };
            const themes = { default: { primary: "#f00" } };
            fetchJsonMock.mockImplementation((url) => {
                if (url.includes("themes.json")) return Promise.resolve(themes);
                return Promise.resolve(null);
            });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1",
                0,
                {},
                true
            );
            expect(result.themes).toEqual(themes);
            expect(fetchJsonMock).not.toHaveBeenCalledWith(
                expect.stringContaining("profile-bundle.json"),
                expect.any(Object)
            );
        });
    });

    describe("validation Files.modules", () => {
        test("warns when Files.modules is not an object", async () => {
            const profile = { id: "p1", Files: { modules: "storage.json" }, layers: [] };
            fetchJsonMock.mockResolvedValue(null);

            await ProfileLoader.loadModularProfile(profile, "data/profiles/p1", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Files.modules should be an object")
            );
        });

        test("warns when a Files.modules entry is not a string", async () => {
            const profile = { id: "p1", Files: { modules: { storage: 42 } }, layers: [] };
            fetchJsonMock.mockResolvedValue(null);

            await ProfileLoader.loadModularProfile(profile, "data/profiles/p1", "p1");
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Files.modules.storage should be a string")
            );
        });
    });

    describe("retrait des fallbacks top-level (layout v2 big-bang)", () => {
        test("top-level themesFile outside Files is ignored", async () => {
            const profile = {
                id: "p1",
                themesFile: "themes.json",
                Files: {},
                layers: [],
            };
            fetchJsonMock.mockResolvedValue({ default: {} });

            const result = await ProfileLoader.loadModularProfile(
                profile,
                "data/profiles/p1",
                "p1"
            );
            expect(result.themes).toBeUndefined();
            expect(fetchJsonMock).not.toHaveBeenCalled();
        });
    });
});
