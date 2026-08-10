/*!
 * @geoleaf/field-renderer — checkbox component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Two modes controlled by fieldConfig.multiple:
 *   false (default) — single boolean checkbox, value: boolean
 *   true            — multi-value group, value: string[]
 *
 * fieldConfig extras:
 *   multiple?: boolean
 *   options?: Array<{value: string; label: string}>  — required when multiple=true
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el } from "../helpers.js";
import { _fieldWrap, _renderOptionGroup, type FieldOption } from "./field-base.js";

type CheckboxOption = FieldOption;

type CheckboxValue = boolean | string[];

function _renderSingle(
    value: boolean,
    fieldConfig: FieldConfig,
    onChange: (v: boolean) => void,
    ctx: RenderCtx
): HTMLElement {
    // Not an option group: one input, and the label follows the control rather
    // than preceding it. Only the wrapper is shared.
    const wrap = _fieldWrap("checkbox");

    const input = _el("input");
    input.type = "checkbox";
    input.id = `gl-field-${fieldConfig.id}`;
    input.checked = !!value;
    input.disabled = !!ctx.readOnly;
    input.addEventListener("change", () => onChange(input.checked));

    const label = _el("label", "gl-form-label");
    label.htmlFor = input.id;
    label.textContent = fieldConfig.label;
    if (fieldConfig.required) label.dataset.required = "true";

    wrap.appendChild(input);
    wrap.appendChild(label);
    return wrap;
}

function _renderMulti(
    value: string[],
    fieldConfig: FieldConfig,
    onChange: (v: string[]) => void,
    ctx: RenderCtx
): HTMLElement {
    const options = (fieldConfig.options as CheckboxOption[] | undefined) ?? [];
    // Degrade, do not throw (backlog B.11). A profile that declares `multiple: true` but
    // stores a boolean reaches here with `value === true`, and `new Set(true)` throws
    // "is not iterable" — taking the whole form down over one malformed field. Same
    // `Array.isArray` predicate the single-value path already uses above.
    const selected = new Set<string>(Array.isArray(value) ? value : []);

    return _renderOptionGroup(options, fieldConfig, {
        groupClass: "gl-form-field gl-form-checkbox-group",
        itemClass: "gl-form-checkbox__item",
        inputType: "checkbox",
        ...(ctx.readOnly !== undefined && { readOnly: ctx.readOnly }),
        isChecked: (opt) => selected.has(opt.value),
        onToggle: (opt, input) => {
            if (input.checked) {
                selected.add(opt.value);
            } else {
                selected.delete(opt.value);
            }
            onChange(Array.from(selected));
        },
    });
}

function formRender(
    value: CheckboxValue,
    fieldConfig: FieldConfig,
    onChange: (v: CheckboxValue) => void,
    ctx: RenderCtx
): HTMLElement {
    if (fieldConfig.multiple) {
        return _renderMulti(
            (value as string[]) ?? [],
            fieldConfig,
            onChange as (v: string[]) => void,
            ctx
        );
    }
    return _renderSingle(value as boolean, fieldConfig, onChange as (v: boolean) => void, ctx);
}

function validator(value: CheckboxValue, fieldConfig: FieldConfig): string | null {
    if (!fieldConfig.required) return null;
    if (fieldConfig.multiple) {
        const err = vRequired(value);
        if (err) return err;
    } else {
        // A required single checkbox must be checked.
        if (!value) return "form.error.required";
    }
    return null;
}

/**
 * A multi-choice checkbox group, driven by the field's `options`. Value is the array of selected option ids.
 *
 * Registered under the id `checkbox`, and selected when a field declares `"type": "checkbox"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const checkboxComponent: ComponentDefinition<CheckboxValue> = {
    id: "checkbox",
    defaults: false,
    formRender,
    validator,
};
