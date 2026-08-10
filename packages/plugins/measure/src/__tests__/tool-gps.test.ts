/**
 * Tests for tool-gps.ts — GPS measure tool.
 *
 * The tool delegates geolocation UX to the existing GeoLeaf geolocation control
 * (.geoleaf-ctrl-geolocation a). Its own watchPosition collects filtered vertices.
 * Map taps add manual waypoints. Space key or external geoloc deactivation stops it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installMockGeoLeaf,
    uninstallMockGeoLeaf,
    makeMockMaplibreMap,
    installGeolocationMock,
    uninstallGeolocationMock,
    installGeolocButtonMock,
    uninstallGeolocButtonMock,
    type GeolocationMock,
} from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import {
    initEngine,
    clearEngineCollection,
    getEngineCollection,
    getSession,
} from "../measure-engine.js";
import { activateGps, deactivateGps } from "../tools/tool-gps.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two coords ~150 m apart (Paris area). */
const COORD_A: [number, number] = [2.35, 48.85];
const COORD_B: [number, number] = [2.3515, 48.851];
const COORD_C: [number, number] = [2.353, 48.852];

/** Coord near COORD_A (< 1 m — below GPS_MIN_DIST_M=2). */
const COORD_A_NEAR: [number, number] = [2.35001, 48.85001];

function makeTs(base = 0, offsetMs = 0): number {
    return base + offsetMs;
}

function makeLngLat(lng: number, lat: number) {
    return { lng, lat, lngLat: { lng, lat }, toArray: () => [lng, lat] as [number, number] };
}

function setup() {
    const gl = installMockGeoLeaf();
    const geo = installGeolocationMock();
    const map = gl._nativeMap as ReturnType<typeof makeMockMaplibreMap>;
    initLayers(map);
    initEngine(getMeasureConfig());
    return { gl, geo, map };
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let map: ReturnType<typeof makeMockMaplibreMap>;
let geo: GeolocationMock;

beforeEach(() => {
    ({ map, geo } = setup());
});

afterEach(() => {
    deactivateGps();
    clearEngineCollection();
    uninstallMockGeoLeaf();
    uninstallGeolocationMock();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activateGps — basic wiring
// ---------------------------------------------------------------------------

describe("activateGps", () => {
    it("calls navigator.geolocation.watchPosition", () => {
        activateGps(map);
        expect(geo.watchPosition).toHaveBeenCalledOnce();
    });

    it("starts a 'line' session in the engine", () => {
        activateGps(map);
        expect(getSession()).not.toBeNull();
        expect(getSession()?.type).toBe("line");
    });

    it("does NOT set cursor to crosshair (no cursor change in GPS mode)", () => {
        activateGps(map);
        // Default cursor is "": no crosshair override in GPS mode
        expect(map.getCanvas().style.cursor).not.toBe("crosshair");
    });

    it("sets __geoleafExclusiveMode on the map", () => {
        activateGps(map);
        expect((map as any).__geoleafExclusiveMode).toBe(true);
    });

    it("installs a keydown listener on document", () => {
        const spy = vi.spyOn(document, "addEventListener");
        activateGps(map);
        expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
    });

    it("is idempotent — safe to call twice", () => {
        activateGps(map);
        activateGps(map);
        expect(geo.watchPosition).toHaveBeenCalledOnce();
    });

    it("clicks the geoloc control button when geoloc is not already active", () => {
        const { link, ctrl } = installGeolocButtonMock();
        const clickSpy = vi.spyOn(link, "click");
        activateGps(map);
        expect(clickSpy).toHaveBeenCalledOnce();
        uninstallGeolocButtonMock(ctrl);
    });

    it("does NOT click the geoloc button when geoloc is already active", () => {
        const gl = installMockGeoLeaf({ geolocActive: true });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        const { link, ctrl } = installGeolocButtonMock();
        const clickSpy = vi.spyOn(link, "click");
        activateGps(localMap);
        expect(clickSpy).not.toHaveBeenCalled();

        deactivateGps();
        uninstallGeolocButtonMock(ctrl);
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });

    it("registers a click handler on the map (for manual waypoints)", () => {
        activateGps(map);
        const onCalls = (map.on as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0]);
        expect(onCalls).toContain("click");
    });
});

// ---------------------------------------------------------------------------
// Manual waypoints — map click
// ---------------------------------------------------------------------------

describe("map click — manual waypoints", () => {
    it("adds a vertex when the user taps the map", () => {
        activateGps(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.85) });
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("adds multiple waypoints on successive taps", () => {
        activateGps(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.36, 48.86) });
        expect(getSession()?.vertices).toHaveLength(2);
    });

    it("ignores duplicate tap at same coordinates", () => {
        activateGps(map);
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.85) });
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.85) });
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("does nothing when tool is not active", () => {
        map._fireEvent("click", { lngLat: makeLngLat(2.35, 48.85) });
        expect(getSession()).toBeNull();
    });

    it("shows close modal when manual tap is near start with ≥ 3 vertices", () => {
        const gl = installMockGeoLeaf({ measureConfig: { gpsCloseThresholdM: 999999 } });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        activateGps(localMap);
        // Add 3 vertices via GPS to satisfy the ≥ 3 condition
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        // Manual tap near the first vertex → threshold is huge → modal shows
        localMap._fireEvent("click", { lngLat: makeLngLat(COORD_A[0], COORD_A[1]) });

        expect(localMap.getContainer().querySelector(".gl-measure-gps-modal")).not.toBeNull();

        deactivateGps();
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });
});

// ---------------------------------------------------------------------------
// _onPosition — GPS vertex filtering
// ---------------------------------------------------------------------------

describe("_onPosition — filtering", () => {
    it("adds a vertex for a valid first position", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("adds multiple vertices for valid successive positions", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        expect(getSession()?.vertices).toHaveLength(3);
    });

    it("rejects a position that implies speed > gpsMaxJumpMps", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        // COORD_B is ~150 m from COORD_A; firing 1 ms later → ~150000 m/s → rejected
        geo._firePosition(COORD_B, makeTs(0, 1));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("rejects a position < 2 m from last accepted (min-distance filter)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_A_NEAR, makeTs(0, 5_000));
        expect(getSession()?.vertices).toHaveLength(1);
    });

    it("accepts a position beyond the min-distance threshold", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        expect(getSession()?.vertices).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// _onPosition — proximity detection (close-as-polygon modal)
// ---------------------------------------------------------------------------

describe("_onPosition — proximity detection", () => {
    it("shows a modal when ≥ 3 vertices and current pos is near start", () => {
        const gl = installMockGeoLeaf({ measureConfig: { gpsCloseThresholdM: 999999 } });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        activateGps(localMap);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        geo._firePosition(COORD_A, makeTs(0, 30_000)); // triggers modal

        expect(localMap.getContainer().querySelector(".gl-measure-gps-modal")).not.toBeNull();

        deactivateGps();
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });

    it("does not show the modal a second time without reset", () => {
        const gl = installMockGeoLeaf({ measureConfig: { gpsCloseThresholdM: 999999 } });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        activateGps(localMap);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        geo._firePosition(COORD_A, makeTs(0, 30_000));
        geo._firePosition(COORD_A, makeTs(0, 40_000)); // should not add a second modal

        expect(localMap.getContainer().querySelectorAll(".gl-measure-gps-modal")).toHaveLength(1);

        deactivateGps();
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });

    it("modal 'Refermer' → closeAsPolygon + session finishes as Polygon", () => {
        const gl = installMockGeoLeaf({ measureConfig: { gpsCloseThresholdM: 999999 } });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        const onStop = vi.fn();
        activateGps(localMap, onStop);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        geo._firePosition(COORD_A, makeTs(0, 30_000));

        const btnYes = localMap
            .getContainer()
            .querySelector(".gl-measure-gps-modal-btn.--primary") as HTMLButtonElement;
        expect(btnYes).not.toBeNull();
        btnYes.click();

        expect(getEngineCollection().features).toHaveLength(1);
        expect(getEngineCollection().features[0].geometry.type).toBe("Polygon");
        expect(onStop).toHaveBeenCalledOnce();

        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });

    it("modal 'Continuer' → tracking continues, no session saved yet", () => {
        const gl = installMockGeoLeaf({ measureConfig: { gpsCloseThresholdM: 999999 } });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        activateGps(localMap);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._firePosition(COORD_C, makeTs(0, 20_000));
        geo._firePosition(COORD_A, makeTs(0, 30_000));

        const btnNo = localMap
            .getContainer()
            .querySelector(".gl-measure-gps-modal-btn:not(.--primary)") as HTMLButtonElement;
        btnNo.click();

        expect(getEngineCollection().features).toHaveLength(0);
        expect(getSession()).not.toBeNull();

        deactivateGps();
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });
});

// ---------------------------------------------------------------------------
// External geoloc deactivation (gl:geoloc:statechange)
// ---------------------------------------------------------------------------

describe("gl:geoloc:statechange — external stop", () => {
    it("stops GPS measure when geoloc is deactivated externally", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));

        // Simulate external geoloc stop (user clicked pill bar button)
        map.getContainer().dispatchEvent(
            new CustomEvent("gl:geoloc:statechange", { detail: { active: false } })
        );

        expect(getSession()).toBeNull(); // session was finalized
        expect(getEngineCollection().features).toHaveLength(1);
    });

    it("calls onStop callback when geoloc is stopped externally", () => {
        const onStop = vi.fn();
        activateGps(map, onStop);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));

        map.getContainer().dispatchEvent(
            new CustomEvent("gl:geoloc:statechange", { detail: { active: false } })
        );

        expect(onStop).toHaveBeenCalledOnce();
    });

    it("ignores statechange { active: true } (geoloc just activated)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));

        map.getContainer().dispatchEvent(
            new CustomEvent("gl:geoloc:statechange", { detail: { active: true } })
        );

        expect(getSession()).not.toBeNull(); // still active
    });
});

// ---------------------------------------------------------------------------
// Space key
// ---------------------------------------------------------------------------

describe("Space key", () => {
    it("Space with ≥ 2 vertices → finishSession (LineString saved)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));

        document.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })
        );

        expect(getEngineCollection().features).toHaveLength(1);
        expect(getEngineCollection().features[0].geometry.type).toBe("LineString");
    });

    it("Space with < 2 vertices → cancelSession (nothing saved)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));

        document.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })
        );

        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("Space → calls onStop callback", () => {
        const onStop = vi.fn();
        activateGps(map, onStop);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));

        document.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })
        );

        expect(onStop).toHaveBeenCalledOnce();
    });

    it("Space does nothing when tool is not active", () => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })
        );
        expect(getEngineCollection().features).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// _onError
// ---------------------------------------------------------------------------

describe("_onError", () => {
    it("PERMISSION_DENIED → clearWatch called, session cancelled", () => {
        activateGps(map);
        geo._fireError(1 /* PERMISSION_DENIED */);

        expect(geo.clearWatch).toHaveBeenCalledWith(42);
        expect(getSession()).toBeNull();
    });

    it("POSITION_UNAVAILABLE → clearWatch called", () => {
        activateGps(map);
        geo._fireError(2 /* POSITION_UNAVAILABLE */);

        expect(geo.clearWatch).toHaveBeenCalledWith(42);
    });

    it("error with ≥ 2 vertices finishes session (LineString saved)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        geo._fireError(2);

        expect(getEngineCollection().features).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// deactivateGps
// ---------------------------------------------------------------------------

describe("deactivateGps", () => {
    it("calls clearWatch with the watch ID", () => {
        activateGps(map);
        deactivateGps();
        expect(geo.clearWatch).toHaveBeenCalledWith(42);
    });

    it("finishes session when ≥ 2 vertices (LineString saved)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        geo._firePosition(COORD_B, makeTs(0, 10_000));
        deactivateGps();

        expect(getEngineCollection().features).toHaveLength(1);
        expect(getEngineCollection().features[0].geometry.type).toBe("LineString");
    });

    it("cancels session when < 2 vertices (nothing saved)", () => {
        activateGps(map);
        geo._firePosition(COORD_A, makeTs(0));
        deactivateGps();

        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("cancels session with 0 vertices", () => {
        activateGps(map);
        deactivateGps();
        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("clears __geoleafExclusiveMode on the map", () => {
        activateGps(map);
        deactivateGps();
        expect((map as any).__geoleafExclusiveMode).toBe(false);
    });

    it("deactivates geoloc control if we activated it", () => {
        // Simulate: geoloc was off, tool clicks it on, then on deactivate clicks it off
        const { link, ctrl } = installGeolocButtonMock();
        const clickSpy = vi.spyOn(link, "click");

        // GeoLeaf.UI._geolocationActive must be true after activation for deactivate to trigger
        activateGps(map); // clicks button once (activate)
        expect(clickSpy).toHaveBeenCalledTimes(1);

        // Simulate that geoloc became active after button click
        (globalThis as any).GeoLeaf.UI._geolocationActive = true;

        deactivateGps(); // should click again (deactivate)
        expect(clickSpy).toHaveBeenCalledTimes(2);

        uninstallGeolocButtonMock(ctrl);
    });

    it("does NOT deactivate geoloc control if geoloc was already active before tool", () => {
        const gl = installMockGeoLeaf({ geolocActive: true });
        const localMap = gl._nativeMap;
        initLayers(localMap);
        initEngine(getMeasureConfig());

        const { link, ctrl } = installGeolocButtonMock();
        const clickSpy = vi.spyOn(link, "click");

        activateGps(localMap); // geoloc was already active → no click
        deactivateGps(); // should NOT click to deactivate

        expect(clickSpy).not.toHaveBeenCalled();

        uninstallGeolocButtonMock(ctrl);
        clearEngineCollection();
        uninstallMockGeoLeaf();
        installMockGeoLeaf();
        map = (globalThis as any).GeoLeaf._nativeMap;
        initLayers(map);
        initEngine(getMeasureConfig());
    });

    it("is safe to call when not active (no-op)", () => {
        expect(() => deactivateGps()).not.toThrow();
    });

    it("removes the keydown listener on document", () => {
        const spy = vi.spyOn(document, "removeEventListener");
        activateGps(map);
        deactivateGps();
        expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
    });
});
