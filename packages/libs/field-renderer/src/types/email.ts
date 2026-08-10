/*!
 * @geoleaf/field-renderer — email component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores an email address string.
 * Side panel renders a clickable mailto: link.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, email as vEmail } from "../validators.js";
import { _renderSimpleField } from "./field-base.js";

const formRender = _renderSimpleField<string>({
    kind: "email",
    inputType: "email",
    setValue: (input, value) => {
        input.value = value ?? "";
    },
    read: (input) => input.value,
    applyAttrs: (input, fieldConfig) => {
        input.placeholder = fieldConfig.placeholder
            ? String(fieldConfig.placeholder)
            : "email@example.com";
    },
});

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return vEmail(value);
}

/**
 * An email address, validated for shape rather than deliverability. The sidepanel renders a `mailto:` link.
 *
 * Registered under the id `email`, and selected when a field declares `"type": "email"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const emailComponent: ComponentDefinition<string> = {
    id: "email",
    defaults: "",
    formRender,
    validator,
};
