/*!
 * @geoleaf-plugins/measure — Polygon surface measurement tool
 * © 2026 Mattieu Pottier — MIT License
 *
 * Wires MapLibre map events to the measure engine for polygon surface measurement.
 * Closure: snap on first vertex (snapPx), double-click, or key C.
 * Cumulative: prior measurements stay visible after each finish.
 * https://geoleaf.dev
 */
import {
    startSession,
    addVertex,
    updateEnginePreview,
    closeAsPolygon,
    finishSession,
    cancelSession,
    getSession,
} from "../measure-engine.js";
import { isLastVertex } from "../compute.js";
import { setCursor } from "../draw-layers.js";
import { getMeasureConfig } from "../config.js";
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
let _snapping = false;

// Guards against the two click events fired before dblclick adding extra vertices.
let _justFinished = false;

// ---------------------------------------------------------------------------
// Cursor guard
// ---------------------------------------------------------------------------

function _startCursorGuard(map: MeasureMap): void {
    _canvas = map.getCanvas();
    _container = map.getContainer();
    // Unlike the other tools, the expected cursor is dynamic: it becomes a pointer while
    // the pointer is within snapPx of the first vertex, signalling that a click closes
    // the ring. Hence the resolver — the guard re-reads it on every mutation.
    _cursorGuard = startCursorGuard(_canvas, {
        isActive: () => _active,
        cursor: () => (_snapping ? "pointer" : "crosshair"),
    });
}

function _stopCursorGuard(): void {
    _cursorGuard?.stop();
    _cursorGuard = null;
    _container = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pixel distance between two geographic coordinates on the current map. */
function _pixelDist(a: [number, number], b: [number, number]): number {
    const map = _map;
    if (!map) return 0;
    const pa = map.project({ lng: a[0], lat: a[1] });
    const pb = map.project({ lng: b[0], lat: b[1] });
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/** True if cursor is within snapPx of the first vertex (requires ≥ 3 vertices). */
function _isSnapping(cursor: [number, number]): boolean {
    const verts = getSession()?.vertices;
    if (!verts || verts.length < 3) return false;
    const first = verts[0];
    if (!first) return false;
    const snapPx = getMeasureConfig().snapPx ?? 12;
    return _pixelDist(first, cursor) <= snapPx;
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
    if (_isSnapping(coord)) {
        _triggerClose();
        return;
    }
    if (isLastVertex(getSession()?.vertices, coord)) return;
    addVertex(coord);
}

function _onContainerDblClick(e: MouseEvent): void {
    if (!_active) return;
    if (e.target !== _canvas) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if ((getSession()?.vertices.length ?? 0) >= 3) {
        _triggerClose();
    }
}

// ---------------------------------------------------------------------------
// Event handlers — MapLibre events (used by unit tests via map._fireEvent)
// ---------------------------------------------------------------------------

function _onClick(e: MeasureMapMouseEvent): void {
    if (!_active || _justFinished) return;
    const coord = e.lngLat.toArray();
    if (_isSnapping(coord)) {
        _triggerClose();
        return;
    }
    if (isLastVertex(getSession()?.vertices, coord)) return;
    addVertex(coord);
}

function _onMouseMove(e: MeasureMapMouseEvent): void {
    if (!_active) return;
    const coord = e.lngLat.toArray();
    const verts = getSession()?.vertices;
    _snapping = !!(verts && verts.length >= 3 && _isSnapping(coord));
    if (verts && verts.length > 0) {
        updateEnginePreview(coord);
    }
    setCursor(_snapping ? "pointer" : "crosshair");
}

function _onDblClick(e: MeasureMapMouseEvent): void {
    if (!_active) return;
    e.preventDefault?.();
    if ((getSession()?.vertices.length ?? 0) >= 3) {
        _triggerClose();
    }
}

function _onKeyDown(e: KeyboardEvent): void {
    if (!_active) return;
    if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        if ((getSession()?.vertices.length ?? 0) >= 3) {
            _triggerClose();
        }
    }
}

function _triggerClose(): void {
    _justFinished = true;
    _snapping = false;
    closeAsPolygon();
    finishSession();
    // Stay active so the user can start another polygon immediately.
    // Reset the guard after the dblclick sequence resolves.
    setTimeout(() => {
        _justFinished = false;
        if (_active) {
            startSession("polygon");
            setCursor("crosshair");
        }
    }, 50);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Arms the polygon tool: starts a new session and listens for map events.
 * Safe to call if already active (no-op).
 */
export function activatePolygon(map: MeasureMap): void {
    if (_active) return;
    _map = map;
    _active = true;
    _justFinished = false;
    _snapping = false;
    map.__geoleafExclusiveMode = true;

    startSession("polygon");
    setCursor("crosshair");

    _startCursorGuard(map);

    _container!.addEventListener("click", _onContainerClick, true);
    _container!.addEventListener("dblclick", _onContainerDblClick, true);

    map.doubleClickZoom?.disable?.();
    map.on("click", _onClick);
    map.on("mousemove", _onMouseMove);
    map.on("dblclick", _onDblClick);
    document.addEventListener("keydown", _onKeyDown);
}

/**
 * Disarms the polygon tool: removes event listeners, cancels any open session,
 * and restores the default cursor.
 */
export function deactivatePolygon(): void {
    if (!_active) return;
    _active = false;
    _justFinished = false;
    _snapping = false;

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

    if (getSession()) cancelSession();
    setCursor("grab");
    _map = null;
}
