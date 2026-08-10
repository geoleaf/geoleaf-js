/**
 */
/* Sprint 5b — modules/loaders/style-loader.ts */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/validators/style-validator.js", () => ({
    StyleValidator: {
        validateStyle: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
        formatValidationErrors: vi.fn(() => ""),
    },
}));

let StyleLoader;
let StyleValidatorMock;

beforeAll(async () => {
    const m = await import("../../src/utils/loaders/style-loader.ts");
    StyleLoader = m.StyleLoader;
    const v = await import("../../src/utils/validators/style-validator.js");
    StyleValidatorMock = v.StyleValidator;
});

beforeEach(() => {
    globalThis.GeoLeaf = { Config: { get: vi.fn(() => "profiles") } };
    globalThis.fetch = vi.fn();
});

describe("loaders/style-loader", () => {
    describe("clearStyleCache", () => {
        it("clears cache without throwing", () => {
            expect(() => StyleLoader.clearStyleCache()).not.toThrow();
        });
    });

    describe("extractLabelConfig", () => {
        it("returns null for null or non-object", () => {
            expect(StyleLoader.extractLabelConfig(null)).toBeNull();
            expect(StyleLoader.extractLabelConfig(undefined)).toBeNull();
        });

        it("returns null when label.enabled is not true", () => {
            expect(StyleLoader.extractLabelConfig({ label: { enabled: false } })).toBeNull();
        });

        it("returns label config when label.enabled is true", () => {
            const styleData = { label: { enabled: true, field: "name" } };
            const result = StyleLoader.extractLabelConfig(styleData);
            expect(result).toEqual(
                expect.objectContaining({ enabled: true, field: "name", isIntegrated: true })
            );
        });
    });

    describe("loadAndValidateStyle", () => {
        it("returns cached result when key in cache and not debug", async () => {
            StyleLoader.clearStyleCache();
            const cached = { styleData: { id: "s1" }, labelConfig: null };
            StyleLoader.styleCache.set("p:l:s", cached);
            const result = await StyleLoader.loadAndValidateStyle(
                "p",
                "l",
                "s",
                "default.json",
                "layers/l"
            );
            expect(result).toEqual(cached);
        });

        it("fetches and returns style when not in cache", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { id: "default", label: { enabled: false } };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(styleData) })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "profile1",
                "layer1",
                "s1",
                "default.json",
                "layers/l1"
            );
            expect(result.styleData).toEqual(styleData);
            expect(result.labelConfig).toBeNull();
            expect(result.metadata.profileId).toBe("profile1");
            expect(result.metadata.layerId).toBe("layer1");
        });

        // The schema documents "filename acts as id for ~20% of style files", but nothing
        // performed that derivation while the validator still required `id` — so 15 real
        // styles were rejected and their layers never loaded (guyane 9,
        // france-risques-inondation 5, france-rail 1).
        it("derives a missing id from the styleId (file name) instead of rejecting", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { style: { fillColor: "#fff" } }; // pas d'`id`, comme guyane
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(styleData) })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "guyane-biodiversite",
                "cours_eau",
                "defaut",
                "defaut.json",
                "layers/cours_eau"
            );
            expect(result.styleData.id).toBe("defaut");
        });

        it("does not overwrite an id the style already declares", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: "explicite", style: {} }),
                })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "p",
                "l",
                "defaut",
                "defaut.json",
                "layers/l"
            );
            expect(result.styleData.id).toBe("explicite");
        });
    });

    describe("clearStyleCache", () => {
        it("deletes single key when cacheKey provided", () => {
            StyleLoader.clearStyleCache();
            StyleLoader.styleCache.set("a:b:c", {});
            StyleLoader.clearStyleCache("a:b:c");
            expect(StyleLoader.styleCache.has("a:b:c")).toBe(false);
        });
    });
});

// ── T22 — style-loader.ts branch coverage ───────────────────────────────────
describe("loaders/style-loader — T22 branch coverage", () => {
    beforeEach(() => {
        globalThis.GeoLeaf = { Config: { get: vi.fn(() => "profiles") } };
        globalThis.fetch = vi.fn();
    });

    describe("getProfilesBasePath branches", () => {
        it("uses configured path when cfg.get returns non-empty string", async () => {
            globalThis.GeoLeaf = { Config: { get: vi.fn(() => "custom/path") } };
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { id: "x" };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(styleData) })
            );
            await StyleLoader.loadAndValidateStyle("p", "l", "s", "d.json", "layers/l");
            expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("custom/path"));
        });

        it("strips trailing slash from configured path", async () => {
            globalThis.GeoLeaf = { Config: { get: vi.fn(() => "mybase/") } };
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { id: "y" };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(styleData) })
            );
            await StyleLoader.loadAndValidateStyle("p", "l", "s", "d.json", "layers/l");
            expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("mybase/p/"));
            expect(globalThis.fetch).not.toHaveBeenCalledWith(
                expect.stringContaining("mybase//p/")
            );
        });

        it("falls back to 'profiles' when cfg.get returns empty string", async () => {
            globalThis.GeoLeaf = { Config: { get: vi.fn(() => "") } };
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "z" }) })
            );
            await StyleLoader.loadAndValidateStyle("p", "l", "s", "d.json", "layers/l");
            expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("profiles/"));
        });

        it("falls back to 'profiles' when GeoLeaf.Config is absent", async () => {
            globalThis.GeoLeaf = {};
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "w" }) })
            );
            await StyleLoader.loadAndValidateStyle("p", "l", "s", "d.json", "layers/l");
            expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("profiles/"));
        });
    });

    describe("loadAndValidateStyle — HTTP error branch", () => {
        it("throws when response.ok is false", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: false, status: 404, statusText: "Not Found" })
            );
            await expect(
                StyleLoader.loadAndValidateStyle("p", "l", "s", "d.json", "layers/l")
            ).rejects.toThrow();
        });
    });

    describe("_ensureLabelVisibleByDefault branch", () => {
        it("sets visibleByDefault=false when label.enabled=true and visibleByDefault is undefined", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { label: { enabled: true } };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(styleData) })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "p",
                "l",
                "s",
                "d.json",
                "layers/l"
            );
            expect(result.styleData.label.visibleByDefault).toBe(false);
        });

        it("does not overwrite visibleByDefault when already set", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            const styleData = { label: { enabled: true, visibleByDefault: true } };
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(styleData) })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "p",
                "l",
                "s",
                "d.json",
                "layers/l"
            );
            expect(result.styleData.label.visibleByDefault).toBe(true);
        });
    });

    describe("_applyStyleValidation branches", () => {
        it("handles validation warnings (warnings.length > 0 branch)", async () => {
            StyleValidatorMock.validateStyle.mockReturnValueOnce({
                valid: true,
                errors: [],
                warnings: [{ field: "color", message: "deprecated" }],
            });
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "w2" }) })
            );
            const result = await StyleLoader.loadAndValidateStyle(
                "p",
                "l",
                "sw",
                "d.json",
                "layers/l"
            );
            expect(result.styleData.id).toBe("w2");
        });
    });

    describe("extractLabelConfig — label object present but enabled=false", () => {
        it("returns null when label object has enabled=false", () => {
            expect(
                StyleLoader.extractLabelConfig({ label: { enabled: false, field: "name" } })
            ).toBeNull();
        });

        it("returns null when label is not an object", () => {
            expect(StyleLoader.extractLabelConfig({ label: "string-label" })).toBeNull();
        });
    });
});

// ── Phase C — branches manquantes post-migration ─────────────────────────────
describe("loaders/style-loader — Phase C additional branches", () => {
    beforeEach(() => {
        globalThis.GeoLeaf = { Config: { get: vi.fn(() => "profiles") } };
        globalThis.fetch = vi.fn();
    });

    describe("_parseStyleJson — JSON parse error branch", () => {
        it("throws with 'malformed JSON' when response.json() rejects", async () => {
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.reject(new SyntaxError("Unexpected token x")),
                })
            );
            await expect(
                StyleLoader.loadAndValidateStyle("p", "l", "bad", "bad.json", "layers/l")
            ).rejects.toThrow(/malformed JSON/);
        });
    });

    describe("_applyStyleValidation — validation failure non-lenient", () => {
        it("throws 'GeoLeaf schema' when validateStyle returns invalid and not lenient", async () => {
            StyleValidatorMock.validateStyle.mockReturnValueOnce({
                valid: false,
                errors: [{ field: "id", message: "required" }],
                warnings: [],
            });
            StyleValidatorMock.formatValidationErrors.mockReturnValueOnce(
                "Validation error: id required"
            );
            StyleLoader.clearStyleCache();
            StyleLoader.clearStyleCache();
            globalThis.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ type: "broken" }) })
            );
            await expect(
                StyleLoader.loadAndValidateStyle("p", "l", "sv", "d.json", "layers/l")
            ).rejects.toThrow(/GeoLeaf schema/);
        });
    });
});
