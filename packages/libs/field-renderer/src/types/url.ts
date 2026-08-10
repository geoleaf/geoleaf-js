/*!
 * @geoleaf/field-renderer — url component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores a raw URL string (http/https/mailto/tel).
 * Distinct from the `link` type which stores { href, label? }.
 * Side panel renders a clickable external link.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, url as vUrl } from "../validators.js";

import { _renderSimpleField } from "./field-base.js";

const formRender = _renderSimpleField<string>({
    kind: "url",
    inputType: "url",
    setValue: (input, value) => {
        input.value = value ?? "";
    },
    read: (input) => input.value,
    applyAttrs: (input, fieldConfig) => {
        input.placeholder = fieldConfig.placeholder ? String(fieldConfig.placeholder) : "https://";
    },
});

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return vUrl(value);
}

/**
 * A URL, validated against the allowed protocols before being rendered as a link.
 *
 * Registered under the id `url`, and selected when a field declares `"type": "url"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const urlComponent: ComponentDefinition<string> = {
    id: "url",
    defaults: "",
    formRender,
    validator,
};
