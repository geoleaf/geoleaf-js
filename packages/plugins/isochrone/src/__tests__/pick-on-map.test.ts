/**
 * @geoleaf-plugins/isochrone — picking a point on the map
 *
 * One click, one point; the crosshair and the guard that keeps a click from opening a feature's
 * sheet are held through the adapter's exclusive mode, never by writing the native map; leaving
 * twice does nothing; with no map to click the mode says it is not armed; and an adapter without
 * exclusive mode still picks. Cases marked 🔴 were seen red with the native write put back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickOriginOnMap } from "../pick-on-map.js";
import { createFakeMap, type FakeMap } from "./fake-map.js";

const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;
let map: FakeMap;

beforeEach(() => {
    map = createFakeMap();
    host.GeoLeaf = { Core: { getMap: () => map } };
});

afterEach(() => {
    host.GeoLeaf = previous;
});

describe("pickOriginOnMap", () => {
    it("gives the clicked point, once, and leaves the mode before saying it", () => {
        const onPick = vi.fn(() => {
            expect(map.clickHandlers.size).toBe(0);
        });
        const mode = pickOriginOnMap(onPick);
        expect(mode.active).toBe(true);
        map.click(55.45, -20.88);
        map.click(56, -21);
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith([55.45, -20.88]);
        expect(mode.active).toBe(false);
    });

    it("subscribes through the adapter, and gives the same handler back", () => {
        const mode = pickOriginOnMap(() => {});
        const handler = vi.mocked(map.on).mock.calls[0]?.[1];
        mode.stop();
        expect(map.off).toHaveBeenCalledWith("click", handler);
    });

    it("ignores a click that carries no position", () => {
        const onPick = vi.fn();
        const mode = pickOriginOnMap(onPick);
        for (const handler of map.clickHandlers) handler({});
        for (const handler of map.clickHandlers) handler({ latlng: { lat: Number.NaN, lng: 1 } });
        expect(onPick).not.toHaveBeenCalled();
        expect(mode.active).toBe(true);
        mode.stop();
    });

    it("reads the engine's position when the adapter added none", () => {
        const onPick = vi.fn();
        pickOriginOnMap(onPick);
        for (const handler of [...map.clickHandlers]) handler({ lngLat: { lng: 3, lat: 4 } });
        expect(onPick).toHaveBeenCalledWith([3, 4]);
    });

    it("draws a crosshair, and gives the cursor back as it WAS", () => {
        const canvas = map.getCanvas();
        canvas.style.cursor = "help";
        const mode = pickOriginOnMap(() => {});
        expect(canvas.style.cursor).toBe("crosshair");
        mode.stop();
        expect(canvas.style.cursor).toBe("help");
    });

    it("🔴 holds exclusive mode on the adapter while armed, and leaves the native map unwritten", () => {
        const mode = pickOriginOnMap(() => {});
        expect(map.exclusive.held).toBe(true);
        expect(map.enterExclusiveMode).toHaveBeenCalledWith("crosshair");
        mode.stop();
        expect(map.exclusive.held).toBe(false);
        expect(map.native.__geoleafExclusiveMode).toBeUndefined();
    });

    it("releases the mode on leaving, even when another tool had entered it before", () => {
        // No token: the picking superseded that tool, and leaving does not hand the mode back.
        map.enterExclusiveMode?.();
        const mode = pickOriginOnMap(() => {});
        mode.stop();
        expect(map.exclusive.held).toBe(false);
    });

    it("leaves once, however many times it is told to", () => {
        const canvas = map.getCanvas();
        const mode = pickOriginOnMap(() => {});
        mode.stop();
        canvas.style.cursor = "wait";
        mode.stop();
        expect(canvas.style.cursor).toBe("wait");
        expect(map.off).toHaveBeenCalledTimes(1);
    });

    it("is inert without a map to click", () => {
        host.GeoLeaf = { Core: { getMap: () => null } };
        const mode = pickOriginOnMap(() => {});
        expect(mode.active).toBe(false);
        expect(() => mode.stop()).not.toThrow();
    });

    it("is inert on an adapter that cannot be subscribed to", () => {
        host.GeoLeaf = { Core: { getMap: () => ({ getContainer: () => map.container }) } };
        expect(pickOriginOnMap(() => {}).active).toBe(false);
    });

    it("🔴 still picks on an adapter without exclusive mode, and writes nothing in its place", () => {
        const bare = createFakeMap({ exclusive: "absent" });
        host.GeoLeaf = { Core: { getMap: () => bare } };
        const onPick = vi.fn();
        const mode = pickOriginOnMap(onPick);
        expect(mode.active).toBe(true);
        bare.click(1, 2);
        expect(onPick).toHaveBeenCalledWith([1, 2]);
        expect(bare.native.__geoleafExclusiveMode).toBeUndefined();
        expect(bare.getCanvas().style.cursor).toBe("");
    });
});
