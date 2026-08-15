/**
 * @file b69-popup-action.test.js
 * @description Test de non-régression — un champ `type: "action"` rend un bouton et ÉMET
 * `geoleaf:popup:action`.
 *
 * Pourquoi ce test existe (B-69, 29/07/2026)
 * ------------------------------------------
 * Le signal était **typé** dans `GeoLeafEventMap`, **enseigné dans trois TSDoc publiés** — le
 * contrat d'événements, les types de configuration de couche, et ceux de la capacité — et doté
 * d'une surface de configuration complète (`actionId`, `confirm`, `icon`, `requiresPlugin`,
 * `payloadFields`). La boucle de rendu, elle, **écartait** ces champs. Un intégrateur qui déclarait
 * un bouton n'obtenait ni bouton, ni événement, ni avertissement : l'échec était silencieux dans
 * les trois directions.
 *
 * ⚠️ **Ce n'est pas le rendu qui bloquait, c'était la charge utile.** Le contrat promet `featureId`
 * et `lngLat` ; le contexte de rendu ne portait que `layerId`. C'est cette absence — et non une
 * décision — qui a fait abandonner la fonctionnalité.
 *
 * Le cas de la liste blanche est le plus important des quatre : sans `payloadFields`, **aucune**
 * propriété ne doit partir. Le contrat la documente « perf + privacy », et un défaut « tout
 * envoyer » ferait fuiter le sac complet dans un événement de document que n'importe quel script
 * de la page peut écouter.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildPopupContent } from "../../../src/capabilities/feature-info/render/popup-content.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";

const CTX = { layerId: "poi", featureId: 42, lngLat: { lat: 1.5, lng: 2.5 } };
const PROPS = { name: "Café", secret: "ne doit pas fuiter", tel: "0102030405" };

function build(field, ctx = CTX) {
    return buildPopupContent([field], PROPS, ctx, { hasSidepanel: false });
}

// ⚠️ `field: "name"` et non `"x"` : le panneau SAUTE un champ dont la valeur est vide
// (`sidepanel-content.ts:98`, un `action` n'étant pas « required »), là où le popup rend le
// bouton inconditionnellement. Un `field` sans valeur ne testerait donc qu'une surface sur deux.
const ACTION = { field: "name", type: "action", actionId: "a", label: "R" };

describe("B-69 — le champ `action` rend un bouton et émet", () => {
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
        // `payloadFields` vient d'un PROFIL : `__proto__` y est écrivable. Sur un objet littéral,
        // une écriture par clé dynamique règle le prototype au lieu d'ajouter une propriété — et
        // `Object.keys()` ne la liste pas, donc la fuite serait invisible à la relecture.
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

    // ── S5 — le canal d'action enrichi (contrat inverse, 14/08/2026) ──────────────
    //
    // ⚠️ MUTATION QUI COMPTE : rétablir `dispatchGeoLeafEvent` à la place du `CustomEvent`
    // brut de `widget-dispatch.ts`. `button` redevient `{}` et `close`/`setBusy` `undefined`,
    // en silence — les quatre cas ci-dessous tombent d'un coup. C'est la démonstration
    // littérale de la raison d'être de `GeoLeafRawEventMap`, et elle a été jouée.

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
        // Le popup n'est PAS fermé : chaque surface injecte SA fermeture. Un import de
        // `FeatureInfo.close()` aurait rendu ["popup", "sidepanel"] depuis les deux.
        expect(closed).toEqual(["sidepanel"]);
    });

    it("`close()` sans `onClose` au contexte est un no-op, jamais une exception", () => {
        const root = build(ACTION, { layerId: "poi" });
        root.querySelector("button.gl-poi-popup__action").click();
        expect(() => seen[0].close()).not.toThrow();
    });

    it("une action émise DEPUIS LE PANNEAU porte `featureId` et `lngLat`", () => {
        // Régression du 14/08/2026 : `surfaces/sidepanel.ts` ne passait que `layerId`, donc
        // cette même émission rendait `featureId: null` et aucun `lngLat` — sous un TSDoc qui
        // déclarait le point réglé depuis B-69. Il ne l'était que côté popup.
        const body = buildSidePanelBody([ACTION], PROPS, CTX);
        body.querySelector("button.gl-poi-popup__action").click();
        expect(seen[0].featureId).toBe(42);
        expect(seen[0].lngLat).toEqual({ lat: 1.5, lng: 2.5 });
    });
});
