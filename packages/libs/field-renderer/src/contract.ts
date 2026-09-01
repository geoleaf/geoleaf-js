/*!
 * @geoleaf/field-renderer — Field contracts
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * A single field descriptor handed to a component.
 *
 * ⚠️ This doc said « from the JSON profile `formSchema` » until task 7.2. That key no
 * longer exists: the host projects `attributes.fields[]` entries carrying `edit` into this
 * shape (editor `modal/attributes-to-form.ts`). Nothing changed HERE — this contract was
 * always about what a component receives, never about where the profile keeps it, and that
 * independence is why the migration cost this lib one comment.
 */
export interface FieldConfig {
    /** GeoJSON property key. */
    id: string;
    /** Component type identifier (e.g. "text", "rating"). */
    type: string;
    /** Displayed label in the form and the side panel. */
    label: string;
    required?: boolean;
    /**
     * When set, the field is pre-filled by the bridge from geometry data
     * (via drawing/geo-compute.ts) and rendered read-only in the form.
     */
    computed?: "geometry.length" | "geometry.area" | "geometry.centroid" | "geometry.vertexCount";
    /** Per-type extras (options, min, max, unit, rows, fetchOptions, …). */
    [key: string]: unknown;
}

/** Contextual data passed to every component render call. */
export interface RenderCtx {
    /** Active locale code (e.g. "fr", "en"). */
    lang: string;
    /** When true, form inputs should be disabled / read-only. */
    readOnly?: boolean;
    /**
     * Arms a one-click map capture mode. The coordinates component calls this
     * when the user clicks "Capture from map". Absent in contexts where map
     * interaction is not available (e.g. unit tests, side-panel-only renders).
     */
    onCapturePosition?: (callback: (lat: number, lng: number) => void) => void;
}

/** Hint for an optional map-layer visualisation of this field value. */
export interface MapLayerHint {
    layerId: string;
    property: string;
}

/**
 * Contract every field-renderer component must implement.
 * The module is intentionally self-contained (no terra-draw, no map imports)
 * so it can be consumed by ANY plugin without modification. ⚠️ This line named one target
 * plugin until the 19/08/2026 — a plugin that no longer exists. A self-containment property
 * justified by one destination reads as obsolete the day that destination disappears, while
 * the property itself is exactly what let this module be consumed by its successor instead.
 */
export interface ComponentDefinition<TValue = unknown> {
    /** Unique component identifier — must match `FieldConfig.type`. */
    id: string;
    /** Default value used when the feature has no value for this field. */
    defaults?: TValue;
    // ── `sidepanelRender` REMOVED ────────────────────────────────
    //
    // This member was MANDATORY, and 23 components implemented it. It had
    // **no production caller**: measured at 0 call sites against 2 for
    // `formRender`, at the preflight of 01/08/2026, reconfirmed on 06/08. The
    // catalogue's only entry point, `createFieldRendererBridge`, calls only
    // `formRender`.
    //
    // Attribute reading is done by the core (`feature-info`), which does not
    // know this package — the rule: the core owns READING, `field-renderer`
    // INPUT. Keeping a dead reading surface here, mandatory in the contract
    // and thus copied by every new component, made 23 implementations pay for
    // a role this package no longer has.
    //
    // 🛑 **BREAKING removal on a published lib, and owned as such** (no
    // legacy, no migration — the application has no users, and
    // `field-renderer` had never been published on npm). It is settled BEFORE
    // publication; after, it would have cost a major.
    /** Render the form input(s) for editing. */
    formRender(
        value: TValue,
        fieldConfig: FieldConfig,
        onChange: (v: TValue) => void,
        ctx: RenderCtx
    ): HTMLElement;
    /** Optional map-layer hint (e.g. badge colour for point features). */
    mapRender?(value: TValue, fieldConfig: FieldConfig, ctx: RenderCtx): MapLayerHint;
    /** Optional sync validator — returns an i18n error key or null. */
    validator?(value: TValue, fieldConfig: FieldConfig): string | null;
}
