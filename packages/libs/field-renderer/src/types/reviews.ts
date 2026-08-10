/*!
 * @geoleaf/field-renderer — reviews component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores Array<{ author: string; rating: number; comment: string; date: string }>.
 * Side panel reuses .gl-poi-review* CSS classes from core.
 * fieldConfig extras:
 *   maxReviews?: number  — maximum number of reviews
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { buildStarDisplay } from "./rating.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

interface Review {
    author: string;
    rating: number;
    comment: string;
    date: string;
}

function _formatDate(iso: string, lang: string): string {
    try {
        return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(iso));
    } catch {
        return iso;
    }
}

function _buildReviewForm(
    initial: Partial<Review>,
    onSubmit: (r: Review) => void,
    onCancel: () => void,
    _ctx: RenderCtx
): HTMLElement {
    const form = _el("div", "gl-form-reviews__form");

    const authorInput = _el("input");
    authorInput.type = "text";
    authorInput.className = "gl-form-input";
    authorInput.placeholder = _getLabel("form.placeholder.reviewAuthor");
    authorInput.value = initial.author ?? "";

    let ratingVal = initial.rating ?? 0;
    const ratingRow = _el("div", "gl-form-reviews__rating-row");
    const stars = buildStarDisplay(ratingVal, 5);
    // Make stars interactive
    const starWrap = _el("div", "gl-form-reviews__stars");
    for (let i = 1; i <= 5; i++) {
        const btn = _el("button");
        btn.type = "button";
        btn.textContent = i <= ratingVal ? "★" : "☆";
        btn.dataset.val = String(i);
        btn.setAttribute("aria-label", `${i} stars`);
        btn.addEventListener("click", () => {
            ratingVal = i;
            Array.from(starWrap.querySelectorAll("button")).forEach((b, j) => {
                b.textContent = j < i ? "★" : "☆";
            });
        });
        starWrap.appendChild(btn);
    }
    void stars; // unused in form, replaced by starWrap
    ratingRow.appendChild(starWrap);

    const commentArea = _el("textarea", "gl-form-input");
    commentArea.rows = 3;
    commentArea.placeholder = _getLabel("form.placeholder.reviewComment");
    commentArea.value = initial.comment ?? "";

    const btnRow = _el("div", "gl-form-reviews__form-actions");

    const submitBtn = _el("button");
    submitBtn.type = "button";
    submitBtn.className = "gl-btn gl-btn--primary";
    submitBtn.textContent = _getLabel("form.label.add");

    const cancelBtn = _el("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gl-btn";
    cancelBtn.textContent = _getLabel("form.label.cancel");

    submitBtn.addEventListener("click", () => {
        if (!authorInput.value.trim()) return;
        onSubmit({
            author: authorInput.value.trim(),
            rating: ratingVal,
            comment: commentArea.value.trim(),
            date: initial.date ?? new Date().toISOString(),
        });
    });
    cancelBtn.addEventListener("click", onCancel);

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    form.appendChild(authorInput);
    form.appendChild(ratingRow);
    form.appendChild(commentArea);
    form.appendChild(btnRow);
    return form;
}

function formRender(
    value: Review[],
    fieldConfig: FieldConfig,
    onChange: (v: Review[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const reviews: Review[] = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
    const maxReviews = fieldConfig.maxReviews != null ? Number(fieldConfig.maxReviews) : Infinity;

    const wrap = _el("div", "gl-form-field gl-form-reviews");

    const labelEl = _el("span", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const listEl = _el("div", "gl-form-reviews__list");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    let formContainer: HTMLElement | null = null;

    function renderList(): void {
        listEl.innerHTML = "";
        reviews.forEach((review, idx) => {
            const card = _el("div", "gl-poi-review");
            const header = _el("div", "gl-poi-review__header");
            const author = _el("span", "gl-poi-review__author");
            author.textContent = review.author;
            const date = _el("span", "gl-poi-review__date");
            date.textContent = review.date ? _formatDate(review.date, ctx.lang) : "";
            header.appendChild(author);
            header.appendChild(date);
            card.appendChild(header);
            card.appendChild(buildStarDisplay(review.rating ?? 0, 5));
            const comment = _el("p", "gl-poi-review__comment");
            comment.textContent = review.comment;
            card.appendChild(comment);
            if (!ctx.readOnly) {
                const removeBtn = _el("button");
                removeBtn.type = "button";
                removeBtn.className = "gl-form-reviews__remove";
                removeBtn.textContent = "×";
                removeBtn.setAttribute("aria-label", _getLabel("form.aria.reviewRemove"));
                removeBtn.addEventListener("click", () => {
                    reviews.splice(idx, 1);
                    onChange([...reviews]);
                    renderList();
                });
                card.appendChild(removeBtn);
            }
            listEl.appendChild(card);
        });
    }

    const addBtn = _el("button");
    addBtn.type = "button";
    addBtn.className = "gl-form-reviews__add";
    addBtn.textContent = `+ ${_getLabel("form.label.reviewAdd")}`;
    addBtn.disabled = !!ctx.readOnly;
    addBtn.addEventListener("click", () => {
        if (reviews.length >= maxReviews || formContainer) return;
        formContainer = _buildReviewForm(
            {},
            (r) => {
                reviews.push(r);
                onChange([...reviews]);
                formContainer?.remove();
                formContainer = null;
                renderList();
            },
            () => {
                formContainer?.remove();
                formContainer = null;
            },
            ctx
        );
        wrap.insertBefore(formContainer, addBtn);
    });

    renderList();
    wrap.appendChild(labelEl);
    wrap.appendChild(listEl);
    wrap.appendChild(addBtn);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: Review[], fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * A list of reviews, each with its author, score and text. Read-mostly: the sidepanel is the real surface.
 *
 * Registered under the id `reviews`, and selected when a field declares `"type": "reviews"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const reviewsComponent: ComponentDefinition<Review[]> = {
    id: "reviews",
    defaults: [],
    formRender,
    validator,
};
