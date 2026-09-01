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
    validate(): boolean;
    getErrors(): Record<string, string | null>;
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

/**
 * Iterates `schema` and calls `ComponentRegistry.get(type).formRender()` for each field.
 * Maintains an internal value map updated via each component's `onChange` callback.
 * Fields with a `computed` key are rendered read-only (geo-compute values set externally via `setValues`).
 * Fields with `dependsOn` + `optionsByCategory` get their select options filtered when the parent changes.
 *
 * ⚠️ Values are addressed through {@link readAt} / {@link writeAt}, so a
 * dotted `id` designates a path in the object and not a literal key — unless
 * that key exists.
 */
export function createFieldRendererBridge(
    schema: FieldConfig[],
    initialValues: Record<string, unknown>,
    ctx: RenderCtx
): FieldRendererBridge {
    const values: Record<string, unknown> = { ...initialValues };
    const errors: Record<string, string | null> = {};
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
        errors[field.id] = null;
    });

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

        validate(): boolean {
            let valid = true;
            schema.forEach((field) => {
                const component =
                    ComponentRegistry.get(field.type) ?? ComponentRegistry.get("text");
                const errKey = component?.validator?.(readAt(values, field.id), field) ?? null;
                if (errKey) {
                    errors[field.id] = _getLabel(errKey);
                    valid = false;
                } else {
                    errors[field.id] = null;
                }
            });
            return valid;
        },

        getErrors(): Record<string, string | null> {
            return { ...errors };
        },

        destroy(): void {
            container.remove();
        },
    };
}
