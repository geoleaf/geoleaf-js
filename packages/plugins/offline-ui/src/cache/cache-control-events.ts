/*!
 * GeoLeaf Storage - Cache Control Events
 * Event binding, accordion toggles, and cleanup for CacheControl.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { events } from "../utils/core-utils.js";
import { LayerSelectorCore } from "./layer-selector/core.js";

import { CACHE_EVENTS } from "./cache-control-types.js";
import type { CacheControlState, CacheProgressDetail } from "./cache-control-types.js";

// ─── Event binding ───────────────────────────────────────────────────

/** Attaches all event listeners (buttons + document-level cache events). */
export function attachEventListeners(self: CacheControlState): void {
    if (self._downloadBtn)
        self._downloadBtn.addEventListener("click", () => {
            self._handleDownload().catch((e: unknown) =>
                Log?.error("[CacheControl] Error handling download:", e)
            );
        });
    if (self._clearBtn)
        self._clearBtn.addEventListener("click", () => {
            self._handleClear().catch((e: unknown) =>
                Log?.error("[CacheControl] Error handling clear:", e)
            );
        });
    if (self._stopBtn) self._stopBtn.addEventListener("click", () => self._handleStop());
    if (self._layersToggleBtn)
        self._layersToggleBtn.addEventListener("click", () => self._handleLayersToggle());
    if (self._statusToggleBtn)
        self._statusToggleBtn.addEventListener("click", () => self._handleStatusToggle());

    if (events) {
        const pushId = (id: number | null) => {
            if (id != null) self._eventCleanups.push(id);
        };
        pushId(
            events.on(
                document,
                CACHE_EVENTS.COMPLETED,
                () => {
                    self._updateStatus().catch((e: unknown) =>
                        Log?.error("[CacheControl] Error updating status:", e)
                    );
                },
                false,
                "CacheControl.cacheCompleted"
            )
        );
        pushId(
            events.on(
                document,
                CACHE_EVENTS.CLEARED,
                () => {
                    self._updateStatus().catch((e: unknown) =>
                        Log?.error("[CacheControl] Error updating status:", e)
                    );
                },
                false,
                "CacheControl.cacheCleared"
            )
        );
        pushId(
            events.on(
                document,
                CACHE_EVENTS.CANCELLED,
                () => self._handleCancelled(),
                false,
                "CacheControl.cacheCancelled"
            )
        );
        pushId(
            events.on(
                document,
                CACHE_EVENTS.PROFILE_LOADED,
                () => {
                    self._updateStatus().catch((e: unknown) =>
                        Log?.error("[CacheControl] Error updating status:", e)
                    );
                    self._populateLayerSelection().catch((e: unknown) =>
                        Log?.error("[CacheControl] Error populating selection:", e)
                    );
                },
                false,
                "CacheControl.profileLoaded"
            )
        );
        pushId(
            events.on(
                document,
                CACHE_EVENTS.PROGRESS,
                (e: Event) => self._updateProgress((e as CustomEvent<CacheProgressDetail>).detail),
                false,
                "CacheControl.cacheProgress"
            )
        );
        pushId(
            events.on(
                document,
                CACHE_EVENTS.CLEAR_PROGRESS,
                (e: Event) =>
                    self._updateClearProgress((e as CustomEvent<CacheProgressDetail>).detail),
                false,
                "CacheControl.clearProgress"
            )
        );
    } else {
        // Fallback without cleanup (log warning)
        Log?.warn(
            "[CacheControl] EventListenerManager not available - listeners will not be cleaned up"
        );
        document.addEventListener(CACHE_EVENTS.COMPLETED, () => {
            self._updateStatus().catch((e: unknown) =>
                Log?.error("[CacheControl] Error updating status:", e)
            );
        });
        document.addEventListener(CACHE_EVENTS.CLEARED, () => {
            self._updateStatus().catch((e: unknown) =>
                Log?.error("[CacheControl] Error updating status:", e)
            );
        });
        document.addEventListener(CACHE_EVENTS.CANCELLED, () => self._handleCancelled());
        document.addEventListener(CACHE_EVENTS.PROFILE_LOADED, () => {
            self._updateStatus().catch((e: unknown) =>
                Log?.error("[CacheControl] Error updating status:", e)
            );
            self._populateLayerSelection().catch((e: unknown) =>
                Log?.error("[CacheControl] Error populating selection:", e)
            );
        });
        document.addEventListener(CACHE_EVENTS.PROGRESS, (e: Event) =>
            self._updateProgress((e as CustomEvent<CacheProgressDetail>).detail)
        );
        document.addEventListener(CACHE_EVENTS.CLEAR_PROGRESS, (e: Event) =>
            self._updateClearProgress((e as CustomEvent<CacheProgressDetail>).detail)
        );
    }
}

// ─── Accordion toggles ──────────────────────────────────────────────

/** Handles the layers accordion toggle (class-based for a smooth transition). */
export function handleLayersToggle(self: CacheControlState): void {
    if (!self._layersContent) return;

    const collapsed = self._layersContent.classList.toggle("gl-cache-collapsible--collapsed");

    if (self._layersToggleBtn) {
        self._layersToggleBtn.textContent = collapsed ? "\u25B2" : "\u25BC";
    }
}

/** Handles the status accordion toggle (class-based for a smooth transition). */
export function handleStatusToggle(self: CacheControlState): void {
    const statusInfo = self._bodyEl?.querySelector?.(".gl-cache-status__info");
    if (!statusInfo || !(statusInfo instanceof HTMLElement)) return;

    const collapsed = statusInfo.classList.toggle("gl-cache-collapsible--collapsed");

    if (self._statusToggleBtn) {
        self._statusToggleBtn.textContent = collapsed ? "\u25B2" : "\u25BC";
    }
}

/** Toggles collapsed state. */
export function toggleCollapsed(self: CacheControlState): void {
    if (!self._container) return;
    const isCollapsed = self._container.classList.toggle("gl-cache-control--collapsed");
    self.options.collapsed = isCollapsed;
}

// ─── Cleanup ─────────────────────────────────────────────────────────

/** Cleans up event listeners and delegated resources. */
export function cleanup(self: CacheControlState): void {
    if (self._eventCleanups?.length) {
        self._eventCleanups.forEach((c) => {
            if (typeof c === "function") c();
            else if (
                typeof c === "number" &&
                events &&
                typeof (events as { off?(id: number): void }).off === "function"
            )
                (events as { off(id: number): void }).off(c);
        });
        self._eventCleanups = [];
        if (Log) Log.debug("[CacheControl] Event listeners cleaned up");
    }

    // Clean up event listeners from LayerSelector
    if (LayerSelectorCore && typeof LayerSelectorCore.cleanup === "function") {
        LayerSelectorCore.cleanup();
    }
}
