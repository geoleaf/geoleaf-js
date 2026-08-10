/**
 * S5/N-1b — re-poussée des `minzoom`/`maxzoom` natifs quand la latitude dérive.
 *
 * Une borne d'échelle ne devient un niveau de zoom qu'À TRAVERS la latitude : le même
 * 1:X vaut ~1 zoom de moins à 60°N qu'à l'équateur. Une plage posée au chargement dérive
 * donc quand la carte voyage nord/sud — et le moteur (qui rend) se désaccorderait de la
 * légende (qui rapporte). Le zoom, lui, ne change RIEN à la conversion : d'où `moveend`
 * et non `zoomend`.
 *
 * Tout passe par `bindZoomRangeSync` : c'est la seule surface publique du module, et
 * c'est le chemin réel. Exporter la fonction interne juste pour la tester aurait créé un
 * export sans consommateur — ce que le gate B3 refuse, à raison.
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

    /** Carte factice dont on pilote la latitude. */
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
        // Plus au nord, le même dénominateur tombe à un zoom plus bas.
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

        // Nouvelle carte à la même latitude : sans reset, la dérive serait jugée nulle
        // et la plage ne serait jamais posée sur la carte recréée.
        bindZoomRangeSync(makeMap());
        moveTo(4);
        expect(setLayerZoomRange).toHaveBeenCalled();
    });
});
