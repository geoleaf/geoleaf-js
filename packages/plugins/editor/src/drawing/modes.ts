/*!
 * @geoleaf-plugins/editor — Terra Draw mode registry
 * © 2026 Mattieu Pottier — MIT License
 *
 * Both 'line' and 'polyline' use TerraDrawLineStringMode but with different modeName
 * values, allowing them to coexist in the same TerraDraw instance with separate layers.
 * 'line' uses finishOnNthCoordinate:2 to auto-finish after exactly 2 points.
 * https://geoleaf.dev
 */
import {
    TerraDrawPointMode,
    TerraDrawLineStringMode,
    TerraDrawPolygonMode,
    TerraDrawSelectMode,
} from "terra-draw";
import type { EditorConfig } from "../types.js";
import { buildSnappingConfig } from "./snap.js";
import {
    readThemeColors,
    buildPointStyles,
    buildLineStyles,
    buildPolygonStyles,
    buildSelectStyles,
} from "./styles.js";
import { MODE_POINT, MODE_LINE, MODE_POLYLINE, MODE_POLYGON, MODE_SELECT } from "./mode-names.js";

// Mode-name constants and pure mappers live in the terra-draw-free `mode-names.ts`
// so eager consumers don't pull the drawing engine into the initial bundle.
// Re-exported here for backward compatibility with existing import sites.
export {
    MODE_POINT,
    MODE_LINE,
    MODE_POLYLINE,
    MODE_POLYGON,
    MODE_SELECT,
    getModeNameForTool,
    geometryTypeForMode,
} from "./mode-names.js";

// Instance types of the four modes this registry can build. Written out rather
// than inferred from a never-called factory: the previous anchor existed only to
// feed `ReturnType`, which made a dead-looking function load-bearing for the type.
type EditorMode =
    | InstanceType<typeof TerraDrawPointMode>
    | InstanceType<typeof TerraDrawLineStringMode>
    | InstanceType<typeof TerraDrawPolygonMode>
    | InstanceType<typeof TerraDrawSelectMode>;
type ThemeColors = ReturnType<typeof readThemeColors>;

function _pointMode(c: ThemeColors): EditorMode {
    return new TerraDrawPointMode({ modeName: MODE_POINT, styles: buildPointStyles(c) });
}

function _lineMode(c: ThemeColors): EditorMode {
    return new TerraDrawLineStringMode({
        modeName: MODE_LINE,
        styles: buildLineStyles(c),
        finishOnNthCoordinate: 2,
        keyEvents: { finish: "Enter", cancel: "Escape" },
    });
}

function _polylineMode(c: ThemeColors): EditorMode {
    return new TerraDrawLineStringMode({
        modeName: MODE_POLYLINE,
        styles: buildLineStyles(c),
        keyEvents: { finish: "Enter", cancel: "Escape" },
    });
}

function _polygonMode(
    c: ThemeColors,
    snap: ReturnType<typeof buildSnappingConfig>,
    pxDist: number
): EditorMode {
    return new TerraDrawPolygonMode({
        modeName: MODE_POLYGON,
        styles: buildPolygonStyles(c),
        snapping: snap,
        pointerDistance: pxDist,
        keyEvents: { finish: "Enter", cancel: "Escape" },
    });
}

function _selectMode(c: ThemeColors): EditorMode {
    // Distinct literals per mode (no shared reference — Terra Draw owns the flags).
    const editable = () => ({
        feature: {
            draggable: true,
            coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true },
        },
    });
    return new TerraDrawSelectMode({
        modeName: MODE_SELECT,
        styles: buildSelectStyles(c),
        flags: {
            [MODE_POINT]: { feature: { draggable: true } },
            [MODE_LINE]: editable(),
            [MODE_POLYLINE]: editable(),
            [MODE_POLYGON]: editable(),
        },
    });
}

/**
 * Builds the array of Terra Draw mode instances to pass to `new TerraDraw({ modes })`.
 * Only includes modes that correspond to tools present in `cfg.enabledTools`.
 */
export function buildTerraDrawModes(cfg: EditorConfig): EditorMode[] {
    const c = readThemeColors();
    const tools = new Set<string>(
        cfg.enabledTools ?? ["point", "line", "polyline", "polygon", "select"]
    );
    const snap = buildSnappingConfig();
    const pxDist = cfg.snapPx ?? 12;
    const modes: EditorMode[] = [];

    if (tools.has("point")) modes.push(_pointMode(c));
    if (tools.has("line")) modes.push(_lineMode(c));
    if (tools.has("polyline")) modes.push(_polylineMode(c));
    if (tools.has("polygon")) modes.push(_polygonMode(c, snap, pxDist));
    if (tools.has("select")) modes.push(_selectMode(c));

    return modes;
}
