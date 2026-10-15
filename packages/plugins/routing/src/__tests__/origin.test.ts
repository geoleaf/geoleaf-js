// @vitest-environment happy-dom
/**
 * @geoleaf-plugins/routing — "Your position" as an origin
 *
 * What is pinned here is not the reading but the REFUSALS: three of them, each meaning something
 * different to the person in front of the screen, and one of them not an error at all.
 *
 * 🛑 The fake capability has the CORE's shape — `active`, `userPosition` — and no other. These
 * tests used to fake `permission`, `position` and `coordinates`, names the core never had: they
 * stayed green while « your position » answered `no-fix` on every real page.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { originFromUserPosition } from "../origin.js";

type Fix = { lat: number; lng: number };
let state: { active: boolean; userPosition: Fix | null };
let permission: string | null;

/** Mounts the capability; `fixOnClick` is what the device answers when the control is clicked. */
function withGeolocation(options: { enabled?: boolean; fixOnClick?: Fix | null } = {}): void {
    state = { active: false, userPosition: null };
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Geolocation: { isEnabled: () => options.enabled !== false, getState: () => state },
    };
    const control = document.createElement("div");
    control.className = "geoleaf-ctrl-geolocation";
    const link = document.createElement("a");
    link.addEventListener("click", () => {
        const fix = options.fixOnClick ?? null;
        state = fix ? { active: true, userPosition: fix } : { active: false, userPosition: null };
        document.body.dispatchEvent(
            new CustomEvent("geoleaf:geolocation:statechange", {
                detail: { active: fix !== null },
                bubbles: true,
            })
        );
    });
    control.append(link);
    document.body.append(control);
}

beforeEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    document.body.innerHTML = "";
    permission = null;
    Object.defineProperty(globalThis.navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: permission ?? "prompt" }) },
    });
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

describe("what it answers", () => {
    it("builds a waypoint in [longitude, latitude] order from the fix the core holds", async () => {
        withGeolocation();
        state = { active: true, userPosition: { lat: -20.88, lng: 55.45 } };
        await expect(originFromUserPosition("Votre position")).resolves.toEqual({
            ok: true,
            waypoint: { coordinates: [55.45, -20.88], name: "Votre position" },
        });
    });

    it("switches the core's GPS on when it is off, and routes from its first fix", async () => {
        withGeolocation({ fixOnClick: { lat: -21.1, lng: 55.5 } });
        const r = await originFromUserPosition("x");
        expect(r.ok && r.waypoint.coordinates).toEqual([55.5, -21.1]);
    });

    it("takes the label from the caller and holds no string of its own", async () => {
        withGeolocation();
        state = { active: true, userPosition: { lat: 2, lng: 1 } };
        const r = await originFromUserPosition("Ma position à moi");
        expect(r.ok && r.waypoint.name).toBe("Ma position à moi");
    });
});

describe("the three refusals, and why they are three", () => {
    it("`unavailable` when the core exposes no geolocation, or the profile turns it off", async () => {
        await expect(originFromUserPosition("x")).resolves.toEqual({
            ok: false,
            reason: "unavailable",
        });
        withGeolocation({ enabled: false });
        await expect(originFromUserPosition("x")).resolves.toEqual({
            ok: false,
            reason: "unavailable",
        });
    });

    it("`denied` when the user said no — and it is NOT an error", async () => {
        // A user who declines has answered the question. Manual entry stays open, and a plugin
        // that made this the only way in would have locked out anyone who said no once.
        withGeolocation({ fixOnClick: null });
        permission = "denied";
        await expect(originFromUserPosition("x")).resolves.toEqual({
            ok: false,
            reason: "denied",
        });
    });

    it("`no-fix` when no fix came and nothing was refused — retrying may work", async () => {
        withGeolocation({ fixOnClick: null });
        permission = "granted";
        await expect(originFromUserPosition("x")).resolves.toEqual({
            ok: false,
            reason: "no-fix",
        });
    });

    it("`no-fix`, not a throw, where the browser cannot say what was answered", async () => {
        withGeolocation({ fixOnClick: null });
        Object.defineProperty(globalThis.navigator, "permissions", {
            configurable: true,
            value: { query: async () => Promise.reject(new TypeError("unsupported")) },
        });
        await expect(originFromUserPosition("x")).resolves.toEqual({
            ok: false,
            reason: "no-fix",
        });
    });
});
