/**
 * Le moteur de rendu unique — tâches 2.2, 2.3 et 2.5 de `roadmap_collecte-terrain-offline`.
 *
 * Ce fichier couvre ce que le Sprint 2 rend possible et qui ne l'était pas :
 *
 *  - `date`, `url` et `email` étaient DÉCLARÉS et absents des DEUX tables de
 *    dispatch. Un champ qui en portait un disparaissait en silence — piège latent,
 *    puisque aucun profil ne les employait. Ils ROUTENT désormais (décision Q4) ;
 *  - `action` n'avait de branche que dans la bulle : un champ d'action déclaré sur
 *    le panneau n'était ni rendu ni signalé (trou fonctionnel ④) ;
 *  - un `price`, un `badge` ou un `link` rendaient `[object Object]` sur les
 *    surfaces texte, parce qu'elles stringifiaient un OBJET (trou fonctionnel ②) ;
 *  - un widget inconnu était muet, dans un sens sur une surface et dans l'autre
 *    ailleurs. Il journalise maintenant (décision Q9), sans jamais être fatal.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
    buildPopupContent,
    buildTooltipText,
} from "../../../src/capabilities/feature-info/render/popup-content.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";

const CTX = { layerId: "l1", featureId: "f1", lngLat: { lat: 1, lng: 2 } };

/** Rend un champ unique sur la bulle et sur le panneau, pour comparer les deux. */
function onBoth(field, properties) {
    return {
        popup: buildPopupContent([field], properties, CTX, { hasSidepanel: false }),
        sidepanel: buildSidePanelBody([field], properties, CTX),
        tooltip: buildTooltipText([field], properties),
    };
}

afterEach(() => {
    delete globalThis.GeoLeaf;
    delete globalThis.confirm;
    vi.restoreAllMocks();
});

describe("Q4 — date, url et email ROUTENT au lieu de disparaître", () => {
    it("date rend une date compacte via Intl, avec la locale du champ", () => {
        const { popup, sidepanel, tooltip } = onBoth(
            { field: "d", type: "date", locale: "fr-FR" },
            { d: "2026-08-02T10:00:00Z" }
        );
        for (const node of [popup, sidepanel]) {
            expect(node.textContent).toMatch(/2026/);
        }
        expect(tooltip).toMatch(/2026/);
    });

    it("date rend la valeur VERBATIM quand elle n'est pas une date", () => {
        // Un profil qui nomme un champ de texte libre doit voir ce texte, pas
        // « Invalid Date ».
        const { sidepanel } = onBoth({ field: "d", type: "date" }, { d: "bientôt" });
        expect(sidepanel.textContent).toContain("bientôt");
    });

    it("url rend un vrai lien", () => {
        const { popup } = onBoth({ field: "u", type: "url" }, { u: "https://example.com" });
        expect(popup.querySelector("a[href='https://example.com']")).not.toBeNull();
    });

    it("email devient un lien mailto QUAND le seam de sécurité l'autorise", () => {
        globalThis.GeoLeaf = { Security: { validateUrl: (u) => u } };
        const { sidepanel } = onBoth({ field: "e", type: "email" }, { e: "a@b.test" });
        expect(sidepanel.querySelector("a[href='mailto:a@b.test']")).not.toBeNull();
    });

    it("email ne double PAS le schéma quand il est déjà là", () => {
        globalThis.GeoLeaf = { Security: { validateUrl: (u) => u } };
        const { sidepanel } = onBoth({ field: "e", type: "email" }, { e: "mailto:a@b.test" });
        expect(sidepanel.querySelector("a[href='mailto:a@b.test']")).not.toBeNull();
    });

    // 🛑 La sanitisation n'est JAMAIS contournée. Le repli de `safeUrl` n'accepte que
    // http(s) : sans seam de sécurité montée, un `mailto:` est refusé. Le champ ne
    // disparaît pas pour autant — c'est le défaut exact que Q4 ferme — il dégrade en
    // texte lisible mais non cliquable, comme le mode sûr de FE-07.
    it("email dégrade en TEXTE quand la sanitisation refuse l'adresse", () => {
        const { sidepanel } = onBoth({ field: "e", type: "email" }, { e: "a@b.test" });
        expect(sidepanel.querySelector("a")).toBeNull();
        expect(sidepanel.textContent).toContain("a@b.test");
    });

    it("une URL refusée par safeUrl ne produit AUCUN lien", () => {
        const { popup } = onBoth({ field: "u", type: "url" }, { u: "javascript:alert(1)" });
        expect(popup.querySelector("a[href^='javascript']")).toBeNull();
    });
});

describe("Trou ④ — action rend sur les DEUX surfaces, pas la bulle seule", () => {
    const ACTION = { field: "a", type: "action", actionId: "open-sheet", label: "Ouvrir" };

    it("le bouton existe sur la bulle ET sur le panneau", () => {
        const { popup, sidepanel } = onBoth(ACTION, { a: "x" });
        expect(popup.querySelector("button.gl-poi-popup__action")).not.toBeNull();
        expect(sidepanel.querySelector("button.gl-poi-popup__action")).not.toBeNull();
    });

    it("il ne rend RIEN sur l'infobulle — un bouton n'y est pas cliquable (FE-07)", () => {
        expect(buildTooltipText([ACTION], { a: "x" })).toBe("");
    });

    it("sans actionId, rien n'est rendu", () => {
        const { popup } = onBoth({ field: "a", type: "action" }, { a: "x" });
        expect(popup.querySelector("button.gl-poi-popup__action")).toBeNull();
    });

    it("le clic émet geoleaf:popup:action avec l'identité de la feature", () => {
        const seen = [];
        const listener = (e) => seen.push(e.detail);
        document.addEventListener("geoleaf:popup:action", listener);
        const { sidepanel } = onBoth(ACTION, { a: "x", secret: "caché", id: 7 });
        sidepanel
            .querySelector("button.gl-poi-popup__action")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.removeEventListener("geoleaf:popup:action", listener);

        expect(seen).toHaveLength(1);
        expect(seen[0].actionId).toBe("open-sheet");
        expect(seen[0].featureId).toBe("f1");
        expect(seen[0].lngLat).toEqual({ lat: 1, lng: 2 });
        // ⚠️ Sans `payloadFields`, AUCUNE propriété n'est jointe. Le défaut va vers la
        // confidentialité : n'importe quel script de la page écoute cet événement.
        expect(seen[0].properties).toEqual({});
    });

    it("payloadFields est une liste blanche STRICTE", () => {
        const seen = [];
        const listener = (e) => seen.push(e.detail);
        document.addEventListener("geoleaf:popup:action", listener);
        const { sidepanel } = onBoth(
            { ...ACTION, payloadFields: ["id", "__proto__", "absent"] },
            { a: "x", secret: "caché", id: 7 }
        );
        sidepanel
            .querySelector("button.gl-poi-popup__action")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.removeEventListener("geoleaf:popup:action", listener);

        expect(seen[0].properties).toEqual({ id: 7 });
        expect(Object.prototype.polluted).toBeUndefined();
    });

    it("requiresPlugin empêche le rendu quand le plugin manque", () => {
        globalThis.GeoLeaf = { plugins: { isLoaded: () => false } };
        const { popup } = onBoth({ ...ACTION, requiresPlugin: "editor" }, { a: "x" });
        expect(popup.querySelector("button.gl-poi-popup__action")).toBeNull();
    });

    it("confirm refusé n'émet rien", () => {
        const seen = [];
        const listener = (e) => seen.push(e.detail);
        document.addEventListener("geoleaf:popup:action", listener);
        // `confirm` n'existe pas dans l'environnement de test : on le POSE plutôt que
        // de l'espionner, sinon c'est l'espion qui échoue et non le comportement.
        globalThis.confirm = () => false;
        const { sidepanel } = onBoth({ ...ACTION, confirm: "Sûr ?" }, { a: "x" });
        sidepanel
            .querySelector("button.gl-poi-popup__action")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.removeEventListener("geoleaf:popup:action", listener);
        expect(seen).toHaveLength(0);
    });
});

describe("Trou ② — la même donnée rend PAREIL sur les trois surfaces", () => {
    it("price est formaté partout, jamais [object Object]", () => {
        const { popup, sidepanel, tooltip } = onBoth(
            { field: "p", type: "price" },
            { p: { amount: 12, currency: "EUR" } }
        );
        for (const node of [popup, sidepanel]) {
            expect(node.textContent).not.toContain("[object Object]");
            expect(node.textContent).toMatch(/12/);
        }
        expect(tooltip).not.toContain("[object Object]");
        expect(tooltip).toMatch(/12/);
    });

    it("link montre son libellé sur l'infobulle, pas son objet", () => {
        const tooltip = buildTooltipText([{ field: "l", type: "link" }], {
            l: { href: "https://e.test", label: "Le site" },
        });
        expect(tooltip).toBe("Le site");
    });

    it("coordinates et hours ne disparaissent PLUS de la bulle", () => {
        const coords = onBoth({ field: "c", type: "coordinates" }, { c: { lat: 1.5, lng: 2.5 } });
        expect(coords.popup.textContent).toContain("1.500000");
        expect(coords.sidepanel.textContent).toContain("1.500000");

        const hours = onBoth(
            { field: "h", type: "hours" },
            { h: { mon: [{ open: "09:00", close: "18:00", closed: false }] } }
        );
        expect(hours.popup.querySelector("table.gl-poi-hours")).not.toBeNull();
        expect(hours.sidepanel.querySelector("table.gl-poi-hours")).not.toBeNull();
    });

    it("les affixes s'appliquent à metric, et à metric SEUL", () => {
        // ⚠️ La bulle les appliquait à NEUF types via une comparaison d'identité de
        // fonction, le panneau à un seul. Le contrat ne déclare `prefix`/`suffix` que
        // sur `metric` — et les deux affixes du dépôt y sont. Iso-comportement.
        const metric = onBoth({ field: "m", type: "metric", suffix: " km²" }, { m: 42 });
        expect(metric.popup.textContent).toContain("42 km²");
        expect(metric.sidepanel.textContent).toContain("42 km²");

        const text = onBoth({ field: "t", type: "text", suffix: " km²" }, { t: "Nom" });
        expect(text.popup.textContent).not.toContain("km²");
        expect(text.sidepanel.textContent).not.toContain("km²");
    });

    it("un tableau de tags se lit en clair sur l'infobulle", () => {
        expect(buildTooltipText([{ field: "t", type: "tags" }], { t: ["a", "b"] })).toBe("a, b");
    });
});

describe("Q9 — un widget inconnu journalise au lieu de se taire", () => {
    it("il n'est pas rendu, il n'est pas fatal, et il est signalé", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { popup, sidepanel } = onBoth(
            { field: "x", type: "sparkline-inexistant" },
            { x: "valeur" }
        );
        expect(popup.querySelector(".gl-poi-popup__body").children.length).toBe(0);
        expect(sidepanel.children.length).toBe(0);
        expect(warn).toHaveBeenCalled();
        expect(warn.mock.calls[0][0]).toContain("sparkline-inexistant");
    });

    it("il passe par le seam de journalisation quand il est monté", () => {
        const warn = vi.fn();
        globalThis.GeoLeaf = { Log: { warn } };
        buildSidePanelBody([{ field: "y", type: "autre-inconnu" }], { y: "v" }, CTX);
        expect(warn).toHaveBeenCalled();
    });
});

describe("display.mode raw — la valeur, sans mise en forme du widget", () => {
    it("un price en mode raw sort en texte, pas en composant", () => {
        const { sidepanel } = onBoth(
            { field: "p", type: "price", mode: "raw" },
            { p: { amount: 12, currency: "EUR" } }
        );
        expect(sidepanel.textContent).toMatch(/12/);
        expect(sidepanel.querySelector("table")).toBeNull();
    });
});

describe("Les chemins de repli — ce qui arrive quand la donnée n'a pas la forme promise", () => {
    // ⚠️ Ces branches existent parce que la donnée d'une couche distante n'obéit à
    // aucun schéma : c'est le même mode d'échec que B.32, où une chaîne là où le code
    // attendait un tableau faisait remonter une exception jusqu'au panneau, qui ne
    // s'ouvrait plus. Elles doivent donc être ÉPROUVÉES, pas seulement écrites.

    it("price scalaire — pas d'objet, pas de plantage", () => {
        const { sidepanel, tooltip } = onBoth({ field: "p", type: "price" }, { p: "12 EUR" });
        expect(sidepanel.textContent).toContain("12 EUR");
        expect(tooltip).toBe("12 EUR");
    });

    it("price à devise inconnue — repli sur la concaténation", () => {
        const t = buildTooltipText([{ field: "p", type: "price" }], {
            p: { amount: 9, currency: "ZZZZ" },
        });
        expect(t).toContain("9");
    });

    it("coordinates scalaire, et coordinates incomplètes", () => {
        expect(buildTooltipText([{ field: "c", type: "coordinates" }], { c: "1,2" })).toBe("1,2");
        expect(buildTooltipText([{ field: "c", type: "coordinates" }], { c: { lat: 1 } })).toBe("");
    });

    it("date à locale invalide — repli ISO plutôt qu'exception", () => {
        const t = buildTooltipText([{ field: "d", type: "date", locale: "€€-€€" }], {
            d: "2026-08-02",
        });
        expect(t).toContain("2026-08-02");
    });

    it("hours dont la valeur n'est pas un objet ne rend rien", () => {
        const { sidepanel } = onBoth({ field: "h", type: "hours" }, { h: "9h-18h" });
        expect(sidepanel.querySelector("table.gl-poi-hours")).toBeNull();
    });

    it("un lien vide ne rend rien, ni ancre ni texte", () => {
        const { sidepanel } = onBoth({ field: "u", type: "url" }, { u: "" });
        expect(sidepanel.children.length).toBe(0);
    });

    it("un lien objet sans href ne rend rien", () => {
        const { sidepanel } = onBoth({ field: "u", type: "url" }, { u: { label: "Sans cible" } });
        expect(sidepanel.querySelector("a")).toBeNull();
    });

    it("list et tags scalaires se lisent quand même", () => {
        expect(buildTooltipText([{ field: "l", type: "list" }], { l: "seul" })).toBe("seul");
        expect(buildTooltipText([{ field: "t", type: "tags" }], { t: "seul" })).toBe("seul");
    });

    it("mode raw sur une valeur sans projection texte ne rend rien", () => {
        const { sidepanel } = onBoth(
            { field: "h", type: "hours", mode: "raw" },
            { h: { mon: [{ open: "9", close: "18", closed: false }] } }
        );
        expect(sidepanel.children.length).toBe(0);
    });
});
