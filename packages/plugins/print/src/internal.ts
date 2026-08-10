/*!
 * @geoleaf-plugins/print — Internal helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type * as MaplibreGL from "maplibre-gl";
import { getNativeMap, warnNoCore } from "@geoleaf/host-runtime";

/** Logs a warning when the core is unavailable. Returns true if core is missing. */
export function _warnNoCore(fnName: string): boolean {
    return warnNoCore("Print", fnName);
}

/**
 * Returns the raw MapLibre map instance via GeoLeaf.Core, or null if unavailable.
 * Use for getStyle(), getBounds(), getZoom(), getCenter(), etc. Single seam where
 * the untyped runtime map is narrowed to the MapLibre `Map` type.
 */
export function _getNativeMap(): MaplibreGL.Map | null {
    return getNativeMap<MaplibreGL.Map>();
}

/**
 * Validates a URL — only http: and https: schemes are accepted.
 * Rejects javascript:, data:, and other dangerous schemes.
 */
export function _validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
