/**
 * The toolbar's proximity button follows the filter after a reset.
 *
 * A reset — `GeoLeaf.Filter.reset()` or the panel's button — disarms the proximity the toolbar
 * placed, but the toolbar kept its own flag: the button stayed lit, and the next press
 * « disarmed » a proximity already gone, so the user needed two presses to arm it again. On a
 * filter pass, a button that believes itself active while the filter's wrapper is no longer armed
 * switches off.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { syncProximityWithFilter } from "../../src/kernel/ui/mobile/mobile-toolbar-proximity.js";
import { domState } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";

let button: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    const toolbar = document.createElement("div");
    button = document.createElement("button");
    button.setAttribute("data-gl-sheet", "proximity");
    button.classList.add("gl-map-toolbar__btn--active");
    toolbar.appendChild(button);
    document.body.appendChild(toolbar);
    domState.toolbar = toolbar;
    domState.proximityActive = true;
    domState.proximityBar = null;
});

function wrapper(armed: boolean): void {
    const w = document.createElement("div");
    w.id = "gl-proximity-toolbar-wrapper";
    if (armed) w.setAttribute("data-proximity-armed", "");
    document.body.appendChild(w);
}

describe("syncProximityWithFilter — le bouton suit le filtre", () => {
    it("proximité désarmée par une remise à zéro : le bouton s'éteint", () => {
        wrapper(false);
        syncProximityWithFilter();
        expect(domState.proximityActive).toBe(false);
        expect(button.classList.contains("gl-map-toolbar__btn--active")).toBe(false);
    });

    it("proximité encore armée : rien ne bouge", () => {
        wrapper(true);
        syncProximityWithFilter();
        expect(domState.proximityActive).toBe(true);
        expect(button.classList.contains("gl-map-toolbar__btn--active")).toBe(true);
    });

    it("bouton déjà éteint : rien à faire", () => {
        domState.proximityActive = false;
        button.classList.remove("gl-map-toolbar__btn--active");
        syncProximityWithFilter();
        expect(button.classList.contains("gl-map-toolbar__btn--active")).toBe(false);
    });
});
