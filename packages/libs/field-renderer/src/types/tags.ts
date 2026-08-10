/*!
 * @geoleaf/field-renderer — tags component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * fieldConfig extras:
 *   options?: Array<{value: string; label: string}>  — candidate list for suggestions
 *   restricted?: boolean                             — when true, only allows values from options
 *   maxTags?: number                                 — maximum number of tags
 *   minTags?: number                                 — minimum required tags
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired, minItems } from "../validators.js";
import { _el } from "../helpers.js";

function formRender(
    value: string[],
    fieldConfig: FieldConfig,
    onChange: (v: string[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const tags: string[] = Array.isArray(value) ? [...value] : [];
    const options =
        (fieldConfig.options as Array<{ value: string; label: string }> | undefined) ?? [];
    const restricted = !!fieldConfig.restricted;
    const maxTags = fieldConfig.maxTags != null ? Number(fieldConfig.maxTags) : Infinity;

    const wrap = _el("div", "gl-form-field gl-form-tags");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const tagsWrap = _el("div", "gl-form-tags__wrap");

    const inputId = `gl-field-${fieldConfig.id}`;
    const input = _el("input");
    input.type = "text";
    input.className = "gl-form-tags__input";
    input.id = inputId;
    input.disabled = !!ctx.readOnly;
    if (fieldConfig.placeholder) input.placeholder = String(fieldConfig.placeholder);
    labelEl.htmlFor = inputId;

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function renderTags(): void {
        tagsWrap.innerHTML = "";
        for (const tag of tags) {
            const pill = _el("span", "gl-form-tag");
            const text = _el("span");
            text.textContent = tag;
            const remove = _el("button");
            remove.type = "button";
            remove.className = "gl-form-tag__remove";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `Remove ${tag}`);
            remove.disabled = !!ctx.readOnly;
            remove.addEventListener("click", () => {
                tags.splice(tags.indexOf(tag), 1);
                onChange([...tags]);
                renderTags();
            });
            pill.appendChild(text);
            pill.appendChild(remove);
            tagsWrap.appendChild(pill);
        }
        tagsWrap.appendChild(input);
    }

    function addTag(raw: string): void {
        const tag = raw.trim();
        if (!tag || tags.includes(tag) || tags.length >= maxTags) return;
        if (restricted && options.length > 0 && !options.find((o) => o.value === tag)) return;
        tags.push(tag);
        onChange([...tags]);
        renderTags();
        input.value = "";
    }

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(input.value);
        } else if (e.key === "Backspace" && input.value === "" && tags.length > 0) {
            tags.pop();
            onChange([...tags]);
            renderTags();
        }
    });

    input.addEventListener("blur", () => {
        if (input.value.trim()) addTag(input.value);
    });

    if (options.length > 0) {
        const datalist = _el("datalist");
        datalist.id = `${inputId}-list`;
        for (const opt of options) {
            const el = _el("option");
            el.value = opt.value;
            el.textContent = opt.label;
            datalist.appendChild(el);
        }
        input.setAttribute("list", datalist.id);
        wrap.appendChild(datalist);
    }

    renderTags();
    wrap.appendChild(labelEl);
    wrap.appendChild(tagsWrap);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: string[], fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    if (fieldConfig.minTags != null) {
        const err = minItems(value, Number(fieldConfig.minTags));
        if (err) return err;
    }
    return null;
}

/**
 * A set of free-text tags, rendered as removable chips.
 *
 * Registered under the id `tags`, and selected when a field declares `"type": "tags"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const tagsComponent: ComponentDefinition<string[]> = {
    id: "tags",
    defaults: [],
    formRender,
    validator,
};
