/*!
 * @geoleaf/field-renderer — dropdown component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * fieldConfig extras:
 *   options?: Array<{value: string; label: string}>  — static list; beside `fetchOptions`, the
 *                                                      fallback when the list cannot be loaded
 *   fetchOptions?: string                            — URL of a JSON array of {value,label}
 *   emptyLabel?: string                              — placeholder option label
 *
 * A list loaded by URL is asked of the host's resolver FIRST (`setOptionsResolver`): the host
 * can keep lists for off-network use, which this library cannot — persisting would pull a
 * storage engine into a field renderer (decision D5, `docs/specs/libs/field-renderer.md`).
 * Only when the resolver has nothing does the component fetch. Whatever the outcome, the value
 * the entity holds stays offered and selected — off-network it used to match no option and
 * vanish — and a read-only field stays read-only (it re-enabled itself once loading ended).
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

/** One choice of a dropdown. */
export interface DropdownOption {
    value: string;
    label: string;
}

/**
 * Answers a dropdown's `fetchOptions` URL with its list — from the host's own store, typically
 * — or `null` when the host has nothing, in which case the component fetches the URL itself.
 */
export type OptionsResolver = (url: string) => Promise<DropdownOption[] | null>;

let _optionsResolver: OptionsResolver | null = null;

/**
 * Registers how a host answers a dropdown's `fetchOptions` URL before the network is asked.
 *
 * ⚠️ One resolver at a time — the last call wins, as with `setImageUploadStrategy`.
 *
 * @param fn - The resolver, or `null` to fetch every list from the network again.
 * @example
 * ```ts
 * setOptionsResolver(async (url) => (await myStore.get(url)) ?? null);
 * ```
 */
export function setOptionsResolver(fn: OptionsResolver | null): void {
    _optionsResolver = fn;
}

/** The options, plus the value the entity holds when none of them carries it. */
function _withSavedValue(options: DropdownOption[], value: string): DropdownOption[] {
    if (!value || options.some((o) => o.value === value)) return options;
    return [...options, { value, label: value }];
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

    for (const opt of _withSavedValue(options, value)) {
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

        // Every outcome REBUILDS the select through `_buildSelect`, which honours
        // `ctx.readOnly` — the failure path used to keep the loading select and re-enable it.
        const show = (options: DropdownOption[]): void => {
            _setLoading(wrap, false);
            const newSelect = _buildSelect(value, options, fieldConfig, onChange, ctx);
            newSelect.id = select.id;
            select.replaceWith(newSelect);
            select = newSelect;
        };

        _setLoading(wrap, true);
        const fromHost = _optionsResolver ? _optionsResolver(fetchUrl) : Promise.resolve(null);
        fromHost
            .catch(() => null)
            .then(
                (held) =>
                    held ??
                    fetch(fetchUrl).then((res) => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json() as Promise<DropdownOption[]>;
                    })
            )
            .then((fetched) => show(fetched))
            .catch(() => {
                // The static list, when declared, is the fallback it looks like — no error then.
                show(staticOptions);
                if (staticOptions.length > 0) return;
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
