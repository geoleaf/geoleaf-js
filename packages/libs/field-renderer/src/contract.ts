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
 * so it can be ported to plugin-addpoi without modification.
 */
export interface ComponentDefinition<TValue = unknown> {
    /** Unique component identifier — must match `FieldConfig.type`. */
    id: string;
    /** Default value used when the feature has no value for this field. */
    defaults?: TValue;
    // ── `sidepanelRender` RETIRÉ — Sprint 6, S6b / B-145 ─────────────────────────────────
    //
    // Ce membre était OBLIGATOIRE, et 23 composants l'implémentaient. Il n'avait **aucun
    // appelant de production** : mesuré à 0 site d'appel contre 2 pour `formRender`, au
    // pré-vol du Sprint 2 (01/08), reconfirmé au pré-vol 6.0 (06/08). Le seul point d'entrée
    // du catalogue, `createFieldRendererBridge`, n'appelle que `formRender`.
    //
    // La lecture attributaire est faite par le core (`feature-info`), qui ne connaît pas ce
    // paquet — c'est la décision **A4″** : le core possède la LECTURE, `field-renderer` la
    // SAISIE. Garder ici une surface de lecture morte, obligatoire au contrat et donc
    // recopiée par tout composant neuf, faisait payer 23 implémentations à un rôle que ce
    // paquet n'a plus.
    //
    // 🛑 **Retrait CASSANT sur une lib publiée, et assumé comme tel** (A16 : aucun legacy,
    // aucune migration — l'application n'a pas d'utilisateurs, et `field-renderer` n'a jamais
    // été publié sur npm). Il se tranche AVANT la publication (B-141) ; après, il aurait
    // coûté un majeur.
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
