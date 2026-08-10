/*!
 * GeoLeaf Core – Events / EventBus
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Central dispatch helper for GeoLeaf custom DOM events.
 * All events are dispatched on `document` using native CustomEvent (no external lib).
 *
 * Security notes:
 * - Payloads contain primitives only (string, number, boolean). No DOM refs or Leaflet objects.
 * - `plugin:failed` error is truncated to 200 chars to prevent stack trace leakage.
 * - Guard for SSR environments where `document` is undefined.
 */

import { Log } from "../../utils/log/index.js";
import type { GeoLeafEventMap } from "../../contracts/event-bus.contract.js";

// Re-export all contract types so existing importers do not need to change.
export type {
    GeoLeafEventMap,
    GeoLeafPoiClickDetail,
    GeoLeafPoiPanelOpenDetail,
    GeoLeafPoiPanelCloseDetail,
    GeoLeafLayerToggleDetail,
    GeoLeafFilterApplyDetail,
    GeoLeafFilterResetDetail,
    GeoLeafMapMoveDetail,
    GeoLeafMapZoomDetail,
    GeoLeafPluginLoadedDetail,
    GeoLeafPluginLazyLoadedDetail,
    GeoLeafPluginFailedDetail,
    GeoLeafPopupActionDetail,
    IEventBus,
} from "../../contracts/event-bus.contract.js";

// ── Sanitization helper ──────────────────────────────────────────────────────

/**
 * Returns a safe copy of `payload` by stripping properties that are not
 * JSON-serializable (functions, DOM nodes, circular references).
 * @param payload - Raw payload object.
 * @returns Sanitized plain-object copy (may be the original if already safe).
 * @internal
 */
function _sanitizePayload<T>(payload: T): T {
    if (payload === null || payload === undefined) return payload;
    if (typeof payload !== "object") return payload;
    try {
        return JSON.parse(JSON.stringify(payload)) as T;
    } catch (_e) {
        // Fallback: shallow copy, dropping non-serializable values
        const safe: Record<string, unknown> = {};
        for (const key of Object.keys(payload as object)) {
            const value = (payload as Record<string, unknown>)[key];
            if (value !== null && (typeof value === "function" || value instanceof Node)) continue;
            try {
                JSON.stringify(value);
                safe[key] = value;
            } catch (_inner) {
                // skip non-serializable property
            }
        }
        return safe as unknown as T;
    }
}

// ── Dispatch helper ──────────────────────────────────────────────────────────

/**
 * Dispatches a typed GeoLeaf custom event on `document`.
 * Silent in SSR environments where `document` is not available.
 *
 * @param name - Event name (must be a key of `GeoLeafEventMap`).
 * @param detail - Typed payload for the event.
 */
export function dispatchGeoLeafEvent<K extends keyof GeoLeafEventMap>(
    name: K,
    detail: GeoLeafEventMap[K]
): void {
    if (typeof document === "undefined") return;
    try {
        const safeDetail = _sanitizePayload(detail);
        document.dispatchEvent(
            new CustomEvent(name, {
                detail: safeDetail,
                bubbles: false,
            })
        );
    } catch (err) {
        Log?.warn(`[GeoLeaf.Events] Failed to dispatch "${name}":`, err);
    }
}
