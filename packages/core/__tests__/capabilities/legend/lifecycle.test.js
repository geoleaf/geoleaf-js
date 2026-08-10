/**
 * LegendLifecycle — S10/F1 app:ready mount + F2 late-gate.
 *
 * Consolidates the legend init (formerly split across `initLegendSafe` and an
 * `init-deferred-ui` block) into a single mount on `geoleaf:app:ready`:
 * `Legend.init` with the active map (options now read from `modules.legend`
 * inside Legend.init — no hardcoded bag, S10 F2), then the active theme's layer
 * legends. Late-gates on the merged `modules.legend.enabled` (`getLegendConfig`).
 * Mirrors the filter / theme-selector capability test pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAllLayerConfigs } from "../../../src/kernel/shared/layer-configs-state.js";

const mockLegendInit = vi.fn();
const mockLegendReset = vi.fn();
// B.28 — the lifecycle imports the IMPLEMENTATION (`./legend.js`), no longer the
// facade, so that is what has to be mocked here.
vi.mock("../../../src/capabilities/legend/legend.js", () => ({
    Legend: { init: (...a) => mockLegendInit(...a), _reset: () => mockLegendReset() },
}));

// B.29 — the late gate reads `getLegendConfig().enabled` inline (the
// `isLegendEnabled()` alias is resorbed), so the gate is driven through the reader.
const { legendEnabled } = vi.hoisted(() => ({ legendEnabled: { value: true } }));
vi.mock("../../../src/capabilities/legend/config.js", () => ({
    getLegendConfig: () => ({ enabled: legendEnabled.value }),
}));

let mockMap = { id: "map" };
vi.mock("../../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: () => mockMap },
}));

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

let mockGeoLeaf;
vi.mock("../../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => mockGeoLeaf,
}));

const { LegendLifecycle } = await import("../../../src/capabilities/legend/lifecycle.ts");

describe("LegendLifecycle (S10/F1 mount + F2 late-gate)", () => {
    beforeEach(() => {
        LegendLifecycle._reset(); // clean module state before clearing the mocks
        vi.clearAllMocks();
        mockMap = { id: "map" };
        mockGeoLeaf = undefined;
        legendEnabled.value = true;
    });
    afterEach(() => {
        LegendLifecycle._reset();
    });

    it("initialises the legend on app:ready with the active map (options from modules.legend)", () => {
        LegendLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        // Options are read inside Legend.init from `modules.legend` — no bag passed.
        expect(mockLegendInit).toHaveBeenCalledWith(mockMap);
    });

    it("does not mount when disabled (modules.legend.enabled:false — late gate)", () => {
        legendEnabled.value = false;
        LegendLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockLegendInit).not.toHaveBeenCalled();
    });

    it("loads the legend of every configured layer (init first)", () => {
        // No theme-based filtering (roadmap nettoyage PB-2, 15/07): the dead
        // `ThemeSelector.getActiveTheme()` read was removed — every configured
        // layer's legend is loaded unconditionally.
        const loadLayerLegend = vi.fn();
        mockGeoLeaf = {
            _GeoJSONLayerManager: { _loadLayerLegend: loadLayerLegend },
        };
        // API S4.3e — les configs de couches ont quitté le namespace pour `kernel/shared/`.
        // Ce test les plantait sur son faux global : il testait sa propre fixture, jamais le
        // chemin réel écrivain → lecteur.
        setAllLayerConfigs([{ id: "a" }, { id: "b" }]);
        LegendLifecycle.init();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(loadLayerLegend).toHaveBeenCalledTimes(2);
        expect(loadLayerLegend).toHaveBeenCalledWith("a", { config: { id: "a" } });
        expect(loadLayerLegend).toHaveBeenCalledWith("b", { config: { id: "b" } });
    });

    it("init() is idempotent — a single app:ready subscription", () => {
        LegendLifecycle.init();
        LegendLifecycle.init(); // second call guarded by _started
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockLegendInit).toHaveBeenCalledTimes(1);
    });

    it("_reset() detaches the listener and tears down the legend", () => {
        LegendLifecycle.init();
        LegendLifecycle._reset();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(mockLegendInit).not.toHaveBeenCalled(); // listener detached before the event
        expect(mockLegendReset).toHaveBeenCalled();
    });
});
