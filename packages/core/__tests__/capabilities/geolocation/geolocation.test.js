/**
 * Geolocation capability — runtime control branch coverage.
 * Relocated from __tests__/ui/control-geolocation-branches.test.js (extraction roadmap
 * contrôles carte). The former internal `ui.showGeolocation` gate is removed (the
 * capability gate + GeolocationLifecycle decide whether init runs), so
 * initGeolocationControl(map) no longer takes a config arg and its config-gate tests
 * are dropped.
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn(() => false) },
}));
vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        createSVGIcon: vi.fn(() => document.createElementNS("http://www.w3.org/2000/svg", "svg")),
    },
}));
vi.mock("../../../src/capabilities/toast-renderer/notifications.js", () => ({
    _UINotifications: {
        dismiss: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(() => document.createElement("div")),
    },
}));
vi.mock("../../../src/capabilities/geolocation/state.js", () => ({
    GeoLocationState: {
        active: false,
        watchId: null,
        userPosition: null,
        userPositionAccuracy: null,
    },
}));
vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));
vi.mock("../../../src/utils/general/dom-helpers.js", () => ({
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
}));
vi.mock("../../../src/utils/controls/propagation-blocker.js", () => ({
    blockMapPropagation: vi.fn(),
}));
vi.mock("../../../src/utils/geo/haversine.js", () => ({
    haversineDistance: vi.fn(() => 100),
}));

import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import { initGeolocationControl } from "../../../src/capabilities/geolocation/geolocation.js";
import { Config } from "../../../src/kernel/config/config-primitives.js";
import { GeoLocationState } from "../../../src/capabilities/geolocation/state.js";
import { _UINotifications } from "../../../src/capabilities/toast-renderer/notifications.js";
import { haversineDistance } from "../../../src/utils/geo/haversine.js";

function makeMockMap() {
    const container = document.createElement("div");
    return {
        getCenter: vi.fn(() => ({ lat: 48.8, lng: 2.3 })),
        getZoom: vi.fn(() => 12),
        setView: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        addControl: vi.fn(() => ({ remove: vi.fn() })),
        getContainer: vi.fn(() => container),
        createMarker: vi.fn(),
        removeMarker: vi.fn(),
        addGeoJSONLayer: vi.fn(),
        removeLayer: vi.fn(),
    };
}

describe("capabilities/geolocation — control branch coverage", () => {
    let originalGeolocation;

    beforeEach(() => {
        vi.restoreAllMocks();
        GeoLocationState.active = false;
        GeoLocationState.watchId = null;
        GeoLocationState.userPosition = null;
        originalGeolocation = navigator.geolocation;
        Object.defineProperty(navigator, "geolocation", {
            value: { watchPosition: vi.fn(() => 42), clearWatch: vi.fn() },
            configurable: true,
            writable: true,
        });
        globalThis.GeoLeaf = { _UINotifications };
    });

    afterEach(() => {
        Object.defineProperty(navigator, "geolocation", {
            value: originalGeolocation,
            configurable: true,
            writable: true,
        });
    });

    describe("initGeolocationControl", () => {
        it("returns undefined when map is null", () => {
            expect(initGeolocationControl(null)).toBeUndefined();
        });

        it("returns undefined when navigator.geolocation is absent", () => {
            Object.defineProperty(navigator, "geolocation", {
                value: undefined,
                configurable: true,
                writable: true,
            });
            const map = makeMockMap();
            expect(initGeolocationControl(map)).toBeUndefined();
        });

        it("returns a destroy function when all conditions met", () => {
            const map = makeMockMap();
            expect(typeof initGeolocationControl(map)).toBe("function");
        });

        it("adds control to map at topleft", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            expect(map.addControl).toHaveBeenCalledWith(expect.any(HTMLElement), "topleft");
        });
    });

    describe("toggle geolocation start", () => {
        it("starts watching position on click", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const container = map.addControl.mock.calls[0][0];
            const link = container.querySelector("a");
            expect(link).not.toBeNull();
            link.click();
            expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
        });

        it("activates via Enter key", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");
            link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
        });

        it("activates via Space key", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");
            link.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
            expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
        });

        it("does not activate on other keys", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");
            link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
        });
    });

    describe("position success", () => {
        it("sets view on first fix", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            expect(map.setView).toHaveBeenCalledWith({ lat: 48.85, lng: 2.35 }, 16);
            expect(GeoLocationState.active).toBe(true);
            expect(map.createMarker).toHaveBeenCalled();
        });

        it("does not setView on subsequent fixes", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            map.setView.mockClear();
            successCb({ coords: { latitude: 48.86, longitude: 2.36, accuracy: 30 } });
            expect(map.setView).not.toHaveBeenCalled();
        });

        it("adds accuracy layer when accuracy < 1000", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 500 } });
            expect(map.addGeoJSONLayer).toHaveBeenCalledWith(
                "gl-geoloc-accuracy",
                expect.anything(),
                expect.objectContaining({ fillColor: "#4285F4" })
            );
        });

        // ANO-036 regression-lock (KERNEL S6). This is the last remaining reader of
        // `ui.interactiveShapes`; the config-contract lock
        // (__tests__/config/s11-ui-anomalies-lock.test.js) asserts the reader still exists,
        // and these two assert that the flag actually reaches the layer options.
        it.each([true, false])(
            "propagates ui.interactiveShapes=%s to the accuracy layer options",
            (flag) => {
                Config.get.mockImplementation((key, dflt) =>
                    key === "ui.interactiveShapes" ? flag : dflt
                );
                const map = makeMockMap();
                initGeolocationControl(map);
                map.addControl.mock.calls[0][0].querySelector("a").click();
                const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
                successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 500 } });
                expect(map.addGeoJSONLayer).toHaveBeenCalledWith(
                    "gl-geoloc-accuracy",
                    expect.anything(),
                    expect.objectContaining({ interactive: flag })
                );
            }
        );

        it("does not add accuracy layer when accuracy >= 1000", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 1500 } });
            expect(map.addGeoJSONLayer).not.toHaveBeenCalled();
        });

        it("removes previous marker before adding new one", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            successCb({ coords: { latitude: 48.86, longitude: 2.36, accuracy: 50 } });
            expect(map.removeMarker).toHaveBeenCalled();
        });
    });

    describe("position error", () => {
        function driveError(code) {
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const errorCb = navigator.geolocation.watchPosition.mock.calls[0][1];
            errorCb({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        }

        it("handles PERMISSION_DENIED error", () => {
            driveError(1);
            expect(_UINotifications.error).toHaveBeenCalledWith(
                expect.stringContaining("permission_denied")
            );
        });

        it("handles POSITION_UNAVAILABLE error", () => {
            driveError(2);
            expect(_UINotifications.error).toHaveBeenCalledWith(
                expect.stringContaining("position_unavailable")
            );
        });

        it("handles TIMEOUT error", () => {
            driveError(3);
            expect(_UINotifications.error).toHaveBeenCalledWith(expect.stringContaining("timeout"));
        });

        it("handles unknown error code with default message", () => {
            driveError(99);
            expect(_UINotifications.error).toHaveBeenCalled();
        });
    });

    describe("stop geolocation", () => {
        it("stops geolocation on second click", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");
            link.click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            link.click();
            expect(navigator.geolocation.clearWatch).toHaveBeenCalled();
            expect(GeoLocationState.active).toBe(false);
        });

        // ⚠️ Browser scenario — no GPS subscription leaks on an error →
        // re-click cycle.
        //
        // Counter-proof: `_onGeoPositionError` only did a PARTIAL teardown
        // (classes + `active=false` + toast), leaving `watchPosition` running
        // and `watchId` set. Since `active` went back to `false`, a SECOND
        // click re-entered the "start" branch and OVERWROTE `watchId` WITHOUT
        // `clearWatch` — one GPS subscription leaked per cycle. The fix
        // borrows `_stopGeolocation` (complete teardown).
        //
        // The scenario is classed 🔴 "browser", but its defect is
        // `watchId`/`clearWatch` bookkeeping — happy-dom, with
        // `navigator.geolocation` mocked (already in place here), decides it
        // as well as a real browser. Covered at its peers' tier.
        it("un cycle erreur → re-clic ne laisse pas fuiter de watch (E.7)", () => {
            const map = makeMockMap();
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");

            // 1st click → start: watchPosition armed.
            link.click();
            expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
            const firstWatchId = navigator.geolocation.watchPosition.mock.results[0].value;

            // Geolocation fails (permission denied) → the error MUST release the subscription.
            const errorCb = navigator.geolocation.watchPosition.mock.calls[0][1];
            errorCb({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
            expect(
                navigator.geolocation.clearWatch,
                "l'erreur n'a pas relâché la souscription (teardown partiel ?)"
            ).toHaveBeenCalledWith(firstWatchId);
            expect(GeoLocationState.active).toBe(false);

            // 2nd click → new start. The 1st subscription having been
            // released, there is no orphan watch: as many clearWatch as superseded watches.
            link.click();
            expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(2);
            const supersededWatches = navigator.geolocation.watchPosition.mock.calls.length - 1; // the last one is live
            expect(
                navigator.geolocation.clearWatch.mock.calls.length,
                "un watch a été écrasé sans clearWatch — fuite E.7"
            ).toBeGreaterThanOrEqual(supersededWatches);
        });
    });

    describe("destroy", () => {
        it("cleans up markers and layers on destroy", () => {
            const map = makeMockMap();
            const destroy = initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            destroy();
            expect(GeoLocationState.active).toBe(false);
        });
    });

    describe("recenter visibility", () => {
        it("shows recenter button when distance > 50", () => {
            haversineDistance.mockReturnValue(100);
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            successCb({ coords: { latitude: 48.86, longitude: 2.36, accuracy: 50 } });
            expect(map.on).toHaveBeenCalled();
        });

        it("hides recenter button when distance <= 50", () => {
            haversineDistance.mockReturnValue(20);
            const map = makeMockMap();
            initGeolocationControl(map);
            map.addControl.mock.calls[0][0].querySelector("a").click();
            const successCb = navigator.geolocation.watchPosition.mock.calls[0][0];
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
            successCb({ coords: { latitude: 48.85, longitude: 2.35, accuracy: 50 } });
        });
    });

    describe("chemin d'erreur — remise à plat (B.33)", () => {
        /** Geolocation error conforming to the browser's type. */
        const geoError = (code) => ({
            code,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: "denied",
        });

        /** Starts geolocation and returns the captured error callback (called later, like a real browser). */
        function startAndCaptureError(map) {
            let errCb = null;
            navigator.geolocation.watchPosition = vi.fn((_ok, err) => {
                errCb = err;
                return 42;
            });
            initGeolocationControl(map);
            const link = map.addControl.mock.calls[0][0].querySelector("a");
            link.click();
            return { errCb, link };
        }

        it("refus de permission : annule le watch au lieu de le laisser courir", () => {
            const map = makeMockMap();
            const { errCb } = startAndCaptureError(map);
            // The watch is indeed armed before the error — what makes the leak possible.
            expect(GeoLocationState.watchId).toBe(42);

            errCb(geoError(1));

            expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
            expect(GeoLocationState.watchId).toBeNull();
        });

        it("un second clic après erreur ne laisse pas fuir la souscription précédente", () => {
            // The defect's real cost: `active` goes back to `false` without
            // cleanup, so a second click re-enters the "start" branch and
            // OVERWRITES `watchId` without `clearWatch`. Each error→re-click
            // cycle leaks one GPS subscription.
            const map = makeMockMap();
            const { errCb, link } = startAndCaptureError(map);
            errCb(geoError(3)); // TIMEOUT

            navigator.geolocation.watchPosition = vi.fn(() => 43);
            link.click();

            expect(GeoLocationState.watchId).toBe(43);
            // Subscription 42 must have been released — otherwise it runs forever.
            expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
        });

        it("position indisponible : détache moveend pour ne pas recentrer sur une position morte", () => {
            const map = makeMockMap();
            const { errCb } = startAndCaptureError(map);
            errCb(geoError(2)); // POSITION_UNAVAILABLE

            expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
            expect(GeoLocationState.userPosition).toBeNull();
        });
    });
});
