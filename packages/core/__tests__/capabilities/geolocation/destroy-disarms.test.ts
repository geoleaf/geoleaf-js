/**
 * `Core.destroy()` disarms geolocation: the GPS watch stops, the state reads inactive.
 *
 * The capability never subscribed to the lifecycle seam that `Core.destroy()` runs. With the map
 * gone, the watch kept firing, `getState().active` stayed `true`, and the next position raised
 * « map is not ready » with nothing to catch it. Red on the code before the fix: the seam ran
 * nothing for this capability.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeolocationLifecycle } from "../../../src/capabilities/geolocation/lifecycle.js";
import { GeoLocationState } from "../../../src/capabilities/geolocation/state.js";
import { runLifecycleTeardowns } from "../../../src/kernel/shared/lifecycle.js";

// Switched off: the control is never built, the stand-in map is never touched — only the
// lifecycle's subscription to the destroy seam is under test.
vi.mock("../../../src/capabilities/geolocation/config.js", () => ({
    getGeolocationConfig: () => ({ enabled: false }),
}));

const clearWatch = vi.fn();

beforeEach(() => {
    vi.stubGlobal("navigator", { geolocation: { clearWatch, watchPosition: vi.fn() } });
    clearWatch.mockClear();
});

afterEach(() => {
    GeolocationLifecycle._reset();
    vi.unstubAllGlobals();
    GeoLocationState.watchId = null;
    GeoLocationState.active = false;
});

describe("geolocation — Core.destroy() la désarme", () => {
    it("une veille en cours s'arrête et l'état passe inactif", () => {
        GeolocationLifecycle.init({} as never);
        GeoLocationState.watchId = 42;
        GeoLocationState.active = true;

        runLifecycleTeardowns();

        expect(clearWatch).toHaveBeenCalledWith(42);
        expect(GeoLocationState.watchId).toBeNull();
        expect(GeoLocationState.active).toBe(false);
    });
});
