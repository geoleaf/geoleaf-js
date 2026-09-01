/**
 * `types/rating.ts` — branch coverage.
 *
 * The component sat at **58.7% branches**: the existing test exercises the
 * nominal render (5 full stars, simple click) but none of its missing pairs
 * — the half star, `maxStars` provided, null value, `required`, `readOnly`,
 * a click OUTSIDE a star and a hover OUTSIDE a star. Exactly those branches
 * are what this file covers.
 *
 * ⚠️ File separate from `field-renderer.test.ts` — see the header of `types-contact.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { ratingComponent, buildStarDisplay } from "../types/rating.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "note", type: "rating", label: "Note", ...overrides };
}

/** Replays a mouse event on a target (bubbles to reach the delegated listener). */
function fire(target: Element, type: string, bubbles = true) {
    target.dispatchEvent(new globalThis.MouseEvent(type, { bubbles }));
}

// ─── buildStarDisplay — the three segment classes ────────────────────────────────

describe("buildStarDisplay — pleine / demie / vide", () => {
    it("une note entière ne produit que des étoiles pleines et vides", () => {
        const el = buildStarDisplay(3, 5);
        expect(el.querySelectorAll(".gl-rating__star--filled").length).toBe(3);
        expect(el.querySelectorAll(".gl-rating__star--empty").length).toBe(2);
        expect(el.querySelectorAll(".gl-rating__star--half").length).toBe(0);
    });

    it("une note à la demie produit UNE demi-étoile — la branche `>= i-0.5 && < i`", () => {
        const el = buildStarDisplay(3.5, 5);
        expect(el.querySelectorAll(".gl-rating__star--filled").length).toBe(3);
        expect(el.querySelectorAll(".gl-rating__star--half").length).toBe(1);
        expect(el.querySelectorAll(".gl-rating__star--empty").length).toBe(1);
        // the half glyph goes with the half class
        expect(el.textContent).toContain("⯨");
    });

    it("expose la note en aria-label", () => {
        expect(buildStarDisplay(2, 5).getAttribute("aria-label")).toBe("2/5");
    });
});

// ─── formRender — mode entier ────────────────────────────────────────────────────

describe("rating.formRender — mode entier (défaut)", () => {
    it("rend une étoile-bouton par cran, active jusqu'à la valeur", () => {
        const el = ratingComponent.formRender!(3, field(), () => {}, CTX);
        const stars = el.querySelectorAll<HTMLButtonElement>(".gl-form-rating__star");
        expect(stars.length).toBe(5);
        expect(el.querySelectorAll(".is-active").length).toBe(3);
    });

    it("une valeur nulle n'active aucune étoile — branche `value ?? 0`", () => {
        const el = ratingComponent.formRender!(null as unknown as number, field(), () => {}, CTX);
        expect(el.querySelectorAll(".is-active").length).toBe(0);
    });

    it("marque le libellé requis quand `required`", () => {
        const el = ratingComponent.formRender!(0, field({ required: true }), () => {}, CTX);
        expect((el.querySelector(".gl-form-label") as HTMLElement).dataset.required).toBe("true");
    });

    it("désactive tous les boutons en lecture seule", () => {
        const el = ratingComponent.formRender!(3, field(), () => {}, CTX_RO);
        const stars = el.querySelectorAll<HTMLButtonElement>(".gl-form-rating__star");
        expect([...stars].every((b) => b.disabled)).toBe(true);
    });

    it("un clic sur la 4e étoile remonte la valeur et ré-affiche", () => {
        const onChange = vi.fn();
        const el = ratingComponent.formRender!(0, field(), onChange, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        const fourth = stars.querySelector('[data-val="4"]')!;
        fire(fourth, "click");
        expect(onChange).toHaveBeenCalledWith(4);
        expect(el.querySelectorAll(".is-active").length).toBe(4);
    });

    it("un clic HORS d'une étoile est ignoré — branche `if (!btn) return`", () => {
        const onChange = vi.fn();
        const el = ratingComponent.formRender!(0, field(), onChange, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        fire(stars, "click"); // the target has no [data-val] ancestor
        expect(onChange).not.toHaveBeenCalled();
    });

    it("le survol d'une étoile pré-affiche cette valeur (aperçu)", () => {
        const el = ratingComponent.formRender!(0, field(), () => {}, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        fire(stars.querySelector('[data-val="3"]')!, "mouseover");
        expect(el.querySelectorAll(".is-active").length).toBe(3);
    });

    it("le survol HORS d'une étoile ne change rien — branche `if (btn)` fausse", () => {
        const el = ratingComponent.formRender!(2, field(), () => {}, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        fire(stars, "mouseover");
        expect(el.querySelectorAll(".is-active").length).toBe(2);
    });

    it("quitter la zone rétablit la valeur courante", () => {
        const el = ratingComponent.formRender!(2, field(), () => {}, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        fire(stars.querySelector('[data-val="5"]')!, "mouseover");
        expect(el.querySelectorAll(".is-active").length).toBe(5);
        fire(stars, "mouseleave", false);
        expect(el.querySelectorAll(".is-active").length).toBe(2);
    });
});

// ─── formRender — half-star mode ─────────────────────────────────────────────────

describe("rating.formRender — mode demi-étoiles (`halfStars`)", () => {
    it("produit deux boutons par étoile (demi-gauche + pleine)", () => {
        const el = ratingComponent.formRender!(0, field({ halfStars: true }), () => {}, CTX);
        expect(el.querySelectorAll(".gl-form-rating__star--half-left").length).toBe(5);
        expect(el.querySelectorAll(".gl-form-rating__star--full").length).toBe(5);
    });

    it("un clic sur une demi-étoile arrondit au pas de 0,5", () => {
        const onChange = vi.fn();
        const el = ratingComponent.formRender!(0, field({ halfStars: true }), onChange, CTX);
        const stars = el.querySelector(".gl-form-rating__stars")!;
        fire(stars.querySelector('[data-val="3.5"]')!, "click");
        expect(onChange).toHaveBeenCalledWith(3.5);
    });

    it("une valeur à la demie active la demi-gauche mais pas la pleine", () => {
        const el = ratingComponent.formRender!(3.5, field({ halfStars: true }), () => {}, CTX);
        const half = el.querySelector('[data-val="3.5"]')!;
        const full = el.querySelector('[data-val="4"]')!;
        expect(half.classList.contains("is-active")).toBe(true);
        expect(full.classList.contains("is-active")).toBe(false);
    });
});

// ─── validator ───────────────────────────────────────────────────────────────────

describe("rating.validator", () => {
    it("rejette une valeur absente quand `required` — branche `if (err) return`", () => {
        expect(
            ratingComponent.validator!(null as unknown as number, field({ required: true }))
        ).toBeTruthy();
    });

    it("une note de 0 satisfait `required` (0 étoile est une valeur présente)", () => {
        expect(ratingComponent.validator!(0, field({ required: true }))).toBeNull();
    });

    it("n'exige rien quand `required` est absent", () => {
        expect(ratingComponent.validator!(0, field())).toBeNull();
    });

    it("borne la note à `maxStars` fourni", () => {
        expect(ratingComponent.validator!(12, field({ maxStars: 10 }))).toBeTruthy();
        expect(ratingComponent.validator!(8, field({ maxStars: 10 }))).toBeNull();
    });
});
