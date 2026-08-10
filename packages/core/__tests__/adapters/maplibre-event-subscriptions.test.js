/**
 * Unit tests for maplibre-event-subscriptions — the delegated-listener tracker
 * that flushes MapLibre `on(type, layerId, handler)` delegated listeners on
 * style rebuild / destroy.
 *
 * RM-P1 fix (a): before this tracker, each basemap rebuild re-bound the POI /
 * cluster / feature-interaction listeners without removing the previous copies,
 * leaking listeners and double-dispatching events. These tests lock the fix:
 * flush detaches every tracked listener, and a re-bind after flush yields
 * exactly one handler per layer (not two).
 */

import {
    trackMapCleanup,
    flushMapCleanups,
    trackedCleanupCount,
} from "../../src/adapters/maplibre/maplibre-event-subscriptions.js";
import { bindPoiEvents } from "../../src/adapters/maplibre/maplibre-poi-builders.js";
import { bindGeoJSONClusterEvents } from "../../src/adapters/maplibre/maplibre-cluster-builders.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const maplibregl = require("../__mocks__/maplibre-gl.cjs");

function freshMap() {
    return maplibregl.__createMockMap();
}

/** Number of handlers the mock map currently holds for `${event}:${layer}`. */
function handlerCount(map, key) {
    return (map.__eventHandlers[key] || []).length;
}

describe("maplibre-event-subscriptions", () => {
    describe("tracker primitives", () => {
        it("tracks and flushes cleanup thunks per map", () => {
            const map = freshMap();
            const a = vi.fn();
            const b = vi.fn();
            trackMapCleanup(map, a);
            trackMapCleanup(map, b);
            expect(trackedCleanupCount(map)).toBe(2);

            flushMapCleanups(map);
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
            expect(trackedCleanupCount(map)).toBe(0);
        });

        it("isolates maps (WeakMap keyed by instance)", () => {
            const m1 = freshMap();
            const m2 = freshMap();
            trackMapCleanup(m1, vi.fn());
            expect(trackedCleanupCount(m1)).toBe(1);
            expect(trackedCleanupCount(m2)).toBe(0);
            flushMapCleanups(m2); // unknown map → no-op
            expect(trackedCleanupCount(m1)).toBe(1);
        });

        it("swallows individual teardown errors and still clears the rest", () => {
            const map = freshMap();
            const boom = vi.fn(() => {
                throw new Error("layer already removed by setStyle");
            });
            const ok = vi.fn();
            trackMapCleanup(map, boom);
            trackMapCleanup(map, ok);
            expect(() => flushMapCleanups(map)).not.toThrow();
            expect(ok).toHaveBeenCalledTimes(1);
            expect(trackedCleanupCount(map)).toBe(0);
        });

        it("flush on an unknown map is a no-op", () => {
            const map = freshMap();
            expect(() => flushMapCleanups(map)).not.toThrow();
            expect(trackedCleanupCount(map)).toBe(0);
        });
    });

    describe("bindPoiEvents cleanup", () => {
        it("detaches every delegated listener on flush", () => {
            const map = freshMap();
            bindPoiEvents(map, "events", { onPointClick: vi.fn(), onClusterClick: vi.fn() });

            expect(handlerCount(map, "click:gl-poi-events-unclustered")).toBe(1);
            expect(handlerCount(map, "click:gl-poi-events-unclustered-icons")).toBe(1);
            expect(handlerCount(map, "click:gl-poi-events-clusters")).toBe(1);
            expect(handlerCount(map, "mouseenter:gl-poi-events-unclustered")).toBe(1);
            expect(handlerCount(map, "mouseleave:gl-poi-events-clusters")).toBe(1);
            expect(trackedCleanupCount(map)).toBeGreaterThan(0);

            flushMapCleanups(map);

            expect(handlerCount(map, "click:gl-poi-events-unclustered")).toBe(0);
            expect(handlerCount(map, "click:gl-poi-events-unclustered-icons")).toBe(0);
            expect(handlerCount(map, "click:gl-poi-events-clusters")).toBe(0);
            expect(handlerCount(map, "mouseenter:gl-poi-events-unclustered")).toBe(0);
            expect(handlerCount(map, "mouseenter:gl-poi-events-unclustered-icons")).toBe(0);
            expect(handlerCount(map, "mouseleave:gl-poi-events-clusters")).toBe(0);
            expect(trackedCleanupCount(map)).toBe(0);
        });

        it("re-binding after flush does NOT duplicate listeners (the leak fix)", () => {
            const map = freshMap();
            bindPoiEvents(map, "events", { onPointClick: vi.fn() });
            flushMapCleanups(map);
            bindPoiEvents(map, "events", { onPointClick: vi.fn() });

            // Exactly one handler per layer — two would be the pre-fix leak.
            expect(handlerCount(map, "click:gl-poi-events-unclustered")).toBe(1);
            expect(handlerCount(map, "click:gl-poi-events-unclustered-icons")).toBe(1);
            expect(handlerCount(map, "mouseenter:gl-poi-events-clusters")).toBe(1);
        });
    });

    describe("bindGeoJSONClusterEvents cleanup", () => {
        it("detaches cluster click + hover listeners on flush", () => {
            const map = freshMap();
            bindGeoJSONClusterEvents(map, "src-1", "layer-1-clusters");
            expect(handlerCount(map, "click:layer-1-clusters")).toBe(1);
            expect(handlerCount(map, "mouseenter:layer-1-clusters")).toBe(1);
            expect(handlerCount(map, "mouseleave:layer-1-clusters")).toBe(1);

            flushMapCleanups(map);
            expect(handlerCount(map, "click:layer-1-clusters")).toBe(0);
            expect(handlerCount(map, "mouseenter:layer-1-clusters")).toBe(0);
            expect(handlerCount(map, "mouseleave:layer-1-clusters")).toBe(0);
        });

        it("re-binding after flush does NOT duplicate cluster listeners", () => {
            const map = freshMap();
            bindGeoJSONClusterEvents(map, "src-1", "layer-1-clusters");
            flushMapCleanups(map);
            bindGeoJSONClusterEvents(map, "src-1", "layer-1-clusters");
            expect(handlerCount(map, "click:layer-1-clusters")).toBe(1);
            expect(handlerCount(map, "mouseenter:layer-1-clusters")).toBe(1);
        });
    });
});
