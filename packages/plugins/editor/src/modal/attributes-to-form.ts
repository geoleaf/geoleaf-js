/*!
 * @geoleaf-plugins/editor — attributes.fields[] → FieldConfig[]
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The CAPTURE projection — task 7.2.
 *
 * A profile now carries ONE field list (`attributes.fields[]`) with two projections —
 * `display` for reading, `edit` for capture — and this module translates the second into
 * the contract `field-renderer` consumes.
 *
 * ⚠️ It REPLACES the reading of `formSchema`, removed in the same task (decision A15: the
 * removal belongs to the sprint that makes the code useless). `formSchema` was a second
 * field list, parallel to `attributes.fields[]` and reconciled with it by nothing.
 */

import type { FieldConfig } from "@geoleaf/field-renderer";

/** A field of a layer's `attributes` block, as it lives in the profile JSON. */
interface AttributeFieldLike {
    field?: unknown;
    label?: unknown;
    widget?: unknown;
    computed?: unknown;
    options?: unknown;
    edit?: {
        required?: unknown;
        widget?: unknown;
        options?: unknown;
    };
}

/**
 * Strips the leading `properties.` prefix off a field path.
 *
 * 🛑 This strip is LOAD-BEARING, not cosmetic. It aligns three things that
 * would diverge without it:
 *  - the key of the `values` map `createFieldRendererBridge` builds, which
 *    goes as-is to persistence;
 *  - `write.properties`, which is a FLAT list (`["title", …]`) serving as the
 *    whitelist for shipping to the backend;
 *  - the DOM id `#gl-field-<id>`, on which `e2e/09-editor.spec.js` has hard
 *    assertions, and which a dot would moreover make unaddressable in an
 *    unescaped CSS selector.
 *
 * ⚠️ Only the LEADING prefix is treated, deliberately: `properties.a.b` would
 * yield `a.b`, a flat key that rebuilds no nesting. Nested field addressing is
 * a distinct subject, out of this projection's scope. Neither migrated profile
 * carries any.
 *
 * ⚠️ Addressing is NOT uniform across profiles — `properties.title` on
 * `tourism`'s side, `name` on `_reference`'s. One rule covers both: without a
 * prefix, the strip is a no-op.
 */
function stripPropertiesPrefix(path: string): string {
    return path.startsWith("properties.") ? path.slice("properties.".length) : path;
}

/**
 * Projects the CAPTURABLE fields of an `attributes` block onto the
 * field-renderer contract.
 *
 * A field without `edit` is not captured: that is the projection's very
 * meaning, and what replaces `formSchema` membership.
 *
 * Field-level `widget` and `options` are the DEFAULTS; `edit.widget` and
 * `edit.options` override them. The override only exists where the two
 * projections genuinely diverge — measured at migration: 1 field out of 11.
 *
 * ⚠️ The options bag is FLATTENED onto the descriptor, because that is where
 * the components read it: `dropdown` reads `fieldConfig.options`, `list` reads
 * `fieldConfig.maxItems`, `image` reads `fieldConfig.uploadEndpoint`,
 * `longtext` reads `fieldConfig.rows`. `attributes` nests it under `options`,
 * `field-renderer` expects it flat — the translation is here, not assumed:
 * every widget the profiles carry is covered one by one in
 * `__tests__/attributes-to-form.test.ts`.
 *
 * @param attributes - The layer's `attributes` block, or any value when absent.
 * @returns The field descriptors to capture, in `attributes.fields[]` order.
 *
 * @example
 * ```ts
 * attributesToFormSchema({
 *     fields: [
 *         {
 *             field: "properties.statut",
 *             label: "Statut",
 *             primitive: "string",
 *             widget: "badge",
 *             edit: { widget: "dropdown", options: { options: [{ value: "Ouvert", label: "Ouvert" }] } },
 *         },
 *     ],
 * });
 * // → [{ id: "statut", type: "dropdown", label: "Statut", options: [{ value: "Ouvert", label: "Ouvert" }] }]
 * ```
 */
export function attributesToFormSchema(attributes: unknown): FieldConfig[] {
    const fields = (attributes as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(fields)) return [];

    const out: FieldConfig[] = [];
    for (const raw of fields as AttributeFieldLike[]) {
        const edit = raw?.edit;
        if (!edit || typeof edit !== "object") continue;
        if (typeof raw.field !== "string") continue;

        const widget = typeof edit.widget === "string" ? edit.widget : raw.widget;
        if (typeof widget !== "string") continue;

        // `edit.options` REPLACES the field's bag, it does not add to it: the
        // two are typed by different widgets, so merging them would mix two
        // vocabularies. The schema requires `edit.widget` whenever
        // `edit.options` is there.
        const bag = edit.options ?? raw.options;
        const flat = bag && typeof bag === "object" ? (bag as Record<string, unknown>) : {};

        out.push({
            ...flat,
            id: stripPropertiesPrefix(raw.field),
            type: widget,
            label: typeof raw.label === "string" ? raw.label : stripPropertiesPrefix(raw.field),
            ...(edit.required === true && { required: true }),
            // ⚠️ `NonNullable`, not `FieldConfig["computed"]`: under
            // `exactOptionalPropertyTypes`, an optional property does not accept
            // `undefined` as a VALUE, and the field's type includes it.
            ...(typeof raw.computed === "string" && {
                computed: raw.computed as NonNullable<FieldConfig["computed"]>,
            }),
        });
    }
    return out;
}
