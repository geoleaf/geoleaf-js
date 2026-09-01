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
 * Default declaration for the cases testing the panel's MECHANICS — opening,
 * closing, focus, accessibility — and not field resolution.
 *
 * ⚠️ These cases called `stubGeoLeaf()` with no argument. The implicit
 * fallback then listed all properties and discarded them ALL further down (a
 * widgetless field was skipped before the dispatch), yielding an empty body.
 * The decision removes both halves.
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
    // ⚠️ FLIPPED on 02/08/2026. This case asserted that an implicit
    // fallback yielded an EMPTY body — two defects cancelling out: the
    // synthesised list had no widget, and a widgetless field was skipped
    // before the dispatch. That is what made the repo's only profile writing
    // "all" on this surface display nothing. Both halves are removed.
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
    // ⚠️ Browser scenario — an image URL REFUSED by safeUrl must not keep the
    // panel from opening, and the gallery must stay navigable over the
    // surviving images, in order.
    //
    // Counter-proof: a thumbnail whose URL `safeUrl` rejects carries NO
    // `<img>` (media.ts, deliberate anti-sink choice).
    // `attachGalleryEvents` yet did `thumb.querySelector("img").src`
    // unguarded → `TypeError` on any remote gallery with a single bad URL,
    // and since this code runs INSIDE `buildSidePanelBody`, **the whole panel
    // failed to open**. The fix excludes empty thumbnails from the navigable
    // set and remaps `data-index` over it (lightbox.ts).
    //
    // The scenario is classed 🔴 "browser" in the table, but its defect is a
    // JS CRASH (`TypeError`), which happy-dom decides as well as a real
    // browser — the neighbouring lightbox navigation tests already run under
    // happy-dom. So it is covered here, at its peers' tier, rather than in
    // E2E where forged data would have to be injected.
    it("une URL de galerie refusée n'empêche pas l'ouverture, et la navigation saute la vignette morte (E.5)", () => {
        stubGeoLeaf({ sidepanel: [{ field: "gal", type: "gallery" }] });

        // 2 valid URLs framing a refused one (javascript: scheme) — the
        // refused one sits in the middle so the `data-index` remap is
        // discriminating: without it, the 3rd would keep index 2 and
        // navigation would aim at the wrong image.
        openSidePanel({
            ...BASE,
            properties: {
                gal: ["https://e.com/1.jpg", "javascript:alert(1)", "https://e.com/3.jpg"],
            },
        });

        // 1 — the panel opens (what the TypeError blocked).
        expect(isSidePanelOpen()).toBe(true);
        const main = body().querySelector(".gl-poi-gallery__main img");
        expect(main, "le panneau de galerie ne s'est pas construit").not.toBeNull();

        // 2 — three thumbnails rendered, but the refused one is empty (no <img>).
        const thumbs = body().querySelectorAll(".gl-poi-gallery__thumb");
        expect(thumbs.length).toBe(3);
        const withImg = [...thumbs].filter((t) => t.querySelector("img"));
        expect(withImg.length, "la vignette refusée n'aurait pas dû porter d'img").toBe(2);

        // 3 — open the lightbox: it navigates the SURVIVING set (2 images), not 3.
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

/**
 * `geoleaf:poi:panel:open` / `:close`.
 *
 * 🛑 **These two keys were TYPED WITHOUT AN EMITTER from the start**: an
 * integrator subscribing to them wrote code that compiles and never fires. It
 * was settled to wire the emitter rather than remove the key.
 *
 * ⚠️ **No gate in the repo can see this batch.** The keys were already typed,
 * so `EVENT-MAP` does not move a digit, and `CONSUMER-CONTRACT` poses no
 * "every key has an emitter" invariant — precisely the original defect. These
 * cases are the ONLY proof the emission exists, and their absence would be
 * indistinguishable from their success.
 */
const TITLED = { sidepanel: [{ field: "name", type: "text", style: "title" }] };

describe("geoleaf:poi:panel:open / :close — les clés fantômes, branchées", () => {
    function record() {
        const seen = [];
        const onOpen = (e) => seen.push({ type: "open", ...e.detail });
        const onClose = (e) => seen.push({ type: "close", ...e.detail });
        document.addEventListener("geoleaf:poi:panel:open", onOpen);
        document.addEventListener("geoleaf:poi:panel:close", onClose);
        return {
            seen,
            stop: () => {
                document.removeEventListener("geoleaf:poi:panel:open", onOpen);
                document.removeEventListener("geoleaf:poi:panel:close", onClose);
            },
        };
    }

    it("ouvrir émet `open` avec l'id et le nom RÉSOLU du titre affiché", () => {
        stubGeoLeaf(TITLED);
        const rec = record();

        openSidePanel(BASE);

        expect(rec.seen).toEqual([{ type: "open", poiId: "f1", poiName: "Lac des Cygnes" }]);
        rec.stop();
    });

    it("fermer émet `close` en nommant le MÊME poi", () => {
        stubGeoLeaf(TITLED);
        openSidePanel(BASE);
        const rec = record();

        closeSidePanel();

        expect(rec.seen).toEqual([{ type: "close", poiId: "f1" }]);
        rec.stop();
    });

    it("🛑 sans identifiant stable, on se TAIT — dans les deux sens", () => {
        stubGeoLeaf(TITLED);
        const rec = record();

        openSidePanel({ ...BASE, featureId: null });
        closeSidePanel();

        // `poiId` is declared `string` in a PUBLISHED interface: forging an
        // id (`""`, an index) would make two id-less POIs indistinguishable at
        // the subscriber.
        expect(rec.seen).toEqual([]);
        rec.stop();
    });

    it("un titre absent donne un nom vide, il ne fait pas échouer l'ouverture", () => {
        stubGeoLeaf({ sidepanel: [{ field: "name", type: "text" }] }); // pas de `style: title`
        const rec = record();

        openSidePanel(BASE);

        expect(rec.seen).toEqual([{ type: "open", poiId: "f1", poiName: "" }]);
        rec.stop();
    });

    it("fermer un panneau déjà fermé n'émet rien", () => {
        stubGeoLeaf(TITLED);
        const rec = record();

        closeSidePanel();

        expect(rec.seen).toEqual([]);
        rec.stop();
    });

    it("🛑 `destroySidePanel` n'émet PAS de `close` — c'est un démontage, pas une fermeture", () => {
        stubGeoLeaf(TITLED);
        openSidePanel(BASE);
        const rec = record();

        destroySidePanel();

        expect(rec.seen).toEqual([]);
        rec.stop();
    });

    it("après un démontage, l'ouverture suivante ne rejoue pas l'ancien poi", () => {
        stubGeoLeaf(TITLED);
        openSidePanel(BASE);
        destroySidePanel();
        const rec = record();

        openSidePanel({ ...BASE, featureId: "f2", properties: { name: "Étang neuf" } });
        closeSidePanel();

        expect(rec.seen).toEqual([
            { type: "open", poiId: "f2", poiName: "Étang neuf" },
            { type: "close", poiId: "f2" },
        ]);
        rec.stop();
    });
});
