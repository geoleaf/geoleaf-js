/*!
 * @geoleaf/field-renderer — link component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Value: { href: string; label?: string }
 * Side panel: clickable <a> opening in a new tab.
 * Form: url input + optional display-label text input.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired, url as vUrl } from "../validators.js";

import { _el, _getLabel } from "../helpers.js";

interface LinkValue {
    href: string;
    label?: string;
}

const DEFAULTS: LinkValue = { href: "", label: "" };

function formRender(
    value: LinkValue,
    fieldConfig: FieldConfig,
    onChange: (v: LinkValue) => void,
    ctx: RenderCtx
): HTMLElement {
    const v: LinkValue = value ?? { ...DEFAULTS };
    const wrap = _el("div", "gl-form-field gl-form-link");

    const fieldLabel = _el("label", "gl-form-label");
    fieldLabel.textContent = fieldConfig.label;
    if (fieldConfig.required) fieldLabel.dataset.required = "true";

    const urlInput = _el("input");
    urlInput.type = "url";
    urlInput.className = "gl-form-input";
    urlInput.value = v.href;
    urlInput.disabled = !!ctx.readOnly;
    urlInput.placeholder = "https://";

    fieldLabel.htmlFor = urlInput.id = `gl-field-${fieldConfig.id}`;

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    const emit = () => {
        const label = labelInput?.value ?? v.label;
        onChange({ href: urlInput.value, ...(label !== undefined && { label }) });
        errorEl.hidden = true;
    };
    urlInput.addEventListener("input", emit);

    wrap.appendChild(fieldLabel);
    wrap.appendChild(urlInput);

    let labelInput: HTMLInputElement | undefined;
    if (fieldConfig.showLabel !== false) {
        const labelFieldLabel = _el("label", "gl-form-label gl-form-label--secondary");
        labelFieldLabel.textContent = _getLabel("form.label.linkLabel");

        labelInput = _el("input");
        labelInput.type = "text";
        labelInput.className = "gl-form-input";
        labelInput.value = v.label ?? "";
        labelInput.disabled = !!ctx.readOnly;

        labelFieldLabel.htmlFor = labelInput.id = `gl-field-${fieldConfig.id}-label`;
        labelInput.addEventListener("input", emit);
        wrap.appendChild(labelFieldLabel);
        wrap.appendChild(labelInput);
    }

    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: LinkValue, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value?.href);
        if (err) return err;
    }
    if (value?.href) {
        const err = vUrl(value.href);
        if (err) return err;
    }
    return null;
}

/**
 * A hyperlink. Value `{ href, label? }`; the label falls back to the href when absent.
 *
 * Registered under the id `link`, and selected when a field declares `"type": "link"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const linkComponent: ComponentDefinition<LinkValue> = {
    id: "link",
    defaults: { ...DEFAULTS },
    formRender,
    validator,
};
