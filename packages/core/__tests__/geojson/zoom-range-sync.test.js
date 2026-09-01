/**
 * Re-pushing native `minzoom`/`maxzoom` when latitude drifts.
 *
 * A scale bound only becomes a zoom level THROUGH latitude: the same 1:X is
 * worth ~1 zoom less at 60°N than at the equator. A range set at load thus
 * drifts as the map travels north/south — and the engine (which renders)
 * would fall out of tune with the legend (which reports). Zoom itself
 * changes NOTHING in the conversion: hence `moveend` and not `zoomend`.
 *
 * Everything goes through `bindZoomRangeSync`: the module's only public
 * surface, and the real path. Exporting the internal function just to test
 * it would have created a consumer-less export — which the orphan gate
 * refuses, rightly.
 */
const state = { layers: new Map(), adapter: null };
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        get state() {
            return state;
        },
    },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
import { bindZoomRangeSync } from "../../src/kernel/geojson/layers/zoom-range-sync.js";

const GUYANE = { minScale: 9222148, maxScale: 2252 };

describe("geojson/zoom-range-sync", () => {
    let setLayerZoomRange;
    let handlers;
    let lat;

    /** Fake map whose latitude is driven. */
    const makeMap = () => ({
        on: (evt, fn) => (handlers[evt] = fn),
        getCenter: () => ({ lat, lng: 0 }),
    });

    const moveTo = (newLat) => {
        lat = newLat;
        handlers.moveend();
    };

    const addLayer = (id, scaleConfig) =>
        state.layers.set(id, { id, currentStyle: scaleConfig ? { scaleConfig } : {} });

    beforeEach(() => {
        setLayerZoomRange = vi.fn();
        handlers = {};
        lat = 4;
        state.layers = new Map();
        state.adapter = { setLayerZoomRange };
        globalThis.GeoLeaf = undefined;
    });

    it("s'abonne à moveend — pas à zoomend : le zoom ne change pas la conversion", () => {
        bindZoomRangeSync(makeMap());
        expect(handlers.moveend).toBeTypeOf("function");
        expect(handlers.zoomend).toBeUndefined();
    });

    it("pousse la plage convertie à la latitude courante", () => {
        addLayer("cours_eau", GUYANE);
        bindZoomRangeSync(makeMap());
        moveTo(4);

        const [id, minZoom, maxZoom] = setLayerZoomRange.mock.calls[0];
        expect(id).toBe("cours_eau");
        expect(minZoom).toBeCloseTo(6, 2);
        expect(maxZoom).toBeCloseTo(18, 2);
    });

    it("ne re-pousse pas tant que la latitude n'a pas dérivé", () => {
        addLayer("cours_eau", GUYANE);
        bindZoomRangeSync(makeMap());
        moveTo(4);
        setLayerZoomRange.mockClear();

        moveTo(4.5); // sous le seuil
        expect(setLayerZoomRange).not.toHaveBeenCalled();
    });

    it("re-pousse au-delà du seuil, avec des bornes différentes", () => {
        addLayer("cours_eau", GUYANE);
        bindZoomRangeSync(makeMap());
        moveTo(4);
        const premierMin = setLayerZoomRange.mock.calls[0][1];
        setLayerZoomRange.mockClear();

        moveTo(50);
        expect(setLayerZoomRange).toHaveBeenCalledTimes(1);
        // Further north, the same denominator lands at a lower zoom.
        expect(setLayerZoomRange.mock.calls[0][1]).toBeLessThan(premierMin);
    });

    it("ignore les couches sans scaleConfig", () => {
        addLayer("sans_contrainte", null);
        bindZoomRangeSync(makeMap());
        moveTo(4);
        expect(setLayerZoomRange).not.toHaveBeenCalled();
    });

    it("efface la plage quand les bornes sont désactivées", () => {
        addLayer("desactivee", { minScale: 0, maxScale: null });
        bindZoomRangeSync(makeMap());
        moveTo(4);
        expect(setLayerZoomRange).toHaveBeenCalledWith("desactivee", null, null);
    });

    it("ne fait rien si l'adaptateur ignore l'opération", () => {
        addLayer("cours_eau", GUYANE);
        state.adapter = {}; // pas de setLayerZoomRange
        bindZoomRangeSync(makeMap());
        expect(() => moveTo(4)).not.toThrow();
        expect(setLayerZoomRange).not.toHaveBeenCalled();
    });

    it("ignore une latitude non exploitable", () => {
        addLayer("cours_eau", GUYANE);
        bindZoomRangeSync(makeMap());
        moveTo(Number.NaN);
        expect(setLayerZoomRange).not.toHaveBeenCalled();
    });

    it("repart d'une ardoise vierge quand une nouvelle carte est liée", () => {
        addLayer("cours_eau", GUYANE);
        bindZoomRangeSync(makeMap());
        moveTo(4);
        setLayerZoomRange.mockClear();

        // A new map at the same latitude: without a reset, the drift would
        // be judged nil and the range never set on the recreated map.
        bindZoomRangeSync(makeMap());
        moveTo(4);
        expect(setLayerZoomRange).toHaveBeenCalled();
    });
});
