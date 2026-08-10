/**
 * Phase 60 — Step 3.1: src/kernel/basemaps/facade.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const setMap = vi.hoisted(() => vi.fn());
const _acquireNativeMap = vi.hoisted(() => vi.fn());
const registerBaseLayer = vi.hoisted(() => vi.fn());
const registerBaseLayers = vi.hoisted(() => vi.fn());
const setBaseLayer = vi.hoisted(() => vi.fn());
const getBaseLayers = vi.hoisted(() => vi.fn(() => ({})));
const getActiveKey = vi.hoisted(() => vi.fn(() => null));
const getActiveLayer = vi.hoisted(() => vi.fn(() => null));

vi.mock("../../src/kernel/basemaps/registry.ts", () => ({
    _acquireNativeMap,
    setMap,
    registerBaseLayer,
    registerBaseLayers,
    setBaseLayer,
    getBaseLayers,
    getActiveKey,
    getActiveLayer,
    // ⚠️ `index.ts` importe et ré-exporte `refreshBasemap`, que ce mock omettait. Sous
    // `require()` le shim de `setup.js` rendait `undefined` en silence ; le mocker natif
    // REFUSE de servir un export non déclaré. Le mock était donc incomplet depuis toujours,
    // et rien ne le disait. Déclaré ici avec la valeur qu'il avait de fait — aucun test ne
    // le touche, et lui donner un spy changerait ce qui est testé.
    refreshBasemap: undefined,
}));

const createBaseLayerControlsUI = vi.hoisted(() => vi.fn());
const bindUIOnce = vi.hoisted(() => vi.fn());
const refreshUI = vi.hoisted(() => vi.fn());
const destroyUI = vi.hoisted(() => vi.fn());

vi.mock("../../src/kernel/basemaps/ui.ts", () => ({
    createBaseLayerControlsUI,
    bindUIOnce,
    refreshUI,
    destroyUI,
}));

import { Baselayers } from "../../src/kernel/basemaps/facade.js";

describe("basemaps/facade (step 3.1)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getBaseLayers.mockReturnValue({});
        getActiveKey.mockReturnValue(null);
    });

    it("exporte Baselayers with init, registerBaseLayer, setBaseLayer, getBaseLayers, getActiveKey, getActiveLayer, destroy", () => {
        expect(Baselayers).toBeDefined();
        expect(typeof Baselayers.init).toBe("function");
        expect(typeof Baselayers.registerBaseLayer).toBe("function");
        expect(typeof Baselayers.registerBaseLayers).toBe("function");
        expect(typeof Baselayers.setBaseLayer).toBe("function");
        expect(Baselayers.setActive).toBe(Baselayers.setBaseLayer);
        expect(typeof Baselayers.getBaseLayers).toBe("function");
        expect(typeof Baselayers.getActiveKey).toBe("function");
        expect(Baselayers.getActiveId).toBe(Baselayers.getActiveKey);
        expect(typeof Baselayers.getActiveLayer).toBe("function");
        expect(typeof Baselayers.destroy).toBe("function");
    });

    it("init sans options calls _acquireNativeMap et enregistre les baselayers par défaut", () => {
        Baselayers.init();
        expect(_acquireNativeMap).toHaveBeenCalledWith(undefined);
        // Defaults are registered via registerBaseLayers(DEFAULT_BASELAYERS).
        expect(registerBaseLayers).toHaveBeenCalledWith(
            expect.objectContaining({ street: expect.anything() })
        );
        expect(createBaseLayerControlsUI).toHaveBeenCalled();
        expect(bindUIOnce).toHaveBeenCalled();
        expect(refreshUI).toHaveBeenCalled();
    });

    it("init avec options.map calls setMap", () => {
        const map = {};
        Baselayers.init({ map });
        expect(setMap).toHaveBeenCalledWith(map);
        expect(registerBaseLayers).toHaveBeenCalledWith(
            expect.objectContaining({ street: expect.anything() })
        );
    });

    it("init avec options.baselayers calls registerBaseLayers", () => {
        Baselayers.init({ baselayers: { osm: { label: "OSM", url: "x" } } });
        expect(registerBaseLayers).toHaveBeenCalledWith({ osm: { label: "OSM", url: "x" } });
    });

    it("init avec options.activeKey calls setBaseLayer", () => {
        Baselayers.init({ activeKey: "osm" });
        expect(setBaseLayer).toHaveBeenCalledWith("osm", { silent: true });
    });

    it("init returns activeKey et layers", () => {
        getActiveKey.mockReturnValue("osm");
        getBaseLayers.mockReturnValue({ osm: {} });
        const result = Baselayers.init();
        expect(result).toEqual({ activeKey: "osm", layers: { osm: {} } });
    });

    it("init sans activeKey mais avec layers calls setBaseLayer(keys[0])", () => {
        getActiveKey.mockReturnValue(null);
        getBaseLayers.mockReturnValue({ first: {} });
        Baselayers.init();
        expect(setBaseLayer).toHaveBeenCalledWith("first", { silent: true });
    });
});
