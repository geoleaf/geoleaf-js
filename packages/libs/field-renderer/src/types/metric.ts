/*!
 * @geoleaf/field-renderer — metric component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Wraps the number component with an optional prefix and/or suffix (unit label).
 * fieldConfig extras: prefix (string), suffix / unit (string), min, max, step.
 * https://geoleaf.dev
 */
import type { ComponentDefinition } from "../contract.js";
import { _el } from "../helpers.js";
import { _renderSimpleField } from "./field-base.js";
import { _applyNumberAttrs, _setNumberValue, _validateNumberRange } from "./number.js";

const formRender = _renderSimpleField<number>({
    kind: "metric",
    inputType: "number",
    setValue: _setNumberValue,
    read: (input) => input.valueAsNumber,
    applyAttrs: _applyNumberAttrs,
    wrapInput: (input, fieldConfig) => {
        const inputWrap = _el("div", "gl-form-metric__row");

        if (fieldConfig.prefix) {
            const prefixEl = _el("span", "gl-form-metric__prefix");
            prefixEl.textContent = String(fieldConfig.prefix);
            inputWrap.appendChild(prefixEl);
        }

        inputWrap.appendChild(input);

        const unit = (fieldConfig.unit ?? fieldConfig.suffix) as string | undefined;
        if (unit) {
            const suffixEl = _el("span", "gl-form-metric__suffix");
            suffixEl.textContent = unit;
            inputWrap.appendChild(suffixEl);
        }

        return inputWrap;
    },
});

/**
 * A number shown with a unit, for figures meant to be read rather than computed on.
 *
 * Registered under the id `metric`, and selected when a field declares `"type": "metric"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const metricComponent: ComponentDefinition<number> = {
    id: "metric",
    defaults: 0,
    formRender,
    validator: _validateNumberRange,
};
