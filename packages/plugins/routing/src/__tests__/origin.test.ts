/**
 * @geoleaf-plugins/routing — "Your position" as an origin
 *
 * What is pinned here is not the reading but the REFUSALS: three of them, each meaning something
 * different to the person in front of the screen, and one of them not an error at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { originFromUserPosition } from "../origin.js";

/**
 * Installs a fake geolocation capability.
 *
 * @param state What `getState()` answers, or `undefined` for no capability at all.
 */
function withGeolocation(state?: unknown): void {
    if (state === undefined) {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
        return;
    }
    (globalThis as Record<string, unknown>).GeoLeaf = { Geolocation: { getState: () => state } };
}

beforeEach(() => withGeolocation(undefined));

describe("what it answers", () => {
    it("builds a waypoint in [longitude, latitude] order", () => {
        withGeolocation({ permission: "granted", position: { lng: 55.45, lat: -20.88 } });
        expect(originFromUserPosition("Votre position")).toEqual({
            ok: true,
            waypoint: { coordinates: [55.45, -20.88], name: "Votre position" },
        });
    });

    it("reads the RAW pair too, because two host shapes exist", () => {
        // Reading only one would work on the host it was written against and answer `no-fix`
        // forever on the other — a failure that looks like a permission problem and is not one.
        withGeolocation({ permission: "granted", coordinates: [55.45, -20.88] });
        expect(originFromUserPosition("x").ok).toBe(true);
    });

    it("takes the label from the caller and holds no string of its own", () => {
        withGeolocation({ permission: "granted", position: { lng: 1, lat: 2 } });
        const r = originFromUserPosition("Ma position à moi");
        expect(r.ok && r.waypoint.name).toBe("Ma position à moi");
    });
});

describe("the three refusals, and why they are three", () => {
    it("`unavailable` when the core exposes no geolocation at all", () => {
        expect(originFromUserPosition("x")).toEqual({ ok: false, reason: "unavailable" });
    });

    it("`denied` when the user said no — and it is NOT an error", () => {
        // A user who declines has answered the question. Manual entry stays open, and a plugin
        // that made this the only way in would have locked out anyone who said no once.
        withGeolocation({ permission: "denied", position: { lng: 1, lat: 2 } });
        expect(originFromUserPosition("x")).toEqual({ ok: false, reason: "denied" });
    });

    it("checks `denied` BEFORE the fix, so a revoked permission cannot route from a stale one", () => {
        // 🛑 The order is the assertion. A denied permission carrying a fix from an earlier
        // session would otherwise route the user from a place they have revoked access to.
        withGeolocation({ permission: "denied", position: { lng: 55.45, lat: -20.88 } });
        expect(originFromUserPosition("x").ok).toBe(false);
    });

    it("`no-fix` when permission is there but nothing has been acquired", () => {
        withGeolocation({ permission: "granted", position: null });
        expect(originFromUserPosition("x")).toEqual({ ok: false, reason: "no-fix" });
    });

    it("`no-fix` on a half-built position rather than a NaN waypoint", () => {
        withGeolocation({ permission: "granted", position: { lng: 55.45 } });
        expect(originFromUserPosition("x")).toEqual({ ok: false, reason: "no-fix" });
    });
});
