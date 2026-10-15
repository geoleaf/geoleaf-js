/**
 * @geoleaf-plugins/isochrone — picking a point on the map
 *
 * One click, one point; the cursor and the flag that keeps a click from opening a feature's
 * sheet are given back as they WERE; leaving twice does nothing; and with no map to click the
 * mode says it is not armed.
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

    it("keeps a click from opening a feature's sheet while armed, and gives the flag back", () => {
        const mode = pickOriginOnMap(() => {});
        expect(map.native.__geoleafExclusiveMode).toBe(true);
        mode.stop();
        expect(map.native.__geoleafExclusiveMode).toBe(false);
    });

    it("leaves the flag raised when another mode had raised it", () => {
        map.native.__geoleafExclusiveMode = true;
        const mode = pickOriginOnMap(() => {});
        mode.stop();
        expect(map.native.__geoleafExclusiveMode).toBe(true);
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

    it("still picks when the native map cannot be reached", () => {
        const adapter = { ...map, getNativeMap: () => undefined };
        host.GeoLeaf = { Core: { getMap: () => adapter } };
        const onPick = vi.fn();
        const mode = pickOriginOnMap(onPick);
        expect(mode.active).toBe(true);
        map.click(1, 2);
        expect(onPick).toHaveBeenCalledWith([1, 2]);
    });
});
