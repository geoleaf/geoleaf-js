/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Geolocation capability — runtime control.
 *
 * Engine-agnostic geolocation control: centers the map on the user's GPS position,
 * draws the user marker + accuracy circle, and exposes a recenter button. Relocated
 * verbatim from `modules/built-in/ui/control-geolocation.ts` (in-core capability
 * reclassification); the former internal `ui.showGeolocation` gate is removed — the
 * capability gate (`modules.geolocation.enabled`) and the lifecycle decide whether
 * `initGeolocationControl()` runs.
 */
import { Log } from "../../utils/log/index.js";
import { Config } from "../../kernel/config/config-primitives.js";
import { DOMSecurity } from "../../kernel/security/index.js";
import { GeoLocationState } from "./state.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import { haversineDistance } from "../../utils/geo/haversine.js";
import type {
    IMapAdapter,
    GeoLeafControl,
    GeoLeafControlPosition,
} from "../../contracts/map-adapter.contract.js";
import type { IGeoLocationState } from "../../contracts/ui-controls.contract.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime — same shape as config.ts). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

// ── Marker / layer IDs ──────────────────────────────────────────────────────
const MARKER_ID = "gl-geoloc-user";
const ACCURACY_LAYER_ID = "gl-geoloc-accuracy";

// ── Tuning constants ─────────────────────────────────────────────────────────
/** Distance (m) the map center must drift from the user before the recenter button shows. */
const RECENTER_VISIBILITY_THRESHOLD_M = 50;
/** Zoom applied when centering on the first GPS fix. */
const INITIAL_FIX_ZOOM = 16;
/** Accuracy (m) at/above which the accuracy circle is not drawn (too coarse to be useful). */
const ACCURACY_CIRCLE_MAX_M = 1000;
/** Duration (ms) of the "position found" toast shown on the first fix. */
const POSITION_FOUND_TOAST_MS = 2500;
/** `watchPosition` timeout (ms) — how long to wait for a fix before erroring. */
const GEO_WATCH_TIMEOUT_MS = 10000;
/** `watchPosition` maximumAge (ms) — 0 forbids a cached position (always fresh). */
const GEO_WATCH_MAX_AGE_MS = 0;

/** User-position marker icon size (px). */
const USER_MARKER_ICON_SIZE_PX = 22;
/** User-position marker anchor (px) — half the size, i.e. the icon's center. */
const USER_MARKER_ICON_ANCHOR_PX = 11;
/** Recenter button icon size (px). */
const RECENTER_ICON_SIZE_PX = 20;
/** Toggle button icon size (px). */
const TOGGLE_ICON_SIZE_PX = 18;

// ── Accuracy circle paint (Google-blue, deliberately not themed) ─────────────
const ACCURACY_CIRCLE_COLOR = "#4285F4";
const ACCURACY_FILL_OPACITY = 0.1;
const ACCURACY_STROKE_OPACITY = 0.3;
const ACCURACY_STROKE_WEIGHT = 1;

// ── Toast renderer (runtime seam) ────────────────────────────────────────────
// The toast renderer lives in `capabilities/toast-renderer`. This control reaches
// it off the global rather than a static import; when the capability is
// disabled/absent, every call is a no-op (graceful degradation).
interface UINotifLike {
    info?(
        message: string,
        options?: number | Record<string, unknown>
    ): HTMLElement | null | undefined;
    success?(message: string, durationOrOptions?: number): HTMLElement | null | undefined;
    error?(message: string): HTMLElement | null | undefined;
    dismiss?(toastEl: HTMLElement): void;
}
function _uiNotif(): UINotifLike | undefined {
    return (globalThis as unknown as { GeoLeaf?: { _UINotifications?: UINotifLike } }).GeoLeaf
        ?._UINotifications;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function _checkRecenterVisibility(map: IMapAdapter, geoState: IGeoLocationState): void {
    if (!geoState.recenterBtn || !GeoLocationState.userPosition) return;
    const mapCenter = map.getCenter();
    const dist = haversineDistance(mapCenter, GeoLocationState.userPosition);
    geoState.recenterBtn.classList.toggle("gl-is-visible", dist > RECENTER_VISIBILITY_THRESHOLD_M);
}

function _stopGeolocation(
    map: IMapAdapter,
    link: HTMLElement,
    geoState: IGeoLocationState,
    onMoveEnd: () => void
): void {
    if (GeoLocationState.watchId !== null) {
        navigator.geolocation.clearWatch(GeoLocationState.watchId);
        GeoLocationState.watchId = null;
    }
    if (geoState.hasMarker) {
        map.removeMarker(MARKER_ID);
        geoState.hasMarker = false;
    }
    if (geoState.hasAccuracyLayer) {
        map.removeLayer(ACCURACY_LAYER_ID);
        geoState.hasAccuracyLayer = false;
    }
    GeoLocationState.active = false;
    GeoLocationState.userPosition = null;
    link.classList.remove("gl-is-active");
    link.classList.remove("gl-is-locating");
    if (geoState.pendingGeolocToast) {
        _uiNotif()?.dismiss?.(geoState.pendingGeolocToast);
        geoState.pendingGeolocToast = null;
    }
    if (geoState.recenterBtn) {
        map.off("moveend", onMoveEnd);
        if (geoState.recenterBtn.parentNode) geoState.recenterBtn.remove();
        geoState.recenterBtn = null;
    }
    map.getContainer().dispatchEvent(
        new CustomEvent("geoleaf:geolocation:statechange", {
            detail: { active: false },
            bubbles: true,
        })
    );
    Log?.info("[Geolocation] Geolocation disabled");
}

function _createRecenterButton(map: IMapAdapter, geoState: IGeoLocationState): void {
    if (geoState.recenterBtn) return;
    const btn = document.createElement("button");
    btn.id = "gl-recenter-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", getLabel("aria.geoloc.recenter"));
    btn.title = getLabel("aria.geoloc.recenter");
    const svg = DOMSecurity.createSVGIcon(
        RECENTER_ICON_SIZE_PX,
        RECENTER_ICON_SIZE_PX,
        "M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z",
        { stroke: "none", fill: "currentColor" }
    );
    btn.appendChild(svg);
    btn.addEventListener("click", () => {
        if (GeoLocationState.userPosition) {
            map.setView(
                { lat: GeoLocationState.userPosition.lat, lng: GeoLocationState.userPosition.lng },
                map.getZoom()
            );
        }
    });
    map.getContainer().appendChild(btn);
    geoState.recenterBtn = btn;
}

function _updateGeoMarkers(
    map: IMapAdapter,
    geoState: IGeoLocationState,
    lat: number,
    lng: number,
    accuracy: number
): void {
    // Remove previous marker / accuracy layer
    if (geoState.hasMarker) map.removeMarker(MARKER_ID);
    if (geoState.hasAccuracyLayer) map.removeLayer(ACCURACY_LAYER_ID);

    // User position marker (DOM-based via adapter)
    // SAFE: icon HTML is static hardcoded string
    map.createMarker(
        MARKER_ID,
        { lat, lng },
        {
            icon: '<div class="gl-user-location-dot gl-user-location-dot--active"></div>',
            iconSize: [USER_MARKER_ICON_SIZE_PX, USER_MARKER_ICON_SIZE_PX] as const,
            iconAnchor: [USER_MARKER_ICON_ANCHOR_PX, USER_MARKER_ICON_ANCHOR_PX] as const,
            className: "gl-user-location-marker gl-user-location-marker--active",
        }
    );
    geoState.hasMarker = true;

    // Accuracy circle (GeoJSON layer with circle-type paint)
    if (accuracy && accuracy < ACCURACY_CIRCLE_MAX_M) {
        const circleGeoJSON = {
            type: "FeatureCollection" as const,
            features: [
                {
                    type: "Feature" as const,
                    geometry: { type: "Point" as const, coordinates: [lng, lat] },
                    properties: { radius: accuracy },
                },
            ],
        };
        const interactiveShapes = _Config.get?.<boolean>("ui.interactiveShapes", false);
        map.addGeoJSONLayer(ACCURACY_LAYER_ID, circleGeoJSON, {
            fillColor: ACCURACY_CIRCLE_COLOR,
            fillOpacity: ACCURACY_FILL_OPACITY,
            color: ACCURACY_CIRCLE_COLOR,
            opacity: ACCURACY_STROKE_OPACITY,
            weight: ACCURACY_STROKE_WEIGHT,
            ...(interactiveShapes !== undefined && { interactive: interactiveShapes }),
            className: "gl-user-location-accuracy",
        });
        geoState.hasAccuracyLayer = true;
    }
}

function _onGeoPositionSuccess(
    position: GeolocationPosition,
    map: IMapAdapter,
    link: HTMLElement,
    geoState: IGeoLocationState,
    onMoveEnd: () => void
): void {
    const { latitude, longitude, accuracy } = position.coords;
    if (!GeoLocationState.active) {
        map.setView({ lat: latitude, lng: longitude }, INITIAL_FIX_ZOOM);
    }
    _updateGeoMarkers(map, geoState, latitude, longitude, accuracy);
    const _isFirstFix = !GeoLocationState.active;
    GeoLocationState.active = true;
    link.classList.remove("gl-is-locating");
    link.classList.add("gl-is-active");
    GeoLocationState.userPosition = {
        lat: latitude,
        lng: longitude,
        accuracy,
        timestamp: Date.now(),
    };
    if (_isFirstFix) {
        if (geoState.pendingGeolocToast) {
            _uiNotif()?.dismiss?.(geoState.pendingGeolocToast);
            geoState.pendingGeolocToast = null;
        }
        _uiNotif()?.success?.(getLabel("toast.geoloc.position_found"), POSITION_FOUND_TOAST_MS);
        map.on("moveend", onMoveEnd);
        map.getContainer().dispatchEvent(
            new CustomEvent("geoleaf:geolocation:statechange", {
                detail: { active: true },
                bubbles: true,
            })
        );
    } else {
        _checkRecenterVisibility(map, geoState);
    }
    Log?.debug("[Geolocation] GPS position updated:", latitude, longitude);
}

function _onGeoPositionError(
    error: GeolocationPositionError,
    map: IMapAdapter,
    link: HTMLElement,
    geoState: IGeoLocationState,
    onMoveEnd: () => void
): void {
    // FULL teardown, not partial. This function only removed the classes, set
    // `active` back to `false` and closed the toast — so it left `watchPosition`
    // running, kept `watchId` set, left the recenter button in the DOM and `moveend`
    // attached. Since `active` went back to `false`, a SECOND click re-entered the
    // "start" branch and OVERWROTE `watchId` without `clearWatch`: a GPS subscription
    // leaked on every error→re-click cycle. And after an error during watch,
    // `moveend` still recentred on a dead position. `_stopGeolocation` already does
    // exactly the right cleanup (pending toast included) — borrowing it beat
    // rewriting half of it.
    _stopGeolocation(map, link, geoState, onMoveEnd);
    let errorMessage = getLabel("toast.geoloc.error.default");
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = getLabel("toast.geoloc.error.permission_denied");
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = getLabel("toast.geoloc.error.position_unavailable");
            break;
        case error.TIMEOUT:
            errorMessage = getLabel("toast.geoloc.error.timeout");
            break;
    }
    if (Log) Log.error("[Geolocation] Geolocation error:", error);
    const _notif = _uiNotif();
    if (_notif && typeof _notif.error === "function") {
        _notif.error(errorMessage);
    } else {
        Log.warn("[Geolocation] " + errorMessage);
    }
}

function _makeToggleGeolocation(
    map: IMapAdapter,
    link: HTMLElement,
    geoState: IGeoLocationState,
    onMoveEnd: () => void
): (e: Event) => void {
    return (e) => {
        e.preventDefault();
        if (GeoLocationState.active) {
            _stopGeolocation(map, link, geoState, onMoveEnd);
            return;
        }
        link.classList.add("gl-is-locating");
        geoState.pendingGeolocToast =
            _uiNotif()?.info?.(getLabel("toast.geoloc.locating"), {
                persistent: true,
                dismissible: false,
            }) ?? null;
        _createRecenterButton(map, geoState);
        GeoLocationState.watchId = navigator.geolocation.watchPosition(
            (pos) => _onGeoPositionSuccess(pos, map, link, geoState, onMoveEnd),
            (err) => _onGeoPositionError(err, map, link, geoState, onMoveEnd),
            {
                enableHighAccuracy: true,
                timeout: GEO_WATCH_TIMEOUT_MS,
                maximumAge: GEO_WATCH_MAX_AGE_MS,
            }
        );
    };
}

/**
 * Builds the geolocation control DOM and wires event listeners.
 *
 * @returns The control container element plus a destroy() teardown function.
 */
function _buildGeolocationControl(
    map: IMapAdapter,
    geoState: IGeoLocationState,
    onMoveEnd: () => void
): { container: HTMLElement; link: HTMLAnchorElement; destroy: () => void } {
    const cleanups: (() => void)[] = [];

    const container = domCreate("div", "geoleaf-ctrl-geolocation geoleaf-ctrl-group geoleaf-ctrl");
    const link = domCreate("a", "", container);
    link.href = "#";
    link.title = getLabel("aria.geoloc.toggle");
    link.setAttribute("role", "button");
    link.setAttribute("aria-label", getLabel("aria.geoloc.toggle_label"));

    // SAFE: SVG static hardcode
    const geoSvg = DOMSecurity.createSVGIcon(
        TOGGLE_ICON_SIZE_PX,
        TOGGLE_ICON_SIZE_PX,
        "M12 2 C 6.5 2 2 6.5 2 12 C 2 17.5 6.5 22 12 22 C 17.5 22 22 17.5 22 12 C 22 6.5 17.5 2 12 2 M12 9 C 10.3 9 9 10.3 9 12 C 9 13.7 10.3 15 12 15 C 13.7 15 15 13.7 15 12 C 15 10.3 13.7 9 12 9",
        { stroke: "currentColor", strokeWidth: "2", fill: "none" }
    );
    link.appendChild(geoSvg);

    blockMapPropagation(container, cleanups);

    const toggleGeolocation = _makeToggleGeolocation(map, link, geoState, onMoveEnd);

    const keydownHandler = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") toggleGeolocation(e);
    };

    link.addEventListener("click", toggleGeolocation);
    link.addEventListener("keydown", keydownHandler);

    // Teardown function — removes all listeners and cleans up map layers
    const destroy = () => {
        link.removeEventListener("click", toggleGeolocation);
        link.removeEventListener("keydown", keydownHandler);
        for (const fn of cleanups) fn();
        cleanups.length = 0;
        if (geoState.hasMarker) {
            map.removeMarker(MARKER_ID);
            geoState.hasMarker = false;
        }
        if (geoState.hasAccuracyLayer) {
            map.removeLayer(ACCURACY_LAYER_ID);
            geoState.hasAccuracyLayer = false;
        }
    };

    return { container, link, destroy };
}

/**
 * Geolocation management — centers the map on the user's GPS position.
 * Mounted by the capability lifecycle when `modules.geolocation.enabled` is not false.
 *
 * @param map      - IMapAdapter instance (engine-agnostic).
 * @param position - Control position on the map.
 * @returns A destroy function that removes the control and all listeners,
 *          or undefined if initialisation was skipped.
 */
function initGeolocationControl(map: IMapAdapter, position = "topleft"): (() => void) | undefined {
    if (!map) {
        Log?.warn("[Geolocation] initGeolocationControl: map missing");
        return;
    }
    if (!navigator.geolocation) {
        Log?.warn("[Geolocation] Geolocation is not supported by this browser");
        return;
    }
    const geoState: IGeoLocationState = {
        hasMarker: false,
        hasAccuracyLayer: false,
        pendingGeolocToast: null as HTMLElement | null,
        recenterBtn: null as HTMLButtonElement | null,
    };
    const onMoveEnd = () => _checkRecenterVisibility(map, geoState);

    const { container, link, destroy } = _buildGeolocationControl(map, geoState, onMoveEnd);

    const controlHandle: GeoLeafControl = map.addControl(
        container,
        position as GeoLeafControlPosition
    );

    // Wrap destroy to also remove control from the map
    const fullDestroy = () => {
        _stopGeolocation(map, link, geoState, onMoveEnd);
        destroy();
        controlHandle.remove();
    };

    if (Log) Log.info("[Geolocation] Geolocation control added to map");
    return fullDestroy;
}

export { initGeolocationControl };
