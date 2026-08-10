/**
 * Unit tests — `bindFeatureInteractionEvents` (backlog COUVERTURE B.2).
 *
 * `built-in/geojson/feature-interaction.ts` était mesuré à **26,7 %** (12/45 lignes) : un seul
 * fichier de test le citait. C'est pourtant le liant clic/survol du noyau — il n'affiche rien,
 * il n'émet que des événements, ce qui le rend entièrement observable sans carte réelle.
 *
 * Les deux dépendances sont mockées avec le patron complet par construction (backlog B.12).
 */
import { vi, describe, test, expect, beforeEach } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", async (importActual) => ({
    ...(await importActual()),
    dispatchGeoLeafEvent: vi.fn(),
}));

vi.mock("../../src/adapters/maplibre/maplibre-event-subscriptions.js", async (importActual) => ({
    ...(await importActual()),
    trackMapCleanup: vi.fn(),
}));

const { bindFeatureInteractionEvents } = await import(
    "../../src/kernel/geojson/feature-interaction.js"
);
const { dispatchGeoLeafEvent } = await import("../../src/kernel/events/event-bus.js");
const { trackMapCleanup } = await import(
    "../../src/adapters/maplibre/maplibre-event-subscriptions.js"
);

/** Fausse carte MapLibre : capture les handlers pour les rejouer à la main. */
function fakeMap({ layers = [], exclusive = false } = {}) {
    const canvas = { style: {} };
    const handlers = {};
    return {
        __geoleafExclusiveMode: exclusive,
        getLayer: (id) => layers.includes(id),
        getCanvas: () => canvas,
        on: vi.fn((type, id, fn) => {
            handlers[`${type}:${id}`] = fn;
        }),
        off: vi.fn(),
        _canvas: canvas,
        _h: handlers,
    };
}

/** Un événement d'interaction plausible. */
function evt(feature, over = {}) {
    return {
        features: feature ? [feature] : [],
        lngLat: { lat: 1, lng: 2 },
        point: { x: 10, y: 20 },
        ...over,
    };
}

beforeEach(() => vi.clearAllMocks());

describe("bindFeatureInteractionEvents — garde de non-interactivité", () => {
    test("`interactiveShape: false` ne branche RIEN", () => {
        const map = fakeMap({ layers: ["a-fill"] });
        bindFeatureInteractionEvents("L", { interactiveShape: false }, map, ["a-fill"]);
        expect(map.on).not.toHaveBeenCalled();
        expect(trackMapCleanup).not.toHaveBeenCalled();
    });

    test("une sous-couche absente de la carte n'est pas branchée", () => {
        const map = fakeMap({ layers: [] });
        bindFeatureInteractionEvents("L", {}, map, ["fantome-fill"]);
        expect(map.on).not.toHaveBeenCalled();
    });
});

describe("clic → geoleaf:feature:click", () => {
    /** Branche et rend le handler de clic capturé. */
    function bindClick(over = {}) {
        const map = fakeMap({ layers: ["a-fill"], ...over });
        bindFeatureInteractionEvents("L", {}, map, ["a-fill"]);
        return { map, onClick: map._h["click:a-fill"] };
    }

    test("émet l'événement avec l'identité, la géométrie et les coordonnées", () => {
        const { onClick } = bindClick();
        onClick(evt({ id: 42, properties: { name: "x" }, geometry: { type: "Point" } }));
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith("geoleaf:feature:click", {
            layerId: "L",
            featureId: 42,
            properties: { name: "x" },
            geometry: { type: "Point" },
            lngLat: { lat: 1, lng: 2 },
            point: { x: 10, y: 20 },
        });
    });

    test("sans `id`, retombe sur `properties.id`", () => {
        const { onClick } = bindClick();
        onClick(evt({ properties: { id: "abc" } }));
        expect(dispatchGeoLeafEvent.mock.calls[0][1].featureId).toBe("abc");
    });

    test("un `properties.id` non scalaire vaut null — pas d'objet en guise d'identité", () => {
        const { onClick } = bindClick();
        onClick(evt({ properties: { id: { nested: true } } }));
        expect(dispatchGeoLeafEvent.mock.calls[0][1].featureId).toBeNull();
    });

    test("ne dispatche pas sans feature", () => {
        const { onClick } = bindClick();
        onClick(evt(null));
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("ne dispatche pas en mode exclusif — un outil a la main", () => {
        const { onClick } = bindClick({ exclusive: true });
        onClick(evt({ id: 1 }));
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("ne dispatche pas sur un cluster (agrégat sans attributs réels)", () => {
        const { onClick } = bindClick();
        onClick(evt({ id: 1, properties: { point_count: 12 } }));
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("ne dispatche pas sans lngLat", () => {
        const { onClick } = bindClick();
        onClick(evt({ id: 1 }, { lngLat: undefined }));
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("le nettoyage est enregistré", () => {
        bindClick();
        expect(trackMapCleanup).toHaveBeenCalled();
    });
});

describe("choix des sous-couches de survol — fill > circle > line > tout", () => {
    /** Rend les ids sur lesquels un `mousemove` a été branché. */
    function hoveredIds(subIds) {
        const map = fakeMap({ layers: subIds });
        bindFeatureInteractionEvents("L", {}, map, subIds);
        return map.on.mock.calls.filter((c) => c[0] === "mousemove").map((c) => c[1]);
    }

    test("les `-fill` l'emportent (toute la surface du polygone, pas sa bordure)", () => {
        expect(hoveredIds(["a-fill", "a-line", "a-circle"])).toEqual(["a-fill"]);
    });

    test("sans fill, les `-circle`", () => {
        expect(hoveredIds(["a-circle", "a-line"])).toEqual(["a-circle"]);
    });

    test("sans fill ni circle, les `-line`", () => {
        expect(hoveredIds(["a-line"])).toEqual(["a-line"]);
    });

    test("sinon, toutes les sous-couches", () => {
        expect(hoveredIds(["a-quelconque"])).toEqual(["a-quelconque"]);
    });
});

describe("survol → curseur + geoleaf:feature:hover", () => {
    function bindHover(over = {}) {
        const map = fakeMap({ layers: ["a-fill"], ...over });
        bindFeatureInteractionEvents("L", { zIndex: 5 }, map, ["a-fill"]);
        return { map, onMove: map._h["mousemove:a-fill"], onLeave: map._h["mouseleave:a-fill"] };
    }

    test("mousemove met le curseur en pointeur et émet la phase `move` avec le zIndex", () => {
        const { map, onMove } = bindHover();
        onMove(evt({ id: 7, properties: { a: 1 } }));
        expect(map._canvas.style.cursor).toBe("pointer");
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith("geoleaf:feature:hover", {
            layerId: "L",
            featureId: 7,
            properties: { a: 1 },
            lngLat: { lat: 1, lng: 2 },
            point: { x: 10, y: 20 },
            zIndex: 5,
            phase: "move",
        });
    });

    test("le curseur passe en pointeur MÊME sans feature — mais rien n'est émis", () => {
        const { map, onMove } = bindHover();
        onMove(evt(null));
        expect(map._canvas.style.cursor).toBe("pointer");
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("mouseleave remet le curseur et émet la phase `leave` à identité nulle", () => {
        const { map, onLeave } = bindHover();
        onLeave();
        expect(map._canvas.style.cursor).toBe("");
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith("geoleaf:feature:hover", {
            layerId: "L",
            featureId: null,
            properties: {},
            lngLat: { lat: 0, lng: 0 },
            point: { x: 0, y: 0 },
            zIndex: 5,
            phase: "leave",
        });
    });

    test("le mode exclusif neutralise move ET leave, curseur compris", () => {
        const { map, onMove, onLeave } = bindHover({ exclusive: true });
        onMove(evt({ id: 1 }));
        onLeave();
        expect(map._canvas.style.cursor).toBeUndefined();
        expect(dispatchGeoLeafEvent).not.toHaveBeenCalled();
    });

    test("un zIndex non numérique retombe sur 0", () => {
        const map = fakeMap({ layers: ["a-fill"] });
        bindFeatureInteractionEvents("L", { zIndex: "haut" }, map, ["a-fill"]);
        map._h["mouseleave:a-fill"]();
        expect(dispatchGeoLeafEvent.mock.calls[0][1].zIndex).toBe(0);
    });
});
