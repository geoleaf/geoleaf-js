/**
 * Unit tests — exclusive mode on the MapLibre adapter: `enterExclusiveMode`,
 * `exitExclusiveMode` and `isExclusiveMode`, which delegate to `kernel/shared/map-cursor.ts`.
 *
 * What the contract promises, one rule per case: entering sets the flag the core's click and
 * hover handlers read on the ENGINE map; a given cursor is painted on the canvas, not the root
 * container; without one the cursor is left alone; entering twice keeps the first original;
 * exiting restores only what an entry painted, and is safe without one; the last entry wins
 * and any exit releases.
 *
 * Every case marked 🔴 was seen red under the mutation its comment names.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";
import { armToolCursor, disarmToolCursor } from "../../src/kernel/shared/map-cursor.js";

interface FakeEngineMap {
    __geoleafExclusiveMode?: boolean;
    canvas: { style: { cursor: string } };
    container: { style: { cursor: string } };
    [key: string]: unknown;
}

let engine: FakeEngineMap;

function makeEngine(): FakeEngineMap {
    const canvas = { style: { cursor: "" } };
    const container = { style: { cursor: "" } };
    return {
        canvas,
        container,
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        remove: vi.fn(),
        getCenter: vi.fn().mockReturnValue({ lat: 45, lng: -73 }),
        getZoom: vi.fn().mockReturnValue(10),
        jumpTo: vi.fn(),
        getContainer: vi.fn().mockReturnValue(container),
        getCanvas: vi.fn().mockReturnValue(canvas),
        addControl: vi.fn(),
        removeControl: vi.fn(),
    };
}

beforeEach(() => {
    engine = makeEngine();
    (globalThis as Record<string, unknown>).maplibregl = {
        // A class, given to `vi.fn` itself: the adapter calls `new`, and `mockImplementation`
        // is typed for plain functions only.
        Map: vi.fn(
            class {
                constructor() {
                    return engine;
                }
            }
        ),
    };
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).maplibregl;
});

function initedAdapter(): MaplibreAdapter {
    const adapter = new MaplibreAdapter();
    adapter.init({ container: "map", center: { lat: 45, lng: -73 }, zoom: 12 });
    return adapter;
}

describe("MaplibreAdapter — exclusive mode", () => {
    it("🔴 entering sets the flag on the engine map, where the core's handlers read it", () => {
        // Mutation: `armToolCursor` no longer sets the flag → red.
        const adapter = initedAdapter();
        adapter.enterExclusiveMode("crosshair");
        expect(engine.__geoleafExclusiveMode).toBe(true);
        expect(adapter.isExclusiveMode()).toBe(true);
    });

    it("🔴 a given cursor is painted on the canvas, not on the root container", () => {
        // Mutation: the cursor is not painted → red.
        const adapter = initedAdapter();
        adapter.enterExclusiveMode("crosshair");
        expect(engine.canvas.style.cursor).toBe("crosshair");
        expect(engine.container.style.cursor).toBe("");
    });

    it("🔴 without a cursor, only the mode is entered and the cursor is left alone", () => {
        // Mutation: an absent cursor is painted as "" → red (the tool's own cursor is wiped).
        const adapter = initedAdapter();
        engine.canvas.style.cursor = "move";
        adapter.enterExclusiveMode();
        expect(engine.__geoleafExclusiveMode).toBe(true);
        expect(engine.canvas.style.cursor).toBe("move");
    });

    it("🔴 exiting restores the cursor shown before the entry, and releases the mode", () => {
        // Mutation: the saved cursor is not restored → red.
        const adapter = initedAdapter();
        engine.canvas.style.cursor = "help";
        adapter.enterExclusiveMode("crosshair");
        adapter.exitExclusiveMode();
        expect(engine.canvas.style.cursor).toBe("help");
        expect(engine.__geoleafExclusiveMode).toBe(false);
        expect(adapter.isExclusiveMode()).toBe(false);
    });

    it("🔴 entering twice keeps the cursor shown before the FIRST entry", () => {
        // Mutation: the original is re-saved on every entry → red (exit restores "crosshair").
        const adapter = initedAdapter();
        engine.canvas.style.cursor = "help";
        adapter.enterExclusiveMode("crosshair");
        adapter.enterExclusiveMode("pointer");
        expect(engine.canvas.style.cursor).toBe("pointer");
        adapter.exitExclusiveMode();
        expect(engine.canvas.style.cursor).toBe("help");
    });

    it("🔴 exiting after a cursor-less entry leaves the cursor untouched", () => {
        // Mutation: a disarm with nothing saved clears the inline cursor → red.
        const adapter = initedAdapter();
        adapter.enterExclusiveMode();
        engine.canvas.style.cursor = "move";
        adapter.exitExclusiveMode();
        expect(engine.canvas.style.cursor).toBe("move");
        expect(engine.__geoleafExclusiveMode).toBe(false);
    });

    it("🔴 exiting without any entry is safe, and changes nothing but the flag", () => {
        // Mutation: a disarm with nothing saved clears the inline cursor → red.
        const adapter = initedAdapter();
        engine.canvas.style.cursor = "move";
        expect(() => adapter.exitExclusiveMode()).not.toThrow();
        expect(engine.canvas.style.cursor).toBe("move");
        expect(adapter.isExclusiveMode()).toBe(false);
    });

    it("🔴 the last entry wins, and any exit releases the mode — there is no token", () => {
        // Mutation: `isExclusiveMode` answers a constant `false` → red.
        const adapter = initedAdapter();
        adapter.enterExclusiveMode("crosshair"); // tool A
        adapter.enterExclusiveMode("copy"); // tool B takes over
        expect(engine.canvas.style.cursor).toBe("copy");
        expect(adapter.isExclusiveMode()).toBe(true);
        adapter.exitExclusiveMode(); // whichever tool exits, the mode is released
        expect(adapter.isExclusiveMode()).toBe(false);
        expect(engine.canvas.style.cursor).toBe("");
    });

    it("🔴 reads the flag written on the engine map by code that bypasses the adapter", () => {
        // The read answers for the engine, so a plugin still writing the flag directly is seen.
        // Mutation: `isExclusiveMode` answers a constant `false` → red.
        const adapter = initedAdapter();
        engine.__geoleafExclusiveMode = true;
        expect(adapter.isExclusiveMode()).toBe(true);
    });

    it("exit and read are no-ops without a map; entry throws like every other member", () => {
        const adapter = new MaplibreAdapter();
        expect(() => adapter.exitExclusiveMode()).not.toThrow();
        expect(adapter.isExclusiveMode()).toBe(false);
        expect(() => adapter.enterExclusiveMode("crosshair")).toThrow(/not ready/);
        const destroyed = initedAdapter();
        destroyed.destroy();
        expect(() => destroyed.exitExclusiveMode()).not.toThrow();
        expect(destroyed.isExclusiveMode()).toBe(false);
    });
});

describe("map-cursor — the same rules through an adapter-shaped map", () => {
    // The proximity capability passes an adapter, not the engine: the flag must land on the
    // engine behind it, and the cursor on its canvas.
    it("unwraps the adapter for the flag and paints its canvas", () => {
        const native: { __geoleafExclusiveMode?: boolean } = {};
        const canvas = { style: { cursor: "" } } as unknown as HTMLCanvasElement;
        const wrapper = {
            getCanvas: () => canvas,
            getContainer: () => document.createElement("div"),
            getNativeMap: () => native,
        };
        armToolCursor(wrapper, "crosshair");
        expect(native.__geoleafExclusiveMode).toBe(true);
        expect(canvas.style.cursor).toBe("crosshair");
        disarmToolCursor(wrapper);
        expect(native.__geoleafExclusiveMode).toBe(false);
        expect(canvas.style.cursor).toBe("");
    });
});
