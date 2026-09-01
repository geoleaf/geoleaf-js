/*!
 * @geoleaf-plugins/editor — Config resolver
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { EditorConfig, EditorTool } from "./types.js";
import {
    CONFLICT_STRATEGIES,
    DEFAULT_CONFLICT_STRATEGY,
} from "./persistence/conflict-strategies.js";
import type { LayerEditionPermissions } from "@geoleaf/core/contracts/sync.contract.js";
import { coreConfigGet } from "@geoleaf/host-runtime";
import { getGeoLeaf } from "@geoleaf/host-runtime";
// The core's published subpath: the `geometry`/`geometryType` alias has ONE resolution.
import { layerGeometry } from "@geoleaf/core/kernel/config/layer-geometry.js";

const ALL_TOOLS: EditorTool[] = [
    "point",
    "line",
    "polyline",
    "polygon",
    "select",
    "undo",
    "redo",
    "delete",
];

const VALID_PERSIST_MODES = ["online", "offline", "auto"] as const;
// 🛑 The list that VALIDATES was the vocabulary's third copy, and the most
// dangerous of the three: it is the one that DECIDES. A strategy added to the
// type without being added here kept being rejected and reset to the default,
// with a warning bearing no visible link to the cause. It is now the source
// itself, imported.

/** Default values for `editorConfig` (mirrors CDC §1.7). */
export const EDITOR_CONFIG_DEFAULTS: EditorConfig = {
    enabled: true,
    showButton: true,
    // 25/07/2026 — `"top-left"` until then, and it was the only usable anchor of
    // the four, so the collision was inevitable: the pill overlapped the core's
    // toolbar there (`.gl-map-toolbar-wrapper`, same column, z-index 1000 vs
    // 980), leaving the tool buttons visible but unreachable to clicks.
    // ⚠️ Scope: only when the menu opens WITHOUT an anchor — the public API
    // `GeoLeaf.Editor.toggleMenu()`. A click on the toolbar button passes an
    // anchor and `positionEditorMenuNear` already moved the menu aside
    // (verified). All four anchors now work; the default moves right.
    menuPosition: "top-right",
    // Visible by default, as `addpoi`'s export button was; but this flag is
    // DECLARED, hence genuinely changeable.
    showExport: true,
    // Replaces `ui.showAddPoi`. Visible by default, as `addpoi`'s button was;
    // but this flag lives under `modules.editor`, DECLARED in the schema, where
    // `ui.showAddPoi` made the core decide the display of a button only a
    // plugin could serve.
    showAddPoi: true,
    // Absorbed from `modules.addpoi.defaultPosition`, which the CORE read
    // (`init-features.ts`): a plugin config key resolved by the kernel.
    poiAddDefaultPosition: "placement-mode",
    enabledTools: [...ALL_TOOLS],
    snapPx: 12,
    // 5.1-a — absorbed from `addpoi`, where the equivalent knob was UNREACHABLE: it was read
    // per-layer as `layer.snapTolerance`, a key that `profiles/schemas/layer-config.schema.json`
    // does not declare while being `additionalProperties: false`. Writing it failed
    // `validate:profiles`, so all 4 editable point layers ran on the hard-coded 50 m fallback.
    // Moving it to the plugin config makes it settable for the first time.
    poiSnapMeters: 50,
    vertexHandleSize: 8,
    midpointHandleSize: 5,
    minVerticesLineString: 2,
    minVerticesPolygon: 3,
    api: {
        baseUrl: "",
        authHeader: null,
        timeoutMs: 8000,
        // Property key under which the geometry is sent in the "collection" dialect (ANO-079).
        geometryProperty: "geom",
    },
    persistence: {
        mode: "auto",
        conflictResolution: DEFAULT_CONFLICT_STRATEGY,
        // Backend wire dialect — "rest" envelope by default (ANO-080).
        dialect: "rest",
    },
    undoStackSize: 100,
    modal: {
        desktopBreakpointPx: 768,
        maxWidthPx: 640,
    },
    confirmDelete: true,
    confirmCancelOnDirty: true,
    defaultLayer: null,
    eventNamespace: "editor",
};

/** Validates and resets persistence enum values to their defaults. */
function validatePersistence(
    p: NonNullable<EditorConfig["persistence"]>
): NonNullable<EditorConfig["persistence"]> {
    const out = { ...p };
    if (out.mode !== undefined && !(VALID_PERSIST_MODES as readonly string[]).includes(out.mode)) {
        console.warn(`[editor] Unknown persistence.mode "${out.mode}", reset to "auto".`);
        out.mode = "auto";
    }
    if (
        out.conflictResolution !== undefined &&
        !(CONFLICT_STRATEGIES as readonly string[]).includes(out.conflictResolution)
    ) {
        console.warn(
            `[editor] Unknown persistence.conflictResolution "${out.conflictResolution}", ` +
                `reset to "${DEFAULT_CONFLICT_STRATEGY}". Known strategies: ` +
                `${CONFLICT_STRATEGIES.join(", ")}.`
        );
        out.conflictResolution = DEFAULT_CONFLICT_STRATEGY;
    }
    return out;
}

/** Clamps a number to [min, max]; falls back to `fallback` if the value is NaN. */
function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
    const n = Number(value);
    return Math.min(max, Math.max(min, isNaN(n) ? fallback : n));
}

/**
 * Clamps the flat numeric bounds in place. `clamp` already coerces via `Number()`
 * and falls back on NaN, so `snapPx` / `minVertices*` / `undoStackSize` route
 * through it directly (their `min` absorbs the legacy `0`-fallback behaviour).
 */
function _clampScalarBounds(out: EditorConfig): void {
    if (out.snapPx !== undefined) out.snapPx = clamp(out.snapPx, 0, Infinity, 0);
    if (out.poiSnapMeters !== undefined)
        out.poiSnapMeters = clamp(out.poiSnapMeters, 0, Infinity, 50);
    if (out.vertexHandleSize !== undefined)
        out.vertexHandleSize = clamp(out.vertexHandleSize, 4, 24, 8);
    if (out.midpointHandleSize !== undefined)
        out.midpointHandleSize = clamp(out.midpointHandleSize, 3, 20, 5);
    if (out.minVerticesLineString !== undefined)
        out.minVerticesLineString = clamp(out.minVerticesLineString, 2, Infinity, 2);
    if (out.minVerticesPolygon !== undefined)
        out.minVerticesPolygon = clamp(out.minVerticesPolygon, 3, Infinity, 3);
    if (out.undoStackSize !== undefined)
        out.undoStackSize = clamp(out.undoStackSize, 1, Infinity, 1);
}

/** Clamps the nested `api` / `modal` numeric bounds in place. */
function _clampNestedBounds(out: EditorConfig): void {
    if (out.api?.timeoutMs !== undefined) {
        out.api = { ...out.api, timeoutMs: clamp(out.api.timeoutMs, 100, Infinity, 8000) };
    }
    if (out.modal?.desktopBreakpointPx !== undefined) {
        out.modal = {
            ...out.modal,
            desktopBreakpointPx: clamp(out.modal.desktopBreakpointPx, 1, Infinity, 768),
        };
    }
    if (out.modal?.maxWidthPx !== undefined) {
        out.modal = { ...out.modal, maxWidthPx: clamp(out.modal.maxWidthPx, 1, Infinity, 640) };
    }
}

/** Drops unknown tools; resets to the full set when filtering empties the list. */
function _filterEnabledTools(out: EditorConfig): void {
    if (out.enabledTools === undefined) return;
    const filtered = out.enabledTools.filter((t) => ALL_TOOLS.includes(t));
    out.enabledTools = filtered.length > 0 ? filtered : [...ALL_TOOLS];
}

/** Clamps numeric bounds and resets unknown enum values to their defaults. */
function validateEditorConfig(cfg: EditorConfig): EditorConfig {
    const out: EditorConfig = { ...cfg };
    _clampScalarBounds(out);
    _clampNestedBounds(out);
    _filterEnabledTools(out);
    if (out.persistence) out.persistence = validatePersistence(out.persistence);
    return out;
}

/** Resolves the `showButton (editorConfig) ↔ ui.showEditor (UIConfig)` alias precedence. */
function _resolveShowButton(raw: EditorConfig): boolean | undefined {
    const uiShowEditor = (
        getGeoLeaf()?.Config?.get?.("ui", {}) as { showEditor?: boolean } | undefined
    )?.showEditor;
    return raw.showButton ?? uiShowEditor ?? EDITOR_CONFIG_DEFAULTS.showButton;
}

/**
 * Returns the resolved `editorConfig`: defaults merged with the integrator's profile values.
 * Handles the `showButton ↔ ui.showEditor` alias and clamps all numeric bounds.
 * @public
 */
export function getEditorConfig(): EditorConfig {
    // INV-CONFIG: read from `modules.editor` (Plugin Contract v1).
    //
    // ⚠️ This line promised, until 29/07/2026, that "the core's mirror keeps the
    // key synchronised with the legacy root `editorConfig` during the
    // deprecation window, so unmigrated profiles still resolve". **The window
    // is closed and the mirror is gone** — measured:
    // `grep -rn "editorConfig" packages/core/src/` yields 0. A profile still on
    // `editorConfig` is thus ignored **silently**, exactly like those left on
    // `printConfig` or `measureConfig`.
    //
    // What made this statement costlier than its twins: it did not live in an
    // old spec but **in the code**, at the very place governing the read — and
    // `src/` is in `files[]`, hence in the npm archive. An integrator reading
    // the installed package's source found a false promise there.
    const raw = coreConfigGet<EditorConfig>("modules.editor", {} as EditorConfig);

    // Conditional insertion: this key is set AFTER `...EDITOR_CONFIG_DEFAULTS`,
    // so an explicit `undefined` would OVERWRITE the package default there.
    const showButton = _resolveShowButton(raw);
    const merged: EditorConfig = {
        ...EDITOR_CONFIG_DEFAULTS,
        ...raw,
        ...(showButton !== undefined && { showButton }),
        api: {
            ...EDITOR_CONFIG_DEFAULTS.api,
            ...raw.api,
        },
        persistence: {
            ...EDITOR_CONFIG_DEFAULTS.persistence,
            ...raw.persistence,
        },
        modal: {
            ...EDITOR_CONFIG_DEFAULTS.modal,
            ...raw.modal,
        },
    };

    return validateEditorConfig(merged);
}

// ---------------------------------------------------------------------------
// Editable layers — single reader of the profile's `edition` block
// ---------------------------------------------------------------------------

/** A profile layer, narrowed to the keys the editor reads. */
interface ProfileLayer {
    id: string;
    label?: string;
    /**
     * Per-operation permissions — the core's `LayerEditionPermissions`, imported rather
     * than redeclared. Redeclaring the shape here is what let the old pair drift into two
     * readers of opposite polarity.
     */
    edition?: LayerEditionPermissions;
    /** Profile vocabulary — `"point" | "polyline" | "polygon"` (ANO-007). */
    geometryType?: string;
    /**
     * The SAME field as `geometryType`, under its other spelling — the schema
     * sets both as aliases and forbids migrating (ANO-007). ⚠️ Long absent from
     * this type, so `_acceptsGeometry` could not read it and the typecheck had
     * nothing to say: one of the reasons the defect lived. Read through
     * `layerGeometry`, never by hand.
     */
    geometry?: string;
    /** GeoJSON vocabulary — `"Point" | "LineString" | "Polygon"`. */
    editableGeometryTypes?: string[];
}

/** Profile `geometryType` → GeoJSON geometry name. The two vocabularies differ (ANO-007). */
const _GEOJSON_FOR_PROFILE_TYPE: Record<string, string> = {
    point: "Point",
    polyline: "LineString",
    line: "LineString",
    polygon: "Polygon",
};

/**
 * Decides whether a layer accepts the given GeoJSON geometry.
 *
 * 🛑 **THIS IS WHERE THE CRITERION IS SETTLED, and it RECONCILES rather than
 * discards one.** The repo carried two: this one (`editableGeometryTypes[]`,
 * plural, GeoJSON vocabulary) and `addpoi`'s, copied into
 * `drawing/poi-snap.ts` (`geometryType`, singular, profile vocabulary). They
 * diverged — a layer declaring one and not the other was editable through one
 * path and not the other.
 *
 * ⚠️ **Keeping `editableGeometryTypes` alone WIDENED silently**: its fallback
 * (`?.includes(g) !== false` — absent means `undefined !== false`, hence
 * `true`) accepts ANY geometry. A polygon layer without the key would have
 * become a candidate for point placement, hence for the duplicate guard.
 * Measured: two `poi-snap` tests caught it.
 *
 * The order is thus: the plural key when it exists, **otherwise** the layer's
 * declared type, **only then** accept. A layer with no signal at all stays
 * open — the previous behaviour, and narrowing it would be a contract change.
 */
function _acceptsGeometry(layer: ProfileLayer, geometryType: string): boolean {
    if (Array.isArray(layer.editableGeometryTypes)) {
        return layer.editableGeometryTypes.includes(geometryType);
    }
    // 🛑 THIS LINE READ ONLY `geometryType`, WHICH IS THE FAILURE MODE THE TSDoc
    // ABOVE DESCRIBES AS DANGEROUS. The schema sets `geometryType` as "alias of
    // `geometry`" (ANO-007), but **18 of the repo's 24** configs declare only
    // `geometry` and **none** declares `geometryType` alone. For all of those,
    // `own` was falsy and the function fell back to `return true` — "accept ANY
    // geometry". A polygon layer declaring its geometry thus became a candidate
    // for POINT placement, exactly what the order described above exists to
    // prevent.
    const declared = layerGeometry(layer);
    const own = declared && _GEOJSON_FOR_PROFILE_TYPE[declared];
    return own ? own === geometryType : true;
}

/**
 * Layers the profile marks editable, in profile order.
 *
 * Single source for the two consumers that used to resolve this independently
 * (PLUGINS S4): `selection/layer-picker` derived a `Set` of ids through a raw
 * `globalThis.GeoLeaf.Config` cast, and `modal/layer-dropdown` returned the layer
 * objects through `getGeoLeaf()`. They had also drifted — only the picker carried
 * the `typeof id === "string"` guard, so a profile layer with no `id` reached the
 * dropdown and rendered a selectable `value="undefined"` option. The guard is kept
 * here for both.
 *
 * @param geometryType - When set, also drops layers whose `editableGeometryTypes`
 * excludes it. Omit it to get every editable layer regardless of geometry — this
 * is what the click-picker wants, and narrowing it would silently make layers
 * unclickable.
 */
export function getEditableLayers(geometryType?: string): ProfileLayer[] {
    const profile = getGeoLeaf()?.Config?.getActiveProfile?.() as
        { layers?: ProfileLayer[] } | undefined;
    return (profile?.layers ?? []).filter(
        (l) =>
            // 🛑 `create` OR `update`, NEVER `delete` — the whole point of the
            // per-operation decision. This line read
            // `enableEdition || enableEditionFull`, a patch laid down to not
            // leave the second flag readerless. It had an effect its name did
            // not hint at: the right to DELETE brought a layer into the edit
            // selector. A layer granting only `delete` has no business here —
            // we do not offer to create on a layer where one may only erase.
            (l.edition?.create === true || l.edition?.update === true) &&
            typeof l.id === "string" &&
            (!geometryType || _acceptsGeometry(l, geometryType))
    );
}
