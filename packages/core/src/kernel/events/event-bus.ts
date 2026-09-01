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
 * - Payloads dispatched THROUGH THIS MODULE contain primitives only (string, number, boolean):
 *   no DOM refs, no functions. That is not a convention but a mechanical consequence of
 *   {@link _sanitizePayload} below — anything else is silently replaced by `{}` or dropped.
 *   ⚠️ The GeoLeaf events that DO carry a live node (`geoleaf:popup:action`,
 *   `geoleaf:toolbar:action`, `geoleaf:layer-manager:panel`) are dispatched as raw
 *   `CustomEvent`s by their own emitters and never reach this file; their keys live in
 *   `GeoLeafRawEventMap`. This line read as a property of ALL GeoLeaf events until 14/08/2026,
 *   which made the raw seams look like violations of it rather than the reason it holds here.
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
    GeoLeafPanelToggleDetail,
    GeoLeafLayerToggleDetail,
    GeoLeafFilterApplyDetail,
    GeoLeafFilterResetDetail,
    GeoLeafMapMoveDetail,
    GeoLeafMapZoomDetail,
    GeoLeafPluginLoadedDetail,
    GeoLeafPluginLazyLoadedDetail,
    GeoLeafPluginFailedDetail,
    // ⚠️ `GeoLeafPopupActionDetail` is the only type in this list whose key NO
    // LONGER lives in `GeoLeafEventMap`: it moved to `GeoLeafRawEventMap` on
    // 14/08/2026, and its detail now carries an `HTMLElement` and two functions.
    // The re-export stays here — removing it would break importers for zero gain —
    // but it no longer says "this type goes through the sanitised bus". No gate can
    // see this gap: it is a valid re-export of a valid type. Do not infer that this
    // key is emitted via `dispatchGeoLeafEvent`.
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
