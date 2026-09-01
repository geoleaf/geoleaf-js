/*!
 * @geoleaf-plugins/editor — Internal shared helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf, getNativeMap } from "@geoleaf/host-runtime";
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
 * Suppresses (on=true) or restores (on=false) core layer popups and tooltips
 * while an editor tool is armed. Mirrors plugin-measure's `__geoleafExclusiveMode`
 * flag, which core `popup-tooltip.ts` checks before opening a click popup, a hover
 * tooltip, or changing the cursor. No-op if the native map is unavailable.
 */
export function _setExclusiveMode(on: boolean): void {
    const map = _getNativeMap();
    if (map) map.__geoleafExclusiveMode = on;
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
    updateLayerData(id: string, data: unknown): void;
}

/**
 * Returns the core map adapter facade (`GeoLeaf.Core.getMap()`), or null.
 * Exposes `setLayerFilter` / `updateLayerData` used by host reconciliation.
 */
export function _getMapFacade(): EditorMapFacade | null {
    const facade = getGeoLeaf()?.Core?.getMap?.() as EditorMapFacade | undefined;
    return facade ?? null;
}
