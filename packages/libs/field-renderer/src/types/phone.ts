/*!
 * @geoleaf/field-renderer — phone component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores an E.164-simplified phone number (e.g. "+33612345678").
 * Side panel renders a clickable tel: link.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, phoneE164 } from "../validators.js";
import { _renderSimpleField } from "./field-base.js";

const formRender = _renderSimpleField<string>({
    kind: "phone",
    inputType: "tel",
    setValue: (input, value) => {
        input.value = value ?? "";
    },
    read: (input) => input.value,
    applyAttrs: (input, fieldConfig) => {
        if (fieldConfig.placeholder) input.placeholder = String(fieldConfig.placeholder);
    },
});

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return phoneE164(value);
}

/**
 * A phone number, checked for shape and digit count. The sidepanel renders a `tel:` link.
 *
 * Registered under the id `phone`, and selected when a field declares `"type": "phone"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const phoneComponent: ComponentDefinition<string> = {
    id: "phone",
    defaults: "",
    formRender,
    validator,
};
