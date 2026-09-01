import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    handleClick,
    closePopup,
    destroyPopup,
} from "../../../src/capabilities/feature-info/surfaces/popup.js";
import {
    isSidePanelOpen,
    destroySidePanel,
} from "../../../src/capabilities/feature-info/surfaces/sidepanel.js";
class FakePopup {
    constructor(opts) {
        this.opts = opts;
        FakePopup.instances.push(this);
    }
    static instances = [];
    lngLat = null;
    node = null;
    _onClose = null;
    setLngLat(ll) {
        this.lngLat = ll;
        return this;
    }
    setDOMContent(n) {
        this.node = n;
        return this;
    }
    addTo() {
        if (this.node) document.body.appendChild(this.node);
        return this;
    }
    remove() {
        this.node?.remove();
        this._onClose?.();
        return this;
    }
    on(type, cb) {
        if (type === "close") this._onClose = cb;
        return this;
    }
}
const DETAIL = {
    layerId: "l1",
    featureId: "f1",
    properties: { name: "Col du Tourmalet", altitude: 2115 },
    geometry: null,
    lngLat: { lat: 42.9, lng: 0.1 },
    point: { x: 100, y: 200 },
};
/**
 * Default declaration for the suites testing the popup's MECHANICS —
 * mounting, anchoring, replacement — and not field resolution.
 *
 * ⚠️ These suites called `stubGeoLeaf()` with no argument and leaned on the
 * implicit fallback ("no binding ⟹ render all properties"). The decision
 * removes that fallback: they thus declare explicitly what they paint. The
 * tested behaviour is the same; what changes is that it is asked for.
 */
// ⚠️ The panel is declared too. The "See more" affordance used to be
// `!binding || binding.sidepanel !== false` — the implicit fallback again,
// leading to a panel nothing had described. It now requires a DECLARED destination.
const DEFAULT_POPUP = {
    popup: [{ field: "name" }, { field: "altitude" }],
    sidepanel: [{ field: "name" }, { field: "altitude" }],
};

function stubGeoLeaf(binding = DEFAULT_POPUP) {
    globalThis.maplibregl = { Popup: FakePopup };
    globalThis.GeoLeaf = {
        GeoJSON: {
            getLayerConfig: (id) =>
                id === "l1" && binding ? { capabilities: { "feature-info": binding } } : null,
        },
        Core: { getMap: () => ({ getNativeMap: () => ({ addSource: () => void 0 }) }) },
        I18n: { t: (_k, fb) => fb },
    };
}
function cleanup() {
    destroyPopup();
    destroySidePanel();
    delete globalThis.GeoLeaf;
    delete globalThis.maplibregl;
    FakePopup.instances = [];
}
function popup() {
    return document.querySelector(".gl-poi-popup");
}
describe("handleClick()", () => {
    beforeEach(() => stubGeoLeaf());
    afterEach(cleanup);
    it("mounts a .gl-poi-popup content node", () => {
        handleClick(DETAIL);
        expect(popup()).not.toBeNull();
    });
    it("anchors the popup at the feature lngLat", () => {
        handleClick(DETAIL);
        expect(FakePopup.instances.at(-1)?.lngLat).toEqual({ lng: 0.1, lat: 42.9 });
    });
    it("requests closeOnClick and no close button (native dismiss)", () => {
        handleClick(DETAIL);
        expect(FakePopup.instances.at(-1)?.opts?.closeOnClick).toBe(true);
        expect(FakePopup.instances.at(-1)?.opts?.closeButton).toBe(false);
    });
    it("shows the declared feature values", () => {
        handleClick(DETAIL);
        expect(popup().textContent).toContain("Col du Tourmalet");
    });
    // ⚠️ FLIPPED on 02/08/2026. This case asserted "no binding ⟹ dump of
    // all properties" — a complete bypass of the attribute contract,
    // reachable by declaring nothing. It now asserts the opposite, and the
    // same test guards the decision.
    it("n'ouvre RIEN quand la couche ne d\u00e9clare aucune lecture", () => {
        stubGeoLeaf(null);
        handleClick(DETAIL);
        expect(popup()).toBeNull();
    });
    it("is a no-op when maplibregl is unavailable", () => {
        delete globalThis.maplibregl;
        handleClick(DETAIL);
        expect(popup()).toBeNull();
    });
    it("does not open when binding.popup is false", () => {
        stubGeoLeaf({ popup: false });
        handleClick(DETAIL);
        expect(popup()).toBeNull();
    });
    it("replaces the existing popup on a second click", () => {
        handleClick(DETAIL);
        handleClick({ ...DETAIL, featureId: "f2", properties: { name: "Autre" } });
        expect(document.querySelectorAll(".gl-poi-popup").length).toBe(1);
    });
    it("renders a link field as a real <a> (full mode)", () => {
        stubGeoLeaf({ popup: [{ field: "site", type: "link" }] });
        handleClick({ ...DETAIL, properties: { site: "https://example.com" } });
        expect(
            popup().querySelector("a.gl-poi-website-link[href='https://example.com']")
        ).not.toBeNull();
    });
    it("renders a title field as an <h3 class=gl-poi-popup__title>", () => {
        stubGeoLeaf({ popup: [{ field: "name", type: "text", variant: "title" }] });
        handleClick({ ...DETAIL, properties: { name: "Sommet" } });
        const t = popup().querySelector(".gl-poi-popup__title");
        expect(t.textContent).toBe("Sommet");
    });
    it("flushes a hero image outside the body", () => {
        stubGeoLeaf({
            popup: [
                { field: "photo", type: "image", variant: "hero" },
                { field: "name", type: "text" },
            ],
        });
        handleClick({ ...DETAIL, properties: { photo: "https://e.com/h.jpg", name: "X" } });
        const root = popup();
        const hero = root.querySelector("img.gl-poi-popup__hero");
        expect(hero).not.toBeNull();
        expect(root.querySelector(".gl-poi-popup__body")?.contains(hero)).toBe(false);
    });
    it("groups consecutive badges into a single container", () => {
        stubGeoLeaf({
            popup: [
                { field: "cat", type: "badge" },
                { field: "sub", type: "badge" },
            ],
        });
        handleClick({ ...DETAIL, properties: { cat: "A", sub: "B" } });
        const badges = popup().querySelectorAll(".gl-poi-popup__badges .gl-poi-badge");
        expect(badges.length).toBe(2);
    });
    it("applies prefix/suffix on text-family fields", () => {
        stubGeoLeaf({ popup: [{ field: "altitude", type: "metric", suffix: " m" }] });
        handleClick(DETAIL);
        expect(popup().textContent).toContain("2115 m");
    });
    // ⚠️ This case PINNED the defect: it was called "skips action fields (no
    // button rendered)" and asserted `querySelector("button")` at `null`. It
    // faithfully described what the code did — discard `action` fields — but
    // that behaviour contradicted the event contract, the layer configuration
    // types and the capability's types, which all promised a button and an
    // emission. A test can be green and guard the wrong behaviour: this one
    // did for the `action` type's whole life.
    it("rend un bouton pour un champ `action`, et laisse passer les autres champs", () => {
        stubGeoLeaf({
            popup: [
                { field: "cta", type: "action", actionId: "x", label: "Ouvrir" },
                { field: "name", type: "text" },
            ],
        });
        handleClick({ ...DETAIL, properties: { cta: "y", name: "Lac" } });
        const root = popup();
        const btn = root.querySelector("button.gl-poi-popup__action");
        expect(btn).not.toBeNull();
        expect(btn.dataset.glActionId).toBe("x");
        expect(root.textContent).toContain("Lac");
    });
    it('"Voir plus" opens the side-panel and closes the popup', () => {
        handleClick(DETAIL);
        const more = document.querySelector(".gl-poi-popup__link");
        expect(more).not.toBeNull();
        more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(isSidePanelOpen()).toBe(true);
        expect(popup()).toBeNull();
    });
    it('"Voir plus" is absent when binding.sidepanel is false', () => {
        stubGeoLeaf({ ...DEFAULT_POPUP, sidepanel: false });
        handleClick(DETAIL);
        expect(document.querySelector(".gl-poi-popup__link")).toBeNull();
    });
    it("closes on the Escape key", () => {
        handleClick(DETAIL);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(popup()).toBeNull();
    });
});
describe("closePopup() / destroyPopup()", () => {
    beforeEach(() => stubGeoLeaf());
    afterEach(cleanup);
    it("closePopup() removes the popup from the DOM", () => {
        handleClick(DETAIL);
        closePopup();
        expect(popup()).toBeNull();
    });
    it("destroyPopup() removes the popup from the DOM", () => {
        handleClick(DETAIL);
        destroyPopup();
        expect(popup()).toBeNull();
    });
});
