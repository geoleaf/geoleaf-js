/**
 * `ScaleLifecycle` — the scale bar mounts on `geoleaf:app:ready`, whenever the module inits.
 *
 * 🛑 A profile without a default theme dispatched `geoleaf:app:ready` from inside
 * `UIModule.init()`, before `ScaleModule.init()` had run: the `{ once: true }` listener it then
 * added waited forever, and the scale bar never appeared. An init that runs after the reveal
 * must mount at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/capabilities/scale/scale-control.js", () => ({
    ScaleControl: { init: vi.fn(), destroy: vi.fn() },
}));

const { ScaleLifecycle } = await import("../../../src/capabilities/scale/lifecycle.js");
const { ScaleControl } = await import("../../../src/capabilities/scale/scale-control.js");
const { markAppReady, resetAppReady } = await import("../../../src/kernel/shared/app-ready.js");
const { runLifecycleTeardowns } = await import("../../../src/kernel/shared/lifecycle.js");

const MAP = { id: "map" } as never;
const appReady = (): void => {
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
};

afterEach(() => {
    ScaleLifecycle._reset();
    resetAppReady();
    vi.clearAllMocks();
});

describe("ScaleLifecycle", () => {
    it("before the reveal: mounts on geoleaf:app:ready, not at init()", () => {
        ScaleLifecycle.init(MAP);
        expect(ScaleControl.init).not.toHaveBeenCalled();
        appReady();
        expect(ScaleControl.init).toHaveBeenCalledTimes(1);
        expect(vi.mocked(ScaleControl.init).mock.calls[0]?.[0]).toBe(MAP);
    });

    it("an init that runs AFTER the reveal mounts at once", () => {
        markAppReady();
        ScaleLifecycle.init(MAP);
        expect(ScaleControl.init).toHaveBeenCalledTimes(1);
    });

    it("_reset() detaches the listener and tears the control down", () => {
        ScaleLifecycle.init(MAP);
        ScaleLifecycle._reset();
        appReady();
        expect(ScaleControl.init).not.toHaveBeenCalled();
        expect(ScaleControl.destroy).toHaveBeenCalled();
    });

    // `Core.destroy()` runs the lifecycle seam and never the module registry, so `_reset()`
    // did not run on it. A destroy landing before `geoleaf:app:ready` — from a listener of that
    // very event laid before this one — let the mount run on the destroyed map: "map is not
    // ready", uncaught on the page.
    it("🛑 the lifecycle seam disarms the mount: an app:ready after a destroy mounts nothing", () => {
        ScaleLifecycle.init(MAP);
        runLifecycleTeardowns();
        appReady();
        expect(ScaleControl.init).not.toHaveBeenCalled();
        // It DISARMS and nothing more: the adapter is already destroyed when the seam runs,
        // and the control's own teardown unsubscribes from it, which throws.
        expect(ScaleControl.destroy).not.toHaveBeenCalled();
    });

    it("after the seam, a new init arms the mount again", () => {
        ScaleLifecycle.init(MAP);
        runLifecycleTeardowns();
        ScaleLifecycle.init(MAP);
        appReady();
        expect(ScaleControl.init).toHaveBeenCalledTimes(1);
    });
});
