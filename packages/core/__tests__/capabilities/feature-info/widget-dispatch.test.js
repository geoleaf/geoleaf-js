/**
 * The single render engine.
 *
 * This file covers what the rework makes possible and was not:
 *
 *  - `date`, `url` and `email` were DECLARED and absent from BOTH dispatch
 *    tables. A field carrying one vanished silently — a latent trap, since no
 *    profile used them. They now ROUTE;
 *  - `action` only had a branch in the popup: an action field declared on the
 *    panel was neither rendered nor reported;
 *  - a `price`, a `badge` or a `link` rendered `[object Object]` on the text
 *    surfaces, because they stringified an OBJECT;
 *  - an unknown widget was mute, one way on one surface and the other way
 *    elsewhere. It now logs, without ever being fatal.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
    buildPopupContent,
    buildTooltipText,
} from "../../../src/capabilities/feature-info/render/popup-content.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";

const CTX = { layerId: "l1", featureId: "f1", lngLat: { lat: 1, lng: 2 } };

/** Renders a single field on the popup and the panel, to compare both. */
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
        // A profile naming a free-text field must see that text, not
        // "Invalid Date".
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

    // 🛑 Sanitisation is NEVER bypassed. `safeUrl`'s fallback only accepts
    // http(s): with no security seam mounted, a `mailto:` is refused. The
    // field does not vanish for all that — the exact defect being closed — it
    // degrades into readable but unclickable text, like FE-07's safe mode.
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
        // ⚠️ Without `payloadFields`, NO property is attached. The default
        // leans towards privacy: any script on the page listens to this event.
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
        // `confirm` does not exist in the test environment: we SET it rather
        // than spy on it, otherwise the spy fails and not the behaviour.
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
        // ⚠️ The popup applied them to NINE types through a function identity
        // comparison, the panel to one. The contract only declares
        // `prefix`/`suffix` on `metric` — and the repo's two affixes are
        // there. Iso-behaviour.
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
    // ⚠️ These branches exist because a remote layer's data obeys no schema:
    // the same failure mode as before, where a string where the code expected
    // an array sent an exception up to the panel, which no longer opened.
    // They must therefore be EXERCISED, not just written.

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
