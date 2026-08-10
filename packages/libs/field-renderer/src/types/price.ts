/*!
 * @geoleaf/field-renderer — price component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Stores { amount: number; currency: string }.
 * fieldConfig extras:
 *   currencies?: string[]   — override the default list (EUR/USD/GBP/CHF/CAD/JPY)
 *   decimals?: number       — decimal places (default 2)
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el } from "../helpers.js";

interface PriceValue {
    amount: number;
    currency: string;
}

const DEFAULT_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY"];

function formRender(
    value: PriceValue,
    fieldConfig: FieldConfig,
    onChange: (v: PriceValue) => void,
    ctx: RenderCtx
): HTMLElement {
    const currencies = (fieldConfig.currencies as string[] | undefined) ?? DEFAULT_CURRENCIES;
    const current: PriceValue = {
        amount: value?.amount ?? 0,
        currency: value?.currency ?? currencies[0] ?? "EUR",
    };

    const wrap = _el("div", "gl-form-field gl-form-price");

    const labelEl = _el("label", "gl-form-label");
    labelEl.textContent = fieldConfig.label;
    if (fieldConfig.required) labelEl.dataset.required = "true";

    const row = _el("div", "gl-form-price__row");

    const amountInput = _el("input");
    amountInput.type = "number";
    amountInput.className = "gl-form-input gl-form-price__amount";
    amountInput.step = "0.01";
    amountInput.min = "0";
    amountInput.value = String(current.amount);
    amountInput.disabled = !!ctx.readOnly;
    labelEl.htmlFor = amountInput.id = `gl-field-${fieldConfig.id}-amount`;

    const currencySelect = _el("select", "gl-form-input gl-form-price__currency");
    currencySelect.disabled = !!ctx.readOnly;
    for (const cur of currencies) {
        const opt = _el("option");
        opt.value = cur;
        opt.textContent = cur;
        opt.selected = cur === current.currency;
        currencySelect.appendChild(opt);
    }

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    amountInput.addEventListener("input", () => {
        current.amount = parseFloat(amountInput.value) || 0;
        onChange({ ...current });
        errorEl.hidden = true;
    });

    currencySelect.addEventListener("change", () => {
        current.currency = currencySelect.value;
        onChange({ ...current });
    });

    row.appendChild(amountInput);
    row.appendChild(currencySelect);
    wrap.appendChild(labelEl);
    wrap.appendChild(row);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: PriceValue, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value?.amount != null ? value : null);
        if (err) return err;
    }
    if (value?.amount != null && value.amount < 0) return "form.error.min";
    return null;
}

/**
 * A price: an amount plus its currency.
 *
 * Registered under the id `price`, and selected when a field declares `"type": "price"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const priceComponent: ComponentDefinition<PriceValue> = {
    id: "price",
    defaults: { amount: 0, currency: "EUR" },
    formRender,
    validator,
};
