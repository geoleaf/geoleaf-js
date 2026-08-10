/*!
 * @geoleaf/field-renderer — rating component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * fieldConfig extras:
 *   halfStars?: boolean  — enable half-star increments (step 0.5)
 *   maxStars?: number    — max stars count (default 5)
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired, range as vRange } from "../validators.js";
import { _el } from "../helpers.js";

/** Build a row of star <span> elements for read-only display. */
export function buildStarDisplay(rating: number, maxStars: number): HTMLElement {
    const wrap = _el("span", "gl-rating");
    wrap.setAttribute("aria-label", `${rating}/${maxStars}`);
    for (let i = 1; i <= maxStars; i++) {
        const star = _el("span");
        star.className =
            i <= Math.floor(rating)
                ? "gl-rating__star gl-rating__star--filled"
                : rating >= i - 0.5 && rating < i
                  ? "gl-rating__star gl-rating__star--half"
                  : "gl-rating__star gl-rating__star--empty";
        star.textContent =
            i <= Math.floor(rating) ? "★" : rating >= i - 0.5 && rating < i ? "⯨" : "☆";
        wrap.appendChild(star);
    }
    return wrap;
}

function formRender(
    value: number,
    fieldConfig: FieldConfig,
    onChange: (v: number) => void,
    ctx: RenderCtx
): HTMLElement {
    const maxStars = fieldConfig.maxStars != null ? Number(fieldConfig.maxStars) : 5;
    const halfStars = !!fieldConfig.halfStars;
    const step = halfStars ? 0.5 : 1;
    let current = value ?? 0;

    const wrap = _el("div", "gl-form-field gl-form-rating");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const stars = _el("div", "gl-form-rating__stars");
    stars.setAttribute("role", "radiogroup");
    stars.setAttribute("aria-label", fieldConfig.label);

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function renderStars(hovered?: number): void {
        stars.innerHTML = "";
        const displayVal = hovered != null ? hovered : current;

        // Build star segments — two buttons per star for half-star support
        for (let i = 1; i <= maxStars; i++) {
            if (halfStars) {
                // left half
                const half = _el("button");
                half.type = "button";
                half.className =
                    "gl-form-rating__star gl-form-rating__star--half-left" +
                    (displayVal >= i - 0.5 ? " is-active" : "");
                half.setAttribute("aria-label", `${i - 0.5} stars`);
                half.disabled = !!ctx.readOnly;
                half.dataset.val = String(i - 0.5);
                const fullStar = _el("button");
                fullStar.type = "button";
                fullStar.className =
                    "gl-form-rating__star gl-form-rating__star--full" +
                    (displayVal >= i ? " is-active" : "");
                fullStar.setAttribute("aria-label", `${i} stars`);
                fullStar.disabled = !!ctx.readOnly;
                fullStar.dataset.val = String(i);
                stars.appendChild(half);
                stars.appendChild(fullStar);
            } else {
                const btn = _el("button");
                btn.type = "button";
                btn.className = "gl-form-rating__star" + (displayVal >= i ? " is-active" : "");
                btn.setAttribute("aria-label", `${i} stars`);
                btn.textContent = displayVal >= i ? "★" : "☆";
                btn.disabled = !!ctx.readOnly;
                btn.dataset.val = String(i);
                stars.appendChild(btn);
            }
        }
    }

    stars.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest("[data-val]") as HTMLElement | null;
        if (!btn) return;
        const val = Math.round(Number(btn.dataset.val) / step) * step;
        current = val;
        onChange(current);
        renderStars();
    });

    stars.addEventListener("mouseover", (e) => {
        const btn = (e.target as HTMLElement).closest("[data-val]") as HTMLElement | null;
        if (btn) renderStars(Math.round(Number(btn.dataset.val) / step) * step);
    });

    stars.addEventListener("mouseleave", () => renderStars());

    renderStars();
    wrap.appendChild(labelEl);
    wrap.appendChild(stars);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: number, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    const maxStars = fieldConfig.maxStars != null ? Number(fieldConfig.maxStars) : 5;
    return vRange(value, 0, maxStars);
}

/**
 * A numeric score, rendered as stars in the sidepanel and as a bounded input in the form.
 *
 * Registered under the id `rating`, and selected when a field declares `"type": "rating"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const ratingComponent: ComponentDefinition<number> = {
    id: "rating",
    defaults: 0,
    formRender,
    validator,
};
