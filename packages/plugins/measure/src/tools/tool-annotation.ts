/*!
 * @geoleaf-plugins/measure — Annotation tool (tooltip / multiline note)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Each map click on the canvas creates a new tooltip overlay via annotation-overlays.ts.
 * No measure-engine session is used — features are inserted directly via onCreated callback.
 * https://geoleaf.dev
 */
import { createOverlay } from "../annotation-overlays.js";
import { setCursor } from "../draw-layers.js";
import { containerCoord, startCursorGuard, type CursorGuard } from "./tool-shared.js";
import type { MeasureMap } from "../types.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _map: MeasureMap | null = null;
let _active = false;
let _canvas: HTMLCanvasElement | null = null;
let _container: HTMLElement | null = null;
let _cursorGuard: CursorGuard | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a MouseEvent client position to [lng, lat] via the map. */
function _containerCoord(e: MouseEvent): [number, number] {
    const map = _map;
    if (!map) return [0, 0]; // unreachable while active — the map is set on activate
    return containerCoord(map, e);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function _onContainerClick(e: MouseEvent): void {
    if (!_active) return;
    // Only handle direct canvas clicks — overlay elements handle their own pointer events
    if (e.target !== _canvas) return;
    e.stopImmediatePropagation();
    const lngLat = _containerCoord(e);
    createOverlay(lngLat);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Arms the annotation tooltip tool. */
export function activateAnnotationTooltip(map: MeasureMap): void {
    if (_active) deactivateAnnotation();
    _map = map;
    _active = true;
    _canvas = map.getCanvas();
    _container = map.getContainer();
    map.__geoleafExclusiveMode = true;
    setCursor("crosshair");
    _cursorGuard = startCursorGuard(_canvas, {
        isActive: () => _active,
        cursor: () => "crosshair",
    });
    _container.addEventListener("click", _onContainerClick, true);
}

/** Disarms whichever annotation sub-tool is currently active. */
export function deactivateAnnotation(): void {
    if (!_active) return;
    _active = false;
    _cursorGuard?.stop();
    _cursorGuard = null;
    if (_container) _container.removeEventListener("click", _onContainerClick, true);
    if (_map) {
        _map.__geoleafExclusiveMode = false;
        setCursor("grab");
    }
    _map = null;
    _canvas = null;
    _container = null;
}
