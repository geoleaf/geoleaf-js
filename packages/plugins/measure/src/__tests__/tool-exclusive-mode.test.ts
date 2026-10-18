/**
 * Every built-in measure tool holds exclusive mode while armed — entered and exited on the GeoLeaf
 * adapter that drives the map, through `@geoleaf/host-runtime`'s seam. The native map is never
 * written: the core's flag is the adapter's business.
 *
 * And the fallback decided for an adapter without the members (a core older than 3.17.0): the
 * tool still arms, nothing throws, and nothing is written on the engine in their place.
 *
 * Every case was seen red, on each of the six tool files, with the native write put back in
 * place of the seam call.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    installMockGeoLeaf,
    uninstallMockGeoLeaf,
    installGeolocationMock,
    uninstallGeolocationMock,
    type MockGeoLeaf,
} from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import { initEngine } from "../measure-engine.js";
import { activateAnnotationTooltip, deactivateAnnotation } from "../tools/tool-annotation.js";
import { activateCircle, deactivateCircle } from "../tools/tool-circle.js";
import { activateCustom, deactivateCustom } from "../tools/tool-custom.js";
import { activateDistance, deactivateDistance } from "../tools/tool-distance.js";
import { activateGps, deactivateGps } from "../tools/tool-gps.js";
import { activatePolygon, deactivatePolygon } from "../tools/tool-polygon.js";
import { activateRect, deactivateRect } from "../tools/tool-rect.js";
import type { MeasureMap } from "../types.js";

type Tool = [name: string, arm: (map: MeasureMap) => void, disarm: () => void];

const TOOLS: Tool[] = [
    ["distance", activateDistance, deactivateDistance],
    ["polygon", activatePolygon, deactivatePolygon],
    ["circle (drag, tool-shared)", activateCircle, deactivateCircle],
    ["rect (drag, tool-shared)", activateRect, deactivateRect],
    ["gps", (m) => activateGps(m), deactivateGps],
    ["annotation", activateAnnotationTooltip, deactivateAnnotation],
    ["custom", (m) => activateCustom(m, "custom-probe", {} as never), deactivateCustom],
];

let gl: MockGeoLeaf;
let map: MeasureMap;

beforeEach(() => {
    gl = installMockGeoLeaf();
    installGeolocationMock();
    map = gl._nativeMap as MeasureMap;
    initLayers(map);
    initEngine(getMeasureConfig());
});

afterEach(() => {
    for (const [, , disarm] of TOOLS) disarm();
    uninstallGeolocationMock();
    uninstallMockGeoLeaf();
});

describe("measure tools — exclusive mode through the adapter", () => {
    it.each(TOOLS)("%s enters on arm and exits on disarm", (_name, arm, disarm) => {
        arm(map);
        expect(gl.exclusive.held).toBe(true);
        disarm();
        expect(gl.exclusive.held).toBe(false);
    });

    it.each(TOOLS)("%s never writes the core's flag on the native map", (_name, arm, disarm) => {
        arm(map);
        disarm();
        expect((map as unknown as Record<string, unknown>).__geoleafExclusiveMode).toBeUndefined();
    });

    it.each(TOOLS)(
        "%s still arms on an adapter without the members, and writes nothing in their place",
        (_name, arm, disarm) => {
            gl.Core.getMap.mockReturnValue({ getNativeMap: () => map });
            expect(() => arm(map)).not.toThrow();
            expect(() => disarm()).not.toThrow();
            expect(
                (map as unknown as Record<string, unknown>).__geoleafExclusiveMode
            ).toBeUndefined();
        }
    );
});
