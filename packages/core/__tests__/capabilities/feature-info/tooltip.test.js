import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    handleHover,
    destroyTooltip,
} from "../../../src/capabilities/feature-info/surfaces/tooltip.js";
/**
 * Déclaration par défaut des cas qui testent la MÉCANIQUE de l'infobulle —
 * création, position, empilement, échappement — et non la résolution des champs.
 *
 * ⚠️ Ces cas appelaient `stubGeoLeaf()` sans argument et s'appuyaient sur un repli
 * qui montrait la PREMIÈRE propriété d'une couche non déclarée : une troisième
 * orthographe de la même règle implicite, que la bulle et le panneau écrivaient
 * chacun autrement. La décision U2 la retire.
 */
const DEFAULT_TOOLTIP = { tooltip: [{ field: "name" }] };

function stubGeoLeaf(binding = DEFAULT_TOOLTIP) {
    globalThis.GeoLeaf = {
        GeoJSON: {
            getLayerConfig: (id) =>
                id === "l1" && binding ? { capabilities: { "feature-info": binding } } : null,
        },
        Core: {
            getMap: () => ({ getNativeMap: () => ({ getContainer: () => document.body }) }),
        },
    };
}
const MOVE = {
    layerId: "l1",
    properties: { name: "Vall\xE9e verte" },
    point: { x: 50, y: 80 },
    zIndex: 0,
    phase: "move",
};
const LEAVE = { ...MOVE, properties: {}, phase: "leave" };
function tt() {
    return document.querySelector(".gl-fi-tooltip");
}
describe("handleHover()", () => {
    beforeEach(() => stubGeoLeaf());
    afterEach(() => {
        destroyTooltip();
        delete globalThis.GeoLeaf;
    });
    it("creates the tooltip element on move", () => {
        handleHover(MOVE);
        expect(tt()).not.toBeNull();
    });
    it("positions the tooltip at the pointer", () => {
        handleHover(MOVE);
        const el = tt();
        expect(el.style.left).toBe("50px");
        expect(el.style.top).toBe("80px");
    });
    it("shows the property value as plain text (no detail table)", () => {
        handleHover(MOVE);
        const el = tt();
        expect(el.querySelector("table")).toBeNull();
        expect(el.textContent).toContain("Vall\xE9e verte");
    });
    it("joins multiple fields with ' | '", () => {
        stubGeoLeaf({ tooltip: [{ field: "name" }, { field: "area" }] });
        handleHover({ ...MOVE, properties: { name: "Lac", area: 42 } });
        expect(tt().textContent).toBe("Lac | 42");
    });
    it("hides the tooltip on leave", () => {
        handleHover(MOVE);
        handleHover(LEAVE);
        const el = tt();
        if (el) expect(el.style.display).toBe("none");
    });
    it("suppresses the tooltip when binding.tooltip === false", () => {
        stubGeoLeaf({ tooltip: false });
        handleHover(MOVE);
        expect(tt()).toBeNull();
    });
    it("keeps only the highest-zIndex layer when layers overlap", () => {
        handleHover({ ...MOVE, zIndex: 0, properties: { name: "Basse" } });
        handleHover({ ...MOVE, zIndex: 5, properties: { name: "Haute" } });
        expect(tt().textContent).toContain("Haute");
    });
    it("skips image and action fields (degraded, not rendered)", () => {
        stubGeoLeaf({
            tooltip: [
                { field: "photo", type: "image" },
                { field: "cta", type: "action", actionId: "x", label: "Ouvrir" },
                { field: "name" },
            ],
        });
        handleHover({
            ...MOVE,
            properties: { photo: "https://e.com/a.jpg", cta: "y", name: "Lac" },
        });
        const el = tt();
        expect(el.querySelector("img")).toBeNull();
        expect(el.textContent).toBe("Lac");
    });
    it("renders a url field as escaped text \u2014 no <a>", () => {
        stubGeoLeaf({ tooltip: [{ field: "site", type: "url" }] });
        handleHover({ ...MOVE, properties: { site: "https://example.com" } });
        const el = tt();
        expect(el.querySelector("a")).toBeNull();
        expect(el.textContent).toContain("https://example.com");
    });
    it("HTML-escapes field values", () => {
        stubGeoLeaf({ tooltip: [{ field: "name" }] });
        handleHover({ ...MOVE, properties: { name: "<b>x</b>" } });
        const el = tt();
        expect(el.querySelector("b")).toBeNull();
        expect(el.textContent).toContain("<b>x</b>");
    });
    it("does not show the tooltip when nothing is displayable", () => {
        stubGeoLeaf({ tooltip: [{ field: "missing" }] });
        handleHover({ ...MOVE, properties: {} });
        expect(tt()).toBeNull();
    });
    // ⚠️ RETOURNÉ le 02/08/2026 (U2). Ce cas asseyait « pas de binding ⟹ montre la
    // première propriété ». C'était le repli implicite dans sa troisième orthographe,
    // celle de l'infobulle. Il asserte désormais l'inverse.
    it("ne montre RIEN quand la couche ne déclare aucune infobulle", () => {
        stubGeoLeaf(null);
        handleHover({ ...MOVE, properties: { title: "Sans déclaration" } });
        expect(tt()).toBeNull();
    });
});
describe("destroyTooltip()", () => {
    beforeEach(() => stubGeoLeaf());
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });
    it("removes the tooltip element from the DOM", () => {
        handleHover(MOVE);
        destroyTooltip();
        expect(tt()).toBeNull();
    });
});
