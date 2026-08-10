/*!
 * @geoleaf-plugins/measure — Distance tool
 * © 2026 Mattieu Pottier — MIT License
 *
 * Wires MapLibre map events to the measure engine for polyline distance measurement.
 * Finish: double-click OR Space key. Measurements are cumulative (prior ones stay visible).
 * https://geoleaf.dev
 */
import {
    startSession,
    addVertex,
    updateEnginePreview,
    finishSession,
    cancelSession,
    getSession,
} from "../measure-engine.js";
import { isLastVertex } from "../compute.js";
import { setCursor } from "../draw-layers.js";
import { containerCoord, startCursorGuard, type CursorGuard } from "./tool-shared.js";
import type { MeasureMap, MeasureMapMouseEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _map: MeasureMap | null = null;
let _active = false;
let _canvas: HTMLCanvasElement | null = null;
let _container: HTMLElement | null = null;
let _cursorGuard: CursorGuard | null = null;

// Prevents the two "click" events fired before "dblclick" from adding extra vertices.
// Set to true for a brief window after a finish is triggered.
let _justFinished = false;

// ---------------------------------------------------------------------------
// Cursor guard
// ---------------------------------------------------------------------------

function _startCursorGuard(map: MeasureMap): void {
    _canvas = map.getCanvas();
    _container = map.getContainer();
    _cursorGuard = startCursorGuard(_canvas, {
        isActive: () => _active,
        cursor: () => "crosshair",
    });
}

function _stopCursorGuard(): void {
    _cursorGuard?.stop();
    _cursorGuard = null;
    _container = null;
}

// ---------------------------------------------------------------------------
// Event handlers — DOM capture (production: blocks feature layer interactions)
// Attached to map.getContainer() so they fire before ANY MapLibre / GeoLeaf handler.
// ---------------------------------------------------------------------------

function _containerCoord(e: MouseEvent): [number, number] {
    const map = _map;
    if (!map) return [0, 0]; // unreachable while active — the map is set on activate
    return containerCoord(map, e);
}

function _onContainerClick(e: MouseEvent): void {
    if (!_active || _justFinished) return;
    if (e.target !== _canvas) return;
    e.stopImmediatePropagation();
    const coord = _containerCoord(e);
    if (isLastVertex(getSession()?.vertices, coord)) return;
    addVertex(coord);
}

function _onContainerDblClick(e: MouseEvent): void {
    if (!_active) return;
    if (e.target !== _canvas) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if ((getSession()?.vertices.length ?? 0) >= 2) {
        _triggerFinish();
    }
}

// ---------------------------------------------------------------------------
// Event handlers — MapLibre events (used by unit tests via map._fireEvent)
// ---------------------------------------------------------------------------

function _onClick(e: MeasureMapMouseEvent): void {
    if (!_active || _justFinished) return;
    const coord = e.lngLat.toArray();
    if (isLastVertex(getSession()?.vertices, coord)) return;
    addVertex(coord);
}

function _onMouseMove(e: MeasureMapMouseEvent): void {
    if (!_active) return;
    if (getSession()?.vertices.length ?? 0 > 0) {
        updateEnginePreview(e.lngLat.toArray());
    }
}

function _onDblClick(e: MeasureMapMouseEvent): void {
    if (!_active) return;
    e.preventDefault?.();
    if ((getSession()?.vertices.length ?? 0) >= 2) {
        _triggerFinish();
    }
}

function _onKeyDown(e: KeyboardEvent): void {
    if (!_active) return;
    if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if ((getSession()?.vertices.length ?? 0) >= 2) {
            _triggerFinish();
        }
    }
}

function _triggerFinish(): void {
    _justFinished = true;
    finishSession();
    // After finishing, stay active so the user can start a new measurement immediately.
    // Reset the "just finished" guard after the click+dblclick sequence resolves (~50 ms).
    setTimeout(() => {
        _justFinished = false;
        if (_active) {
            startSession("line");
            setCursor("crosshair");
        }
    }, 50);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Arms the distance tool: starts a new session and listens for map events.
 * Safe to call if already active (no-op).
 */
export function activateDistance(map: MeasureMap): void {
    if (_active) return;
    _map = map;
    _active = true;
    _justFinished = false;
    map.__geoleafExclusiveMode = true;

    startSession("line");
    setCursor("crosshair");

    // Guard cursor against external changes (layer hover/leave handlers).
    _startCursorGuard(map);

    // DOM capture on container: fires before any MapLibre or GeoLeaf feature handler.
    _container!.addEventListener("click", _onContainerClick, true);
    _container!.addEventListener("dblclick", _onContainerDblClick, true);

    map.doubleClickZoom?.disable?.();
    map.on("click", _onClick);
    map.on("mousemove", _onMouseMove);
    map.on("dblclick", _onDblClick);
    document.addEventListener("keydown", _onKeyDown);
}

/**
 * Disarms the distance tool: removes event listeners, cancels any open session,
 * and restores the default cursor.
 */
export function deactivateDistance(): void {
    if (!_active) return;
    _active = false;
    _justFinished = false;

    if (_container) {
        _container.removeEventListener("click", _onContainerClick, true);
        _container.removeEventListener("dblclick", _onContainerDblClick, true);
    }
    _stopCursorGuard();
    _canvas = null;

    const map = _map;
    if (map) {
        map.__geoleafExclusiveMode = false;
        map.doubleClickZoom?.enable?.();
        map.off("click", _onClick);
        map.off("mousemove", _onMouseMove);
        map.off("dblclick", _onDblClick);
    }
    document.removeEventListener("keydown", _onKeyDown);

    // Cancel open session (shows finished features but discards in-progress vertices)
    if (getSession()) cancelSession();
    setCursor("grab");
    _map = null;
}
