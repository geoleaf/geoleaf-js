/*!
 * @geoleaf-plugins/editor — Internal shared helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import {
    enterExclusiveMode,
    exitExclusiveMode,
    getGeoLeaf,
    getNativeMap,
} from "@geoleaf/host-runtime";
import type { EditorMap } from "./types.js";

/**
 * Returns the raw MapLibre map instance via GeoLeaf.Core, narrowed to the
 * structural {@link EditorMap} surface, or null if unavailable. Single seam
 * where the untyped runtime map (`GeoLeaf.Core.getMap().getNativeMap()`) is
 * cast to `EditorMap`. Use for getContainer(), queryRenderedFeatures(), etc.
 */
export function _getNativeMap(): EditorMap | null {
    return getNativeMap<EditorMap>();
}

/** GeoLeaf BaseLayers module surface used by the editor (basemap re-apply). */
interface EditorBaseLayers {
    refreshBasemap?(): void;
    [key: string]: unknown;
}

/**
 * Returns the GeoLeaf BaseLayers module (namespace-agnostic: BaseLayers or Baselayers).
 * Returns null when not available (older core or module not loaded).
 */
export function _getBaseLayers(): EditorBaseLayers | null {
    const gl = getGeoLeaf();
    return ((gl?.BaseLayers ?? gl?.Baselayers) as EditorBaseLayers | undefined) ?? null;
}

/**
 * Enters (on=true) or exits (on=false) exclusive mode while an editor tool is armed, on the GeoLeaf
 * adapter that drives the map: while it holds, the core opens no feature popup on click and its
 * hover handlers leave the cursor alone. Entered without a cursor — Terra Draw owns it.
 *
 * A no-op when the native map is unavailable, or when the adapter offers no exclusive mode (a core
 * older than 3.17.0): the tool then works without it.
 */
export function _setExclusiveMode(on: boolean): void {
    const map = _getNativeMap();
    if (!map) return;
    if (on) enterExclusiveMode(map);
    else exitExclusiveMode(map);
}

// DOM helpers and i18n resolver live in field-renderer; re-exported here so
// existing editor modules can keep their current import paths unchanged.
export { _el, _getLabel } from "@geoleaf/field-renderer";

/**
 * Shows a toast via `GeoLeaf.UI.notify.{success,error,info,warn}`. No-op when the
 * notification system is unavailable (older core, tests).
 */
export function _notify(kind: "success" | "error" | "info" | "warn", message: string): void {
    const notify = getGeoLeaf()?.UI?.notify as
        Record<string, ((msg: string) => void) | undefined> | undefined;
    notify?.[kind]?.(message);
}

/** Core map adapter facade (`GeoLeaf.Core.getMap()`) surface used by host reconciliation. */
interface EditorMapFacade {
    setLayerFilter(id: string, filter: unknown): void;
}

/**
 * Returns the core map adapter facade (`GeoLeaf.Core.getMap()`), or null.
 * Exposes `setLayerFilter`, the hide filter of host reconciliation.
 */
export function _getMapFacade(): EditorMapFacade | null {
    const facade = getGeoLeaf()?.Core?.getMap?.() as EditorMapFacade | undefined;
    return facade ?? null;
}
