/*!
 * @geoleaf/field-renderer — date component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores an ISO date string (YYYY-MM-DD), the native format of <input type="date">.
 * Side panel renders a human-readable date via Intl.DateTimeFormat.
 * fieldConfig.min / fieldConfig.max → date range bounds (YYYY-MM-DD strings).
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, dateISO } from "../validators.js";
import { _renderSimpleField } from "./field-base.js";

const formRender = _renderSimpleField<string>({
    kind: "date",
    inputType: "date",
    setValue: (input, value) => {
        input.value = value ?? "";
    },
    read: (input) => input.value,
    applyAttrs: (input, fieldConfig) => {
        // Truthiness guard, NOT `!== undefined` — unlike `number`. A blank
        // string bound is meaningless for a date input, so it is skipped here.
        if (fieldConfig.min) input.min = String(fieldConfig.min);
        if (fieldConfig.max) input.max = String(fieldConfig.max);
    },
});

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return dateISO(value);
}

/**
 * A date, held as an ISO-8601 string. The form uses a native date input, so the browser owns the locale and the picker.
 *
 * Registered under the id `date`, and selected when a field declares `"type": "date"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const dateComponent: ComponentDefinition<string> = {
    id: "date",
    defaults: "",
    formRender,
    validator,
};
