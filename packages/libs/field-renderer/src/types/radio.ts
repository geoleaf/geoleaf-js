/*!
 * @geoleaf/field-renderer — radio component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * fieldConfig extras:
 *   options: Array<{value: string; label: string}>  — required
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _renderOptionGroup, type FieldOption } from "./field-base.js";

type RadioOption = FieldOption;

function formRender(
    value: string,
    fieldConfig: FieldConfig,
    onChange: (v: string) => void,
    ctx: RenderCtx
): HTMLElement {
    const options = (fieldConfig.options as RadioOption[] | undefined) ?? [];

    return _renderOptionGroup(options, fieldConfig, {
        groupClass: "gl-form-field gl-form-radio-group",
        itemClass: "gl-form-radio__item",
        inputType: "radio",
        named: true,
        ...(ctx.readOnly !== undefined && { readOnly: ctx.readOnly }),
        isChecked: (opt) => opt.value === value,
        onToggle: (_opt, input) => {
            if (input.checked) onChange(input.value);
        },
    });
}

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * A single choice from the field's `options`, rendered as radio buttons rather than a select.
 *
 * Registered under the id `radio`, and selected when a field declares `"type": "radio"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const radioComponent: ComponentDefinition<string> = {
    id: "radio",
    defaults: "",
    formRender,
    validator,
};
