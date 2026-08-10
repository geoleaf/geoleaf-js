/*!
 * @geoleaf-plugins/print — Server-side render fallback (client portion only)
 *
 * Activated when:
 *  - The client canvas is tainted (SecurityError / DOMException from toDataURL/toBlob)
 *    because a tile source does not send CORS headers, OR
 *  - printConfig.forceServer === true.
 *
 * The plugin only handles the CLIENT side of this fallback:
 *  - Building the POST payload (map style + bbox + page/compose options)
 *  - Sending the request to printConfig.serverEndpoint
 *  - Handling the binary or { url } response
 *  - Triggering the download via download.ts
 *
 * The actual server-side render (headless MapLibre, etc.) is the INTEGRATOR's
 * responsibility. See the README for a stub endpoint example.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { EmpriseBbox, PageOrientation } from "./types.js";
import type { PrintConfig } from "./config.js";
import { _validateUrl } from "./internal.js";

/** Minimal map surface read by {@link buildServerPayload} (satisfied by MapLibre's `Map`). */
interface PayloadMap {
    getCenter?(): { lng: number; lat: number } | null | undefined;
    getStyle?(): unknown;
    getZoom?(): number | null | undefined;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Page parameters sent to the server. */
export interface ServerPageOpts {
    format: string;
    orientation: PageOrientation;
    dpi: number;
    margins: { top: number; right: number; bottom: number; left: number };
}

/** Compose parameters sent to the server. */
export interface ServerComposeOpts {
    title: string;
    description: string;
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
}

/** Full payload POSTed to printConfig.serverEndpoint. */
export interface ServerFallbackPayload {
    style: unknown;
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
    bbox: EmpriseBbox;
    page: ServerPageOpts;
    compose: ServerComposeOpts;
    outputFormat: string;
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

/**
 * Builds the POST payload from the current map state and print options.
 *
 * @param nativeMap   - Raw MapLibre map instance (via _getNativeMap()).
 * @param bbox        - The computed print extent.
 * @param page        - Paper format / orientation / DPI / margins.
 * @param compose     - Title, description and overlay flags.
 * @param outputFormat - "pdf" or "jpg" (or any registered exporter format).
 */
export function buildServerPayload(
    nativeMap: PayloadMap,
    bbox: EmpriseBbox,
    page: ServerPageOpts,
    compose: ServerComposeOpts,
    outputFormat: string
): ServerFallbackPayload {
    const center = nativeMap?.getCenter?.();
    return {
        style: nativeMap?.getStyle?.() ?? {},
        center: center ? [center.lng, center.lat] : [0, 0],
        zoom: nativeMap?.getZoom?.() ?? 0,
        bearing: 0,
        pitch: 0,
        bbox,
        page,
        compose,
        outputFormat,
    };
}

// ---------------------------------------------------------------------------
// Fallback request
// ---------------------------------------------------------------------------

/**
 * Sends the payload to printConfig.serverEndpoint.
 *
 * Handles two response types:
 *  - Binary (`application/pdf`, `image/*`) → returned directly as a Blob.
 *  - JSON `{ "url": "https://…" }` → fetches the URL and returns its Blob.
 *
 * Returns `null` on any failure (invalid endpoint, network error, bad response).
 * Always logs a clear warning before returning null.
 *
 * @param payload - The POST payload built by buildServerPayload().
 * @param config  - The current printConfig (for serverEndpoint and serverHeaders).
 */
export async function tryServerFallback(
    payload: ServerFallbackPayload,
    config: PrintConfig
): Promise<Blob | null> {
    const endpoint = config.serverEndpoint;
    if (!endpoint) return null;

    if (!_validateUrl(endpoint)) {
        console.warn("[GeoLeaf.Print] serverEndpoint is not a valid http(s) URL:", endpoint);
        return null;
    }

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(config.serverHeaders ?? {}),
            },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        console.warn("[GeoLeaf.Print] Server fallback request failed (network error):", err);
        return null;
    }

    if (!response.ok) {
        console.warn(
            `[GeoLeaf.Print] Server fallback returned HTTP ${response.status} ${response.statusText}.`
        );
        return null;
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Binary response — return as Blob directly.
    // Exclude application/json and application/xml which must be parsed as text.
    const isBinary =
        (contentType.startsWith("application/") &&
            !contentType.includes("json") &&
            !contentType.includes("xml")) ||
        contentType.startsWith("image/");
    if (isBinary) {
        return response.blob();
    }

    // JSON response with a URL — fetch the file from the provided URL.
    let json: unknown;
    try {
        json = await response.json();
    } catch {
        console.warn("[GeoLeaf.Print] Server fallback returned unexpected non-JSON body.");
        return null;
    }

    const fileUrl = (json as { url?: unknown } | null)?.url;
    if (typeof fileUrl === "string" && _validateUrl(fileUrl)) {
        try {
            const fileResp = await fetch(fileUrl);
            if (fileResp.ok) return fileResp.blob();
            console.warn("[GeoLeaf.Print] Server fallback file URL fetch failed:", fileResp.status);
        } catch (err) {
            console.warn("[GeoLeaf.Print] Server fallback file URL fetch error:", err);
        }
        return null;
    }

    console.warn("[GeoLeaf.Print] Server fallback response has no valid binary or url field.");
    return null;
}
