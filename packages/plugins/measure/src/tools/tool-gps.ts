/*!
 * @geoleaf-plugins/measure — GPS measure tool
 * © 2026 Mattieu Pottier — MIT License
 *
 * Delegates geolocation (permission, dot marker, auto-center) to the existing
 * GeoLeaf geolocation control (.geoleaf-ctrl-geolocation a).
 * Collects filtered GPS vertices via a separate watchPosition.
 * A tap on the map adds a manual waypoint.
 * Stopping: Space key, re-click GPS button, or external geoloc deactivation.
 * https://geoleaf.dev
 */
import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { MeasureConfig, MeasureMap, MeasureMapMouseEvent } from "../types.js";
import { getMeasureConfig } from "../config.js";
import { _el, _getLabel } from "../internal.js";
import { segmentLengths, isLastVertex } from "../compute.js";
import {
    startSession,
    addVertex,
    closeAsPolygon,
    finishSession,
    cancelSession,
    getSession,
} from "../measure-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum distance (m) between two automatically accepted GPS vertices. */
const GPS_MIN_DIST_M = 2;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _active = false;
let _map: MeasureMap | null = null;
let _cfg: MeasureConfig | null = null;
let _watchId: number | null = null;
let _onStop: (() => void) | null = null;
let _lastAccepted: { coord: [number, number]; timestamp: number } | null = null;
let _closeModalShown = false;
let _modalEl: HTMLElement | null = null;
/** True if this tool clicked the geoloc button to activate it. */
let _weActivatedGeoloc = false;

// ---------------------------------------------------------------------------
// GeoLeaf geolocation control helpers
// ---------------------------------------------------------------------------

function _getGeolocLink(): HTMLAnchorElement | null {
    return document.querySelector(".geoleaf-ctrl-geolocation a");
}

function _isGeolocActive(): boolean {
    return !!getGeoLeaf()?.UI?._geolocationActive;
}

// ---------------------------------------------------------------------------
// Close-as-polygon modal
// ---------------------------------------------------------------------------

function _showCloseModal(): void {
    const map = _map;
    if (_modalEl || !map) return;
    _closeModalShown = true;

    const overlay = _el("div", "gl-measure-gps-modal-overlay");
    const box = _el("div", "gl-measure-gps-modal");

    const msg = _el("p", "gl-measure-gps-modal-msg");
    msg.textContent = _getLabel("measure.gps.closePrompt");

    const btnYes = _el("button", "gl-measure-gps-modal-btn --primary");
    btnYes.textContent = _getLabel("measure.gps.closeYes");
    btnYes.setAttribute("type", "button");

    const btnNo = _el("button", "gl-measure-gps-modal-btn");
    btnNo.textContent = _getLabel("measure.gps.closeNo");
    btnNo.setAttribute("type", "button");

    box.appendChild(msg);
    box.appendChild(btnYes);
    box.appendChild(btnNo);
    overlay.appendChild(box);
    map.getContainer().appendChild(overlay);
    _modalEl = overlay;

    btnYes.addEventListener(
        "click",
        () => {
            _hideCloseModal();
            closeAsPolygon();
            _triggerStop();
        },
        { once: true }
    );

    btnNo.addEventListener(
        "click",
        () => {
            _hideCloseModal();
            // Allow the modal to re-trigger if the user circles back to the start
            _closeModalShown = false;
        },
        { once: true }
    );
}

function _hideCloseModal(): void {
    _modalEl?.remove();
    _modalEl = null;
}

// ---------------------------------------------------------------------------
// GPS event handlers
// ---------------------------------------------------------------------------

function _onPosition(pos: GeolocationPosition): void {
    if (!_active || !_cfg) return;

    const coord: [number, number] = [pos.coords.longitude, pos.coords.latitude];
    const ts = pos.timestamp;

    // Jump filter: reject implausible speed between last accepted and current position
    if (_lastAccepted) {
        const dist = segmentLengths([_lastAccepted.coord, coord])[0] ?? 0;
        const deltaS = Math.max((ts - _lastAccepted.timestamp) / 1000, 0.001);
        if (dist / deltaS > _cfg.gpsMaxJumpMps) return;
        // Min-distance filter: skip micro-updates
        if (dist < GPS_MIN_DIST_M) return;
    }

    addVertex(coord);
    _lastAccepted = { coord, timestamp: ts };

    // Proximity-to-start detection: prompt to close as polygon
    const session = getSession();
    if (session && session.vertices.length >= 3 && !_closeModalShown) {
        const start = session.vertices[0];
        const distToStart = start ? (segmentLengths([coord, start])[0] ?? Infinity) : Infinity;
        if (distToStart < _cfg.gpsCloseThresholdM) _showCloseModal();
    }
}

function _onError(_err: GeolocationPositionError): void {
    // The GeoLeaf geolocation control already handles error UI.
    // Just stop the measure tool.
    deactivateGps();
}

/**
 * Map click handler: adds a manual waypoint at the tapped position.
 * Allows the user to insert an intermediate point while tracking.
 */
function _onMapClick(e: MeasureMapMouseEvent): void {
    if (!_active || !_cfg) return;
    const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const session = getSession();
    if (isLastVertex(session?.vertices, coord)) return;
    addVertex(coord);
    // Same proximity-to-start detection as GPS positions, for manual testing
    if (session && session.vertices.length >= 3 && !_closeModalShown) {
        const start = session.vertices[0];
        const distToStart = start ? (segmentLengths([coord, start])[0] ?? Infinity) : Infinity;
        if (distToStart < _cfg.gpsCloseThresholdM) _showCloseModal();
    }
}

function _onKeyDown(e: KeyboardEvent): void {
    if (!_active) return;
    if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        _triggerStop();
    }
}

/**
 * Fired when the GeoLeaf geolocation control state changes externally.
 * If geoloc is stopped from outside (user clicked the pill button), also stop GPS measure.
 */
function _onGeolocStateChange(e: Event): void {
    if (!_active) return;
    if ((e as CustomEvent<{ active?: boolean }>).detail?.active === false) {
        // Geoloc was stopped externally — do not try to re-click the button on cleanup
        _weActivatedGeoloc = false;
        _triggerStop();
    }
}

// ---------------------------------------------------------------------------
// Stop logic
// ---------------------------------------------------------------------------

function _triggerStop(): void {
    const cb = _onStop;
    deactivateGps();
    cb?.();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Arms the GPS tool: activates the GeoLeaf geolocation control (if not already
 * active), starts a measure session, and begins collecting GPS vertices.
 * Map taps add manual waypoints. Space key or geoloc deactivation stops the tool.
 * Safe to call if already active (no-op).
 *
 * @param map - MapLibre map instance.
 * @param onStop - Optional callback invoked when the tool stops itself. Used by
 *   public-api.ts to deselect the GPS button in the floating measure menu.
 */
export function activateGps(map: MeasureMap, onStop?: () => void): void {
    if (_active) return;

    _active = true;
    _map = map;
    _cfg = getMeasureConfig();
    _onStop = onStop ?? null;
    _lastAccepted = null;
    _closeModalShown = false;
    _weActivatedGeoloc = false;
    map.__geoleafExclusiveMode = true;

    startSession("line");

    // Activate the GeoLeaf geolocation control if not already on.
    // This triggers permission request, centers the map on first fix,
    // and shows the user location dot — all handled by the existing control.
    if (!_isGeolocActive()) {
        const link = _getGeolocLink();
        if (link) {
            link.click();
            _weActivatedGeoloc = true;
        }
    }

    // Own watchPosition for vertex collection (separate from the control's marker watch).
    if (navigator.geolocation) {
        _watchId = navigator.geolocation.watchPosition(_onPosition, _onError, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 30_000,
        });
    }

    // React if the user stops geolocation from outside (e.g., pill button click)
    map.getContainer().addEventListener("gl:geoloc:statechange", _onGeolocStateChange);

    // Map tap = manual waypoint
    map.on("click", _onMapClick);

    document.addEventListener("keydown", _onKeyDown);
}

/**
 * Disarms the GPS tool: stops position watching, finalises the session,
 * and deactivates the GeoLeaf geolocation control if this tool activated it.
 * Safe to call when not active (no-op).
 */
export function deactivateGps(): void {
    if (!_active) return;
    _active = false;

    _hideCloseModal();

    // Remove all listeners first (before any side effects that might re-trigger)
    const map = _map;
    if (map) {
        map.getContainer().removeEventListener("gl:geoloc:statechange", _onGeolocStateChange);
        map.off("click", _onMapClick);
        map.__geoleafExclusiveMode = false;
    }
    document.removeEventListener("keydown", _onKeyDown);

    if (_watchId !== null) {
        navigator.geolocation?.clearWatch(_watchId);
        _watchId = null;
    }

    // Deactivate the geolocation control only if we were the ones who activated it
    if (_weActivatedGeoloc && _isGeolocActive()) {
        _getGeolocLink()?.click();
    }
    _weActivatedGeoloc = false;

    // Finalise or discard the session
    const session = getSession();
    if (session && session.vertices.length >= 2) {
        finishSession();
    } else if (session) {
        cancelSession();
    }

    _map = null;
    _cfg = null;
    _onStop = null;
    _lastAccepted = null;
    _closeModalShown = false;
}
