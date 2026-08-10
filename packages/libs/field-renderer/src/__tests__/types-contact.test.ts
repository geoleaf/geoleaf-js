/**
 * `types/email.ts`, `types/phone.ts`, `types/url.ts` et `types/date.ts` —
 * couverture des branches (backlog R.2).
 *
 * Les quatre étaient à **37,5 / 37,5 / 37,5 / 42,85 % de branches**, et ce n'est pas un
 * hasard : ils partagent le même squelette — leur formulaire passe par `_renderSimpleField`.
 * Les tester ensemble n'est pas un regroupement de confort — c'est la **paire manquante** de
 * chaque branche partagée : `readOnly`, `computed`, `placeholder` fourni ou par défaut,
 * valeur nulle.
 *
 * ⚠️ Cette prose citait aussi `_linkSidepanel`, le rendu de panneau latéral que les trois
 * types « lien » partageaient. Il a été retiré au Sprint 6 (S6b / B-145) avec les 23
 * `sidepanelRender` : la phrase est corrigée plutôt que laissée, une prose démentie par le
 * code étant le compteur **C5** de la clause.
 *
 * `date` rejoint le lot pour `_renderSimpleField` et pour sa garde `min`/`max`, qui teste
 * la **véracité** là où `number` teste `!== undefined` — un écart que `field-base.ts` documente
 * comme délibéré et que rien ne vérifiait.
 *
 * ⚠️ Fichier séparé de `field-renderer.test.ts` (2 074 l.) — voir l'en-tête de
 * `types-gallery.test.ts`.
 */
import { describe, it, expect } from "vitest";

import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { emailComponent } from "../types/email.js";
import { phoneComponent } from "../types/phone.js";
import { urlComponent } from "../types/url.js";
import { dateComponent } from "../types/date.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "f", type: "text", label: "Champ", ...overrides };
}

const noop = () => {};

// Le bloc `describe.each` qui couvrait `_linkSidepanel` sur les trois types « lien » a été
// retiré avec lui (S6b / B-145) : `sidepanelRender` n'avait aucun appelant de production, et
// un test qui survit au code qu'il testait est le compteur C6 de la clause.

// ─── _renderSimpleField — le squelette partagé des quatre ────────────────────────

describe.each([
    ["email", emailComponent, "email", "a@b.co"],
    ["phone", phoneComponent, "tel", "+33123456789"],
    ["url", urlComponent, "url", "https://example.com"],
    ["date", dateComponent, "date", "2026-07-24"],
] as [string, ComponentDefinition<string>, string, string][])(
    "%s.formRender",
    (kind, component, inputType, value) => {
        it("rend un input du bon type portant la valeur", () => {
            const el = component.formRender!(value, field(), noop, CTX);
            const input = el.querySelector<HTMLInputElement>("input")!;

            expect(input.type).toBe(inputType);
            expect(input.value).toBe(value);
            expect(el.className).toContain(`gl-form-${kind}`);
        });

        it("traite une valeur nulle comme une chaîne vide", () => {
            const el = component.formRender!(null as unknown as string, field(), noop, CTX);

            expect(el.querySelector<HTMLInputElement>("input")!.value).toBe("");
        });

        it("apparie le libellé et l'input par identifiant", () => {
            const el = component.formRender!("", field({ id: "monchamp" }), noop, CTX);

            expect(el.querySelector<HTMLLabelElement>("label")!.htmlFor).toBe("gl-field-monchamp");
            expect(el.querySelector<HTMLInputElement>("input")!.id).toBe("gl-field-monchamp");
        });

        it("marque le libellé requis", () => {
            const el = component.formRender!("", field({ required: true }), noop, CTX);

            expect(el.querySelector<HTMLLabelElement>("label")!.dataset.required).toBe("true");
        });

        it("désactive l'input en lecture seule", () => {
            const el = component.formRender!("", field(), noop, CTX_RO);

            expect(el.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
        });

        it("désactive aussi un champ calculé, hors lecture seule", () => {
            const el = component.formRender!("", field({ computed: true }), noop, CTX);

            expect(el.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
        });

        it("notifie la saisie et referme l'erreur affichée", () => {
            const seen: string[] = [];
            const el = component.formRender!("", field(), (v) => seen.push(v), CTX);
            const input = el.querySelector<HTMLInputElement>("input")!;
            const errorEl = el.querySelector<HTMLElement>(".gl-form-error")!;
            errorEl.hidden = false;

            input.value = value;
            input.dispatchEvent(new Event("input"));

            expect(seen).toEqual([value]);
            expect(errorEl.hidden).toBe(true);
        });
    }
);

// ─── applyAttrs — là où les quatre divergent ─────────────────────────────────────

describe("applyAttrs — placeholders par défaut et surcharges", () => {
    it("email retombe sur email@example.com", () => {
        const el = emailComponent.formRender!("", field(), noop, CTX);

        expect(el.querySelector<HTMLInputElement>("input")!.placeholder).toBe("email@example.com");
    });

    it("url retombe sur https://", () => {
        const el = urlComponent.formRender!("", field(), noop, CTX);

        expect(el.querySelector<HTMLInputElement>("input")!.placeholder).toBe("https://");
    });

    it("phone n'en pose AUCUN par défaut — contrairement aux deux autres", () => {
        const el = phoneComponent.formRender!("", field(), noop, CTX);

        expect(el.querySelector<HTMLInputElement>("input")!.placeholder).toBe("");
    });

    it.each([
        ["email", emailComponent],
        ["phone", phoneComponent],
        ["url", urlComponent],
    ] as [string, ComponentDefinition<string>][])(
        "%s honore un placeholder explicite",
        (_kind, component) => {
            const el = component.formRender!("", field({ placeholder: "à vous" }), noop, CTX);

            expect(el.querySelector<HTMLInputElement>("input")!.placeholder).toBe("à vous");
        }
    );
});

describe("date.formRender — bornes min/max", () => {
    it("applique les deux bornes quand elles sont fournies", () => {
        const el = dateComponent.formRender!(
            "",
            field({ min: "2026-01-01", max: "2026-12-31" }),
            noop,
            CTX
        );
        const input = el.querySelector<HTMLInputElement>("input")!;

        expect(input.min).toBe("2026-01-01");
        expect(input.max).toBe("2026-12-31");
    });

    it("n'en applique aucune par défaut", () => {
        const el = dateComponent.formRender!("", field(), noop, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;

        expect(input.min).toBe("");
        expect(input.max).toBe("");
    });

    it("ignore une borne vide — garde de VÉRACITÉ, pas de définition", () => {
        // `field-base.ts` documente l'écart avec `number`, qui teste `!== undefined` : une
        // chaîne vide n'a pas de sens comme borne de date, donc elle est sautée.
        const el = dateComponent.formRender!("", field({ min: "", max: "" }), noop, CTX);
        const input = el.querySelector<HTMLInputElement>("input")!;

        expect(input.min).toBe("");
        expect(input.max).toBe("");
    });
});

// ─── validators ──────────────────────────────────────────────────────────────────

describe("validators des quatre types", () => {
    it.each([
        ["email", emailComponent, "contact@example.com", "pas-un-email"],
        ["phone", phoneComponent, "+33123456789", "abc"],
        ["url", urlComponent, "https://example.com", "pas-une-url"],
        ["date", dateComponent, "2026-07-24", "24/07/2026"],
    ] as [string, ComponentDefinition<string>, string, string][])(
        "%s accepte une valeur conforme et refuse une valeur mal formée",
        (_kind, component, good, bad) => {
            expect(component.validator!(good, field())).toBeNull();
            expect(component.validator!(bad, field())).not.toBeNull();
        }
    );

    it.each([
        ["email", emailComponent],
        ["phone", phoneComponent],
        ["url", urlComponent],
        ["date", dateComponent],
    ] as [string, ComponentDefinition<string>][])(
        "%s refuse le vide quand le champ est requis",
        (_kind, component) => {
            expect(component.validator!("", field({ required: true }))).not.toBeNull();
        }
    );

    it.each([
        ["email", emailComponent],
        ["phone", phoneComponent],
        ["url", urlComponent],
        ["date", dateComponent],
    ] as [string, ComponentDefinition<string>][])(
        "%s accepte le vide quand le champ est facultatif",
        (_kind, component) => {
            expect(component.validator!("", field())).toBeNull();
        }
    );
});
