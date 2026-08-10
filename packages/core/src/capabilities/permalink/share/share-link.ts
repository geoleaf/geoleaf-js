/*!
 * GeoLeaf Core — Share / Build link
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Resolves the current shareable URL.
 *
 * The Permalink module keeps `window.location` in sync with the live map state
 * (centre, zoom, visible/hidden layers, filters, theme) via `history.replaceState`
 * on every `moveend`, `geoleaf:geojson:visibility-changed`, `geoleaf:filters:applied`
 * and `geoleaf:theme:applied` event. The current `window.location.href` is therefore
 * the canonical "share this view" URL — no extra state capture is required.
 *
 * @see permalink-sync.startSync
 */

/**
 * Returns the current shareable URL.
 *
 * Picks `window.location.href` when available (always populated by the Permalink
 * sync). Falls back to an empty string in non-browser environments (SSR / tests).
 *
 * @returns Absolute URL string, or `""` if `window` is unavailable.
 */
export function buildShareUrl(): string {
    if (typeof window === "undefined" || !window.location) return "";
    return window.location.href;
}
