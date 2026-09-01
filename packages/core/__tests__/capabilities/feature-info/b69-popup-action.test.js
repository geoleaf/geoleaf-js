/**
 * @file b69-popup-action.test.js
 * @description Non-regression test — a `type: "action"` field renders a button and EMITS
 * `geoleaf:popup:action`.
 *
 * Why this test exists (29/07/2026)
 * ------------------------------------------
 * The signal was **typed** in `GeoLeafEventMap`, **taught in three published
 * TSDoc** — the event contract, the layer configuration types, and the
 * capability's — and endowed with a complete configuration surface
 * (`actionId`, `confirm`, `icon`, `requiresPlugin`, `payloadFields`). The
 * render loop, though, **discarded** those fields. An integrator declaring a
 * button got no button, no event, no warning: the failure was silent in all
 * three directions.
 *
 * ⚠️ **The render was not what blocked, the payload was.** The contract
 * promises `featureId` and `lngLat`; the render context only carried
 * `layerId`. That absence — and not a decision — is what made the feature
 * get abandoned.
 *
 * The whitelist case is the most important of the four: without
 * `payloadFields`, **no** property must leave. The contract documents it
 * "perf + privacy", and a "send everything" default would leak the whole bag
 * into a document event any script on the page can listen to.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildPopupContent } from "../../../src/capabilities/feature-info/render/popup-content.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";

const CTX = { layerId: "poi", featureId: 42, lngLat: { lat: 1.5, lng: 2.5 } };
const PROPS = { name: "Café", secret: "ne doit pas fuiter", tel: "0102030405" };

function build(field, ctx = CTX) {
    return buildPopupContent([field], PROPS, ctx, { hasSidepanel: false });
}

// ⚠️ `field: "name"` and not `"x"`: the panel SKIPS a field whose value is
// empty (`sidepanel-content.ts`, an `action` not being "required"), where
// the popup renders the button unconditionally. A valueless `field` would
// thus test only one surface out of two.
const ACTION = { field: "name", type: "action", actionId: "a", label: "R" };

describe("le champ `action` rend un bouton et émet", () => {
    let seen;
    const onAction = (e) => seen.push(e.detail);
    beforeEach(() => {
        seen = [];
        document.addEventListener("geoleaf:popup:action", onAction);
    });
    afterEach(() => document.removeEventListener("geoleaf:popup:action", onAction));

    it("rend un bouton portant son actionId", () => {
        const root = build({ field: "x", type: "action", actionId: "book", label: "Réserver" });
        const btn = root.querySelector("button.gl-poi-popup__action");
        expect(btn, "aucun bouton rendu").toBeTruthy();
        expect(btn.dataset.glActionId).toBe("book");
        expect(btn.textContent).toBe("Réserver");
    });

    it("émet `geoleaf:popup:action` au clic, avec la charge utile du contrat", () => {
        const root = build({ field: "x", type: "action", actionId: "book", label: "R" });
        root.querySelector("button").click();
        expect(seen).toHaveLength(1);
        expect(seen[0].actionId).toBe("book");
        expect(seen[0].layerId).toBe("poi");
        expect(seen[0].featureId).toBe(42);
        expect(seen[0].lngLat).toEqual({ lat: 1.5, lng: 2.5 });
    });

    it("SANS `payloadFields`, aucune propriété ne part", () => {
        const root = build({ field: "x", type: "action", actionId: "a", label: "R" });
        root.querySelector("button").click();
        expect(seen[0].properties).toEqual({});
    });

    it("AVEC `payloadFields`, seules les clés listées partent", () => {
        const root = build({
            field: "x",
            type: "action",
            actionId: "a",
            label: "R",
            payloadFields: ["name", "tel", "absente"],
        });
        root.querySelector("button").click();
        expect(seen[0].properties).toEqual({ name: "Café", tel: "0102030405" });
        expect(seen[0].properties.secret).toBeUndefined();
    });

    it("ne rend rien quand `requiresPlugin` nomme un plugin absent", () => {
        globalThis.GeoLeaf = { plugins: { isLoaded: (n) => n === "present" } };
        const absent = build({
            field: "x",
            type: "action",
            actionId: "a",
            label: "R",
            requiresPlugin: "manquant",
        });
        expect(absent.querySelector("button.gl-poi-popup__action")).toBeNull();
        const present = build({
            field: "x",
            type: "action",
            actionId: "a",
            label: "R",
            requiresPlugin: "present",
        });
        expect(present.querySelector("button.gl-poi-popup__action")).toBeTruthy();
        delete globalThis.GeoLeaf;
    });

    it("écarte les clés dangereuses de `payloadFields` (pollution de prototype)", () => {
        // `payloadFields` comes from a PROFILE: `__proto__` is writable
        // there. On an object literal, a dynamic-key write sets the prototype
        // instead of adding a property — and `Object.keys()` does not list
        // it, so the leak would be invisible at reread.
        const root = build({
            field: "x",
            type: "action",
            actionId: "a",
            label: "R",
            payloadFields: ["__proto__", "constructor", "prototype", "name"],
        });
        root.querySelector("button").click();
        expect(seen[0].properties).toEqual({ name: "Café" });
        expect(Object.getPrototypeOf(seen[0].properties)).toBe(Object.prototype);
        expect({}.polluted).toBeUndefined();
    });

    it("ne rend rien sans `actionId` — un bouton sans identifiant n'a rien à émettre", () => {
        const root = build({ field: "x", type: "action", label: "R" });
        expect(root.querySelector("button.gl-poi-popup__action")).toBeNull();
    });

    // ── the enriched action channel (inverse contract, 14/08/2026) ────────────────
    //
    // ⚠️ MUTATION THAT MATTERS: restoring `dispatchGeoLeafEvent` in place of
    // `widget-dispatch.ts`'s raw `CustomEvent`. `button` becomes `{}` again
    // and `close`/`setBusy` `undefined`, silently — the four cases below fall
    // at once. The literal demonstration of `GeoLeafRawEventMap`'s reason to
    // exist, and it was played.

    it("`button` est le bouton RÉEL, pas la coquille `{}` de la sanitisation", () => {
        const root = build(ACTION);
        const btn = root.querySelector("button.gl-poi-popup__action");
        btn.click();
        expect(seen[0].button).toBe(btn);
        expect(seen[0].button).toBeInstanceOf(HTMLElement);
    });

    it("`setBusy` pose et retire les TROIS marques — `disabled`, `aria-busy`, la classe", () => {
        const root = build(ACTION);
        const btn = root.querySelector("button.gl-poi-popup__action");
        btn.click();

        seen[0].setBusy(true);
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute("aria-busy")).toBe("true");
        expect(btn.classList.contains("gl-poi-popup__action--busy")).toBe(true);

        seen[0].setBusy(false);
        expect(btn.disabled).toBe(false);
        expect(btn.getAttribute("aria-busy")).toBe("false");
        expect(btn.classList.contains("gl-poi-popup__action--busy")).toBe(false);
    });

    it("`close()` ferme la surface du bouton, et RIEN d'autre — côté popup", () => {
        const closed = [];
        const root = build(ACTION, { ...CTX, onClose: () => closed.push("popup") });
        root.querySelector("button.gl-poi-popup__action").click();
        seen[0].close();
        expect(closed).toEqual(["popup"]);
    });

    it("`close()` ferme la surface du bouton, et RIEN d'autre — côté panneau", () => {
        const closed = [];
        const body = buildSidePanelBody([ACTION], PROPS, {
            ...CTX,
            onClose: () => closed.push("sidepanel"),
        });
        body.querySelector("button.gl-poi-popup__action").click();
        seen[0].close();
        // The popup is NOT closed: each surface injects ITS closing. An
        // import of `FeatureInfo.close()` would have yielded
        // ["popup", "sidepanel"] from both.
        expect(closed).toEqual(["sidepanel"]);
    });

    it("`close()` sans `onClose` au contexte est un no-op, jamais une exception", () => {
        const root = build(ACTION, { layerId: "poi" });
        root.querySelector("button.gl-poi-popup__action").click();
        expect(() => seen[0].close()).not.toThrow();
    });

    it("une action émise DEPUIS LE PANNEAU porte `featureId` et `lngLat`", () => {
        // Regression of 14/08/2026: `surfaces/sidepanel.ts` only passed
        // `layerId`, so this same emission yielded `featureId: null` and no
        // `lngLat` — under a TSDoc declaring the point settled. It only was popup-side.
        const body = buildSidePanelBody([ACTION], PROPS, CTX);
        body.querySelector("button.gl-poi-popup__action").click();
        expect(seen[0].featureId).toBe(42);
        expect(seen[0].lngLat).toEqual({ lat: 1.5, lng: 2.5 });
    });
});
