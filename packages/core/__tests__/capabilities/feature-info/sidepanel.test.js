import { describe, it, expect, afterEach } from "vitest";
import {
    openSidePanel,
    closeSidePanel,
    isSidePanelOpen,
    destroySidePanel,
} from "../../../src/capabilities/feature-info/surfaces/sidepanel.js";
const BASE = {
    layerId: "l1",
    featureId: "f1",
    properties: { name: "Lac des Cygnes", area: 42 },
    geometry: null,
    lngLat: { lat: 48.8, lng: 2.3 },
    point: { x: 0, y: 0 },
};
/**
 * Déclaration par défaut des cas qui testent la MÉCANIQUE du panneau — ouverture,
 * fermeture, focus, accessibilité — et non la résolution des champs.
 *
 * ⚠️ Ces cas appelaient `stubGeoLeaf()` sans argument. Le repli implicite listait
 * alors toutes les propriétés puis les écartait TOUTES plus bas (un champ sans
 * widget était sauté avant le dispatch), ce qui rendait un corps vide. La décision
 * U2 retire les deux moitiés.
 */
const DEFAULT_SIDEPANEL = { sidepanel: [{ field: "name" }] };

function stubGeoLeaf(binding = DEFAULT_SIDEPANEL) {
    globalThis.GeoLeaf = {
        GeoJSON: {
            getLayerConfig: (id) =>
                id === "l1" && binding ? { capabilities: { "feature-info": binding } } : null,
        },
    };
}
function panel() {
    return document.querySelector(".gl-poi-sidepanel");
}
function body() {
    return document.querySelector(".gl-poi-sidepanel__body");
}
afterEach(() => {
    destroySidePanel();
    document.querySelector(".gl-poi-lightbox-global")?.remove();
    delete globalThis.GeoLeaf;
});
describe("openSidePanel() \u2014 shell & lifecycle", () => {
    it("opens without a GeoLeaf.POI dependency", () => {
        stubGeoLeaf();
        expect(() => openSidePanel(BASE)).not.toThrow();
        expect(isSidePanelOpen()).toBe(true);
        expect(document.querySelector(".gl-poi-sidepanel.open")).not.toBeNull();
    });
    it("opens when GeoLeaf is absent entirely", () => {
        expect(() => openSidePanel(BASE)).not.toThrow();
        expect(isSidePanelOpen()).toBe(true);
    });
    it("appends the panel to document.body and marks it open", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        expect(panel()?.parentElement).toBe(document.body);
        expect(document.body.classList.contains("gl-poi-sidepanel-open")).toBe(true);
    });
    it("renders the header close button and a body", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        expect(document.querySelector(".gl-poi-sidepanel__close")).not.toBeNull();
        expect(body()).not.toBeNull();
    });
    it("closes via the close button", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        document
            .querySelector(".gl-poi-sidepanel__close")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(isSidePanelOpen()).toBe(false);
        expect(document.querySelector(".gl-poi-sidepanel.open")).toBeNull();
    });
    it("closes via the Escape key", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(isSidePanelOpen()).toBe(false);
    });
    it("closes via an outside click", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(isSidePanelOpen()).toBe(false);
    });
    it("does not close on a click inside the panel", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        body().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(isSidePanelOpen()).toBe(true);
    });
    it("closeSidePanel() keeps the element in the DOM", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        closeSidePanel();
        expect(panel()).not.toBeNull();
    });
    it("destroySidePanel() removes the element", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        destroySidePanel();
        expect(panel()).toBeNull();
        expect(isSidePanelOpen()).toBe(false);
    });
    it("keeps the panel open on a Tab key (focus trap, no close)", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
        expect(isSidePanelOpen()).toBe(true);
    });
    it("reopening on a new feature reuses the same panel element", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        openSidePanel({ ...BASE, featureId: "f2", properties: { name: "Autre" } });
        expect(document.querySelectorAll(".gl-poi-sidepanel").length).toBe(1);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(isSidePanelOpen()).toBe(false);
    });
    // ── B.35 (c) — regression pin, NOT a bug fix ────────────────────────────
    //
    // `_attachListeners` runs on every open and `ensureContainer` reuses the same
    // close button, so the click registration is repeated N times. It does NOT
    // stack: `closeSidePanel` is a module-level function declaration, i.e. the
    // same object every time, and the DOM spec appends a listener only "if
    // eventTarget's event listener list does not contain an event listener whose
    // type is type, callback is callback, and capture is capture". The two
    // document-level handlers next to it are fresh closures per open — which is
    // exactly why `_detachListeners` exists for them and not for this one.
    //
    // The invariant is therefore *callback identity*, and it is one refactor away
    // from being lost (inlining `() => closeSidePanel()` would silently start
    // stacking). That is what this pins — behaviour alone cannot: extra runs are
    // invisible because `closeSidePanel` early-returns on `!_isOpen`.
    it("re-opening does not stack close-button handlers (callback identity)", () => {
        stubGeoLeaf();
        openSidePanel(BASE);
        const btn = document.querySelector(".gl-poi-sidepanel__close");
        const registered = [];
        const nativeAdd = btn.addEventListener.bind(btn);
        btn.addEventListener = (type, cb, opts) => {
            registered.push({ type, cb });
            return nativeAdd(type, cb, opts);
        };
        for (let i = 0; i < 5; i++) openSidePanel({ ...BASE, featureId: `f${i}` });
        const clickCallbacks = registered.filter((r) => r.type === "click").map((r) => r.cb);
        expect(clickCallbacks.length).toBeGreaterThanOrEqual(1);
        // One distinct callback across every re-registration → the DOM keeps one.
        expect(new Set(clickCallbacks).size).toBe(1);
    });
});
describe("openSidePanel() \u2014 content", () => {
    it("renders an escaped title (text field styled title)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "name", type: "text", style: "title" }] });
        openSidePanel({ ...BASE, properties: { name: "<b>Lac</b>" } });
        const title = document.querySelector(".gl-poi-sidepanel__title-text");
        expect(title.querySelector("b")).toBeNull();
        expect(title.textContent).toBe("<b>Lac</b>");
    });
    it("renders a hero image inside the body", () => {
        stubGeoLeaf({ sidepanel: [{ field: "photo", type: "image", variant: "hero" }] });
        openSidePanel({ ...BASE, properties: { photo: "https://e.com/lac.jpg" } });
        expect(body().querySelector(".gl-poi-sidepanel__photo--hero img")).not.toBeNull();
    });
    it("renders a link field as a real <a> (full mode)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "site", type: "link" }] });
        openSidePanel({ ...BASE, properties: { site: "https://example.com" } });
        expect(
            body().querySelector("a.gl-poi-website-link[href='https://example.com']")
        ).not.toBeNull();
    });
    it("always renders a badge (required field)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "cat", type: "badge" }] });
        openSidePanel({ ...BASE, properties: { cat: "Parc" } });
        expect(body().querySelector(".gl-poi-badge")?.textContent).toBe("Parc");
    });
    it("wraps an accordion field in <details class=gl-accordion>", () => {
        stubGeoLeaf({
            sidepanel: [
                {
                    field: "desc",
                    type: "text",
                    accordion: true,
                    defaultOpen: true,
                    label: "D\xE9tails",
                },
            ],
        });
        openSidePanel({ ...BASE, properties: { desc: "Un lac paisible" } });
        const acc = body().querySelector("details.gl-accordion");
        expect(acc).not.toBeNull();
        expect(acc.hasAttribute("open")).toBe(true);
        expect(acc.querySelector(".gl-accordion__header")?.textContent).toContain("D\xE9tails");
    });
    it("skips empty non-required fields", () => {
        stubGeoLeaf({ sidepanel: [{ field: "missing", type: "text" }] });
        openSidePanel({ ...BASE, properties: {} });
        expect(body().children.length).toBe(0);
    });
    // \u26a0\ufe0f RETOURN\u00c9 le 02/08/2026 (U2). Ce cas asseyait qu'un repli implicite rendait
    // un corps VIDE \u2014 deux d\u00e9fauts qui s'annulaient : la liste synth\u00e9tis\u00e9e n'avait
    // pas de widget, et un champ sans widget \u00e9tait saut\u00e9 avant le dispatch. C'est ce
    // qui faisait que le seul profil du d\u00e9p\u00f4t \u00e9crivant \u00ab all \u00bb sur cette surface
    // n'affichait rien. Les deux moiti\u00e9s sont retir\u00e9es.
    it("ne peint RIEN quand la couche ne d\u00e9clare aucune lecture", () => {
        stubGeoLeaf(null);
        openSidePanel(BASE);
        expect(body().children.length).toBe(0);
    });
    it("un champ d\u00e9clar\u00e9 SANS widget est rendu en texte, comme sur la bulle", () => {
        stubGeoLeaf({ sidepanel: [{ field: "name" }] });
        openSidePanel({ ...BASE, properties: { name: "Lac bleu" } });
        expect(body().textContent).toContain("Lac bleu");
    });
    it("opens the lightbox when the gallery main image is clicked", () => {
        stubGeoLeaf({ sidepanel: [{ field: "gal", type: "gallery" }] });
        openSidePanel({
            ...BASE,
            properties: { gal: ["https://e.com/1.jpg", "https://e.com/2.jpg"] },
        });
        const main = body().querySelector(".gl-poi-gallery__main img");
        expect(main).not.toBeNull();
        main.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelector(".gl-poi-lightbox-global")).not.toBeNull();
        document
            .querySelector(".gl-poi-lightbox__close")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // ⚠️ R.7b / scénario navigateur E.5 — une URL d'image REFUSÉE par safeUrl ne doit pas
    // empêcher le panneau de s'ouvrir, et la galerie doit rester navigable sur les images
    // survivantes, dans l'ordre.
    //
    // Contre-épreuve B.32 (CAPACITÉS S11) : une vignette dont l'URL est rejetée par `safeUrl`
    // ne porte PAS de `<img>` (media.ts:108-109, choix délibéré anti-sink). `attachGalleryEvents`
    // faisait `thumb.querySelector("img").src` sans garde → `TypeError` sur toute galerie
    // distante avec une seule mauvaise URL, et comme ce code tourne DANS `buildSidePanelBody`,
    // **tout le panneau échouait à s'ouvrir**. Le correctif exclut les vignettes vides de
    // l'ensemble navigable et remappe `data-index` dessus (lightbox.ts:314-323).
    //
    // Ce scénario est classé 🔴 « navigateur » dans la table, mais son défaut est un CRASH JS
    // (`TypeError`), que happy-dom décide aussi bien qu'un vrai navigateur — les tests de
    // navigation lightbox voisins tournent déjà sous happy-dom. Il est donc couvert ici, au
    // tier de ses pairs, plutôt qu'en E2E où il faudrait injecter une donnée forgée.
    it("une URL de galerie refusée n'empêche pas l'ouverture, et la navigation saute la vignette morte (E.5)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "gal", type: "gallery" }] });

        // 2 URLs valides encadrant une refusée (schéma javascript:) — la refusée est au milieu
        // pour que le remap de `data-index` soit discriminant : sans remap, la 3ᵉ garderait
        // l'index 2 et la navigation viserait la mauvaise image.
        openSidePanel({
            ...BASE,
            properties: {
                gal: ["https://e.com/1.jpg", "javascript:alert(1)", "https://e.com/3.jpg"],
            },
        });

        // 1 — le panneau s'ouvre (c'est ce que le TypeError bloquait).
        expect(isSidePanelOpen()).toBe(true);
        const main = body().querySelector(".gl-poi-gallery__main img");
        expect(main, "le panneau de galerie ne s'est pas construit").not.toBeNull();

        // 2 — trois vignettes rendues, mais la refusée est vide (aucun <img>).
        const thumbs = body().querySelectorAll(".gl-poi-gallery__thumb");
        expect(thumbs.length).toBe(3);
        const withImg = [...thumbs].filter((t) => t.querySelector("img"));
        expect(withImg.length, "la vignette refusée n'aurait pas dû porter d'img").toBe(2);

        // 3 — ouvrir la lightbox : elle navigue l'ensemble SURVIVANT (2 images), pas 3.
        main.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelector(".gl-poi-lightbox-global")).not.toBeNull();
        expect(document.querySelector(".gl-poi-lightbox__counter")?.textContent).toBe("1 / 2");
    });
    it("an explicit layout overrides the auto-resolved binding (no merge)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "name", type: "text" }] });
        openSidePanel(
            { ...BASE, properties: { name: "Lac des Cygnes", area: "12 ha" } },
            { layerId: "l1", fields: [{ field: "area", type: "text" }] }
        );
        expect(body().textContent).toContain("12 ha");
        expect(body().textContent).not.toContain("Lac des Cygnes");
    });
});
