/*!
 * @geoleaf/field-renderer — longtext component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Not built on `_renderSimpleField`: the control is a <textarea>, and the live
 * character counter is appended conditionally between the input and the error
 * slot. Only the shared primitives apply.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired, maxLength as vMaxLength } from "../validators.js";
import { _el } from "../helpers.js";
import { _errorSlot, _fieldWrap, _formLabel } from "./field-base.js";

function formRender(
    value: string,
    fieldConfig: FieldConfig,
    onChange: (v: string) => void,
    ctx: RenderCtx
): HTMLElement {
    const wrap = _fieldWrap("longtext");
    const label = _formLabel(fieldConfig);

    const textarea = _el("textarea", "gl-form-input");
    textarea.rows = fieldConfig.rows ? Number(fieldConfig.rows) : 4;
    textarea.value = value ?? "";
    textarea.disabled = !!ctx.readOnly || !!fieldConfig.computed;
    if (fieldConfig.placeholder) textarea.placeholder = String(fieldConfig.placeholder);

    const maxLen = fieldConfig.maxLength ? Number(fieldConfig.maxLength) : 0;
    if (maxLen) textarea.maxLength = maxLen;

    const counter = _el("span", "gl-form-hint");
    if (maxLen) {
        counter.textContent = `${(value ?? "").length} / ${maxLen}`;
    }

    const errorEl = _errorSlot();

    label.htmlFor = textarea.id = `gl-field-${fieldConfig.id}`;

    textarea.addEventListener("input", () => {
        onChange(textarea.value);
        errorEl.hidden = true;
        if (maxLen) counter.textContent = `${textarea.value.length} / ${maxLen}`;
    });

    wrap.appendChild(label);
    wrap.appendChild(textarea);
    if (maxLen) wrap.appendChild(counter);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    if (fieldConfig.maxLength !== undefined) {
        const err = vMaxLength(value, Number(fieldConfig.maxLength));
        if (err) return err;
    }
    return null;
}

/**
 * Multi-line free text, rendered in a textarea. Distinct from `text` by the input it uses, not by its value type.
 *
 * Registered under the id `longtext`, and selected when a field declares `"type": "longtext"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const longtextComponent: ComponentDefinition<string> = {
    id: "longtext",
    defaults: "",
    formRender,
    validator,
};
