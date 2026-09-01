/**
 * Tests for tool-custom.ts — the envelope a registered tool is armed inside.
 *
 * The subject is NOT the third party's callbacks but what the plugin guarantees around them:
 * exclusive mode, cursor, cursor guard, and a balanced arm/disarm however the caller switches.
 * Those three invariants are unreachable from `onActivate(map: unknown)`, which is the whole
 * reason the envelope exists here rather than in the integrator's code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";
import { initLayers } from "../draw-layers.js";
import { activateCustom, deactivateCustom, getActiveCustomId } from "../tools/tool-custom.js";
import type { MeasureMap } from "../types.js";

let map: ReturnType<typeof makeMockMaplibreMap>;

beforeEach(() => {
    installMockGeoLeaf();
    map = makeMockMaplibreMap();
    initLayers(map as unknown as MeasureMap); // wires setCursor() to this map
});

afterEach(() => {
    deactivateCustom();
    uninstallMockGeoLeaf();
});

const arm = (id: string, def: Record<string, unknown> = {}) =>
    activateCustom(map as unknown as MeasureMap, id, def as never);

describe("activateCustom — the envelope", () => {
    it("claims exclusive mode so the core's hover handlers stand down", () => {
        arm("denivele");
        expect(
            (map as unknown as { __geoleafExclusiveMode?: boolean }).__geoleafExclusiveMode
        ).toBe(true);
    });

    it("paints the declared cursor", () => {
        arm("denivele", { cursor: "cell" });
        expect(map.getCanvas().style.cursor).toBe("cell");
    });

    it("falls back to crosshair when the definition declares no cursor", () => {
        arm("denivele");
        expect(map.getCanvas().style.cursor).toBe("crosshair");
    });

    it("calls onActivate with the map, AFTER the envelope is in place", () => {
        const onActivate = vi.fn(() => {
            // Observed from inside the callback: the tool is already fully armed.
            expect(map.getCanvas().style.cursor).toBe("cell");
            expect(
                (map as unknown as { __geoleafExclusiveMode?: boolean }).__geoleafExclusiveMode
            ).toBe(true);
        });
        arm("denivele", { cursor: "cell", onActivate });
        expect(onActivate).toHaveBeenCalledWith(map);
    });

    it("guards the cursor against an external write", async () => {
        arm("denivele", { cursor: "cell" });
        map.getCanvas().style.cursor = ""; // exactly what a POI mouseleave writes
        await new Promise((r) => setTimeout(r, 0)); // flush the MutationObserver microtask
        expect(map.getCanvas().style.cursor).toBe("cell");
    });

    it("is idempotent for the same id — onActivate fires once", () => {
        const onActivate = vi.fn();
        arm("denivele", { onActivate });
        arm("denivele", { onActivate });
        expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it("switching id disarms the previous tool first", () => {
        const onDeactivate = vi.fn();
        arm("premier", { onDeactivate });
        arm("second");
        expect(onDeactivate).toHaveBeenCalled();
        expect(getActiveCustomId()).toBe("second");
    });
});

describe("deactivateCustom — the teardown", () => {
    it("releases exclusive mode and restores the pan cursor", () => {
        arm("denivele", { cursor: "cell" });
        deactivateCustom();
        expect(
            (map as unknown as { __geoleafExclusiveMode?: boolean }).__geoleafExclusiveMode
        ).toBe(false);
        expect(map.getCanvas().style.cursor).toBe("grab");
    });

    it("calls onDeactivate BEFORE the envelope comes down", () => {
        const onDeactivate = vi.fn(() => {
            // The callback sees the same armed state on both edges.
            expect(
                (map as unknown as { __geoleafExclusiveMode?: boolean }).__geoleafExclusiveMode
            ).toBe(true);
        });
        arm("denivele", { onDeactivate });
        deactivateCustom();
        expect(onDeactivate).toHaveBeenCalled();
    });

    it("stops guarding the cursor once disarmed", async () => {
        arm("denivele", { cursor: "cell" });
        deactivateCustom();
        map.getCanvas().style.cursor = "pointer";
        await new Promise((r) => setTimeout(r, 0));
        expect(map.getCanvas().style.cursor).toBe("pointer");
    });

    it("is safe to call when nothing is armed", () => {
        expect(() => deactivateCustom()).not.toThrow();
        expect(getActiveCustomId()).toBeNull();
    });

    it("reports the armed id, and null once disarmed", () => {
        expect(getActiveCustomId()).toBeNull();
        arm("denivele");
        expect(getActiveCustomId()).toBe("denivele");
        deactivateCustom();
        expect(getActiveCustomId()).toBeNull();
    });
});
