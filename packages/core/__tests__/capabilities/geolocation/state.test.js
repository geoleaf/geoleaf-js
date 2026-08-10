/**
 * Geolocation capability — state singleton.
 * Relocated from __tests__/ui/geolocation-state-branches.test.js (extraction roadmap
 * contrôles carte). Pure state module — no mocks needed.
 */
"use strict";

describe("capabilities/geolocation — GeoLocationState", () => {
    let GeoLocationState;

    beforeAll(async () => {
        const mod = await import("../../../src/capabilities/geolocation/state.ts");
        GeoLocationState = mod.GeoLocationState;
    });

    beforeEach(() => {
        GeoLocationState.active = false;
        GeoLocationState.watchId = null;
        GeoLocationState.userPosition = null;
        GeoLocationState.userPositionAccuracy = null;
    });

    it("initial state: active is false", () => {
        expect(GeoLocationState.active).toBe(false);
    });

    it("initial state: watchId is null", () => {
        expect(GeoLocationState.watchId).toBeNull();
    });

    it("initial state: userPosition is null", () => {
        expect(GeoLocationState.userPosition).toBeNull();
    });

    it("initial state: userPositionAccuracy is null", () => {
        expect(GeoLocationState.userPositionAccuracy).toBeNull();
    });

    it("set active=true / active=false", () => {
        GeoLocationState.active = true;
        expect(GeoLocationState.active).toBe(true);
        GeoLocationState.active = false;
        expect(GeoLocationState.active).toBe(false);
    });

    it("set watchId to a number then back to null", () => {
        GeoLocationState.watchId = 42;
        expect(GeoLocationState.watchId).toBe(42);
        GeoLocationState.watchId = null;
        expect(GeoLocationState.watchId).toBeNull();
    });

    it("set userPosition to a coordinates object", () => {
        const pos = { lat: 48.8566, lng: 2.3522, timestamp: Date.now(), accuracy: 10 };
        GeoLocationState.userPosition = pos;
        expect(GeoLocationState.userPosition).toEqual(pos);
        expect(GeoLocationState.userPosition.lat).toBe(48.8566);
        expect(GeoLocationState.userPosition.lng).toBe(2.3522);
    });

    it("set userPosition to null clears it", () => {
        GeoLocationState.userPosition = { lat: 1, lng: 2, timestamp: 0, accuracy: 5 };
        GeoLocationState.userPosition = null;
        expect(GeoLocationState.userPosition).toBeNull();
    });

    it("set userPositionAccuracy to a number then null", () => {
        GeoLocationState.userPositionAccuracy = 15.5;
        expect(GeoLocationState.userPositionAccuracy).toBe(15.5);
        GeoLocationState.userPositionAccuracy = null;
        expect(GeoLocationState.userPositionAccuracy).toBeNull();
    });

    it("simulate watch start/stop", () => {
        GeoLocationState.active = true;
        GeoLocationState.watchId = 7;
        expect(GeoLocationState.active).toBe(true);
        expect(GeoLocationState.watchId).toBe(7);
        GeoLocationState.active = false;
        GeoLocationState.watchId = null;
        expect(GeoLocationState.watchId).toBeNull();
    });

    it("is an exported singleton (same reference on re-import)", async () => {
        const mod2 = await import("../../../src/capabilities/geolocation/state.ts");
        expect(mod2.GeoLocationState).toBe(GeoLocationState);
    });
});
