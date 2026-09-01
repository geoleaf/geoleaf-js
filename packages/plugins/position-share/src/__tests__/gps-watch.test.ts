/**
 * @geoleaf-plugins/position-share — GPS watch activation
 *
 * This module carries per-session state (`_requested`, `_deniedNotified`) on purpose: the
 * click must happen once, and a refusal must be reported once. Each test therefore re-imports
 * it through `vi.resetModules()` — sharing the module between cases would make one test's
 * "already requested" the next one's silent pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type GpsWatchModule = typeof import("../gps-watch.js");

async function freshModule(): Promise<GpsWatchModule> {
    vi.resetModules();
    return import("../gps-watch.js");
}

function setWatchActive(active: boolean): void {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Geolocation: { getState: () => ({ active }) },
    };
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("isWatchActive", () => {
    it("is false when the capability is absent", async () => {
        const m = await freshModule();
        expect(m.isWatchActive()).toBe(false);
    });

    it("reflects the capability's state", async () => {
        const m = await freshModule();
        setWatchActive(true);
        expect(m.isWatchActive()).toBe(true);
        setWatchActive(false);
        expect(m.isWatchActive()).toBe(false);
    });
});

describe("ensureWatch", () => {
    it("does nothing when the watch is already running", async () => {
        const m = await freshModule();
        setWatchActive(true);
        const link = document.createElement("a");
        const click = vi.fn();
        link.addEventListener("click", click);
        const ctrl = document.createElement("div");
        ctrl.className = "geoleaf-ctrl-geolocation";
        ctrl.appendChild(link);
        document.body.appendChild(ctrl);

        expect(m.ensureWatch()).toBe(true);
        expect(click).not.toHaveBeenCalled();
    });

    it("clicks the geolocation control when the watch is off", async () => {
        const m = await freshModule();
        setWatchActive(false);
        const link = document.createElement("a");
        const click = vi.fn();
        link.addEventListener("click", click);
        const ctrl = document.createElement("div");
        ctrl.className = "geoleaf-ctrl-geolocation";
        ctrl.appendChild(link);
        document.body.appendChild(ctrl);

        expect(m.ensureWatch()).toBe(true);
        expect(click).toHaveBeenCalledTimes(1);
    });

    // A browser only grants geolocation once per prompt; clicking again on every cycle would
    // re-prompt a user who has already answered.
    it("clicks only once, however many times it is called", async () => {
        const m = await freshModule();
        setWatchActive(false);
        const link = document.createElement("a");
        const click = vi.fn();
        link.addEventListener("click", click);
        const ctrl = document.createElement("div");
        ctrl.className = "geoleaf-ctrl-geolocation";
        ctrl.appendChild(link);
        document.body.appendChild(ctrl);

        m.ensureWatch();
        m.ensureWatch();
        m.ensureWatch();
        expect(click).toHaveBeenCalledTimes(1);
    });

    it("returns false and reports when the control is not in the DOM", async () => {
        const m = await freshModule();
        setWatchActive(false);
        expect(m.ensureWatch()).toBe(false);
    });
});

describe("notifyDeniedOnce", () => {
    // The logger seam delegates to `GeoLeaf.Log`, never to `console` — spying on the console
    // here would observe nothing and let "at most once" pass with ZERO calls, which is the
    // shape of a test that cannot fail. The exact count below is what makes it bite.
    it("reports a refusal exactly once per session", async () => {
        const m = await freshModule();
        const warn = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = { Log: { warn } };

        m.notifyDeniedOnce();
        m.notifyDeniedOnce();
        m.notifyDeniedOnce();

        expect(warn).toHaveBeenCalledTimes(1);
    });
});
