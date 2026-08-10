/*!
 * @geoleaf-plugins/editor — Public type definitions
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Allowed tool identifiers in the editor sub-menu. */
export type EditorTool =
    | "point"
    | "line"
    | "polyline"
    | "polygon"
    | "select"
    | "undo"
    | "redo"
    | "delete";

/** Initial position preset or pixel coordinates for the floating sub-menu. */
export type MenuPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | { top: number; left: number };

/**
 * Configuration object for `@geoleaf-plugins/editor`.
 * Set under the `editorConfig` key in the integrator's GeoLeaf profile JSON.
 * All fields are optional; unset fields fall back to {@link EDITOR_CONFIG_DEFAULTS}.
 * @public
 */
export interface EditorConfig {
    /** Enable or disable the entire plugin. Default: `true`. */
    enabled?: boolean;
    /** Show the "Edit" button in the pill toolbar. Alias: `ui.showEditor`. Default: `true`. */
    showButton?: boolean;
    /**
     * Show the "export this session" toolbar button. Default: `true`.
     *
     * ⚠️ Sous `modules.editor.*` et non `ui.*`, à dessein : les deux drapeaux équivalents
     * d'`addpoi` (`ui.showPoiExport`, `ui.showPoiSubmit`) n'étaient déclarés dans AUCUN schéma
     * alors que `ui.schema.json` est `additionalProperties: false` — ils étaient donc
     * inatteignables, et leurs boutons ni masquables ni affichables (R19).
     */
    showExport?: boolean;
    /**
     * Show the "add a POI" button in the core's mobile toolbar. Default: `true`.
     *
     * ⚠️ 5.1-f — remplace `ui.showAddPoi`, qui était lu par le CORE (`init-features.ts`) pour
     * décider d'un bouton que seul un PLUGIN pouvait servir. Le drapeau descend ici avec le
     * comportement qu'il gouverne : le core n'a plus à connaître le nom d'un plugin pour
     * savoir s'il doit dessiner un bouton.
     */
    showAddPoi?: boolean;
    /**
     * Where the "add a POI" flow takes its initial position. Default: `"placement-mode"`.
     *
     * `"geolocation"` uses the current GPS fix when one is available, and falls back to
     * placement mode when it is not. Absorbé de `modules.addpoi.defaultPosition` (5.1-f).
     */
    poiAddDefaultPosition?: "placement-mode" | "geolocation";
    /** Initial anchor position of the floating sub-menu. Default: `"top-left"`. */
    menuPosition?: MenuPosition;
    /** Subset of tools to display in the sub-menu. Default: all 8 tools. */
    enabledTools?: EditorTool[];
    /** Snap tolerance radius in pixels for polygon closure on the first vertex. Default: `12`. */
    snapPx?: number;
    /**
     * Duplicate-guard radius in METRES for point capture: tapping within this distance of an
     * existing feature on an editable point layer snaps onto it and reports its identity.
     * `0` disables the guard. Default: `50`.
     *
     * ⚠️ Not to be confused with {@link EditorConfig.snapPx}, which is a Terra Draw drawing
     * comfort measured in screen pixels. This one is a ground distance — see
     * `drawing/poi-snap.ts`.
     */
    poiSnapMeters?: number;
    /** Diameter in pixels of draggable vertex handles. Clamped to [4, 24]. Default: `8`. */
    vertexHandleSize?: number;
    /** Diameter in pixels of midpoint handles. Clamped to [3, 20]. Default: `5`. */
    midpointHandleSize?: number;
    /** Minimum vertex count for a LineString — vertex deletion blocked below. Default: `2`. */
    minVerticesLineString?: number;
    /** Minimum vertex count for a Polygon. Default: `3`. */
    minVerticesPolygon?: number;
    /** REST API settings for online persistence. */
    api?: {
        /** Base URL for `POST /features`, `PUT /features/:id`, `DELETE /features/:id`. Default: `""`. */
        baseUrl?: string;
        /** Optional `Authorization` header value (Bearer token, API key, …). Default: `null`. */
        authHeader?: string | null;
        /** Network timeout in ms before falling back to the offline queue. Default: `8000`. */
        timeoutMs?: number;
        /**
         * Property key under which the geometry is sent in the `"collection"` dialect
         * (e.g. `"geom"` → `POST {baseUrl}/{layerId} { ...properties, geom }`). Default: `"geom"`.
         */
        geometryProperty?: string;
    };
    /** Persistence strategy. */
    persistence?: {
        /**
         * Adapter mode: `"auto"` detects online/offline status, `"online"` always uses REST,
         * `"offline"` always uses the sync queue. Default: `"auto"`.
         */
        mode?: "online" | "offline" | "auto";
        /**
         * Wire dialect of the backend.
         * - `"rest"` (default): `POST/PUT/DELETE {baseUrl}/features?layerId=…` with a `{ feature, layerId }` envelope.
         * - `"collection"`: `POST {baseUrl}/{layerId}` with a flat `{ ...properties, geom: geometry }` body
         *   (OGC API Features / PostgREST-style collection). Create-only for now.
         */
        dialect?: "rest" | "collection";
        /** Conflict resolution when the server returns HTTP 409. Default: `"prompt"`. */
        conflictResolution?: "client-wins" | "server-wins" | "prompt";
    };
    /** Maximum depth of the undo/redo stack per session. Default: `100`. */
    undoStackSize?: number;
    /** Modal and drawer display settings. */
    modal?: {
        /** Screen width threshold (px): ≥ value → centred modal; < value → full-screen drawer. Default: `768`. */
        desktopBreakpointPx?: number;
        /** Maximum width in pixels of the desktop modal. Default: `640`. */
        maxWidthPx?: number;
    };
    /** Show a confirmation dialog before deleting an entity. Default: `true`. */
    confirmDelete?: boolean;
    /** Ask for confirmation if the user closes a modified form without saving. Default: `true`. */
    confirmCancelOnDirty?: boolean;
    /** Pre-selected layer ID in the target-layer dropdown. `null` = first compatible layer. Default: `null`. */
    defaultLayer?: string | null;
    /** Prefix for public DOM events emitted by the plugin (e.g. `"editor:feature:created"`). Default: `"editor"`. */
    eventNamespace?: string;
}

// ---------------------------------------------------------------------------
// MapLibre runtime frontier — structural subset used across the plugin.
// The editor stays MapLibre-agnostic (no value import of maplibre-gl): this
// interface narrows the `unknown` returned by GeoLeaf.Core.getMap().getNativeMap()
// at the single seam (internal._getNativeMap). Also passed to
// TerraDrawMapLibreGLAdapter (generic + unconstrained → accepts this shape).
// ---------------------------------------------------------------------------

/** Screen pixel coordinate carried by editor map pointer events. */
export interface EditorPoint {
    x: number;
    y: number;
}

/** Map pointer event surface consumed by the editor (MapLibre `MapMouseEvent` subset). */
export interface EditorMapMouseEvent {
    point: EditorPoint;
    /**
     * Geographic position of the pointer. Optional because the drawing pipeline only ever
     * reads `point` — it is the placement mode (5.1-a) that needs coordinates.
     */
    lngLat?: { lat: number; lng: number };
}

/** A rendered feature returned by {@link EditorMap.queryRenderedFeatures} (MapLibre subset). */
export interface EditorRenderedFeature {
    id: string | number | undefined;
    geometry: { type: string; coordinates: unknown };
    layer: { id: string };
    properties: Record<string, unknown>;
}

/**
 * Structural subset of the native MapLibre map used across the editor plugin.
 * `__geoleafExclusiveMode` is a custom GeoLeaf flag (not a MapLibre member).
 */
export interface EditorMap {
    getContainer(): HTMLElement;
    getCanvas(): HTMLCanvasElement;
    on(type: string, listener: (e: EditorMapMouseEvent) => void): void;
    off(type: string, listener: (e: EditorMapMouseEvent) => void): void;
    once(type: string, listener: (...args: unknown[]) => void): void;
    queryRenderedFeatures(point: EditorPoint): EditorRenderedFeature[];
    loaded(): boolean;
    /**
     * Pan handler. Optional: the placement mode disables panning while the user aims, and a
     * test double that omits it must degrade rather than throw.
     */
    dragPan?: { enable?(): void; disable?(): void };
    __geoleafExclusiveMode?: boolean;
}
