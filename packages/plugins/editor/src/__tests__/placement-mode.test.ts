/*!
 * Tests — tâche 5.1-a : le mode de placement programmatique (`drawing/placement-mode.ts`)
 *
 * ⚠️ Le mock de carte REPRODUIT les contraintes de MapLibre au lieu de les ignorer :
 *   - `on`/`off` tiennent un vrai registre, donc un `off` mal apparié laisse le handler vivant
 *     et le test suivant le voit ;
 *   - `getCanvas()` rend un vrai élément, donc le curseur est réellement écrit puis restauré ;
 *   - `dragPan` est ABSENT du mock par défaut — c'est le cas réel d'un double de test, et le
 *     code doit dégrader et non jeter.
 * C'est la leçon du Sprint 4 : un mock plus permissif que la surface valide les deux formes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _findNearbyFeature = vi.fn();
const _notify = { info: vi.fn() };

vi.mock("@geoleaf/host-runtime", () => ({
    Log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getUINotifications: () => _notify,
}));

let _seamMap: unknown = null;
vi.mock("../internal.js", () => ({
    _getLabel: (k: string) => k,
    _getNativeMap: () => _seamMap,
}));

vi.mock("../drawing/poi-snap.js", () => ({
    findNearbyFeature: (...a: unknown[]) => _findNearbyFeature(...a),
}));

const { PlacementMode, DEFAULT_SNAP_METERS } = await import("../drawing/placement-mode.js");

// --- doubles ---------------------------------------------------------------

interface FakeMarker {
    remove: ReturnType<typeof vi.fn>;
    getLngLat(): { lat: number; lng: number };
    setLngLat(c: [number, number]): FakeMarker;
    addTo(): FakeMarker;
    on(evt: string, cb: () => void): void;
    _fire(evt: string): void;
    _pos: { lat: number; lng: number };
}

const _markers: FakeMarker[] = [];

function installMapLibre(present = true) {
    if (!present) {
        delete (globalThis as { maplibregl?: unknown }).maplibregl;
        return;
    }
    (globalThis as { maplibregl?: unknown }).maplibregl = {
        Marker: function (this: FakeMarker) {
            const listeners: Record<string, (() => void)[]> = {};
            this._pos = { lat: 0, lng: 0 };
            this.remove = vi.fn();
            this.getLngLat = () => this._pos;
            this.setLngLat = (c: [number, number]) => {
                this._pos = { lng: c[0], lat: c[1] };
                return this;
            };
            this.addTo = () => this;
            this.on = (evt: string, cb: () => void) => {
                (listeners[evt] ??= []).push(cb);
            };
            this._fire = (evt: string) => (listeners[evt] ?? []).forEach((cb) => cb());
            _markers.push(this);
            return this;
        },
    };
}

function makeMap(opts: { withDragPan?: boolean } = {}) {
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    const canvas = document.createElement("canvas");
    const container = document.createElement("div");
    const dragPan = { enable: vi.fn(), disable: vi.fn() };
    const map = {
        getCanvas: () => canvas,
        getContainer: () => container,
        on: vi.fn((t: string, h: (e: unknown) => void) => {
            (handlers[t] ??= []).push(h);
        }),
        off: vi.fn((t: string, h: (e: unknown) => void) => {
            handlers[t] = (handlers[t] ?? []).filter((x) => x !== h);
        }),
        once: vi.fn(),
        queryRenderedFeatures: () => [],
        loaded: () => true,
        ...(opts.withDragPan !== false && { dragPan }),
        _click(lat: number, lng: number) {
            (handlers.click ?? []).forEach((h) =>
                h({ point: { x: 0, y: 0 }, lngLat: { lat, lng } })
            );
        },
        _handlerCount: () => (handlers.click ?? []).length,
        _canvas: canvas,
        _dragPan: dragPan,
    };
    return map;
}

beforeEach(() => {
    _findNearbyFeature.mockReset().mockReturnValue(null);
    _notify.info.mockReset();
    _markers.length = 0;
    _seamMap = null;
    installMapLibre(true);
});

afterEach(() => {
    PlacementMode.deactivate();
    PlacementMode.clearMarker();
});

// --- cycle de vie ----------------------------------------------------------

describe("PlacementMode — cycle de vie", () => {
    it("s'arme, pose le curseur crosshair, et se désarme en le restaurant", () => {
        const map = makeMap();
        map._canvas.style.cursor = "grab";

        PlacementMode.activate(map, () => {});
        expect(PlacementMode.isActive()).toBe(true);
        expect(map._canvas.style.cursor).toBe("crosshair");
        expect(map._handlerCount()).toBe(1);

        PlacementMode.deactivate();
        expect(PlacementMode.isActive()).toBe(false);
        expect(map._canvas.style.cursor).toBe("grab");
        expect(map._handlerCount()).toBe(0);
    });

    it("refuse une seconde activation et n'installe pas de second handler", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        PlacementMode.activate(map, () => {});
        expect(map._handlerCount()).toBe(1);
    });

    it("n'active rien quand aucune carte n'est disponible", () => {
        PlacementMode.activate(null, () => {});
        expect(PlacementMode.isActive()).toBe(false);
    });

    it("déballe un ADAPTATEUR de carte via getNativeMap()", () => {
        const map = makeMap();
        PlacementMode.activate({ getNativeMap: () => map }, () => {});
        expect(map._handlerCount()).toBe(1);
    });

    it("se rabat sur le seam du plugin quand l'appelant ne passe rien", () => {
        const map = makeMap();
        _seamMap = map;
        PlacementMode.activate(null, () => {});
        expect(map._handlerCount()).toBe(1);
    });
});

describe("PlacementMode — le panoramique", () => {
    it("ne coupe PAS le drag par défaut", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        expect(map._dragPan.disable).not.toHaveBeenCalled();
        PlacementMode.deactivate();
        expect(map._dragPan.enable).not.toHaveBeenCalled();
    });

    it("coupe puis rétablit le drag quand disableDrag est demandé", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {}, { disableDrag: true });
        expect(map._dragPan.disable).toHaveBeenCalledTimes(1);
        PlacementMode.deactivate();
        expect(map._dragPan.enable).toHaveBeenCalledTimes(1);
    });

    it("🛑 ne jette pas quand la carte n'expose pas dragPan", () => {
        const map = makeMap({ withDragPan: false });
        expect(() => PlacementMode.activate(map, () => {}, { disableDrag: true })).not.toThrow();
        expect(() => PlacementMode.deactivate()).not.toThrow();
    });
});

// --- la résolution du clic -------------------------------------------------

describe("PlacementMode — le clic résout le placement", () => {
    it("rend la position cliquée quand rien n'est à proximité", () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb, { snapMeters: 50 });
        map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual({ latlng: { lat: -21.1, lng: 55.5 }, snapped: null });
        expect(_findNearbyFeature).toHaveBeenCalledWith({ lat: -21.1, lng: 55.5 }, 50);
    });

    it("accroche et rend les coordonnées de l'entité existante", () => {
        const near = {
            latlng: { lat: -21.2, lng: 55.6 },
            distanceMeters: 12,
            layerId: "candelabres",
            id: "c-7",
            title: "Lampadaire 7",
        };
        _findNearbyFeature.mockReturnValue(near);
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        map._click(-21.1, 55.5);

        expect(cb.mock.calls[0][0]).toEqual({ latlng: near.latlng, snapped: near });
        // 2 notifications : l'invite posée par `activate`, puis l'alerte de doublon. On
        // assert la SECONDE nommément — compter les appels laisserait passer une invite
        // émise deux fois, et « au moins une » laisserait passer l'alerte manquante.
        expect(_notify.info).toHaveBeenCalledTimes(2);
        expect(_notify.info.mock.calls[0][0]).toBe("editor.placement.prompt");
        expect(_notify.info.mock.calls[1][0]).toContain("editor.placement.existingDetected");
        expect(_notify.info.mock.calls[1][0]).toContain("Lampadaire 7");
    });

    it("n'alerte PAS d'un doublon quand il n'y en a pas", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        map._click(-21.1, 55.5);
        expect(_notify.info).toHaveBeenCalledTimes(1);
        expect(_notify.info.mock.calls[0][0]).toBe("editor.placement.prompt");
    });

    it("applique le rayon par défaut quand l'appelant n'en passe pas", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        map._click(-21.1, 55.5);
        expect(_findNearbyFeature).toHaveBeenCalledWith(expect.anything(), DEFAULT_SNAP_METERS);
    });

    it("🛑 se DÉSARME avant de rappeler — un second clic ne place pas deux fois", () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        map._click(-21.1, 55.5);

        expect(PlacementMode.isActive()).toBe(false);
        map._click(-21.3, 55.7);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it("ignore un clic qui ne porte pas de lngLat", () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        (map.on as unknown as { mock: { calls: [string, (e: unknown) => void][] } }).mock.calls
            .filter(([t]) => t === "click")
            .forEach(([, h]) => h({ point: { x: 1, y: 1 } }));
        expect(cb).not.toHaveBeenCalled();
        expect(PlacementMode.isActive()).toBe(true);
    });
});

// --- le marqueur de correction ---------------------------------------------

describe("PlacementMode — le marqueur draggable", () => {
    it("pose un marqueur et le CONSERVE après le clic", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        map._click(-21.1, 55.5);

        expect(_markers).toHaveLength(1);
        expect(_markers[0].remove).not.toHaveBeenCalled();
        expect(_markers[0]._pos).toEqual({ lat: -21.1, lng: 55.5 });
    });

    it("🛑 le drag REJOUE le garde-fou : s'éloigner d'un doublon l'efface", () => {
        _findNearbyFeature.mockReturnValueOnce({
            latlng: { lat: -21.1, lng: 55.5 },
            distanceMeters: 3,
            layerId: "candelabres",
            id: "c-7",
        });
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        map._click(-21.1, 55.5);
        expect(cb.mock.calls[0][0].snapped?.id).toBe("c-7");

        // Le marqueur est traîné ailleurs ; le garde-fou ne trouve plus rien.
        _findNearbyFeature.mockReturnValue(null);
        _markers[0]._pos = { lat: -21.9, lng: 55.9 };
        _markers[0]._fire("dragend");

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[1][0]).toEqual({
            latlng: { lat: -21.9, lng: 55.9 },
            snapped: null,
        });
    });

    it("🛑 le drag SUR un doublon le lève", () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        map._click(-21.1, 55.5);

        const near = {
            latlng: { lat: -21.9, lng: 55.9 },
            distanceMeters: 2,
            layerId: "candelabres",
            id: "c-9",
        };
        _findNearbyFeature.mockReturnValue(near);
        _markers[0]._pos = { lat: -21.9, lng: 55.9 };
        _markers[0]._fire("dragend");

        expect(cb.mock.calls[1][0].snapped).toEqual(near);
    });

    it("clearMarker() retire le marqueur", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        map._click(-21.1, 55.5);
        PlacementMode.clearMarker();
        expect(_markers[0].remove).toHaveBeenCalledTimes(1);
    });

    it("🛑 sans MapLibre, le placement fonctionne quand même — seul le marqueur manque", () => {
        installMapLibre(false);
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(_markers).toHaveLength(0);
    });
});
