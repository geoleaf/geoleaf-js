/**
 * `types/list.ts` and `types/longtext.ts` — branch coverage.
 *
 * `list` sat at **46.15% branches / 61.53% functions**: all the
 * drag-and-drop reordering, the `maxItems` ceiling and read-only mode were
 * uncovered. `longtext` at **53.33%**: the character counter — set
 * conditionally between the input and the error slot, and the only reason
 * this type does NOT go through `_renderSimpleField` — was never exercised.
 *
 * ⚠️ File separate from `field-renderer.test.ts` (2,074 l.) — see the header
 * of `types-gallery.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { listComponent } from "../types/list.js";
import { longtextComponent } from "../types/longtext.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "items", type: "list", label: "Éléments", ...overrides };
}

beforeEach(() => {
    document.body.innerHTML = "";
});

// ─── list.formRender — editing ───────────────────────────────────────────────────

describe("list.formRender — édition", () => {
    it("traite une valeur non-tableau comme une liste vide", () => {
        const el = listComponent.formRender!(
            "pas un tableau" as unknown as string[],
            field(),
            vi.fn(),
            CTX
        );

        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(0);
    });

    it("rend un input par entrée, avec sa poignée masquée aux lecteurs d'écran", () => {
        const el = listComponent.formRender!(["a", "b"], field(), vi.fn(), CTX);

        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(2);
        expect(el.querySelector(".gl-form-list__handle")!.getAttribute("aria-hidden")).toBe("true");
    });

    it("la saisie remplace l'entrée à son index et notifie", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender!(["a", "b"], field(), onChange, CTX);
        const input = el.querySelectorAll<HTMLInputElement>("input")[1];

        input.value = "modifié";
        input.dispatchEvent(new Event("input"));

        expect(onChange).toHaveBeenCalledWith(["a", "modifié"]);
    });

    it("le retrait supprime l'entrée visée", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender!(["a", "b", "c"], field(), onChange, CTX);

        el.querySelectorAll<HTMLButtonElement>(".gl-form-list__remove")[1].click();

        expect(onChange).toHaveBeenCalledWith(["a", "c"]);
        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(2);
    });

    it("le bouton d'ajout pousse une entrée vide", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender!(["a"], field(), onChange, CTX);

        el.querySelector<HTMLButtonElement>(".gl-form-list__add")!.click();

        expect(onChange).toHaveBeenCalledWith(["a", ""]);
        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(2);
    });

    it("l'ajout est refusé une fois maxItems atteint", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender!(["a", "b"], field({ maxItems: 2 }), onChange, CTX);

        el.querySelector<HTMLButtonElement>(".gl-form-list__add")!.click();

        expect(onChange).not.toHaveBeenCalled();
        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(2);
    });

    it("sans maxItems, le plafond est infini", () => {
        const onChange = vi.fn();
        const el = listComponent.formRender!(["a"], field(), onChange, CTX);
        const add = el.querySelector<HTMLButtonElement>(".gl-form-list__add")!;

        add.click();
        add.click();
        add.click();

        expect(el.querySelectorAll(".gl-form-list__item").length).toBe(4);
    });

    it("addLabel surcharge le libellé du bouton d'ajout", () => {
        const el = listComponent.formRender!(
            [],
            field({ addLabel: "Ajouter un lieu" }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector(".gl-form-list__add")!.textContent).toBe("Ajouter un lieu");
    });

    it("sans addLabel le bouton porte « + Add »", () => {
        const el = listComponent.formRender!([], field(), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-list__add")!.textContent).toBe("+ Add");
    });

    it("en lecture seule : rien n'est déplaçable, saisissable, supprimable ni ajoutable", () => {
        const el = listComponent.formRender!(["a"], field(), vi.fn(), CTX_RO);

        expect(el.querySelector<HTMLElement>(".gl-form-list__item")!.draggable).toBe(false);
        expect(el.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
        expect(el.querySelector<HTMLButtonElement>(".gl-form-list__remove")!.disabled).toBe(true);
        expect(el.querySelector<HTMLButtonElement>(".gl-form-list__add")!.disabled).toBe(true);
    });

    it("marque le libellé requis", () => {
        const el = listComponent.formRender!([], field({ required: true }), vi.fn(), CTX);

        expect(el.querySelector<HTMLLabelElement>("label")!.dataset.required).toBe("true");
    });
});

// ─── list.formRender — reordering ────────────────────────────────────────────────

describe("list.formRender — glisser-déposer", () => {
    function threeItems(onChange = vi.fn()) {
        const el = listComponent.formRender!(["a", "b", "c"], field(), onChange, CTX);
        return {
            el,
            onChange,
            items: [...el.querySelectorAll<HTMLElement>(".gl-form-list__item")],
        };
    }

    it("déplace l'entrée tirée à l'index de celle survolée", () => {
        const { items, onChange } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        items[2].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).toHaveBeenCalledWith(["b", "c", "a"]);
    });

    it("un dépôt sur soi-même ne change rien", () => {
        const { items, onChange } = threeItems();

        items[1].dispatchEvent(new Event("dragstart"));
        items[1].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("un dépôt sans tirage préalable ne change rien", () => {
        const { items, onChange } = threeItems();

        items[2].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("dragend annule le tirage en cours", () => {
        const { items, onChange } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        items[0].dispatchEvent(new Event("dragend"));
        items[1].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("marque puis démarque le tirage et le survol", () => {
        const { items } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        expect(items[0].classList.contains("is-dragging")).toBe(true);

        items[1].dispatchEvent(new Event("dragover", { cancelable: true }));
        expect(items[1].classList.contains("is-over")).toBe(true);

        items[1].dispatchEvent(new Event("dragleave"));
        expect(items[1].classList.contains("is-over")).toBe(false);

        items[0].dispatchEvent(new Event("dragend"));
        expect(items[0].classList.contains("is-dragging")).toBe(false);
    });
});

// ─── list.validator ──────────────────────────────────────────────────────────────

describe("list.validator", () => {
    it("accepte une liste vide quand rien n'est exigé", () => {
        expect(listComponent.validator!([], field())).toBeNull();
    });

    it("refuse une liste vide quand le champ est requis", () => {
        expect(listComponent.validator!([], field({ required: true }))).not.toBeNull();
    });

    it("refuse une liste sous minItems", () => {
        expect(listComponent.validator!(["a"], field({ minItems: 2 }))).not.toBeNull();
    });

    it("accepte une liste au niveau de minItems", () => {
        expect(listComponent.validator!(["a", "b"], field({ minItems: 2 }))).toBeNull();
    });

    it("le contrôle de minItems s'applique même sans required", () => {
        // The two guards are independent: `required` exits first, `minItems`
        // evaluates next — and an optional but bounded field must stay bounded.
        expect(listComponent.validator!(["a"], field({ minItems: 3 }))).not.toBeNull();
    });
});

// ─── longtext ────────────────────────────────────────────────────────────────────

function ltField(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "desc", type: "longtext", label: "Description", ...overrides };
}

describe("longtext.formRender", () => {
    // ⚠️ `rows` is compared after `Number()`: the HTML spec makes it an
    // `unsigned long` IDL attribute, and a browser does return a number —
    // happy-dom returns the string "4". Coercing here rather than loosening
    // the assertion keeps the test right in both environments.
    it("rend un textarea de 4 lignes par défaut", () => {
        const el = longtextComponent.formRender!("", ltField(), vi.fn(), CTX);

        expect(Number(el.querySelector<HTMLTextAreaElement>("textarea")!.rows)).toBe(4);
    });

    it("honore la hauteur demandée", () => {
        const el = longtextComponent.formRender!("", ltField({ rows: 10 }), vi.fn(), CTX);

        expect(Number(el.querySelector<HTMLTextAreaElement>("textarea")!.rows)).toBe(10);
    });

    it("traite une valeur nulle comme une chaîne vide", () => {
        const el = longtextComponent.formRender!(
            null as unknown as string,
            ltField(),
            vi.fn(),
            CTX
        );

        expect(el.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    });

    it("désactive le textarea en lecture seule et pour un champ calculé", () => {
        const ro = longtextComponent.formRender!("", ltField(), vi.fn(), CTX_RO);
        const computed = longtextComponent.formRender!(
            "",
            ltField({ computed: true }),
            vi.fn(),
            CTX
        );

        expect(ro.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
        expect(computed.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    });

    it("pose le placeholder quand il est fourni, et rien sinon", () => {
        const avec = longtextComponent.formRender!(
            "",
            ltField({ placeholder: "Décrivez…" }),
            vi.fn(),
            CTX
        );
        const sans = longtextComponent.formRender!("", ltField(), vi.fn(), CTX);

        expect(avec.querySelector<HTMLTextAreaElement>("textarea")!.placeholder).toBe("Décrivez…");
        expect(sans.querySelector<HTMLTextAreaElement>("textarea")!.placeholder).toBe("");
    });

    it("n'affiche AUCUN compteur sans maxLength", () => {
        const el = longtextComponent.formRender!("abc", ltField(), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-hint")).toBeNull();
    });

    it("affiche le compteur initial quand maxLength est posé", () => {
        const el = longtextComponent.formRender!("abc", ltField({ maxLength: 100 }), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-hint")!.textContent).toBe("3 / 100");
        expect(el.querySelector<HTMLTextAreaElement>("textarea")!.maxLength).toBe(100);
    });

    it("le compteur part de 0 pour une valeur nulle", () => {
        const el = longtextComponent.formRender!(
            null as unknown as string,
            ltField({ maxLength: 50 }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector(".gl-form-hint")!.textContent).toBe("0 / 50");
    });

    it("le compteur suit la saisie", () => {
        const el = longtextComponent.formRender!("", ltField({ maxLength: 100 }), vi.fn(), CTX);
        const ta = el.querySelector<HTMLTextAreaElement>("textarea")!;

        ta.value = "douze chars";
        ta.dispatchEvent(new Event("input"));

        expect(el.querySelector(".gl-form-hint")!.textContent).toBe("11 / 100");
    });

    it("maxLength à 0 ne pose ni compteur ni attribut — garde de véracité", () => {
        const el = longtextComponent.formRender!("abc", ltField({ maxLength: 0 }), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-hint")).toBeNull();
    });

    it("notifie la saisie et referme l'erreur affichée", () => {
        const onChange = vi.fn();
        const el = longtextComponent.formRender!("", ltField(), onChange, CTX);
        const ta = el.querySelector<HTMLTextAreaElement>("textarea")!;
        const errorEl = el.querySelector<HTMLElement>(".gl-form-error")!;
        errorEl.hidden = false;

        ta.value = "saisi";
        ta.dispatchEvent(new Event("input"));

        expect(onChange).toHaveBeenCalledWith("saisi");
        expect(errorEl.hidden).toBe(true);
    });

    it("apparie le libellé et le textarea", () => {
        const el = longtextComponent.formRender!("", ltField(), vi.fn(), CTX);

        expect(el.querySelector<HTMLLabelElement>("label")!.htmlFor).toBe("gl-field-desc");
        expect(el.querySelector<HTMLTextAreaElement>("textarea")!.id).toBe("gl-field-desc");
    });
});

describe("longtext.validator", () => {
    it("accepte le vide quand le champ est facultatif", () => {
        expect(longtextComponent.validator!("", ltField())).toBeNull();
    });

    it("refuse le vide quand le champ est requis", () => {
        expect(longtextComponent.validator!("", ltField({ required: true }))).not.toBeNull();
    });

    it("refuse une valeur au-dessus de maxLength", () => {
        expect(longtextComponent.validator!("abcdef", ltField({ maxLength: 3 }))).not.toBeNull();
    });

    it("accepte une valeur au niveau de maxLength", () => {
        expect(longtextComponent.validator!("abc", ltField({ maxLength: 3 }))).toBeNull();
    });

    it("maxLength à 0 est contrôlé — garde `!== undefined`, pas de véracité", () => {
        // The validator tests `!== undefined` where the render tests
        // truthiness: a `maxLength: 0` sets no counter but REFUSES any input.
        // The gap is in the code; it is pinned here rather than found in production.
        expect(longtextComponent.validator!("a", ltField({ maxLength: 0 }))).not.toBeNull();
    });
});
