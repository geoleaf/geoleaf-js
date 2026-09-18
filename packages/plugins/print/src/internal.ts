/*!
 * @geoleaf-plugins/print — Internal helpers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type * as MaplibreGL from "maplibre-gl";
import type { RequestTransformFunction, ResourceType } from "maplibre-gl";
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
 * The live map's request transform, as a function an off-screen map can be given.
 *
 * 🛑 THE PRINT READ A FIELD MAPLIBRE DOES NOT WRITE. It copied
 * `_requestManager._transformRequest` — 4.7.1, 5.0.0, 6.0.0 and 6.7.0 all name the field
 * `_transformRequestFn` — behind a hand-written cast that kept the compiler from seeing it. The
 * off-screen map was therefore always created without a transform, and the tiles only the
 * connector's bridge authenticates went to print without a token.
 *
 * ⚠️ It DELEGATES rather than copies: the off-screen map asks the live manager at request time,
 * so it follows the transform the live map uses then — the connector re-installs its own when
 * the basemap changes. And the access is typed by MapLibre's own declarations
 * (`Map._requestManager: RequestManager`): a rename there breaks this repository's build when it
 * moves to that version, where the cast let the print go on without a token.
 *
 * @param nativeMap - The live map.
 * @returns The delegating transform, or `undefined` when the map has no request manager.
 */
export function _liveTransformRequest(
    nativeMap: MaplibreGL.Map | null | undefined
): RequestTransformFunction | undefined {
    const manager = nativeMap?._requestManager;
    if (!manager) return undefined;
    return (url, resourceType) => manager.transformRequest(url, resourceType as ResourceType);
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
