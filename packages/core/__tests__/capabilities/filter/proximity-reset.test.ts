/**
 * Resetting proximity clears the toolbar wrapper the filter engine reads.
 *
 * `resetProximity()` stopped at the map — circle, marker, click handler — and disarmed the mode.
 * The hidden wrapper the toolbar fills kept its centre (`data-proximity-active`, lat, lng): the
 * next filter pass read it again, and the filter's « reset » left the map filtered. Red on the
 * code before the fix: the attributes were still there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    resetProximity,
    TOOLBAR_ARMED_ATTR,
    TOOLBAR_WRAPPER_ID,
} from "../../../src/capabilities/filter/panel/proximity/proximity-deactivation.js";
import { ProximityState } from "../../../src/capabilities/filter/panel/proximity/proximity-state.js";
import type { IMapAdapter } from "../../../src/contracts/map-adapter.contract.js";

const { removeCircleAndMarker } = vi.hoisted(() => ({ removeCircleAndMarker: vi.fn() }));

vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-circle.js", () => ({
    removeCircleAndMarker,
}));
vi.mock("../../../src/kernel/shared/index.js", () => ({ disarmToolCursor: vi.fn() }));

function armedWrapper(): HTMLElement {
    const w = document.createElement("div");
    w.id = TOOLBAR_WRAPPER_ID;
    w.setAttribute("data-gl-filter-id", "proximity");
    w.setAttribute("data-proximity-active", "true");
    w.setAttribute("data-proximity-lat", "-34.6");
    w.setAttribute("data-proximity-lng", "-58.45");
    w.setAttribute("data-proximity-radius", "10");
    w.setAttribute(TOOLBAR_ARMED_ATTR, "");
    document.body.appendChild(w);
    return w;
}

beforeEach(() => {
    document.body.innerHTML = "";
    removeCircleAndMarker.mockClear();
    ProximityState.mode = true;
    ProximityState.pendingRadius = 4;
    ProximityState.clickHandler = null;
    ProximityState.map = { off: vi.fn() } as unknown as IMapAdapter;
});

describe("resetProximity — la proximité de la barre", () => {
    it("retire le centre et l'armement du wrapper, garde le rayon", () => {
        const w = armedWrapper();
        resetProximity();
        expect(w.hasAttribute("data-proximity-active")).toBe(false);
        expect(w.hasAttribute("data-proximity-lat")).toBe(false);
        expect(w.hasAttribute("data-proximity-lng")).toBe(false);
        expect(w.hasAttribute(TOOLBAR_ARMED_ATTR)).toBe(false);
        expect(w.getAttribute("data-proximity-radius")).toBe("10");
    });

    it("désarme le mode, oublie le rayon en attente et nettoie la carte", () => {
        armedWrapper();
        resetProximity();
        expect(ProximityState.mode).toBe(false);
        expect(ProximityState.pendingRadius).toBeNull();
        expect(removeCircleAndMarker).toHaveBeenCalledTimes(1);
    });

    it("sans carte retenue, le wrapper est quand même vidé", () => {
        ProximityState.map = null;
        const w = armedWrapper();
        resetProximity();
        expect(w.hasAttribute("data-proximity-active")).toBe(false);
        expect(ProximityState.mode).toBe(false);
    });
});
