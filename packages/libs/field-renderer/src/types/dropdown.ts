/*!
 * @geoleaf/field-renderer — dropdown component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * fieldConfig extras:
 *   options?: Array<{value: string; label: string}>  — static list
 *   fetchOptions?: string                            — URL to fetch a JSON array of {value,label}
 *   emptyLabel?: string                              — placeholder option label
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

interface DropdownOption {
    value: string;
    label: string;
}

function _buildSelect(
    value: string,
    options: DropdownOption[],
    fieldConfig: FieldConfig,
    onChange: (v: string) => void,
    ctx: RenderCtx
): HTMLSelectElement {
    const select = _el("select", "gl-form-input");
    select.disabled = !!ctx.readOnly;

    const emptyLabel = fieldConfig.emptyLabel ? String(fieldConfig.emptyLabel) : "";
    const placeholder = _el("option");
    placeholder.value = "";
    placeholder.textContent = emptyLabel;
    placeholder.disabled = !!fieldConfig.required;
    select.appendChild(placeholder);

    for (const opt of options) {
        const el = _el("option");
        el.value = opt.value;
        el.textContent = opt.label;
        select.appendChild(el);
    }

    // Assign after all options are in the DOM so the select reflects the value.
    select.value = value;

    select.addEventListener("change", () => {
        onChange(select.value);
    });
    return select;
}

function _setLoading(wrap: HTMLElement, loading: boolean): void {
    const select = wrap.querySelector("select");
    if (select) select.disabled = loading;
    let spinner = wrap.querySelector<HTMLSpanElement>(".gl-form-dropdown__spinner");
    if (loading && !spinner) {
        spinner = _el("span");
        spinner.className = "gl-form-dropdown__spinner";
        wrap.appendChild(spinner);
    } else if (!loading && spinner) {
        spinner.remove();
    }
}

function formRender(
    value: string,
    fieldConfig: FieldConfig,
    onChange: (v: string) => void,
    ctx: RenderCtx
): HTMLElement {
    const wrap = _el("div", "gl-form-field gl-form-dropdown");

    const label = _el("label", "gl-form-label");
    label.textContent = fieldConfig.label;
    if (fieldConfig.required) label.dataset.required = "true";

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    const staticOptions = (fieldConfig.options as DropdownOption[] | undefined) ?? [];
    const fetchUrl = fieldConfig.fetchOptions as string | undefined;

    let select: HTMLSelectElement;

    if (fetchUrl) {
        // Render a disabled placeholder immediately then populate after fetch.
        select = _buildSelect(value, [], fieldConfig, onChange, ctx);
        select.disabled = true;
        label.htmlFor = select.id = `gl-field-${fieldConfig.id}`;
        wrap.appendChild(label);
        wrap.appendChild(select);
        wrap.appendChild(errorEl);

        _setLoading(wrap, true);
        fetch(fetchUrl)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<DropdownOption[]>;
            })
            .then((fetched) => {
                _setLoading(wrap, false);
                const newSelect = _buildSelect(value, fetched, fieldConfig, onChange, ctx);
                newSelect.id = select.id;
                select.replaceWith(newSelect);
                select = newSelect;
            })
            .catch(() => {
                _setLoading(wrap, false);
                errorEl.textContent = _getLabel("form.error.fetchFailed");
                errorEl.hidden = false;
            });
    } else {
        select = _buildSelect(value, staticOptions, fieldConfig, onChange, ctx);
        label.htmlFor = select.id = `gl-field-${fieldConfig.id}`;
        wrap.appendChild(label);
        wrap.appendChild(select);
        wrap.appendChild(errorEl);
    }

    return wrap;
}

function validator(value: string, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value);
        if (err) return err;
    }
    return null;
}

/**
 * A single choice from the field's `options`, held as the selected option id.
 *
 * Registered under the id `dropdown`, and selected when a field declares `"type": "dropdown"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const dropdownComponent: ComponentDefinition<string> = {
    id: "dropdown",
    defaults: "",
    formRender,
    validator,
};
