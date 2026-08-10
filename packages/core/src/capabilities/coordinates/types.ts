/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Coordinates capability — local structural types.
 *
 * Relocated from `modules/built-in/ui/coordinates-display.ts` when the cursor
 * coordinates readout was reclassified to an in-core capability
 * (`capabilities/coordinates/`, gate `modules.coordinates.enabled`).
 */
"use strict";

import type { GeoLeafControl, GeoLeafLatLng } from "../../contracts/map-adapter.contract.js";

/** Map adapter event carrying cursor coordinates. */
export interface MapMouseEvent {
    latlng: GeoLeafLatLng;
}

/** Subset of the map adapter consumed by the coordinates display. */
export interface CoordinatesMapLike {
    on(event: string, handler: (e: MapMouseEvent) => void): void;
    off(event: string, handler: (e: MapMouseEvent) => void): void;
    addControl(control: HTMLElement, position: string): GeoLeafControl;
}

/** Coordinates display runtime options. */
export interface CoordinatesOptions {
    position: string;
    decimals: number;
}

/** Coordinates display control instance (members accessed via `this`). */
export interface CoordinatesControl {
    _map: CoordinatesMapLike | null;
    _controlHandle: GeoLeafControl | null;
    _coordsElement: HTMLElement | null;
    _boundMouseMoveHandler: ((e: MapMouseEvent) => void) | null;
    _cleanups: Array<() => void>;
    /** Pending animation frame for the readout — the `mousemove` coalescing handle. */
    _frameHandle: number | null;
    /** Last cursor position seen in the current frame; only it gets painted. */
    _pendingLatLng: GeoLeafLatLng | null;
    /** Watcher for the scale wrapper, cancelled on destroy. */
    _wrapperObserver: MutationObserver | null;
    /** Its 5s safety timeout — cancelled on destroy, else it rebuilds a dead control. */
    _wrapperTimeout: ReturnType<typeof setTimeout> | null;
    _options: CoordinatesOptions;
    init(map: CoordinatesMapLike, options?: Partial<CoordinatesOptions>): void;
    _createControl(): void;
    _attachToScaleWrapper(scaleWrapper: HTMLElement): void;
    _createStandaloneControl(): void;
    _onMouseMove(e: MapMouseEvent): void;
    destroy(): void;
}
