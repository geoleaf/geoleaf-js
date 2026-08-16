/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — runtime control.
 *
 * Displays the cursor coordinates (lat/lng) in real time. Relocated verbatim from
 * `modules/built-in/ui/coordinates-display.ts` (in-core capability reclassification);
 * the former internal `ui.showCoordinates` gate is removed — the capability gate
 * (`modules.coordinates.enabled`) and the lifecycle decide whether `init()` runs.
 *
 * Docks onto the scale control's wrapper (`.gl-scale-main-wrapper`) when present,
 * falling back to a standalone control otherwise.
 */

import { Log } from "../../utils/log/index.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
// NB: `Helpers` comes from utils/general/helpers-namespace.js — a different file from
// utils/general/dom-helpers.js above, which provides `domCreate`. It carries the rAF
// wrappers (`requestFrame`/`cancelFrame`), which fall back to `setTimeout` when the
// environment has no `requestAnimationFrame`.
import { Helpers } from "../../utils/general/helpers-namespace.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import { DEFAULT_COORDINATES_DECIMALS } from "./constants.js";
import type {
    CoordinatesControl,
    CoordinatesMapLike,
    CoordinatesOptions,
    MapMouseEvent,
} from "./types.js";

const CONTEXT = "[GeoLeaf.Coordinates]";
const DEFAULT_COORDS_TEXT = "Lat: --, Lng: --";
/** Fallback delay (ms) after which the standalone control is created if the scale wrapper never appears. */
const WRAPPER_FALLBACK_TIMEOUT_MS = 5000;

const CoordinatesDisplay: CoordinatesControl = {
    _map: null,
    _controlHandle: null,
    _coordsElement: null,
    _boundMouseMoveHandler: null,
    _cleanups: [] as (() => void)[],
    /** Pending animation frame for the coordinate readout, or `null` when idle. */
    _frameHandle: null,
    /** Last position seen this frame — only it is painted. */
    _pendingLatLng: null,
    /** Wrapper watcher + its safety timeout, so `destroy()` can cancel both. */
    _wrapperObserver: null,
    _wrapperTimeout: null,
    _options: {
        position: "bottomleft",
        decimals: DEFAULT_COORDINATES_DECIMALS,
    },

    /**
     * Initializes the coordinates control.
     * @param map - Map adapter instance
     * @param options - Configuration overrides
     */
    init(map: CoordinatesMapLike, options: Partial<CoordinatesOptions> = {}) {
        try {
            if (!map) {
                throw new Error("A map instance is required.");
            }

            this._map = map;
            this._options = { ...this._options, ...options };

            // Store the bound reference of the listener
            this._boundMouseMoveHandler = this._onMouseMove.bind(this);

            // Create the control
            this._createControl();

            Log.info(`${CONTEXT} Capability initialized successfully.`);
        } catch (err) {
            Log.error(`${CONTEXT} Error during initialization:`, (err as Error).message);
        }
    },

    /**
     * Creates the coordinates control.
     * @private
     */
    _createControl() {
        try {
            // Perf: MutationObserver instead of a fixed delay for robustness —
            // wait for .gl-scale-main-wrapper to appear in DOM.
            const scaleWrapper = document.querySelector(".gl-scale-main-wrapper");

            if (scaleWrapper) {
                this._attachToScaleWrapper(scaleWrapper as HTMLElement);
            } else {
                // Wrapper not yet in DOM: observe body until it appears. Both the observer
                // and its timeout are stored so `destroy()` can cancel them — otherwise the
                // timeout fires after teardown, sees `_coordsElement === null` (which
                // `destroy()` just nulled) and RE-CREATES the control on a dead instance.
                const observer = new MutationObserver((_mutations, obs) => {
                    const el = document.querySelector(".gl-scale-main-wrapper");
                    if (el) {
                        obs.disconnect();
                        this._wrapperObserver = null;
                        this._attachToScaleWrapper(el as HTMLElement);
                    }
                });
                this._wrapperObserver = observer;
                observer.observe(document.body || document.documentElement, {
                    childList: true,
                    subtree: true,
                });
                // Safety timeout: fallback to standalone after 5s if wrapper never appears
                this._wrapperTimeout = setTimeout(() => {
                    this._wrapperTimeout = null;
                    observer.disconnect();
                    this._wrapperObserver = null;
                    if (!this._coordsElement) {
                        Log.warn(
                            `${CONTEXT} Scale wrapper not found after 5s, using classic mode.`
                        );
                        this._createStandaloneControl();
                    }
                }, WRAPPER_FALLBACK_TIMEOUT_MS);
            }
        } catch (err) {
            Log.error(`${CONTEXT} Error creating control:`, (err as Error).message);
        }
    },

    /**
     * Attaches coordinates to the existing scale wrapper.
     * @param scaleWrapper - Scale wrapper element
     * @private
     */
    _attachToScaleWrapper(scaleWrapper: HTMLElement) {
        // Add a separator before the coordinates
        domCreate("div", "gl-scale-separator", scaleWrapper);

        // Create the display element for coordinates directly in the wrapper
        this._coordsElement = domCreate("div", "gl-scale-coordinates", scaleWrapper);
        this._coordsElement.textContent = DEFAULT_COORDS_TEXT;

        // Add the mousemove event listener with stored reference
        this._map!.on("mousemove", this._boundMouseMoveHandler!);

        Log.info(`${CONTEXT} Coordinates integrated into scale wrapper.`);
    },

    /**
     * Creates a standalone control as fallback.
     * @private
     */
    _createStandaloneControl() {
        // Build the container element
        const container = domCreate("div", "gl-coordinates-display");

        // Block map event propagation on this control
        this._cleanups = [];
        blockMapPropagation(container, this._cleanups);

        // Create the content element
        this._coordsElement = domCreate("div", "gl-coordinates__content", container);
        this._coordsElement.textContent = DEFAULT_COORDS_TEXT;

        // Listen for mousemove on the map adapter
        this._map!.on("mousemove", this._boundMouseMoveHandler!);

        // Add to map via adapter — returns a handle with remove()
        this._controlHandle = this._map!.addControl(container, this._options.position);
    },

    /**
     * Event handler for mouse movement.
     *
     * Coalesced on an animation frame: MapLibre fires `mousemove` as fast as the pointer
     * reports, but the display can only change once per painted frame — the extra writes
     * are invisible by construction. Only the LAST position of each frame is kept, so the
     * readout stays on the true cursor position (a leading-edge throttle would freeze it
     * on a stale one).
     *
     * @param e - Map event with e.latlng {lat, lng}
     * @private
     */
    _onMouseMove(e: MapMouseEvent) {
        if (!this._coordsElement) return;

        // Read the coordinates NOW: the event object is pooled/reused by the engine and
        // may hold another position by the time the frame runs.
        this._pendingLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (this._frameHandle !== null) return;

        this._frameHandle = Helpers.requestFrame(() => {
            this._frameHandle = null;
            const pending = this._pendingLatLng;
            this._pendingLatLng = null;
            if (!pending || !this._coordsElement) return;
            const lat = pending.lat.toFixed(this._options.decimals);
            const lng = pending.lng.toFixed(this._options.decimals);
            this._coordsElement.textContent = `Lat: ${lat}, Lng: ${lng}`;
        });
    },

    /**
     * Destroys the control and cleans up resources.
     */
    destroy() {
        try {
            // Cancel the wrapper watcher first: its 5s timeout would otherwise fire after
            // teardown and rebuild the control on a destroyed instance.
            if (this._wrapperTimeout !== null) {
                clearTimeout(this._wrapperTimeout);
                this._wrapperTimeout = null;
            }
            this._wrapperObserver?.disconnect();
            this._wrapperObserver = null;

            // Drop any frame still pending, so it cannot write to a removed element.
            if (this._frameHandle !== null) {
                Helpers.cancelFrame(this._frameHandle);
                this._frameHandle = null;
            }
            this._pendingLatLng = null;

            // Remove the event listener with stored reference
            if (this._map && this._boundMouseMoveHandler) {
                this._map.off("mousemove", this._boundMouseMoveHandler);
                this._boundMouseMoveHandler = null;
            }

            // Remove the element from DOM if it exists
            if (this._coordsElement && this._coordsElement.parentNode) {
                this._coordsElement.parentNode.removeChild(this._coordsElement);
                this._coordsElement = null;
            }

            // Run all event listener cleanups
            for (const fn of this._cleanups) fn();
            this._cleanups = [];

            // Remove standalone control from the map
            this._controlHandle?.remove();
            this._controlHandle = null;

            Log.info(`${CONTEXT} Capability destroyed successfully.`);
        } catch (err) {
            Log.error(`${CONTEXT} Error during destruction:`, (err as Error).message);
        }
    },
};

// ── ESM Export ──
export { CoordinatesDisplay };
