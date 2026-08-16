/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Offline Detector Module
 *
 * Detects and handles online/offline transitions.
 * Shows a UI badge and emits custom events.
 *
 * @version 1.2.0
 */

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { ensureMap } from "../../utils/general/utils-base.js";
import { events } from "../../utils/general/event-listener-manager.js";
import { domCreate, applyCssText } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";

/** Runtime configuration of the offline detector. */
interface OfflineDetectorConfig {
    showBadge: boolean;
    badgePosition: string;
    checkInterval: number;
    pingUrl: string | null;
}

/**
 * Minimal map-adapter surface used by the offline badge: only `addControl`,
 * which returns a removable control handle. Kept local to avoid coupling this
 * built-in module to the full `IMapAdapter` type.
 */
interface OfflineBadgeMapAdapter {
    addControl(element: HTMLElement, position: string): { remove(): void };
}

/**
 * Builds the offline badge DOM node (styling + labels only; mounting is done
 * by `_createBadge()`).
 */
function _createOfflineBadgeContainer(): HTMLElement {
    const container = domCreate("div", "geoleaf-offline-badge-control");
    applyCssText(
        container,
        `
        background: #ff6b6b;
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        cursor: default;
        display: none;
        white-space: nowrap;
        position: absolute;
        left: 54px;
        top: 0;
        margin: 0 !important;
        border: none;
    `
    );
    container.textContent = getLabel("ui.offline.badge");
    container.title = getLabel("aria.offline.badge_title");
    return container;
}

const OfflineDetector = {
    /**
     * Current connection state.
     *
     * Deliberately NOT initialised from `navigator.onLine`: this object literal
     * is evaluated at module import time, which throws wherever `navigator` is
     * absent (SSR, plain Node tests). `init()` reads the real value.
     *
     * @private
     */
    _isOnline: true,

    /**
     * UI badge (when enabled)
     * @private
     */
    _badge: null as HTMLElement | null,

    /**
     * Handle returned by map.addControl(), used for removal.
     * @private
     */
    _badgeControlHandle: null as { remove(): void } | null,

    /**
     * Cleanup functions for badge propagation blockers
     * @private
     */
    _badgeCleanups: [] as (() => void)[],

    /**
     * Configuration
     * @private
     */
    _config: {
        showBadge: false,
        badgePosition: "topleft",
        checkInterval: 30000,
        pingUrl: null,
    } as OfflineDetectorConfig,

    /**
     * Periodic connectivity-check timer
     * @private
     */
    _checkTimer: null as ReturnType<typeof setInterval> | null,

    /**
     * Event cleanup functions
     * @private
     */
    _eventCleanups: [] as (number | null | (() => void))[],

    /**
     * Initializes the detector.
     *
     * Idempotent: a second call tears the previous one down first, so listeners
     * and timers are never registered twice.
     *
     * @param {Object} options - Configuration options
     * @param {boolean} options.showBadge - Show the UI badge
     * @param {string} options.badgePosition - Badge position (top-right, top-left, etc.)
     * @param {number} options.checkInterval - Check interval in ms
     * @param {string} options.pingUrl - URL used for the connectivity ping
     * @returns {void}
     */
    init(options: Partial<OfflineDetectorConfig> = {}) {
        // Re-init would otherwise stack another set of window listeners on top of
        // the live ones, leaking them until destroy(). Transitions themselves stay
        // single-fire (the _isOnline guard makes the extra listener a no-op).
        if (this._eventCleanups.length > 0 || this._checkTimer !== null) {
            Log.debug("[OfflineDetector] Re-initializing — tearing down the previous instance");
            this.destroy();
        }

        // Merge config
        this._config = { ...this._config, ...options };

        Log.info(
            `[OfflineDetector] Initializing (badge: ${this._config.showBadge ? "enabled" : "disabled"})`
        );

        // Initial state
        this._isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        Log.info(`[OfflineDetector] Initial state: ${this._isOnline ? "ONLINE" : "OFFLINE"}`);

        // The badge is created lazily:
        // - On the first offline event when showBadge=true
        // - Or through a manual call if the map becomes available later

        // Listen to the browser events
        this._attachEventListeners();

        // Periodic check
        this._startPeriodicCheck();

        // Check the real state right away. Best-effort: a failed ping must not
        // reject into the init path — the detector falls back to navigator.onLine.
        this.checkConnectivity().catch((e: unknown) =>
            Log.debug("[OfflineDetector] Initial connectivity check failed:", e)
        );
    },

    /**
     * Creates the offline badge UI control on the map via IMapAdapter.
     * @private
     */
    _createBadge() {
        if (this._badge) return; // Already created

        const map = ensureMap(undefined) as OfflineBadgeMapAdapter | null;
        if (!map) {
            Log.warn("[OfflineDetector] Cannot create badge: map not available");
            return;
        }

        const container = _createOfflineBadgeContainer();
        const cleanups: (() => void)[] = [];
        blockMapPropagation(container, cleanups);
        this._badgeControlHandle = map.addControl(container, "topleft");
        this._badge = container;
        this._badgeCleanups = cleanups;

        Log.debug("[OfflineDetector] Badge control created on map");
    },

    /**
     * Shows the badge
     * @private
     */
    _showBadge() {
        // Create the badge if it does not exist yet (lazy creation)
        if (!this._badge && this._config.showBadge) {
            this._createBadge();
        }

        if (this._badge) {
            this._badge.style.display = "block";
        }
    },

    /**
     * Hides the badge
     * @private
     */
    _hideBadge() {
        if (this._badge) {
            this._badge.style.display = "none";
        }
    },

    /**
     * Attaches the event listeners
     * @private
     */
    _attachEventListeners() {
        // Native browser events — tracked for cleanup

        if (events) {
            this._eventCleanups.push(
                events.on(
                    window,
                    "online",
                    () => this._handleOnline(),
                    false,
                    "OfflineDetector.online"
                )
            );
            this._eventCleanups.push(
                events.on(
                    window,
                    "offline",
                    () => this._handleOffline(),
                    false,
                    "OfflineDetector.offline"
                )
            );
        } else {
            // Fallback sans cleanup
            Log.warn(
                "[OfflineDetector] EventListenerManager not available - listeners will not be cleaned up"
            );
            window.addEventListener("online", () => this._handleOnline());
            window.addEventListener("offline", () => this._handleOffline());
        }

        Log.debug("[OfflineDetector] Event listeners attached");
    },

    /**
     * Detaches event listeners, clears timers and removes the badge.
     */
    destroy() {
        // Cleanup event listeners
        if (this._eventCleanups && this._eventCleanups.length > 0) {
            this._eventCleanups.forEach((cleanup: number | null | (() => void)) => {
                if (typeof cleanup === "function") cleanup();
                else if (typeof cleanup === "number") events.off(cleanup);
            });
            this._eventCleanups = [];
            Log.info("[OfflineDetector] Event listeners cleaned up");
        }

        // Clear check timer
        if (this._checkTimer) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
        }

        // Clean up badge propagation blockers
        if (this._badgeCleanups.length > 0) {
            this._badgeCleanups.forEach((fn) => fn());
            this._badgeCleanups = [];
        }

        // Remove badge control from map
        this._badgeControlHandle?.remove();
        this._badgeControlHandle = null;
        this._badge = null;
    },

    /**
     * Handles the transition to online
     * @private
     */
    _handleOnline() {
        if (this._isOnline) return; // Already online

        Log.info("[OfflineDetector] Connection restored → ONLINE");
        this._isOnline = true;

        // Hide the badge
        if (this._config.showBadge) {
            this._hideBadge();
        }

        // Emit a custom event
        document.dispatchEvent(
            new CustomEvent("geoleaf:online", {
                detail: { timestamp: Date.now() },
            })
        );

        // Confirm with a ping when needed (best-effort, see init).
        this.checkConnectivity().catch((e: unknown) =>
            Log.debug("[OfflineDetector] Connectivity confirmation failed:", e)
        );
    },

    /**
     * Handles the transition to offline
     * @private
     */
    _handleOffline() {
        if (!this._isOnline) return; // Already offline

        Log.warn("[OfflineDetector] Connection lost → OFFLINE");
        this._isOnline = false;

        // Show the badge
        if (this._config.showBadge) {
            this._showBadge();
        }

        // Emit a custom event
        document.dispatchEvent(
            new CustomEvent("geoleaf:offline", {
                detail: { timestamp: Date.now() },
            })
        );
    },

    /**
     * Checks real connectivity (with a ping when configured)
     *
     * @returns {Promise<boolean>}
     * @example
     * const isOnline = await GeoLeaf.Storage.OfflineDetector.checkConnectivity();
     */
    async checkConnectivity() {
        // With no ping URL configured, fall back to the browser state
        if (!this._config.pingUrl) {
            return this._isOnline;
        }

        // Declared outside the try so `finally` can always clear it. Clearing only
        // on the resolved path leaked one 5 s timer per failed ping, which piles up
        // for as long as the network stays down.
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        try {
            // Try a ping against the configured URL
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(this._config.pingUrl, {
                method: "HEAD",
                cache: "no-cache",
                signal: controller.signal,
            });

            const isOnline = response.ok;

            // Update the state when it differs
            if (isOnline !== this._isOnline) {
                if (isOnline) {
                    this._handleOnline();
                } else {
                    this._handleOffline();
                }
            }

            return isOnline;
        } catch (error: unknown) {
            // An error most likely means we are offline
            const detail = error instanceof Error ? error.message : String(error);
            Log.debug(`[OfflineDetector] Ping failed: ${detail}`);

            if (this._isOnline) {
                this._handleOffline();
            }

            return false;
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    },

    /**
     * Starts the periodic check
     * @private
     */
    _startPeriodicCheck() {
        // Without a pingUrl, checkConnectivity() only re-reads navigator.onLine —
        // the browser online/offline listeners already cover that, so the periodic
        // timer would spin every checkInterval doing nothing. Skip it (RM-P2 #6b).
        if (!this._config.pingUrl) return;

        if (this._checkTimer) {
            clearInterval(this._checkTimer);
        }

        this._checkTimer = setInterval(() => {
            this.checkConnectivity().catch((e: unknown) =>
                Log.debug("[OfflineDetector] Periodic connectivity check failed:", e)
            );
        }, this._config.checkInterval);

        Log.debug(
            `[OfflineDetector] Periodic check started (every ${this._config.checkInterval}ms)`
        );
    },

    /**
     * Stops the periodic check
     */
    stopPeriodicCheck() {
        if (this._checkTimer) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
            Log.debug("[OfflineDetector] Periodic check stopped");
        }
    },

    /**
     * Returns the État de connexion current
     *
     * @returns {boolean}
     * @example
     * if (GeoLeaf.Storage.OfflineDetector.isOnline()) {
     *   // Perform a network request
     * }
     */
    isOnline() {
        return this._isOnline;
    },
};

export { OfflineDetector };
