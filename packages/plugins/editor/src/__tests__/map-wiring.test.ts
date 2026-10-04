/**
 * Tests for map-wiring.ts — the editor wires itself once per engine map.
 *
 * ## The defect this pins
 *
 * The editor wired itself on `geoleaf:map:ready` with `{ once: true }`. `GeoLeaf.mount()`
 * unmounts the application and boots it again on a second map: nothing wired the editor on it.
 * Measured in a real browser — the tool stayed reachable, and arming it put no drawing layer on
 * the new map, the engine being the one of the map that had gone.
 *
 * Listening for ever is not enough either: the signal is emitted several times per boot, and
 * again when a theme refits the view. The map's identity is what tells « the same map again »
 * from « a new map ».
 */
import { describe, it, expect, vi } from "vitest";
import { wireOncePerMap } from "../map-wiring.js";

/** A wiring whose current map the test sets. */
function makeWiring(initial: unknown = null) {
    const state = { map: initial };
    const wire = vi.fn();
    const unwire = vi.fn();
    const onMapReady = wireOncePerMap({ getMap: () => state.map, wire, unwire });
    return { state, wire, unwire, onMapReady };
}

describe("wireOncePerMap", () => {
    it("wires on the first signal", () => {
        const { wire, unwire, onMapReady } = makeWiring({ id: "first" });
        onMapReady();
        expect(wire).toHaveBeenCalledTimes(1);
        expect(unwire).not.toHaveBeenCalled();
    });

    it("🛑 wires ONCE per map — the signal is emitted several times per boot", () => {
        const { wire, unwire, onMapReady } = makeWiring({ id: "first" });
        onMapReady();
        onMapReady();
        onMapReady();
        expect(wire).toHaveBeenCalledTimes(1);
        expect(unwire).not.toHaveBeenCalled();
    });

    it("🛑 wires again on a NEW map, after taking the previous wiring down", () => {
        const order: string[] = [];
        const { state, wire, unwire, onMapReady } = makeWiring({ id: "first" });
        wire.mockImplementation(() => order.push("wire"));
        unwire.mockImplementation(() => order.push("unwire"));
        onMapReady();

        state.map = { id: "second" };
        onMapReady();

        expect(order).toEqual(["wire", "unwire", "wire"]);
    });

    it("🛑 does nothing while there is no map — a late signal of an unmounted application", () => {
        const { state, wire, unwire, onMapReady } = makeWiring({ id: "first" });
        onMapReady();

        state.map = null;
        onMapReady();

        expect(wire).toHaveBeenCalledTimes(1);
        expect(unwire).not.toHaveBeenCalled();
    });

    it("a signal on the same map does not bring back an editor the host destroyed", () => {
        // `GeoLeaf.Editor.destroy()` does not go through this handler: nothing is recorded, and
        // the map it was wired on is still the map alive.
        const map = { id: "first" };
        const { wire, onMapReady } = makeWiring(map);
        onMapReady();
        onMapReady();
        expect(wire).toHaveBeenCalledTimes(1);
    });

    it("wires without a map the first time — the menu does not need one", () => {
        const { state, wire, unwire, onMapReady } = makeWiring(null);
        onMapReady();
        expect(wire).toHaveBeenCalledTimes(1);

        // The map arrives: the wiring is redone on it, the engine reading the map at wire time.
        state.map = { id: "first" };
        onMapReady();
        expect(unwire).toHaveBeenCalledTimes(1);
        expect(wire).toHaveBeenCalledTimes(2);
    });

    it("reads `undefined` as no map", () => {
        const { state, wire, onMapReady } = makeWiring({ id: "first" });
        onMapReady();
        state.map = undefined;
        onMapReady();
        expect(wire).toHaveBeenCalledTimes(1);
    });
});
