/**
 * `CoordinatesLifecycle` — the readout mounts on `geoleaf:app:ready`, whenever the module inits.
 *
 * 🛑 A profile without a default theme dispatched `geoleaf:app:ready` from inside
 * `UIModule.init()`, before `CoordinatesModule.init()` had run: the `{ once: true }` listener it
 * then added waited forever, and the readout never appeared. An init that runs after the reveal
 * must mount at once. (The pointer rule lives in `coordinates-touch.test.ts`.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/capabilities/coordinates/coordinates.js", () => ({
    CoordinatesDisplay: { init: vi.fn(), destroy: vi.fn() },
}));

const { CoordinatesLifecycle } = await import("../../../src/capabilities/coordinates/lifecycle.js");
const { CoordinatesDisplay } = await import("../../../src/capabilities/coordinates/coordinates.js");
const { markAppReady, resetAppReady } = await import("../../../src/kernel/shared/app-ready.js");

const MAP = { id: "map" } as never;
const appReady = (): void => {
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
};

afterEach(() => {
    CoordinatesLifecycle._reset();
    resetAppReady();
    vi.clearAllMocks();
});

describe("CoordinatesLifecycle", () => {
    it("before the reveal: mounts on geoleaf:app:ready, not at init()", () => {
        CoordinatesLifecycle.init(MAP);
        expect(CoordinatesDisplay.init).not.toHaveBeenCalled();
        appReady();
        expect(CoordinatesDisplay.init).toHaveBeenCalledTimes(1);
        expect(vi.mocked(CoordinatesDisplay.init).mock.calls[0]?.[0]).toBe(MAP);
    });

    it("an init that runs AFTER the reveal mounts at once", () => {
        markAppReady();
        CoordinatesLifecycle.init(MAP);
        expect(CoordinatesDisplay.init).toHaveBeenCalledTimes(1);
    });

    it("_reset() detaches the listener and tears the readout down", () => {
        CoordinatesLifecycle.init(MAP);
        CoordinatesLifecycle._reset();
        appReady();
        expect(CoordinatesDisplay.init).not.toHaveBeenCalled();
        expect(CoordinatesDisplay.destroy).toHaveBeenCalled();
    });
});
