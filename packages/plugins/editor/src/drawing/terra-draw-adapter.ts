/*!
 * @geoleaf-plugins/editor — Terra Draw lifecycle wrapper
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { GeoJSONStoreFeatures, GeoJSONStoreGeometries, TerraDraw } from "terra-draw";
import type { EditorConfig, EditorTool, EditorMap } from "../types.js";
import {
    getModeNameForTool,
    geometryTypeForMode,
    MODE_STATIC,
    MODE_POINT,
    MODE_LINE,
    MODE_POLYLINE,
    MODE_POLYGON,
    MODE_SELECT,
} from "./mode-names.js";
import {
    buildPointStyles,
    buildLineStyles,
    buildPolygonStyles,
    buildSelectStyles,
    watchThemeChanges,
    type ThemeColors,
} from "./styles.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * The four events the Terra Draw adapter reports back on.
 *
 * Implemented by the mutable `adapterCallbacks` singleton in `events.ts`, whose members start
 * as no-ops and are replaced once the bridge is wired.
 */
export interface TerraDrawAdapterCallbacks {
    /**
     * @param action - Terra Draw finish action. "draw" for a genuine drawing
     *   completion (creation); edit gestures in select mode use other values
     *   (dragCoordinate / insertMidpoint / deleteCoordinate / dragFeature / …).
     */
    onFinish(id: string, geometryType: string, action: string): void;
    onChange(ids: string[], changeType: string): void;
    onSelect(id: string): void;
    onDeselect(id: string): void;
}

/**
 * The editor's handle on Terra Draw — arming tools, reading the active one, tearing down.
 *
 * Created lazily: `terra-draw` is pulled in through a dynamic import so it stays out of the
 * eager bundle, which is why the mode-name constants live in a separate, runtime-free module.
 */
export interface TerraDrawAdapterInstance {
    /** Starts Terra Draw event listeners. Must be called after map is ready. */
    start(): void;
    /** Stops Terra Draw (removes event listeners, clears store). */
    stop(): void;
    /** Arms the given drawing mode, or returns to 'static' if tool is null. */
    setMode(tool: EditorTool | null): void;
    /** Returns the currently armed tool, or null if in static mode. */
    getActiveTool(): EditorTool | null;
    /** Returns a snapshot copy of the feature with the given ID, or undefined. */
    getFeature(id: string): GeoJSONStoreFeatures<GeoJSONStoreGeometries> | undefined;
    /** Removes features by ID from the Terra Draw store and map layers. */
    removeFeatures(ids: string[]): void;
    /**
     * Adds a GeoJSON feature to the Terra Draw store and returns its assigned ID.
     * The feature must have a `mode` property matching a registered Terra Draw mode.
     * Returns null if Terra Draw rejects the feature (invalid geometry, unknown mode, etc.).
     */
    addFeature(feature: GeoJSONStoreFeatures): string | null;
    /** Programmatically selects a feature by its Terra Draw ID. */
    selectFeature(id: string): void;
    /** Programmatically deselects a feature. */
    deselectFeature(id: string): void;
    /** Replaces a feature's geometry in-place (used for guard-rail rollbacks). */
    updateFeatureGeometry(id: string, geometry: GeoJSONStoreGeometries): void;
    /** Whether native undo is available. */
    canUndo(): boolean;
    /** Whether native redo is available. */
    canRedo(): boolean;
    /** Undoes the last drawing operation. */
    undo(): void;
    /** Redoes the last undone operation. */
    redo(): void;
    /** Destroys Terra Draw and cleans up all resources. */
    destroy(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bridges Terra Draw store events to the adapter callbacks. */
function _wireDrawEvents(draw: TerraDraw, callbacks: TerraDrawAdapterCallbacks): void {
    draw.on("finish", (id, ctx) => {
        callbacks.onFinish(String(id), geometryTypeForMode(ctx.mode), ctx.action);
    });
    draw.on("change", (ids, type) => {
        callbacks.onChange(ids.map(String), type);
    });
    draw.on("select", (id) => {
        callbacks.onSelect(String(id));
    });
    draw.on("deselect", (id) => {
        callbacks.onDeselect(String(id));
    });
}

/**
 * Returns a theme applier that restyles every enabled mode live. The enabled-tool
 * set is resolved once (the config is immutable for the adapter's lifetime).
 */
function _buildThemeApplier(draw: TerraDraw, cfg: EditorConfig): (c: ThemeColors) => void {
    const tools = new Set<string>(
        cfg.enabledTools ?? ["point", "line", "polyline", "polygon", "select"]
    );
    return (c: ThemeColors): void => {
        try {
            if (tools.has("point"))
                draw.updateModeOptions(MODE_POINT, { styles: buildPointStyles(c) });
            if (tools.has("line"))
                draw.updateModeOptions(MODE_LINE, { styles: buildLineStyles(c) });
            if (tools.has("polyline"))
                draw.updateModeOptions(MODE_POLYLINE, { styles: buildLineStyles(c) });
            if (tools.has("polygon"))
                draw.updateModeOptions(MODE_POLYGON, { styles: buildPolygonStyles(c) });
            if (tools.has("select"))
                draw.updateModeOptions(MODE_SELECT, { styles: buildSelectStyles(c) });
        } catch {
            // ignore if Terra Draw is not yet started
        }
    };
}

/** Sets the map canvas CSS cursor; no-op if the canvas isn't available. */
function _setCanvasCursor(map: EditorMap, cursor: string): void {
    try {
        const canvas = map?.getCanvas?.() as HTMLCanvasElement | null;
        if (canvas) canvas.style.cursor = cursor;
    } catch {
        // ignore if map canvas not available
    }
}

/** Lifecycle + mode-arming surface (owns the active-tool and theme-watch state). */
function _buildLifecycleApi(
    map: EditorMap,
    cfg: EditorConfig,
    draw: TerraDraw
): Pick<TerraDrawAdapterInstance, "start" | "stop" | "setMode" | "getActiveTool" | "destroy"> {
    let _activeTool: EditorTool | null = null;
    let _stopThemeWatch: (() => void) | null = null;
    const applyTheme = _buildThemeApplier(draw, cfg);

    return {
        start(): void {
            draw.start();
            _stopThemeWatch = watchThemeChanges((c) => applyTheme(c));
        },

        stop(): void {
            _stopThemeWatch?.();
            _stopThemeWatch = null;
            draw.stop();
        },

        setMode(tool: EditorTool | null): void {
            _activeTool = tool;
            const modeName = tool ? getModeNameForTool(tool) : null;
            draw.setMode(modeName ?? MODE_STATIC);
            // Crosshair only for drawing tools; "select" uses the default cursor
            // (layer-picker switches to "pointer" when hovering an editable feature).
            _setCanvasCursor(map, tool && tool !== "select" ? "crosshair" : "");
        },

        getActiveTool(): EditorTool | null {
            return _activeTool;
        },

        destroy(): void {
            _stopThemeWatch?.();
            _stopThemeWatch = null;
            try {
                draw.stop();
            } catch {
                /* already stopped */
            }
            _setCanvasCursor(map, "");
        },
    };
}

/** Feature CRUD surface over the Terra Draw store. */
function _buildFeatureApi(
    draw: TerraDraw
): Pick<
    TerraDrawAdapterInstance,
    | "getFeature"
    | "removeFeatures"
    | "addFeature"
    | "selectFeature"
    | "deselectFeature"
    | "updateFeatureGeometry"
> {
    return {
        getFeature(id: string) {
            return draw.getSnapshotFeature(id as unknown as number | string);
        },

        removeFeatures(ids: string[]): void {
            draw.removeFeatures(ids as unknown as (number | string)[]);
        },

        addFeature(feature: GeoJSONStoreFeatures): string | null {
            const results = draw.addFeatures([feature]);
            const result = results[0];
            if (!result) return null;
            // Terra Draw may assign a UUID before validation and then roll back the
            // store entry if validation fails. Guard against returning a stale UUID.
            if ((result as { valid?: boolean }).valid === false) {
                console.warn(
                    "[GeoLeaf.Editor] addFeature: Terra Draw rejected the feature",
                    (result as { reason?: string }).reason ?? "(no reason)",
                    feature
                );
                return null;
            }
            const id = result.id;
            return id != null ? String(id) : null;
        },

        selectFeature(id: string): void {
            draw.selectFeature(id as unknown as number | string, MODE_SELECT);
        },

        deselectFeature(id: string): void {
            draw.deselectFeature(id as unknown as number | string);
        },

        updateFeatureGeometry(id: string, geometry: GeoJSONStoreGeometries): void {
            draw.updateFeatureGeometry(id as unknown as number | string, geometry);
        },
    };
}

/** Native undo/redo surface. */
function _buildHistoryApi(
    draw: TerraDraw
): Pick<TerraDrawAdapterInstance, "canUndo" | "canRedo" | "undo" | "redo"> {
    return {
        canUndo(): boolean {
            return draw.canUndo();
        },
        canRedo(): boolean {
            return draw.canRedo();
        },
        undo(): void {
            draw.undo();
        },
        redo(): void {
            draw.redo();
        },
    };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures a Terra Draw instance bound to the given MapLibre map.
 * Call `start()` on the returned instance after creating to activate event
 * listeners.
 *
 * The drawing engine (`terra-draw` + its MapLibre adapter + the mode classes) is
 * imported dynamically here so it lands in a separate lazy chunk and stays out of
 * the initial editor bundle — the factory is awaited on first tool activation.
 */
export async function createTerraDrawAdapter(
    map: EditorMap,
    cfg: EditorConfig,
    callbacks: TerraDrawAdapterCallbacks
): Promise<TerraDrawAdapterInstance> {
    const [{ TerraDraw }, { TerraDrawMapLibreGLAdapter }, { buildTerraDrawModes }] =
        await Promise.all([
            import("terra-draw"),
            import("terra-draw-maplibre-gl-adapter"),
            import("./modes.js"),
        ]);

    const mapAdapter = new TerraDrawMapLibreGLAdapter({
        map,
        coordinatePrecision: 9,
    });

    const draw = new TerraDraw({
        adapter: mapAdapter,
        modes: buildTerraDrawModes(cfg),
    });

    _wireDrawEvents(draw, callbacks);

    return {
        ..._buildLifecycleApi(map, cfg, draw),
        ..._buildFeatureApi(draw),
        ..._buildHistoryApi(draw),
    };
}
