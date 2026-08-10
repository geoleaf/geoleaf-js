/*!
 * @geoleaf/field-renderer — list component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores string[]. Supports drag-and-drop reordering via HTML5 draggable API.
 * fieldConfig extras:
 *   ordered?: boolean    — render as <ol> (default <ul>)
 *   minItems?: number    — minimum required items
 *   maxItems?: number    — maximum allowed items
 *   addLabel?: string    — label for the "+ Add" button (i18n key or raw string)
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired, minItems } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

function formRender(
    value: string[],
    fieldConfig: FieldConfig,
    onChange: (v: string[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const items: string[] = Array.isArray(value) ? [...value] : [];
    const maxItems = fieldConfig.maxItems != null ? Number(fieldConfig.maxItems) : Infinity;
    let dragSrcIdx: number | null = null;

    const wrap = _el("div", "gl-form-field gl-form-list");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const listEl = _el("ul", "gl-form-list__editor");

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    function renderItems(): void {
        listEl.innerHTML = "";
        items.forEach((item, idx) => {
            const li = _el("li", "gl-form-list__item");
            li.draggable = !ctx.readOnly;

            const handle = _el("span", "gl-form-list__handle");
            handle.textContent = "⠿";
            handle.setAttribute("aria-hidden", "true");

            const input = _el("input");
            input.type = "text";
            input.className = "gl-form-input";
            input.value = item;
            input.disabled = !!ctx.readOnly;
            input.addEventListener("input", () => {
                items[idx] = input.value;
                onChange([...items]);
            });

            const removeBtn = _el("button");
            removeBtn.type = "button";
            removeBtn.className = "gl-form-list__remove";
            removeBtn.textContent = "×";
            removeBtn.setAttribute("aria-label", _getLabel("form.aria.listRemove"));
            removeBtn.disabled = !!ctx.readOnly;
            removeBtn.addEventListener("click", () => {
                items.splice(idx, 1);
                onChange([...items]);
                renderItems();
            });

            li.addEventListener("dragstart", () => {
                dragSrcIdx = idx;
                li.classList.add("is-dragging");
            });
            li.addEventListener("dragend", () => {
                dragSrcIdx = null;
                li.classList.remove("is-dragging");
            });
            li.addEventListener("dragover", (e) => {
                e.preventDefault();
                li.classList.add("is-over");
            });
            li.addEventListener("dragleave", () => li.classList.remove("is-over"));
            li.addEventListener("drop", (e) => {
                e.preventDefault();
                li.classList.remove("is-over");
                if (dragSrcIdx == null || dragSrcIdx === idx) return;
                const [moved] = items.splice(dragSrcIdx, 1);
                if (moved === undefined) return;
                items.splice(idx, 0, moved);
                onChange([...items]);
                renderItems();
            });

            li.appendChild(handle);
            li.appendChild(input);
            li.appendChild(removeBtn);
            listEl.appendChild(li);
        });
    }

    const addBtn = _el("button");
    addBtn.type = "button";
    addBtn.className = "gl-form-list__add";
    addBtn.textContent = fieldConfig.addLabel ? String(fieldConfig.addLabel) : "+ Add";
    addBtn.disabled = !!ctx.readOnly;
    addBtn.addEventListener("click", () => {
        if (items.length >= maxItems) return;
        items.push("");
        onChange([...items]);
        renderItems();
        const last = listEl.querySelector<HTMLInputElement>("li:last-child input");
        last?.focus();
    });

    renderItems();
    wrap.appendChild(labelEl);
    wrap.appendChild(listEl);
    wrap.appendChild(addBtn);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: string[], fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    if (fieldConfig.minItems != null) {
        const err = minItems(value, Number(fieldConfig.minItems));
        if (err) return err;
    }
    return null;
}

/**
 * An ordered list of free-text strings, rendered as a bulleted list.
 *
 * Registered under the id `list`, and selected when a field declares `"type": "list"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const listComponent: ComponentDefinition<string[]> = {
    id: "list",
    defaults: [],
    formRender,
    validator,
};
