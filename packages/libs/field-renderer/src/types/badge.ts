/*!
 * @geoleaf/field-renderer — badge component
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Value: { label: string; color: string } — rendered as a coloured pill.
 * https://geoleaf.dev
 */
import type { ComponentDefinition, FieldConfig, RenderCtx } from "../contract.js";
import { required as vRequired } from "../validators.js";
import { _el, _getLabel } from "../helpers.js";

interface BadgeValue {
    label: string;
    color: string;
}

const DEFAULTS: BadgeValue = { label: "", color: "#6366f1" };

function formRender(
    value: BadgeValue,
    fieldConfig: FieldConfig,
    onChange: (v: BadgeValue) => void,
    ctx: RenderCtx
): HTMLElement {
    const v: BadgeValue = value ?? { ...DEFAULTS };
    const wrap = _el("div", "gl-form-field gl-form-badge");

    const fieldLabel = _el("label", "gl-form-label");
    fieldLabel.textContent = fieldConfig.label;
    if (fieldConfig.required) fieldLabel.dataset.required = "true";

    const row = _el("div", "gl-form-badge__row");

    const textInput = _el("input");
    textInput.type = "text";
    textInput.className = "gl-form-input";
    textInput.value = v.label;
    textInput.disabled = !!ctx.readOnly;
    textInput.placeholder = fieldConfig.placeholder ? String(fieldConfig.placeholder) : "";

    const colorInput = _el("input");
    colorInput.type = "color";
    colorInput.className = "gl-form-badge__color";
    colorInput.value = v.color;
    colorInput.disabled = !!ctx.readOnly;
    // The visible <label> is bound to the TEXT input below (`fieldLabel.htmlFor`), so the
    // colour swatch is left unnamed — axe reported it as rule `label`. It needs its own
    // name, and one that says which field it colours, since a form can carry several
    // badges.
    colorInput.setAttribute(
        "aria-label",
        `${_getLabel("form.aria.badgeColor")} — ${fieldConfig.label}`
    );

    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;

    fieldLabel.htmlFor = textInput.id = `gl-field-${fieldConfig.id}`;

    const emit = () => {
        onChange({ label: textInput.value, color: colorInput.value });
        errorEl.hidden = true;
    };
    textInput.addEventListener("input", emit);
    colorInput.addEventListener("input", emit);

    row.appendChild(textInput);
    row.appendChild(colorInput);
    wrap.appendChild(fieldLabel);
    wrap.appendChild(row);
    wrap.appendChild(errorEl);
    return wrap;
}

function validator(value: BadgeValue, fieldConfig: FieldConfig): string | null {
    if (fieldConfig.required) {
        const err = vRequired(value?.label);
        if (err) return err;
    }
    return null;
}

/**
 * A coloured pill. Value `{ label, color }`; the form pairs a text input with a colour swatch, the swatch carrying its own `aria-label` since the visible label is bound to the text input.
 *
 * Registered under the id `badge`, and selected when a field declares `"type": "badge"`.
 * Like every component it exposes two surfaces: `formRender` (editable, honouring `ctx.readOnly`) and `validator`.
 */
export const badgeComponent: ComponentDefinition<BadgeValue> = {
    id: "badge",
    defaults: { ...DEFAULTS },
    formRender,
    validator,
};
