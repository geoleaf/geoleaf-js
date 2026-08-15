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

// 🛑 `showCoordinatePoints: true` ON THE THREE ACCUMULATING MODES IS LOAD-BEARING, NOT DECOR.
//
// Terra Draw seeds a line with the SAME coordinate twice (`createLine` → `[c, c]`) and a
// polygon with four; the second one is the "live" vertex a hover drags. Both are degenerate
// — zero length, zero area — so MapLibre paints NOTHING, and the closing point that would be
// painted is only created on the second click. On a desktop the defect is invisible: a
// `pointermove` immediately moves the live vertex and the rubber band shows where the first
// point landed. A finger emits no `pointermove` between two taps, so on mobile the first tap
// drew strictly nothing and the geometry appeared out of nowhere on the second.
//
// Turning these on is what makes each committed vertex a real painted circle from the first
// tap. The `coordinatePoint*` styles it needs were already written in `styles.ts` and had
// never had any effect — this activates a half-laid wiring rather than adding one.
// Guarded by `e2e/32-editor-vertex.touch.spec.js` (touch project), which was seen red on the
// three modes before this line existed. Not on `point` (already a painted circle) nor on
// `select` (no such option).
function _lineMode(c: ThemeColors): EditorMode {
    return new TerraDrawLineStringMode({
        modeName: MODE_LINE,
        styles: buildLineStyles(c),
        finishOnNthCoordinate: 2,
        showCoordinatePoints: true,
        keyEvents: { finish: "Enter", cancel: "Escape" },
    });
}

function _polylineMode(c: ThemeColors): EditorMode {
    return new TerraDrawLineStringMode({
        modeName: MODE_POLYLINE,
        styles: buildLineStyles(c),
        showCoordinatePoints: true,
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
        showCoordinatePoints: true,
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
