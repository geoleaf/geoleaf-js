/*!
 * @geoleaf/field-renderer — Field renderer bridge (FieldConfig[] → ComponentRegistry)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { FieldConfig, RenderCtx } from "./contract.js";
import { ComponentRegistry } from "./registry.js";
import { _el, _getLabel } from "./helpers.js";

/**
 * Handle over a rendered form: read and write its values, validate it, tear it down.
 *
 * Returned when a schema is rendered, and the only supported way to talk to the fields
 * afterwards — the host does not reach into the DOM itself.
 */
export interface FieldRendererBridge {
    /** Scrollable container holding all rendered fields. */
    el: HTMLElement;
    getValues(): Record<string, unknown>;
    setValues(values: Record<string, unknown>): void;
    /** Runs all validators. Returns true when the form is valid. */
    /** Runs all validators, PAINTS the outcome per field, and returns true when valid. */
    validate(): boolean;
    getErrors(): Record<string, string | null>;
    /**
     * The control of the first field currently in error, for the caller to focus.
     *
     * Reflects the last {@link FieldRendererBridge.validate} call, so calling it before one
     * returns `null`. The modal uses it to answer a refused save with something the user
     * can see AND reach — the two halves of "the form said no".
     */
    firstInvalidControl(): HTMLElement | null;
    destroy(): void;
}

/**
 * Reads the value a field `id` designates, flat or at the end of a dotted path.
 *
 * 🛑 This module's four accesses did `values[field.id]`, a FLAT access. An
 * `id` like `attributes.short_desc` looked there for a property **literally
 * named** "attributes.short_desc", so a field stored under a nested object
 * displayed correctly (the reading engine does know how to descend) but
 * **could not be edited**.
 *
 * ⚠️ **The literal key wins, and that is not a convenience**: it is what
 * makes the change purely ADDITIVE. A consumer really storing their value
 * under the key `"a.b"` keeps finding it; without that precedence, their data
 * would move into a nested object at the first render. This package is
 * published — nothing that worked moves.
 */
function readAt(values: Record<string, unknown>, id: string): unknown {
    if (id in values || !id.includes(".")) return values[id];
    let cur: unknown = values;
    for (const seg of id.split(".")) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

/**
 * Writes where {@link readAt} reads, creating the missing levels.
 *
 * ⚠️ Strict symmetry with reading: the literal key wins there too, otherwise
 * a value read flat would be rewritten nested and the field would split at
 * the next render.
 * ⚠️ An intermediate level that exists but is not an object is REPLACED —
 * overwriting a scalar is the only way to honour the path, and the
 * alternative (giving up silently) is precisely the defect this function fixes.
 */
function writeAt(values: Record<string, unknown>, id: string, v: unknown): void {
    if (id in values || !id.includes(".")) {
        values[id] = v;
        return;
    }
    const segs = id.split(".");
    const last = segs.pop() as string;
    let cur: Record<string, unknown> = values;
    for (const seg of segs) {
        const next = cur[seg];
        if (!next || typeof next !== "object") cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
    }
    cur[last] = v;
}

/** Control a field's error message describes, whatever component rendered it. */
function _controlOf(wrap: HTMLElement): HTMLElement | null {
    return wrap.querySelector<HTMLElement>("input, select, textarea, fieldset");
}

/**
 * Gives one field's error slot a resolvable identity, once, at build time.
 *
 * ⚠️ **Done here and not in `types/field-base.ts`**, because 13 components hand-roll their
 * own `.gl-form-error` span instead of calling `_errorSlot()` — `tags`, `table`, `gallery`,
 * `dropdown`, `image`, `coordinates`, `hours`… Wiring it per component would mean 17 sites
 * and 17 chances to forget one; the wrapper is the one place they all share.
 *
 * @param wrap    - The field wrapper the component returned.
 * @param fieldId - Schema id, which may be a dotted path (`properties.photo`).
 */
function _wireErrorSlot(wrap: HTMLElement, fieldId: string): void {
    wrap.dataset["glField"] = fieldId;
    const slot = wrap.querySelector<HTMLElement>(".gl-form-error");
    if (!slot) return;
    slot.id = `gl-field-${fieldId}-error`;
    // `polite`, not `assertive`: the message appears on a deliberate submit, so it must be
    // announced without cutting off whatever the user is already hearing.
    slot.setAttribute("aria-live", "polite");
    const ctl = _controlOf(wrap);
    if (!ctl) return;
    ctl.setAttribute("aria-describedby", slot.id);
    ctl.setAttribute("aria-invalid", "false");
}

/**
 * Clears a field's error as soon as the user edits inside it.
 *
 * ONE delegated listener rather than one per field. `types/field-base.ts` already hides its
 * own slot on `input`, but it knows nothing of `aria-invalid` nor of the error map — leaving
 * those behind would make the screen and `getErrors()` disagree.
 *
 * @param container - The bridge's field container.
 * @param errors    - The error map to keep in step with the screen.
 */
function _wireErrorClearing(container: HTMLElement, errors: Map<string, string | null>): void {
    const clear = (e: Event) => {
        const wrap = (e.target as Element | null)?.closest?.<HTMLElement>("[data-gl-field]");
        const id = wrap?.dataset["glField"];
        if (!id || !wrap) return;
        errors.set(id, null);
        _paintField(wrap, null);
    };
    container.addEventListener("input", clear);
    container.addEventListener("change", clear);
}

/**
 * Shows or hides one field's error.
 *
 * @param wrap    - The field wrapper.
 * @param message - Resolved message, or `null` to clear.
 */
function _paintField(wrap: HTMLElement, message: string | null): void {
    const slot = wrap.querySelector<HTMLElement>(".gl-form-error");
    if (slot) {
        slot.textContent = message ?? "";
        slot.hidden = message === null;
    }
    _controlOf(wrap)?.setAttribute("aria-invalid", message === null ? "false" : "true");
}

/**
 * Iterates `schema` and calls `ComponentRegistry.get(type).formRender()` for each field.
 * Maintains an internal value map updated via each component's `onChange` callback.
 * Fields with a `computed` key are rendered read-only (geo-compute values set externally via `setValues`).
 * Fields with `dependsOn` + `optionsByCategory` get their select options filtered when the parent changes.
 *
 * ⚠️ Values are addressed through {@link readAt} / {@link writeAt}, so a
 * dotted `id` designates a path in the object and not a literal key — unless
 * that key exists.
 *
 * @param schema        - The fields to render, in order.
 * @param initialValues - Values the form opens on.
 * @param ctx           - Rendering context (language, read-only).
 * @returns the bridge handle — element, values, validation and teardown.
 */
export function createFieldRendererBridge(
    schema: FieldConfig[],
    initialValues: Record<string, unknown>,
    ctx: RenderCtx
): FieldRendererBridge {
    const values: Record<string, unknown> = { ...initialValues };
    // 🛑 A `Map`, AND NOT A PLAIN OBJECT. The clear-on-input handler keys off a `data-`
    // attribute read from the DOM, so `errors[id] = null` is a write by a key the code does
    // not choose — with `__proto__` it re-parents the object instead of storing anything.
    // `check-dynamic-key-writes` bit on exactly that line; a Map has no such key, so the
    // hazard is removed rather than declared. `getErrors()` still hands back a plain record.
    const errors = new Map<string, string | null>();
    const container = _el("div", "gl-editor-form-fields");
    const renderedEls = new Map<string, HTMLElement>();

    schema.forEach((field) => {
        const isComputed = Boolean(field.computed);
        const fieldCtx: RenderCtx = isComputed ? { ...ctx, readOnly: true } : ctx;

        const component = ComponentRegistry.get(field.type) ?? ComponentRegistry.get("text");
        if (!component) return;

        const initial = readAt(values, field.id) ?? component.defaults;
        const el = component.formRender(
            initial,
            field,
            (v) => {
                writeAt(values, field.id, v);
            },
            fieldCtx
        );
        container.appendChild(el);
        renderedEls.set(field.id, el);
        errors.set(field.id, null);
        _wireErrorSlot(el, field.id);
    });

    _wireErrorClearing(container, errors);

    // Wire cascade: fields with dependsOn + optionsByCategory filter their options
    // when the parent field's select changes.
    schema.forEach((field) => {
        if (!field.dependsOn || !field.optionsByCategory) return;
        const parentId = field.dependsOn as string;
        const optsByCategory = field.optionsByCategory as Record<
            string,
            Array<{ value: string; label: string }>
        >;

        const parentEl = renderedEls.get(parentId);
        const childEl = renderedEls.get(field.id);
        if (!parentEl || !childEl) return;

        const parentSelect = parentEl.querySelector<HTMLSelectElement>("select");
        const childSelect = childEl.querySelector<HTMLSelectElement>("select");
        if (!parentSelect || !childSelect) return;

        parentSelect.addEventListener("change", () => {
            const opts = optsByCategory[parentSelect.value] ?? [];
            childSelect.innerHTML = "";
            if (field.emptyLabel) {
                const empty = document.createElement("option");
                empty.value = "";
                empty.textContent = field.emptyLabel as string;
                childSelect.appendChild(empty);
            }
            opts.forEach((o) => {
                const opt = document.createElement("option");
                opt.value = o.value;
                opt.textContent = o.label;
                childSelect.appendChild(opt);
            });
            // Reset dependent value when parent changes
            writeAt(values, field.id, "");
        });
    });

    return {
        el: container,

        getValues(): Record<string, unknown> {
            return { ...values };
        },

        setValues(incoming: Record<string, unknown>): void {
            Object.assign(values, incoming);
        },

        /**
         * Runs every validator AND paints the outcome.
         *
         * 🛑 THE PAINTING IS NOT A SIDE EFFECT ADDED FOR CONVENIENCE — it is what the
         * function was missing. It filled this map and showed nothing, so an invalid form
         * answered "Enregistrer" with silence, and `getErrors()` had no production caller
         * at all. `types/field-base.ts` already promised in its own TSDoc that the slot is
         * "revealed by the component **or the bridge** on validation"; the bridge never did.
         */
        validate(): boolean {
            let valid = true;
            schema.forEach((field) => {
                const component =
                    ComponentRegistry.get(field.type) ?? ComponentRegistry.get("text");
                const errKey = component?.validator?.(readAt(values, field.id), field) ?? null;
                const message = errKey ? _getLabel(errKey) : null;
                errors.set(field.id, message);
                if (message) valid = false;
                const el = renderedEls.get(field.id);
                if (el) _paintField(el, message);
            });
            return valid;
        },

        firstInvalidControl(): HTMLElement | null {
            for (const field of schema) {
                if (!errors.get(field.id)) continue;
                const el = renderedEls.get(field.id);
                const ctl = el?.querySelector<HTMLElement>("input, select, textarea");
                if (ctl) return ctl;
                if (el) return el;
            }
            return null;
        },

        getErrors(): Record<string, string | null> {
            // `fromEntries` defines OWN properties, so a field literally named `__proto__`
            // lands as data rather than re-parenting the result.
            return Object.fromEntries(errors);
        },

        destroy(): void {
            container.remove();
        },
    };
}
