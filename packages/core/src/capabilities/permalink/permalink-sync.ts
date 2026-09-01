/*!
 * GeoLeaf Core – Permalink / Deep Linking
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Core logic for URL Permalink / Deep Linking (§1.3).
 *
 * Responsibilities:
 *   - `readUrl(config)` — parse the current URL and return a `PermalinkState` (or null).
 *   - `buildUrl(state, config)` — serialize a state object to a URL fragment or query string.
 *   - `applyState(state, map)` — restore map view + layer visibility + active filter from state.
 *   - `startSync(map, config)` — attach map event listeners that write the URL on every move.
 *
 * Security:
 *   - All numeric values are passed through `validateNumber()` / `validateCoordinates()`.
 *   - Layer IDs are validated as non-empty strings, capped at 100 entries.
 *   - Filter text is capped at 200 characters.
 *   - No `innerHTML` usage — no XSS surface.
 *
 * URL formats (§1.3.1, §1.3.4):
 *   Hash (default): `#gl_lat=48.857&gl_lng=2.347&gl_zoom=12`
 *   Query:          `?gl_lat=48.857&gl_lng=2.347&gl_zoom=12`
 *   Compact:        `#gl=<base64(JSON)>`
 *   Auto-compact:   transparent fallback when hash exceeds 200 chars.
 *
 * The apply-side restoration helpers live in `permalink-restore.ts` (source
 * budget split); this file keeps the capture / sync logic.
 *
 * @see permalink-api for the public facade
 * @see permalink-restore for the apply-side restoration helpers
 * @see config-types for PermalinkConfig
 */

import { GeoJSONShared } from "../../kernel/geojson/index.js";
import type { PermalinkConfig } from "../../kernel/config/geoleaf-config/config-types.js";
import { readUrl, buildUrl, MAX_TEXT_LEN } from "./permalink-url.js";
import type { PermalinkState } from "./permalink-url.js";
import { getPermalinkGeoLeaf } from "./types.js";
import { getLog } from "../../utils/general/di-accessors.js";
import type { PermalinkFilterField } from "./types.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";
import { applyPermalinkLayerVisibility } from "./permalink-restore.js";
import { DEFAULT_PERMALINK_FIELDS, FILTER_PANEL_ID } from "./constants.js";

export type { PermalinkState };
export { readUrl, buildUrl };

/** Debounce delay in ms for map move/zoom events. */
const SYNC_DEBOUNCE_MS = 400;

/**
 * Grace period after `geoleaf:app:ready` before concluding `geoleaf:themes:ready` will never
 * fire. The selector mounts ON app:ready and emits in the same burst, so anything beyond a
 * couple of seconds is not lateness — it is absence (unregistered capability, or missing
 * theme containers). Kept well above one macrotask so a slow device never false-positives.
 */
const THEMES_READY_GRACE_MS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: unknown, ...args: Parameters<T>) {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    } as T;
}

/**
 * Capture the current map state (centre, zoom, hidden layers, active filter).
 *
 * @param map - Map adapter instance.
 * @param config - Active permalink configuration.
 * @returns Current serializable state.
 */
function _captureState(map: IMapAdapter, config: PermalinkConfig): PermalinkState {
    const center = map.getCenter();
    const fields = config.fields ?? DEFAULT_PERMALINK_FIELDS;

    const state: PermalinkState = {
        lat: Math.round(center.lat * 1e6) / 1e6,
        lng: Math.round(center.lng * 1e6) / 1e6,
        zoom: Math.round(map.getZoom()),
    };

    _captureVisibilityFields(state, fields);
    _captureFilterState(state, fields);
    _captureThemeField(state, fields);

    return state;
}

/** Captures user-overridden hidden (`layers`) and shown (`shownLayers`) layer ids. */
function _captureVisibilityFields(state: PermalinkState, fields: readonly string[]): void {
    if (fields.includes("layers")) {
        try {
            const hidden: string[] = [];
            GeoJSONShared.state.layers.forEach((layerData, layerId) => {
                // userOverride=true + logicalState=false means the user explicitly hid this layer.
                const meta = layerData._visibility;
                if (meta && meta.userOverride === true && meta.logicalState === false) {
                    hidden.push(layerId);
                }
            });
            if (hidden.length > 0) state.layers = hidden;
        } catch {
            // GeoJSONShared not yet initialised — omit layers field
        }
    }
    if (fields.includes("shownLayers")) {
        try {
            const shown: string[] = [];
            GeoJSONShared.state.layers.forEach((layerData, layerId) => {
                // userOverride=true + logicalState=true means the user explicitly showed this layer.
                const meta = layerData._visibility;
                if (meta && meta.userOverride === true && meta.logicalState === true) {
                    shown.push(layerId);
                }
            });
            if (shown.length > 0) state.shownLayers = shown;
        } catch {
            // GeoJSONShared not yet initialised — omit shownLayers field
        }
    }
}

/**
 * Captures the active filter (text / taxonomy / tag / rating) from the Filter
 * capability's serialisation contract (`GeoLeaf.Filter.getActiveFilter()`) — no DOM
 * scraping, no ghost inputs. Taxonomy values (categories + sub-categories, flat) map
 * to `categories`; `permalink-url` keeps the `gl_*` params on serialise.
 */
function _captureFilterState(state: PermalinkState, fields: readonly string[]): void {
    const active = getPermalinkGeoLeaf()?.Filter?.getActiveFilter?.();
    if (!active?.fields?.length) return;
    for (const f of active.fields) _captureFilterField(state, fields, f);
}

/** Maps one serialised filter field onto the matching permalink state slot. */
function _captureFilterField(
    state: PermalinkState,
    fields: readonly string[],
    f: PermalinkFilterField
): void {
    switch (f.kind) {
        case "text":
            if (f.text && fields.includes("filter")) state.filter = f.text.slice(0, MAX_TEXT_LEN);
            break;
        case "taxonomy":
            if (f.values?.length && fields.includes("categories")) state.categories = [...f.values];
            break;
        case "tag":
            if (f.values?.length && fields.includes("tags")) state.tags = [...f.values];
            break;
        case "range":
            if (typeof f.range?.min === "number" && f.range.min > 0 && fields.includes("rating")) {
                state.rating = f.range.min;
            }
            break;
        default:
            break;
    }
}

/** Captures the currently active theme id from the ThemeSelector. */
function _captureThemeField(state: PermalinkState, fields: readonly string[]): void {
    if (!fields.includes("theme")) return;
    try {
        const themeId = getPermalinkGeoLeaf()?.ThemeSelector?.getCurrentTheme?.();
        if (typeof themeId === "string" && themeId.length > 0) {
            state.theme = themeId;
        }
    } catch {
        // ThemeSelector not available
    }
}

/**
 * Restores the filter (text / taxonomy / tag / rating) via the Filter capability's
 * contract (`GeoLeaf.Filter.applyFilter()`) — no ghost-injection. Maps each `gl_*`
 * value to the matching field via `getConfig()`'s descriptors; taxonomy is a single
 * flat value set (`gl_cats`), aligned with the generic filter engine.
 *
 * **The apply is gated on the panel being mounted.** Since S13, `applyFilter()`
 * reflects the state onto the REAL panel controls (`panel/write.ts`) instead of
 * injecting ghost inputs — so it needs `#gl-filter-panel` to exist. It does not yet
 * when this runs: the caller is deferred to `geoleaf:theme:applied`, and the panel is
 * mounted by `capabilities/filter/lifecycle.ts` on `geoleaf:app:ready`, which
 * `revealApp()` dispatches from a LATER listener of that same `theme:applied`
 * (`app/init-reveal.ts` is registered after `applyState`'s own listener).
 * Applying against a null panel silently dropped the write, and the panel mounted a
 * moment later came up blank while the sources stayed filtered — a deep link like
 * `#gl_filter=montagne` filtered the data but left the search box empty, and the next
 * panel interaction re-read the empty controls and cleared the filter.
 * `app:ready` is dispatched synchronously inside that same `theme:applied` turn, so
 * waiting for it costs no perceptible delay; `FilterLifecycle` registered its own
 * `app:ready` listener at boot, i.e. strictly before this one, so the panel is up.
 */
function _restoreFilterState(state: PermalinkState): void {
    const filter = getPermalinkGeoLeaf()?.Filter;
    if (!filter?.applyFilter || !filter.getConfig) return;
    const descriptors = filter.getConfig()?.fields ?? [];
    const out: PermalinkFilterField[] = [];
    for (const d of descriptors) {
        const field = _mapDescriptorToField(d, state);
        if (field) out.push(field);
    }
    if (!out.length) return;
    const apply = (): void => filter.applyFilter!({ fields: out });
    if (typeof document === "undefined" || document.getElementById(FILTER_PANEL_ID)) {
        apply();
        return;
    }
    document.addEventListener("geoleaf:app:ready", apply, { once: true });
}

/** Maps one filter descriptor to a serialised field from the permalink state (or null). */
function _mapDescriptorToField(
    d: { id: string; kind: string },
    state: PermalinkState
): PermalinkFilterField | null {
    switch (d.kind) {
        case "text":
            return typeof state.filter === "string" && state.filter
                ? { id: d.id, kind: "text", text: state.filter }
                : null;
        case "taxonomy": {
            const values = state.categories ?? [];
            return values.length ? { id: d.id, kind: "taxonomy", values } : null;
        }
        case "tag":
            return state.tags?.length ? { id: d.id, kind: "tag", values: [...state.tags] } : null;
        case "range":
            return typeof state.rating === "number" && state.rating > 0
                ? { id: d.id, kind: "range", range: { min: state.rating } }
                : null;
        default:
            return null;
    }
}

/**
 * Apply a permalink state to the map and UI.
 *
 * Map view is applied immediately (synchronous).
 * If a theme needs to be restored, it is applied once `geoleaf:themes:ready` fires,
 * then layer visibility and filter are applied after the resulting `geoleaf:theme:applied`.
 * Without a theme change, layers and filter are deferred to the first `geoleaf:theme:applied`.
 *
 * @param state - State to restore.
 * @param map - Map adapter instance.
 */
export function applyState(state: PermalinkState, map: IMapAdapter): void {
    // Immediate: restore map view
    map.setView({ lat: state.lat, lng: state.lng }, state.zoom);

    if (typeof document === "undefined") return;

    const hasLayers = !!(state.layers && state.layers.length > 0);
    const hasShownLayers = !!(state.shownLayers && state.shownLayers.length > 0);
    const hasFilter = typeof state.filter === "string";
    const hasCategories = !!state.categories?.length;
    const hasTags = !!state.tags?.length;
    const hasRating = typeof state.rating === "number" && state.rating > 0;
    const hasTheme = typeof state.theme === "string" && state.theme.length > 0;
    const hasDeferred =
        hasLayers ||
        hasShownLayers ||
        hasFilter ||
        hasCategories ||
        hasTags ||
        hasRating ||
        hasTheme;
    if (!hasDeferred) return;

    function _applyLayersAndFilter(): void {
        applyPermalinkLayerVisibility(state, hasLayers, hasShownLayers);
        _restoreFilterState(state);
    }

    if (hasTheme) {
        // Wait for ThemeSelector to finish its initial load, then switch theme if needed.
        // geoleaf:themes:ready fires once, after the default theme:applied.
        //
        // ⚠️ WITH A FALLBACK, because that event has exactly ONE emitter and three conditions:
        // `theme-selector` must be registered, a profile active, and both theme containers
        // present in the page. A page that misses any of them never emits — and without the
        // fallback below, everything deferred here (layer visibility, filter, shown-layers)
        // was silently LOST, not just the theme switch. `geoleaf:app:ready` always fires (the
        // reveal has its own safety timeout), and themes:ready normally follows it in the
        // same mount burst: a grace period after app:ready is therefore a reliable "the
        // emitter is not coming" signal. The theme switch itself is dropped in that case —
        // with no selector mounted there is nothing that can switch — but dropped LOUDLY,
        // and the rest of the deferred state still applies.
        let _handled = false;
        const _onThemesReady = function (): void {
            const themeSelector = getPermalinkGeoLeaf()?.ThemeSelector;
            const currentTheme = themeSelector?.getCurrentTheme?.();
            if (state.theme && currentTheme !== state.theme && themeSelector?.setTheme) {
                // Register layers/filter restore to fire after the next theme:applied
                document.addEventListener("geoleaf:theme:applied", _applyLayersAndFilter, {
                    once: true,
                });
                themeSelector.setTheme(state.theme).catch(() => {
                    // setTheme() failed — theme:applied may never fire; apply directly
                    document.removeEventListener("geoleaf:theme:applied", _applyLayersAndFilter);
                    _applyLayersAndFilter();
                });
            } else {
                // Correct theme already active — layers are loaded, apply immediately
                _applyLayersAndFilter();
            }
        };
        document.addEventListener(
            "geoleaf:themes:ready",
            function (): void {
                if (_handled) return;
                _handled = true;
                _onThemesReady();
            },
            { once: true }
        );
        document.addEventListener(
            "geoleaf:app:ready",
            function (): void {
                setTimeout(function (): void {
                    if (_handled) return;
                    _handled = true;
                    getLog()?.warn?.(
                        "[Permalink] geoleaf:themes:ready never fired — theme restore dropped, " +
                            "applying deferred layers/filter without it."
                    );
                    _applyLayersAndFilter();
                }, THEMES_READY_GRACE_MS);
            },
            { once: true }
        );
    } else {
        // No theme change — defer layers/filter to the first theme:applied
        document.addEventListener("geoleaf:theme:applied", _applyLayersAndFilter, { once: true });
    }
}

/**
 * Start URL synchronisation: listen to map `moveend` and write the URL.
 *
 * Uses `history.replaceState()` only — no browser history entry is created.
 * The write is debounced by {@link SYNC_DEBOUNCE_MS} ms.
 *
 * @param map - Map adapter instance.
 * @param config - Active permalink configuration.
 * @returns A teardown that removes every listener attached by this call (map `moveend`
 *          plus the three `document` listeners), so a re-init or reset never leaks them.
 */
export function startSync(map: IMapAdapter, config: PermalinkConfig): () => void {
    function _doWrite() {
        try {
            const state = _captureState(map, config);
            const fragment = buildUrl(state, config);
            if (!fragment) return;

            const mode = config.mode ?? "hash";
            if (mode === "query") {
                history.replaceState(
                    null,
                    "",
                    window.location.pathname + fragment + window.location.hash
                );
            } else {
                history.replaceState(
                    null,
                    "",
                    window.location.pathname + window.location.search + fragment
                );
            }
        } catch {
            // Silently ignore — history API may be unavailable (e.g. file:// protocol)
        }
    }

    // Map pan/zoom — debounced at 400 ms to avoid excessive writes while dragging.
    const writeOnMove = _debounce(_doWrite, SYNC_DEBOUNCE_MS);
    map.on("moveend", writeOnMove);

    // Document listeners registered below — kept so the teardown removes the exact refs.
    const docListeners: Array<[string, () => void]> = [];
    if (typeof document !== "undefined") {
        // Layer visibility toggled by the user — use a very short debounce (50 ms) so the
        // URL reflects the new state almost immediately and is never cancelled by a concurrent
        // moveend event firing within the 400 ms window.
        const writeOnVisibility = _debounce(_doWrite, 50);
        document.addEventListener("geoleaf:geojson:visibility-changed", writeOnVisibility);
        docListeners.push(["geoleaf:geojson:visibility-changed", writeOnVisibility]);

        // Filter changes and theme switches — short debounce too (they batch quickly).
        const writeOnFilter = _debounce(_doWrite, 50);
        document.addEventListener("geoleaf:filters:applied", writeOnFilter);
        docListeners.push(["geoleaf:filters:applied", writeOnFilter]);

        const writeOnTheme = _debounce(_doWrite, 50);
        document.addEventListener("geoleaf:theme:applied", writeOnTheme);
        docListeners.push(["geoleaf:theme:applied", writeOnTheme]);
    }

    // Teardown — symmetric with the registration above. Returned so the facade can stop
    // syncing on re-init / reset and never leak the map + document listeners.
    return function stopSync(): void {
        map.off("moveend", writeOnMove);
        for (const [event, handler] of docListeners) {
            document.removeEventListener(event, handler);
        }
    };
}
