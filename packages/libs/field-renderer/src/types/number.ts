/*!
 * @geoleaf/field-renderer — number component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig } from "../contract.js";
import { required as vRequired, range as vRange } from "../validators.js";
import { _renderSimpleField } from "./field-base.js";

/** Shared by `number` and `metric`: `min`/`max`/`step` bounds on a numeric input. */
export function _applyNumberAttrs(input: HTMLInputElement, fieldConfig: FieldConfig): void {
    // `!== undefined`, NOT truthiness — unlike `date`. `min: 0` is a legitimate
    // bound and must survive.
    if (fieldConfig.min !== undefined) input.min = String(fieldConfig.min);
    if (fieldConfig.max !== undefined) input.max = String(fieldConfig.max);
    if (fieldConfig.step !== undefined) input.step = String(fieldConfig.step);
}

/** Shared by `number` and `metric`: leaves the input blank for a nullish value. */
export function _setNumberValue(input: HTMLInputElement, value: number): void {
    if (value !== undefined && value !== null) input.value = String(value);
}

/** Shared by `number` and `metric`: range check honouring optional bounds. */
export function _validateNumberRange(value: number, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    if (fieldConfig.min !== undefined || fieldConfig.max !== undefined) {
        const min = fieldConfig.min !== undefined ? Number(fieldConfig.min) : -Infinity;
        const max = fieldConfig.max !== undefined ? Number(fieldConfig.max) : Infinity;
        const err = vRange(value, min, max);
        if (err) return err;
    }
    return null;
}

const formRender = _renderSimpleField<number>({
    kind: "number",
    inputType: "number",
    setValue: _setNumberValue,
    read: (input) => input.valueAsNumber,
    applyAttrs: _applyNumberAttrs,
});

/**
 * A plain number, in a numeric input.
 *
 * Registered under the id `number`, and selected when a field declares `"type": "number"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const numberComponent: ComponentDefinition<number> = {
    id: "number",
    defaults: 0,
    formRender,
    validator: _validateNumberRange,
};
