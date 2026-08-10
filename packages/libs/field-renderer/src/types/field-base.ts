/*!
 * @geoleaf/field-renderer — shared field scaffolding
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Every field type used to hand-roll the same wrap/label/input/error skeleton.
 * The primitives below own that skeleton once; `_renderSimpleField` turns it
 * into a `formRender` for the types whose only differences are the input type
 * and a handful of attributes.
 *
 * The DOM produced here is byte-for-byte what the hand-rolled versions emitted
 * — same tags, same classes, same attribute set, same child order. That is what
 * lets the existing suite validate the extraction without a single test change.
 * https://geoleaf.dev
 */
import type { FieldConfig, RenderCtx } from "../contract.js";
import { _el } from "../helpers.js";

/** Wrapper shared by every field: `gl-form-field` + a per-type modifier. */
export function _fieldWrap(kind: string): HTMLDivElement {
    return _el("div", `gl-form-field gl-form-${kind}`);
}

/** Editable `<label>` carrying the field name and the `required` marker. */
export function _formLabel(fieldConfig: FieldConfig): HTMLLabelElement {
    const label = _el("label", "gl-form-label");
    label.textContent = fieldConfig.label;
    if (fieldConfig.required) label.dataset.required = "true";
    return label;
}

/** Hidden error slot, revealed by the component or the bridge on validation. */
export function _errorSlot(): HTMLSpanElement {
    const errorEl = _el("span", "gl-form-error");
    errorEl.hidden = true;
    return errorEl;
}

/** One selectable entry of a `checkbox`-multi or `radio` group. */
export interface FieldOption {
    value: string;
    label: string;
}

/** Per-type customisation of the shared option-group render. */
interface OptionGroupSpec {
    /**
     * Full class list of the `<fieldset>`.
     *
     * Passed verbatim rather than derived from a `kind` suffix, so the class
     * name stays a literal in the source. `verify-purgecss.cjs` reads the
     * sources to decide which selectors are live; a template-built
     * `gl-form-${kind}-group` is invisible to it and got `.gl-form-radio-group`
     * reported as dead CSS. Greppable class names also help humans.
     */
    groupClass: string;
    /** Full class list of each option row. Literal, for the same reason. */
    itemClass: string;
    /** Value of `input.type`. */
    inputType: string;
    /** Whether the inputs share a `name` (radio semantics: one choice per group). */
    named?: boolean;
    /** Disables every input — sourced from `RenderCtx.readOnly`, not the field config. */
    readOnly?: boolean;
    /** Whether this option is selected on first render. */
    isChecked(option: FieldOption): boolean;
    /** Called on `change` — emits the new value in the component's own shape. */
    onToggle(option: FieldOption, input: HTMLInputElement): void;
}

/**
 * Builds the `<fieldset>` + `<legend>` + one input-per-option shape shared by
 * the multi-value checkbox and the radio group.
 *
 * @param options     - Selectable entries.
 * @param fieldConfig - Field descriptor (label, required).
 * @param spec        - Per-type differences.
 */
export function _renderOptionGroup(
    options: FieldOption[],
    fieldConfig: FieldConfig,
    spec: OptionGroupSpec
): HTMLFieldSetElement {
    const groupId = `gl-field-${fieldConfig.id}`;

    const fieldset = _el("fieldset", spec.groupClass);

    const legend = _el("legend", "gl-form-label");
    legend.textContent = fieldConfig.label;
    if (fieldConfig.required) legend.dataset.required = "true";
    fieldset.appendChild(legend);

    for (const opt of options) {
        const itemWrap = _el("div", spec.itemClass);

        const input = _el("input");
        input.type = spec.inputType;
        if (spec.named) input.name = groupId;
        input.value = opt.value;
        input.id = `${groupId}-${opt.value}`;
        input.checked = spec.isChecked(opt);
        input.disabled = !!spec.readOnly;
        input.addEventListener("change", () => spec.onToggle(opt, input));

        const optLabel = _el("label");
        optLabel.htmlFor = input.id;
        optLabel.textContent = opt.label;

        itemWrap.appendChild(input);
        itemWrap.appendChild(optLabel);
        fieldset.appendChild(itemWrap);
    }

    fieldset.appendChild(_errorSlot());
    return fieldset;
}

/** Per-type customisation of the shared single-input `formRender`. */
interface SimpleFieldSpec<TValue> {
    /** Per-type modifier class suffix (matches the component id). */
    kind: string;
    /** Value of `input.type`. */
    inputType: string;
    /** Writes the incoming value onto the input. */
    setValue(input: HTMLInputElement, value: TValue): void;
    /** Reads the edited value back off the input, in the component's own type. */
    read(input: HTMLInputElement): TValue;
    /**
     * Applies the per-type attributes (placeholder, min/max, step, maxLength).
     * Kept as a hook rather than a declarative map: the guards are NOT uniform
     * across types and must not be made so — `date` tests min/max for
     * truthiness while `number` tests `!== undefined`, which is the only reason
     * `min: 0` behaves differently on the two. Preserved deliberately.
     */
    applyAttrs?(input: HTMLInputElement, fieldConfig: FieldConfig): void;
    /**
     * Wraps the input in extra chrome before it is appended (metric's
     * prefix/suffix row). Returns the node to append in the input's place.
     */
    wrapInput?(input: HTMLInputElement, fieldConfig: FieldConfig): HTMLElement;
}

/**
 * Builds the `formRender` of a single-input field.
 *
 * Covers the skeleton every simple type repeated verbatim: wrapper, label with
 * `required` marker, `gl-form-input`, hidden error slot, `htmlFor`/`id` pairing
 * on `gl-field-<id>`, and an `input` listener that emits and clears the error.
 *
 * @param spec - Per-type differences.
 * @returns A `ComponentDefinition.formRender` implementation.
 */
export function _renderSimpleField<TValue>(
    spec: SimpleFieldSpec<TValue>
): (
    value: TValue,
    fieldConfig: FieldConfig,
    onChange: (v: TValue) => void,
    ctx: RenderCtx
) => HTMLElement {
    return function formRender(
        value: TValue,
        fieldConfig: FieldConfig,
        onChange: (v: TValue) => void,
        ctx: RenderCtx
    ): HTMLElement {
        const wrap = _fieldWrap(spec.kind);
        const label = _formLabel(fieldConfig);

        const input = _el("input", "gl-form-input");
        input.type = spec.inputType;
        spec.setValue(input, value);
        input.disabled = !!ctx.readOnly || !!fieldConfig.computed;
        spec.applyAttrs?.(input, fieldConfig);

        const errorEl = _errorSlot();

        label.htmlFor = input.id = `gl-field-${fieldConfig.id}`;

        input.addEventListener("input", () => {
            onChange(spec.read(input));
            errorEl.hidden = true;
        });

        wrap.appendChild(label);
        wrap.appendChild(spec.wrapInput ? spec.wrapInput(input, fieldConfig) : input);
        wrap.appendChild(errorEl);
        return wrap;
    };
}
