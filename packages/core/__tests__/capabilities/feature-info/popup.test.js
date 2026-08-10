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
 * Déclaration par défaut des suites qui testent la MÉCANIQUE de la bulle — montage,
 * ancrage, remplacement — et non la résolution des champs.
 *
 * ⚠️ Ces suites appelaient `stubGeoLeaf()` sans argument et s'appuyaient sur le
 * repli implicite (« pas de binding ⟹ rend toutes les propriétés »). La décision U2
 * retire ce repli : elles déclarent donc explicitement ce qu'elles peignent. Le
 * comportement testé est le même ; ce qui change, c'est qu'il est demandé.
 */
// ⚠️ Le panneau est déclaré, lui aussi. L'affordance « Voir plus » valait
// auparavant `!binding || binding.sidepanel !== false` — encore le repli implicite,
// qui menait vers un panneau que rien n'avait décrit. Elle exige maintenant une
// destination DÉCLARÉE.
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
    // \u26a0\ufe0f RETOURN\u00c9 le 02/08/2026 (U2). Ce cas asseyait \u00ab pas de binding \u27f9 dump de
    // toutes les propri\u00e9t\u00e9s \u00bb \u2014 un contournement complet du contrat attributaire,
    // atteignable en ne d\u00e9clarant rien. Il asserte d\u00e9sormais l'inverse, et c'est le
    // m\u00eame test qui garde la d\u00e9cision.
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
    // ⚠️ Ce cas ÉPINGLAIT le défaut B-69 : il s'appelait « skips action fields (no button
    // rendered) » et assertait `querySelector("button")` à `null`. Il décrivait fidèlement ce que
    // le code faisait — écarter les champs `action` — mais ce comportement contredisait le contrat
    // d'événements, les types de configuration de couche et les types de la capacité, qui
    // promettaient tous un bouton et une émission. Un test peut être vert et garder le mauvais
    // comportement : celui-ci l'a fait pendant toute la vie du type `action`.
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
