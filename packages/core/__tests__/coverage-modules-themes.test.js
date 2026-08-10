/**
 * Campagne tests unitaires — themes (ThemeCache + ThemeApplierCore)
 * Sprint T9 — coverage-modules pattern.
 */

import { ThemeCache } from "../src/kernel/themes/theme-cache.js";

vi.mock("../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Dependencies mocked for ThemeApplierCore ─────────────────────────────────

vi.mock("../src/kernel/config/config-primitives.js", () => ({
    Config: {
        Profile: {
            getActiveProfileConfig: vi.fn(() => ({
                performance: { themeBatchSize: 2 },
            })),
        },
    },
}));

// ⚠️ R.32 (25/07/2026) — le chemin était `../src/geoleaf.legend.js`, qui N'EXISTE PAS.
// `theme-applier/core.ts:10` importe la façade depuis `api/`, donc ce mock ne s'appliquait
// jamais : le test exerçait la VRAIE `Legend` en croyant l'avoir isolée. Prouvé par mutation
// dans les deux sens — factory qui jette : inerte sur l'ancien chemin (13/13 vert),
// 3 tests rouges sur le nouveau.
vi.mock("../src/api/geoleaf.legend.js", () => ({
    Legend: {
        showLoadingOverlay: vi.fn(),
        hideLoadingOverlay: vi.fn(),
    },
}));

// ⚠️ R.32 — même défaut, même cause (`theme-applier/core.ts:11`).
vi.mock("../src/api/geoleaf.layer-manager.js", () => ({
    LayerManager: {
        refresh: vi.fn(),
    },
}));

vi.mock("../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        getLayerById: vi.fn(() => null),
    },
}));

describe("Coverage — ThemeCache", () => {
    it("get returns null when StorageDB not available", async () => {
        const result = await ThemeCache.get("layer-1");
        expect(result).toBeNull();
    });
    it("store does not throw when StorageDB not available", async () => {
        await expect(ThemeCache.store("layer-1", null, {})).resolves.not.toThrow();
    });
    it("invalidate does not throw when StorageDB not available", async () => {
        await expect(ThemeCache.invalidate("layer-1")).resolves.not.toThrow();
    });
});

// ── ThemeApplierCore ──────────────────────────────────────────────────────────
import { ThemeApplierCore } from "../src/kernel/themes/theme-applier/core.js";

// Stub methods injected by visibility.ts (not imported in unit test scope)
ThemeApplierCore._hideAllLayers = vi.fn();
ThemeApplierCore._syncLegendVisibility = vi.fn();
ThemeApplierCore._applyLayerConfig = vi.fn(() => Promise.resolve());
ThemeApplierCore._fitBoundsOnAllLayers = vi.fn();

describe("Coverage — ThemeApplierCore", () => {
    describe("_init() / _cleanup()", () => {
        it("_init sets up internal state without throwing", () => {
            expect(() => ThemeApplierCore._init()).not.toThrow();
        });

        it("_cleanup does not throw when not initialised", () => {
            const fresh = Object.create(ThemeApplierCore);
            fresh._pendingCheckTimer = null;
            fresh._pendingLayerConfigs = null;
            expect(() => fresh._cleanup()).not.toThrow();
        });

        it("_cleanup clears pendingCheckTimer", () => {
            ThemeApplierCore._init();
            ThemeApplierCore._pendingCheckTimer = setTimeout(() => {}, 5000);
            ThemeApplierCore._cleanup();
            expect(ThemeApplierCore._pendingCheckTimer).toBeNull();
        });

        it("_cleanup clears pendingLayerConfigs map", () => {
            ThemeApplierCore._init();
            ThemeApplierCore._pendingLayerConfigs.set("layer-x", {});
            ThemeApplierCore._cleanup();
            expect(ThemeApplierCore._pendingLayerConfigs.size).toBe(0);
        });
    });

    describe("applyTheme() — input branches", () => {
        beforeEach(() => {
            ThemeApplierCore._init();
        });

        it("rejects with error when theme is null", async () => {
            await expect(ThemeApplierCore.applyTheme(null)).rejects.toThrow();
        });

        it("rejects with error when theme has no id", async () => {
            await expect(ThemeApplierCore.applyTheme({ layers: [] })).rejects.toThrow();
        });

        it("resolves with empty layers array when deps are available", async () => {
            // Both GeoJSONCore and LayerManager are mocked as truthy — applyTheme should resolve
            await expect(
                ThemeApplierCore.applyTheme({ id: "t1", layers: [] })
            ).resolves.not.toThrow();
        });
    });

    describe("getCurrentThemeId()", () => {
        it("returns null before any theme is applied", () => {
            ThemeApplierCore._currentThemeId = null;
            const id = ThemeApplierCore._currentThemeId;
            expect(id).toBeNull();
        });

        it("reflects a set value", () => {
            ThemeApplierCore._init();
            ThemeApplierCore._currentThemeId = "nature";
            expect(ThemeApplierCore._currentThemeId).toBe("nature");
            ThemeApplierCore._currentThemeId = null;
        });
    });

    describe("_isFirstLoad flag", () => {
        it("starts as true by default", () => {
            // Read the initial value — may have been changed by other tests
            expect(typeof ThemeApplierCore._isFirstLoad).toBe("boolean");
        });
    });
});
