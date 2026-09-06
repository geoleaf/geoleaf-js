/*!
 * Tests — the programmatic placement mode (`drawing/placement-mode.ts`)
 *
 * ⚠️ The map mock REPRODUCES MapLibre's constraints instead of ignoring them:
 *   - `on`/`off` keep a real registry, so a mispaired `off` leaves the handler
 *     alive and the next test sees it;
 *   - `getCanvas()` returns a real element, so the cursor is really written
 *     then restored;
 *   - `dragPan` is ABSENT from the mock by default — the real case of a test
 *     double, and the code must degrade, not throw.
 * The lesson: a mock more permissive than the surface validates both forms.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _findNearbyFeature = vi.fn();
const _notify = { info: vi.fn() };

/**
 * The duplicate guard's dialog. Answers with whatever the test queues.
 *
 * ⚠️ The parameter is TYPED rather than left to `vi.fn()`'s inferred `[]`: an untyped double
 * makes `mock.calls[0][0]` a tuple index that does not exist, so a test reading what the guard
 * ASKED cannot compile. Half of what matters here is the question, not just the answer.
 */
interface ChooseArgs {
    title?: string;
    message: string;
    choices: { id: string; label: string; tone?: string }[];
    dismissValue?: string | null;
}
const _choose = vi.fn(async (_opts: ChooseArgs): Promise<string | null> => null);

vi.mock("@geoleaf/host-runtime", () => ({
    Log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getUINotifications: () => _notify,
    chooseDialog: (opts: ChooseArgs) => _choose(opts),
}));

let _seamMap: unknown = null;
// ⚠️ The label double reads the REAL French catalogue rather than echoing the key. Echoing
// would make the interpolation of `{title}` and `{d}` structurally unobservable — the guard
// could stop naming the neighbour it found and every test would stay green.
vi.mock("../internal.js", async () => {
    const mod = await vi.importActual<{ default: Record<string, string> }>("../lang/lang-fr.js");
    return {
        _getLabel: (k: string) => mod.default[k] ?? k,
        _getNativeMap: () => _seamMap,
    };
});

vi.mock("../drawing/poi-snap.js", () => ({
    findNearbyFeature: (...a: unknown[]) => _findNearbyFeature(...a),
}));

const { PlacementMode, DEFAULT_SNAP_METERS } = await import("../drawing/placement-mode.js");
const LANG_FR = (await import("../lang/lang-fr.js")).default;

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
        // Returns a promise: `_handleMapClick` is async since the duplicate guard asks a
        // question, so a test that does not await it asserts on a handler still mid-flight.
        _click(lat: number, lng: number) {
            return Promise.all(
                (handlers.click ?? []).map((h) =>
                    h({ point: { x: 0, y: 0 }, lngLat: { lat, lng } })
                )
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
    _choose.mockReset().mockResolvedValue(null);
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

// --- click resolution --------------------------------------------------------

describe("PlacementMode — le clic résout le placement", () => {
    it("rend la position cliquée quand rien n'est à proximité", async () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb, { snapMeters: 50 });
        await map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual({
            latlng: { lat: -21.1, lng: 55.5 },
            snapped: null,
            intent: "create",
        });
        expect(_findNearbyFeature).toHaveBeenCalledWith({ lat: -21.1, lng: 55.5 }, 50);
        // 🛑 No neighbour, no question. A dialog on every tap would be the other way of
        // making the guard useless — people dismiss what always fires.
        expect(_choose).not.toHaveBeenCalled();
    });

    // 🛑 THIS TEST LOCKED THE DEFECT, and it is worth saying what it asserted: that a tap
    // near an existing feature RESOLVES TO THE NEIGHBOUR'S COORDINATES. Downstream, that
    // position opened a CREATION form — so the guard against duplicates built duplicates,
    // perfectly superimposed and therefore indistinguishable in the ERP. What it verified
    // was faithful to the code; the code was wrong. Replaced by the three outcomes below.
    const NEAR = {
        latlng: { lat: -21.2, lng: 55.6 },
        distanceMeters: 12.4,
        layerId: "candelabres",
        id: "c-7",
        title: "Lampadaire 7",
    };

    it("DEMANDE quoi faire au lieu d'accrocher en silence, et nomme le voisin", async () => {
        _findNearbyFeature.mockReturnValue(NEAR);
        const map = makeMap();
        PlacementMode.activate(map, vi.fn());
        await map._click(-21.1, 55.5);

        expect(_choose).toHaveBeenCalledTimes(1);
        const opts = _choose.mock.calls[0]![0];
        expect(opts.message).toContain("Lampadaire 7");
        expect(opts.message).toContain("12");
        expect(opts.choices.map((c) => c.id)).toEqual(["cancel", "edit", "create"]);
        // 🛑 The safe exit must be the safe one. `dismissValue` pointing at `create` would
        // turn Escape into a duplicate — the very defect, moved one layer down.
        expect(opts.dismissValue ?? null).not.toBe("create");
    });

    it("« Modifier l'existant » rend l'entité voisine, avec SA position", async () => {
        _findNearbyFeature.mockReturnValue(NEAR);
        _choose.mockResolvedValue("edit");
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual({
            latlng: NEAR.latlng,
            snapped: NEAR,
            intent: "edit",
        });
    });

    // 🛑 THE HEART OF THE FIX. Deliberately creating next to an existing feature must land
    // where the finger landed. Snapping onto the neighbour is what produced two records at
    // the exact same coordinates, which no ERP can tell apart afterwards.
    it("« Créer quand même » garde la coordonnée du TAP, pas celle du voisin", async () => {
        _findNearbyFeature.mockReturnValue(NEAR);
        _choose.mockResolvedValue("create");
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);

        expect(cb.mock.calls[0][0]).toEqual({
            latlng: { lat: -21.1, lng: 55.5 },
            snapped: NEAR,
            intent: "create",
        });
    });

    it("l'abandon ne place RIEN — ni marqueur, ni position", async () => {
        _findNearbyFeature.mockReturnValue(NEAR);
        _choose.mockResolvedValue(null);
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0].intent).toBe("abandon");
        expect(_markers).toHaveLength(0);
    });

    it("désarme le mode AVANT d'ouvrir la question — un tap égaré n'est pas un second placement", async () => {
        _findNearbyFeature.mockReturnValue(NEAR);
        let armedDuringDialog: boolean | null = null;
        _choose.mockImplementation(async () => {
            armedDuringDialog = PlacementMode.isActive();
            return null;
        });
        const map = makeMap();
        PlacementMode.activate(map, vi.fn());
        await map._click(-21.1, 55.5);

        expect(armedDuringDialog).toBe(false);
    });

    it("n'alerte PAS d'un doublon quand il n'y en a pas", async () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        await map._click(-21.1, 55.5);
        expect(_notify.info).toHaveBeenCalledTimes(1);
        expect(_notify.info.mock.calls[0][0]).toBe(LANG_FR["editor.placement.prompt"]);
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

// --- the correction marker ---------------------------------------------------

describe("PlacementMode — le marqueur draggable", () => {
    it("pose un marqueur et le CONSERVE après le clic", () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        map._click(-21.1, 55.5);

        expect(_markers).toHaveLength(1);
        expect(_markers[0].remove).not.toHaveBeenCalled();
        expect(_markers[0]._pos).toEqual({ lat: -21.1, lng: 55.5 });
    });

    it("🛑 le drag REJOUE le garde-fou : s'éloigner d'un doublon l'efface", async () => {
        _findNearbyFeature.mockReturnValueOnce({
            latlng: { lat: -21.1, lng: 55.5 },
            distanceMeters: 3,
            layerId: "candelabres",
            id: "c-7",
        });
        // A neighbour is found, so the guard asks; "create anyway" is what leaves a marker
        // to drag in the first place.
        _choose.mockResolvedValue("create");
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);
        expect(cb.mock.calls[0][0].snapped?.id).toBe("c-7");

        // The marker is dragged elsewhere; the guard no longer finds anything.
        _findNearbyFeature.mockReturnValue(null);
        _markers[0]._pos = { lat: -21.9, lng: 55.9 };
        _markers[0]._fire("dragend");

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[1][0]).toEqual({
            latlng: { lat: -21.9, lng: 55.9 },
            snapped: null,
            intent: "create",
        });
    });

    it("🛑 le drag SUR un doublon le lève", async () => {
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);

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

    it("clearMarker() retire le marqueur", async () => {
        const map = makeMap();
        PlacementMode.activate(map, () => {});
        await map._click(-21.1, 55.5);
        PlacementMode.clearMarker();
        expect(_markers[0].remove).toHaveBeenCalledTimes(1);
    });

    it("🛑 sans MapLibre, le placement fonctionne quand même — seul le marqueur manque", async () => {
        installMapLibre(false);
        const map = makeMap();
        const cb = vi.fn();
        PlacementMode.activate(map, cb);
        await map._click(-21.1, 55.5);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(_markers).toHaveLength(0);
    });
});
