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
 * Lit la valeur qu'un `id` de champ désigne, plate ou au bout d'un chemin pointé.
 *
 * 🛑 B-132 — les quatre accès de ce module faisaient `values[field.id]`, un accès PLAT.
 * Un `id` comme `attributes.short_desc` y cherchait une propriété **littéralement nommée**
 * « attributes.short_desc », donc un champ rangé sous un objet imbriqué s'affichait
 * correctement (le moteur de lecture, lui, sait descendre) mais **ne pouvait pas être saisi**.
 *
 * ⚠️ **La clé littérale l'emporte, et ce n'est pas une commodité** : c'est ce qui rend le
 * changement purement ADDITIF. Un consommateur qui range réellement sa valeur sous la clé
 * `"a.b"` continue de la trouver ; sans cette précédence, on déplacerait sa donnée dans un
 * objet imbriqué au premier rendu. Ce paquet est publié — rien de ce qui marchait ne bouge.
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
 * Écrit au même endroit que {@link readAt} lit, en créant les niveaux manquants.
 *
 * ⚠️ Symétrie stricte avec la lecture : la clé littérale l'emporte là aussi, sinon une valeur
 * lue à plat serait réécrite imbriquée et le champ se dédoublerait au rendu suivant.
 * ⚠️ Un niveau intermédiaire qui existe mais n'est pas un objet est REMPLACÉ — écraser un
 * scalaire est le seul moyen d'honorer le chemin, et l'alternative (abandonner en silence)
 * est précisément le défaut que cette fonction corrige.
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
 * ⚠️ Les valeurs sont adressées par {@link readAt} / {@link writeAt}, donc un `id` pointé
 * désigne un chemin dans l'objet et non une clé littérale — sauf si cette clé existe (B-132).
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
