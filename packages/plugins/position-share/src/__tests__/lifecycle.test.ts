/**
 * @geoleaf-plugins/position-share — boot wiring
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type LifecycleModule = typeof import("../lifecycle.js");

async function freshModule(): Promise<LifecycleModule> {
    vi.resetModules();
    return import("../lifecycle.js");
}

/** Captures what the plugin sends through the logger seam (which never touches `console`). */
let warn: ReturnType<typeof vi.fn>;

/**
 * A namespace whose profile drives `modules.position-share`, with a live GPS control.
 *
 * @param mapBuilt - When true, `getNativeMap()` answers — i.e. boot is already behind us, which
 *   is what the late-load fallback keys on.
 */
function setHost(cfg: Record<string, unknown>, watchActive: boolean, mapBuilt = false): void {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Config: { get: (key: string) => (key === "modules.position-share" ? cfg : undefined) },
        Geolocation: { getState: () => ({ active: watchActive, userPosition: null }) },
        Log: { warn, info: vi.fn() },
        ...(mapBuilt ? { Core: { getMap: () => ({ getNativeMap: () => ({}) }) } } : {}),
    };
}

function installGeolocControl(): ReturnType<typeof vi.fn> {
    const link = document.createElement("a");
    const click = vi.fn();
    link.addEventListener("click", click);
    const ctrl = document.createElement("div");
    ctrl.className = "geoleaf-ctrl-geolocation";
    ctrl.appendChild(link);
    document.body.appendChild(ctrl);
    return click;
}

beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.fn();
    document.body.innerHTML = "";
});

afterEach(() => {
    // `initLifecycle` registers on `document`, which `vi.resetModules()` does NOT reset — the
    // listener of a previous test survives into this one and fires on the same event, so a
    // second module would click the control a second time and every exact count would drift.
    // Draining them here is possible precisely because they are `{ once: true }`: the DOM is
    // emptied and the namespace removed FIRST, so the drained handlers read a disabled config
    // and find no control, and therefore do nothing on their way out.
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    document.body.innerHTML = "";
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("initLifecycle", () => {
    // The geolocation control is not in the DOM until the app has built its chrome. Acting at
    // module load would find nothing — and a missing element is not an error, so the failure
    // would leave no trace at all.
    it("does nothing before geoleaf:app:ready", async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false);
        const click = installGeolocControl();

        m.initLifecycle();
        await vi.advanceTimersByTimeAsync(10000);

        expect(click).not.toHaveBeenCalled();
    });

    it('requests the GPS watch on app:ready in mode "auto"', async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false);
        const click = installGeolocControl();

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(click).toHaveBeenCalledTimes(1);
    });

    it('stays silent in mode "manual"', async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "manual" }, false);
        const click = installGeolocControl();

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(click).not.toHaveBeenCalled();
    });

    it("stays silent when the plugin is not enabled", async () => {
        const m = await freshModule();
        setHost({ enabled: false, mode: "auto" }, false);
        const click = installGeolocControl();

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(click).not.toHaveBeenCalled();
    });

    // 🛑 The plugin is loaded LAZILY: its import can happen long after `geoleaf:app:ready` has
    // fired, and a listener added to a signal that already passed never runs. Without the
    // fallback, `auto` and reception simply never start — no error, no trace. This is the class
    // that closed twice in this repository, on `realtime-layer` then `geocoding`.
    it("runs immediately when the map already exists (late load, signal already gone)", async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false, true);
        const click = installGeolocControl();

        m.initLifecycle();

        // No `app:ready` dispatched at all — the fallback is the only thing that can act.
        expect(click).toHaveBeenCalledTimes(1);
    });

    it("does not run the boot work twice when the signal arrives after the fallback", async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false, true);
        const click = installGeolocControl();

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(click).toHaveBeenCalledTimes(1);
    });

    it("wires the listener only once", async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false);
        const click = installGeolocControl();

        m.initLifecycle();
        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(click).toHaveBeenCalledTimes(1);
    });

    // A refused permission leaves the watch inactive after the grace period. It must be said,
    // and emission must not start.
    it("reports a refused permission after the grace period", async () => {
        const m = await freshModule();
        setHost({ enabled: true, mode: "auto" }, false);
        installGeolocControl();

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        expect(warn).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(9000);
        expect(warn).toHaveBeenCalled();
    });

    it("starts reception when the profile asks for it", async () => {
        const m = await freshModule();
        const start = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Config: {
                get: (key: string) =>
                    key === "modules.position-share"
                        ? {
                              enabled: true,
                              mode: "off",
                              receive: { enabled: true, layerId: "fleet" },
                          }
                        : undefined,
            },
            Log: { warn, info: vi.fn() },
            RealtimeLayer: { start, stop: vi.fn() },
        };

        m.initLifecycle();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(start).toHaveBeenCalledWith("fleet");
    });
});
