/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Scale Control
 * Manages the display of graphical scale, numeric scale and zoom level
 *
 * ─── Deliberate re-implementation — do NOT replace with `maplibregl.ScaleControl` ───
 *
 * This control was flagged as duplicating MapLibre's built-in `ScaleControl`
 * (S4 LOW-50 → rapport de dette §6 → R.39). The measurement closed the question the
 * other way: the overlap is one 7-line helper, and the control does four things
 * MapLibre's cannot. Recording the verdict here so the question is not re-opened from
 * the surface resemblance alone — the same reason `utils/controls/focus-trap.ts`
 * carries its own non-fusion note (R.19).
 *
 * What MapLibre's ScaleControl does NOT provide, and this one does:
 *  1. A NUMERIC scale (`1:X`) via `scaleAtZoom()`. MapLibre renders only the graphic bar.
 *  2. An EDITABLE numeric scale — the user types `1:25 000` and the map goes there
 *     (`_switchToEditMode`, `_onScaleInputChange`, `_calculateZoomFromScale`). No
 *     MapLibre equivalent exists.
 *  3. The current zoom level as a readout (`_createZoomLevel`, option `scaleNivel`).
 *  4. A number format deliberately NOT localised (ISO 31-0 ASCII space) because
 *     `_onScaleInputChange` re-parses its own output; see the rationale on
 *     `_formatNumber`. MapLibre exposes only `maxWidth` + `unit`.
 * Conversely this control is metric-only, where MapLibre also offers imperial and
 * nautical units — switching would be a feature change in both directions, not a swap.
 *
 * The genuine duplication is `_getRoundNum` alone (7 lines, the Leaflet 10/5/3/2/1
 * step algorithm), which MapLibre keeps private and therefore cannot be reused.
 * `pointToLatLng` and `haversineDistance` are NOT local re-implementations: the first
 * is a method of the adapter contract, the second a shared utility used by three
 * capabilities.
 */

import { Log } from "../../utils/log/index.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import { haversineDistance } from "../../utils/geo/haversine.js";
import { scaleAtZoom, zoomAtScale } from "../../utils/general/scale-utils.js";
import type {
    GeoLeafControl,
    GeoLeafLatLng,
    GeoLeafPoint,
} from "../../contracts/map-adapter.contract.js";

/** Subset of the map adapter consumed by the scale control. */
interface MapLike {
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
    addControl(control: HTMLElement, position: string): GeoLeafControl;
    getContainer(): HTMLElement;
    getCenter(): GeoLeafLatLng;
    getZoom(): number;
    setView(center: GeoLeafLatLng, zoom: number): void;
    pointToLatLng(point: GeoLeafPoint): GeoLeafLatLng;
}

/** Scale control configuration (subset of `scaleConfig`). */
interface ScaleControlConfig {
    position?: string;
    scaleGraphic?: boolean;
    scaleNumeric?: boolean;
    scaleNivel?: boolean;
    scaleNumericEditable?: boolean;
}

/** Scale control module instance (members accessed via `this`). */
interface ScaleControlModule {
    _map: MapLike | null;
    _config: ScaleControlConfig;
    _container: HTMLElement | null;
    _scaleLineMetric: HTMLElement | null;
    _numericElement: HTMLElement | null;
    _zoomElement: HTMLElement | null;
    _inputElement: HTMLInputElement | null;
    _scalePrefix: HTMLElement | null;
    _mainWrapper: HTMLElement | null;
    _controlHandle: GeoLeafControl | null;
    _cleanups: Array<() => void>;
    _eventHandlers: Record<string, () => void>;
    init(map: MapLike, config?: ScaleControlConfig): void;
    _createMainContainer(): void;
    _addGraphicScaleToContainer(container: HTMLElement): void;
    _updateScaleLine(scaleLine: HTMLElement, maxMeters: number): void;
    _getRoundNum(num: number): number;
    _createCustomScaleBlock(parentContainer: HTMLElement): void;
    _createReadOnlyScale(): void;
    _createEditableScale(): void;
    _createZoomLevel(): void;
    _switchToEditMode(): void;
    _switchToDisplayMode(): void;
    _updateScale(): void;
    _calculateScale(zoom: number, lat?: number): number;
    _formatNumber(num: number): string;
    _onScaleInputChange(): void;
    _calculateZoomFromScale(targetScale: number): number;
    destroy(): void;
}

/**
 * Custom scale control
 */
const ScaleControl: ScaleControlModule = {
    _map: null,
    _config: {},
    _container: null,
    _scaleLineMetric: null,
    _numericElement: null,
    _zoomElement: null,
    _inputElement: null,
    _scalePrefix: null,
    _mainWrapper: null,
    _controlHandle: null,
    _cleanups: [],
    _eventHandlers: {},

    /**
     * Initializes the scale control
     * @param {any} map - Map adapter instance (IMapAdapter)
     * @param {Object} config - Configuration from scaleConfig
     */
    init(map: MapLike, config?: ScaleControlConfig) {
        if (!map) {
            Log.error("[GeoLeaf.ScaleControl] Map not provided");
            return;
        }

        this._map = map;
        this._config = config || {};
        this._cleanups = [];

        // Create a single container for everything
        this._createMainContainer();

        Log.info("[GeoLeaf.ScaleControl] Scale control initialized");
    },

    /**
     * Creates the main container with graphical scale and custom block
     * @private
     */
    _createMainContainer() {
        const position = this._config.position || "bottomleft";

        // Main container — horizontal layout
        this._mainWrapper = domCreate("div", "gl-scale-main-wrapper");

        // 1. Graphical scale
        if (this._config.scaleGraphic !== false) {
            const graphicWrapper = domCreate("div", "gl-scale-graphic-wrapper", this._mainWrapper);
            this._addGraphicScaleToContainer(graphicWrapper);
        }

        // 2. Custom block (numeric scale + zoom) on the same line
        if (this._config.scaleNumeric || this._config.scaleNivel) {
            this._createCustomScaleBlock(this._mainWrapper);
        }

        // Add main container to the map via the adapter
        this._controlHandle = this._map!.addControl(this._mainWrapper, position);
    },

    /**
     * Adds the graphical scale into a container
     * @param {HTMLElement} container - Target container
     * @private
     */
    _addGraphicScaleToContainer(container: HTMLElement) {
        // Create graphical scale manually
        const scaleDiv = domCreate("div", "gl-scale-graphic gl-control", container);

        const scaleLineMetric = domCreate("div", "gl-scale-graphic-line", scaleDiv);
        this._scaleLineMetric = scaleLineMetric;

        // Update function for the graphical scale
        const updateScale = () => {
            const mapHeight = this._map!.getContainer().getBoundingClientRect().height;
            const y = mapHeight / 2;
            const p1 = this._map!.pointToLatLng({ x: 0, y });
            const p2 = this._map!.pointToLatLng({ x: 150, y });
            const maxMeters = haversineDistance(p1, p2);
            this._updateScaleLine(this._scaleLineMetric!, maxMeters);
        };

        this._eventHandlers.graphicScaleUpdate = updateScale;
        this._map!.on("zoomend", updateScale);
        this._map!.on("moveend", updateScale);
        updateScale();

        Log.info("[GeoLeaf.ScaleControl] Graphical scale added");
    },

    /**
     * Updates the graphical scale line
     * @param {HTMLElement} scaleLine - Scale line element
     * @param {number} maxMeters - Maximum distance in meters
     * @private
     */
    _updateScaleLine(scaleLine: HTMLElement, maxMeters: number) {
        const maxKm = maxMeters / 1000;
        let scale, ratio;

        if (maxKm > 1) {
            const maxNiceKm = this._getRoundNum(maxKm);
            ratio = maxNiceKm / maxKm;
            scale = maxNiceKm + " km";
        } else {
            const maxNiceM = this._getRoundNum(maxMeters);
            ratio = maxNiceM / maxMeters;
            scale = maxNiceM + " m";
        }

        scaleLine.style.width = Math.round(150 * ratio) + "px";
        scaleLine.textContent = scale;
    },

    /**
     * Rounds a number to a "clean" value (1, 2, 5, 10, 20, 50, etc.)
     * @param {number} num - Number to round
     * @returns {number} Rounded number
     * @private
     */
    _getRoundNum(num: number) {
        const pow10 = Math.pow(10, (Math.floor(num) + "").length - 1);
        let d = num / pow10;

        d = d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1;

        return pow10 * d;
    },

    /**
     * Creates the custom block (numeric scale + zoom level)
     * @param {HTMLElement} parentContainer - Parent container
     * @private
     */
    _createCustomScaleBlock(parentContainer: HTMLElement) {
        // Create container — horizontal layout
        this._container = domCreate("div", "gl-scale-control", parentContainer);

        // Numeric scale
        if (this._config.scaleNumeric) {
            if (this._config.scaleNumericEditable) {
                this._createEditableScale();
            } else {
                this._createReadOnlyScale();
            }
        }

        // Zoom level
        if (this._config.scaleNivel) {
            this._createZoomLevel();
        }

        // Update events
        const updateHandler = () => this._updateScale();
        this._eventHandlers.numericScaleUpdate = updateHandler;
        this._map!.on("zoomend", updateHandler);
        this._map!.on("moveend", updateHandler);
        this._updateScale(); // Initial update

        Log.info("[GeoLeaf.ScaleControl] Custom block added");
    },

    /**
     * Creates read-only numeric scale
     * @private
     */
    _createReadOnlyScale() {
        this._numericElement = domCreate("div", "gl-scale-numeric", this._container!);
    },

    /**
     * Creates editable numeric scale with input
     * @private
     */
    _createEditableScale() {
        // Create container for editable scale
        const wrapper = domCreate("div", "gl-scale-numeric-editable", this._container!);

        // Create "1:" prefix (always visible)
        this._scalePrefix = domCreate("span", "gl-scale-prefix", wrapper);
        this._scalePrefix.textContent = "1:";

        // Create the initially displayed span (underlined and clickable) - contains only the denominator
        this._numericElement = domCreate("span", "gl-scale-numeric-clickable", wrapper);
        this._numericElement.textContent = "0";

        // Create the input (hidden initially) - contains only the denominator
        this._inputElement = domCreate("input", "gl-scale-numeric-input", wrapper);
        this._inputElement.type = "text";
        this._inputElement.placeholder = "250000";
        this._inputElement.style.display = "none";

        // Prevent map interactions during editing
        blockMapPropagation(wrapper, this._cleanups);

        // Span click: switch to edit mode
        this._numericElement.addEventListener("click", () => {
            this._switchToEditMode();
        });

        // Validate with Enter
        this._inputElement.addEventListener("keypress", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                this._onScaleInputChange();
                this._switchToDisplayMode();
            }
        });

        // Validation on blur
        this._inputElement.addEventListener("blur", () => {
            this._onScaleInputChange();
            this._switchToDisplayMode();
        });
    },

    /**
     * Creates zoom level display
     * @private
     */
    _createZoomLevel() {
        this._zoomElement = domCreate("div", "gl-scale-zoom", this._container!);
    },

    /**
     * Switches to edit mode (shows input)
     * @private
     */
    _switchToEditMode() {
        if (!this._numericElement || !this._inputElement) return;

        // Copy current value into the input
        this._inputElement.value = this._numericElement.textContent!;

        // Hide the span, show the input
        this._numericElement.style.display = "none";
        this._inputElement.style.display = "inline-block";

        // Focus and select text
        this._inputElement.focus();
        this._inputElement.select();
    },

    /**
     * Switches to display mode (shows span)
     * @private
     */
    _switchToDisplayMode() {
        if (!this._numericElement || !this._inputElement) return;

        // Hide the input, show the span
        this._inputElement.style.display = "none";
        this._numericElement.style.display = "inline";
    },

    /**
     * Updates the scale and zoom display
     * @private
     */
    _updateScale() {
        const zoom = this._map!.getZoom();
        const scale = this._calculateScale(zoom);

        // Update numeric scale
        if (this._numericElement) {
            if (this._config.scaleNumericEditable) {
                // Update only the denominator (without '1:')
                if (this._inputElement!.style.display === "none") {
                    this._numericElement.textContent = this._formatNumber(scale);
                }
            } else {
                // Non-editable mode: display "1:" + denominator
                this._numericElement.textContent = `1:${this._formatNumber(scale)}`;
            }
        }

        // Update zoom level
        if (this._zoomElement) {
            this._zoomElement.textContent = `Zoom: ${Number(zoom).toFixed(2)}`;
        }
    },

    /**
     * Calculates approximate scale based on zoom level. Delegates to the kernel's
     * {@link scaleAtZoom} so the Web Mercator forward formula has a single source of truth
     * (the private copy this method held drifted from `scale-utils` before S6).
     * @param {number} zoom - Map zoom level
     * @param {number} [lat] - Optional latitude (uses map center if not provided)
     * @returns {number} Scale (e.g. 250000 for 1:250000)
     * @private
     */
    _calculateScale(zoom: number, lat?: number) {
        // Use provided latitude or map center latitude
        const latitude = lat !== undefined ? lat : this._map!.getCenter().lat;
        return scaleAtZoom(zoom, latitude);
    },

    /**
     * Formats a number with ASCII spaces as thousands separators — `380585` → `"380 585"`.
     *
     * Written as a right-to-left walk rather than the obvious
     * `replace(/\B(?=(\d{3})+(?!\d))/g, " ")`. That regex nests a quantifier inside a
     * lookahead, so `security/detect-unsafe-regex` fires on it and the method carried an
     * `eslint-disable` justified by the input being bounded. The bound was real — callers
     * pass the denominator from `scaleAtZoom`, an integer of at most 9 digits — but it rests
     * on a TYPE that a later edit could widen to `string` without any gate noticing: the
     * disable would stay green and its justification would quietly become false. The loop
     * removes the question instead of documenting it (CAPACITÉS S10.3).
     *
     * Byte-identical to the regex it replaces: verified over 200 008 values plus the
     * boundaries (0, 999, 1000, 10⁶, 591 657 528, 1 234 567 890), 0 divergence.
     *
     * ⚠️ The ASCII space is a SETTLED CHOICE, not a pending localisation — do not "fix" it.
     * Backlog B.26 proposed `Intl.NumberFormat`; it was measured across the six supported
     * languages and CLOSED (CAPACITÉS S12, arbitrage Mattieu). Two reasons, in order:
     *
     *  1. The space is the ISO 31-0 / SI thousands separator: unambiguous everywhere. Four
     *     of the six languages (`de`, `es`, `it`, `pt`) group with `"."`, and `1:250.000`
     *     reads as a DECIMAL when the number is a scale denominator. Localising would trade
     *     a neutral separator for an ambiguous one — on this field, that is a regression.
     *  2. It is load-bearing for input. `_onScaleInputChange` re-parses this very output
     *     with `replace(/\s/g, "")` + `parseInt`. Measured: `en` → `"250,000"` → 250, and
     *     `de`/`es`/`it`/`pt` → `"250.000"` → 250. Five of six languages would silently
     *     apply a 1:250 scale. (`fr` survives only because its ICU separator is U+202F,
     *     which `\s` happens to match.)
     *
     * Localising this field therefore requires deriving the group separator from
     * `formatToParts` AND rewriting the parse in the same move — for a worse readout. The
     * remaining `toLocaleString("fr-FR")` sites of B.26 live in the plugins, out of scope.
     *
     * @param num - The scale denominator (a non-negative integer).
     * @returns The denominator with a space every three digits.
     * @private
     */
    _formatNumber(num: number) {
        const digits = num.toString();
        let out = "";
        for (let i = 0; i < digits.length; i++) {
            // Insert before every digit whose distance to the end is a non-zero multiple of
            // 3 — i.e. at each group boundary, never in leading position.
            const fromEnd = digits.length - i;
            if (i > 0 && fromEnd % 3 === 0) out += " ";
            out += digits[i];
        }
        return out;
    },

    /**
     * Handles manual scale change
     * @private
     */
    _onScaleInputChange() {
        if (!this._inputElement) return;

        const input = this._inputElement.value.trim();
        // Parse only the denominator (number with optional spaces)
        const cleanedInput = input.replace(/\s/g, "");
        const targetScale = Number.parseInt(cleanedInput, 10);

        if (!isNaN(targetScale) && targetScale > 0) {
            const targetZoom = this._calculateZoomFromScale(targetScale);
            // Use setView without options — adapter signature: setView(center, zoom)
            this._map!.setView(this._map!.getCenter(), targetZoom);
            Log.info(
                `[GeoLeaf.ScaleControl] Zoom adjusted to ${targetZoom} for scale 1:${targetScale}`
            );
        } else {
            Log.warn("[GeoLeaf.ScaleControl] Invalid scale format:", input);
            this._updateScale(); // Reset value
        }
    },

    /**
     * Calculates the zoom level to reach a given scale
     * @param {number} targetScale - Target scale (e.g. 250000)
     * @returns {number} Zoom level (may be fractional for precision)
     * @private
     */
    _calculateZoomFromScale(targetScale: number) {
        const lat = this._map!.getCenter().lat;
        // Analytic seed via the kernel's inverse primitive; the loop below refines it and
        // clamps to the control's own [0 ; 22] range.
        let zoom = zoomAtScale(targetScale, lat);

        // Refine zoom by iteration to get the exact scale
        // Use a precise convergence method
        for (let i = 0; i < 20; i++) {
            const currentScale = this._calculateScale(zoom, lat);
            const diff = targetScale - currentScale;

            // Stop if error is less than 1 (essentially identical)
            if (Math.abs(diff) < 1) {
                break;
            }

            // Adjust zoom proportionally to the error
            // The larger the scale, the more we need to zoom out
            const adjustment = Math.log2(targetScale / currentScale);
            zoom -= adjustment * 0.95; // Damping factor to avoid oscillations
        }

        // Round to 4 decimal places for maximum precision
        const preciseZoom = Math.round(zoom * 10000) / 10000;
        return Math.max(0, Math.min(22, preciseZoom));
    },

    /**
     * Destroys the control and cleans up resources
     */
    destroy() {
        // Remove event listeners from the map
        if (this._map && this._eventHandlers) {
            if (this._eventHandlers.graphicScaleUpdate) {
                this._map.off("zoomend", this._eventHandlers.graphicScaleUpdate);
                this._map.off("moveend", this._eventHandlers.graphicScaleUpdate);
            }
            if (this._eventHandlers.numericScaleUpdate) {
                this._map.off("zoomend", this._eventHandlers.numericScaleUpdate);
                this._map.off("moveend", this._eventHandlers.numericScaleUpdate);
            }
        }

        // Remove the control via adapter handle
        this._controlHandle?.remove();

        // Run propagation-blocker cleanups
        if (this._cleanups) {
            for (const fn of this._cleanups) fn();
            this._cleanups = [];
        }

        // Remove main container from the DOM (belt-and-suspenders)
        if (this._mainWrapper && this._mainWrapper.parentNode) {
            this._mainWrapper.parentNode.removeChild(this._mainWrapper);
        }

        // Clean up all references
        this._map = null;
        this._config = null!;
        this._container = null;
        this._scaleLineMetric = null;
        this._numericElement = null;
        this._zoomElement = null;
        this._inputElement = null;
        this._scalePrefix = null;
        this._mainWrapper = null;
        this._controlHandle = null;
        this._eventHandlers = {};

        Log.info("[GeoLeaf.ScaleControl] Control destroyed and resources cleaned up");
    },
};

// Expose the module (removed: migrated to globals.js in B3)

// The former `initScaleControl` (which read `ui.showScale` + `scaleConfig` from the
// global Config) is replaced by ScaleLifecycle, which reads `modules.scale` via
// getScaleConfig() and calls `ScaleControl.init(map, config)` when enabled.

export { ScaleControl };
export type { ScaleControlConfig, MapLike as ScaleMapLike };
