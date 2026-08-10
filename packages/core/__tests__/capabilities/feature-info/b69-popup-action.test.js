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

const CTX = { layerId: "poi", featureId: 42, lngLat: { lat: 1.5, lng: 2.5 } };
const PROPS = { name: "Café", secret: "ne doit pas fuiter", tel: "0102030405" };

function build(field) {
    return buildPopupContent([field], PROPS, CTX, { hasSidepanel: false });
}

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
});
