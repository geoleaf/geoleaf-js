/*!
 * @geoleaf/field-renderer — text component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, maxLength as vMaxLength } from "../validators.js";
import { _renderSimpleField } from "./field-base.js";

const formRender = _renderSimpleField<string>({
    kind: "text",
    inputType: "text",
    setValue: (input, value) => {
        input.value = value ?? "";
    },
    read: (input) => input.value,
    applyAttrs: (input, fieldConfig) => {
        if (fieldConfig.maxLength) input.maxLength = Number(fieldConfig.maxLength);
        if (fieldConfig.placeholder) input.placeholder = String(fieldConfig.placeholder);
    },
});

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
 * A single line of free text — the default component when a field declares no type.
 *
 * Registered under the id `text`, and selected when a field declares `"type": "text"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const textComponent: ComponentDefinition<string> = {
    id: "text",
    defaults: "",
    formRender,
    validator,
};
