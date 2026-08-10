/*!
 * GeoLeaf Core (toast-renderer capability) — Lifecycle / boot wiring
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Lifecycle for the in-core toast-renderer capability.
 *
 * Absorbs the former `app/init-notifications.ts` (S7): creates the toast container,
 * initializes the `NotificationSystem`, registers it as the renderer of the kernel
 * `notify()` primitive, and wires the boot loading toast + profile/theme toast
 * listeners. `init()` is idempotent (`_started` guard); `_reset()` detaches the
 * listeners and destroys the renderer (registry destroy / test seam).
 *
 * The dependency-injected values from the former `setupNotifications({...})` bag are
 * re-sourced here: `getLabel` (direct i18n import), the notify primitive (import),
 * the `_UINotifications` singleton (import), a local perf-mark helper, and `Log`.
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { notifyPrimitive } from "../../utils/notify/notify.primitive.js";
import type { NotifyLevel } from "../../contracts/notify.contract.js";
import { _UINotifications } from "./notifications.js";
import { getToastRendererConfig } from "./config.js";
import { DEFAULT_MAX_VISIBLE, DEFAULT_TOAST_POSITION } from "./constants.js";

/** Detail payload of the `geoleaf:profile:loaded` event (read for the profile toast). */
interface ProfileLoadedDetail {
    profileId?: string;
    data?: {
        profile?: { label?: string; name?: string; title?: string; [key: string]: unknown };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** Detail payload of the `geoleaf:theme:applied` event (themeName + layerCount). */
interface ThemeAppliedDetail {
    themeName?: string;
    layerCount?: number;
    [key: string]: unknown;
}

/** `Window` augmented with the runtime perf opt-in flag (mirrors app-types `PerfWindow`). */
interface PerfWindow extends Window {
    __GEOLEAF_PERF__?: boolean;
}

/** Records a performance mark when the `__GEOLEAF_PERF__` opt-in flag is set. */
function _pm(name: string): void {
    if ((window as PerfWindow).__GEOLEAF_PERF__) performance?.mark?.(name);
}

// ── Module-private state (was private to `setupNotifications`) ───────────────
let _started = false;
let _loadingToast: HTMLElement | null = null;
let _pendingProfileToastDetail: ProfileLoadedDetail | null = null;
/** The renderer handed to the notify primitive — kept so `_reset()` can unregister it. */
let _registeredRenderer: ((message: string, level: NotifyLevel) => void) | null = null;
/**
 * The `#gl-notifications` element, only when THIS lifecycle created it. A host page is
 * free to provide its own container; teardown may take back what it added, never what
 * it merely borrowed.
 */
let _ownedContainer: HTMLElement | null = null;

/**
 * Emits a success toast through the kernel primitive. Mirrors the former
 * `_app.showNotification` (helpers.ts): always resolves (the primitive buffers
 * until the renderer registers), so the return is always `true`.
 */
function showNotification(message: string): boolean {
    notifyPrimitive.notify(message, "success");
    return true;
}

/** Whether the renderer is initialized (container present). */
function notificationsReady(): boolean {
    return !!_UINotifications?.container;
}

function tryShowProfileToast(detail: ProfileLoadedDetail): boolean {
    if (!detail || !detail.data) return false;
    const profile = detail.data.profile || {};
    const profileName =
        profile.label || profile.name || profile.title || detail.profileId || "Profile";
    const message = getLabel("toast.profile.loaded", profileName);
    if (!notificationsReady()) {
        _pendingProfileToastDetail = detail;
        return false;
    }
    const shown = showNotification(message);
    if (shown) _pendingProfileToastDetail = null;
    else _pendingProfileToastDetail = detail;
    return shown;
}

// ── Named event handlers (so `_reset()` can detach them) ─────────────────────
function onThemeApplying(): void {
    // R-perf S1 — mark the start of the data-loading toast interval
    _pm("geoleaf:theme:applying");
    // Display a persistent toast if the notification system is ready
    if (_UINotifications && _UINotifications.container) {
        _loadingToast =
            _UINotifications.info(getLabel("toast.init.loading"), {
                persistent: true,
                dismissible: false,
            }) ?? null;
    }
}

function onProfileLoaded(event: Event): void {
    const detail = (event as CustomEvent<ProfileLoadedDetail>).detail;
    if (detail) {
        _pendingProfileToastDetail = detail;
        tryShowProfileToast(detail);
    }
}

function onThemeApplied(event: Event): void {
    const themeDetail = (event as CustomEvent<ThemeAppliedDetail>).detail;
    // R-perf S1 — measure the data-loading toast interval (applying → applied)
    if ((window as PerfWindow).__GEOLEAF_PERF__) {
        _pm("geoleaf:theme:applied");
        try {
            performance.measure(
                "geoleaf:theme-data-load",
                "geoleaf:theme:applying",
                "geoleaf:theme:applied"
            );
            const _last = performance.getEntriesByName("geoleaf:theme-data-load", "measure").at(-1);
            if (_last) {
                const _layerCount = themeDetail?.layerCount ?? "?";
                Log.info(
                    "[Perf] Theme data load: " +
                        _last.duration.toFixed(1) +
                        "ms (" +
                        _layerCount +
                        " couches)"
                );
            }
        } catch (_e) {
            void _e;
        }
    }
    // Close the persistent loading toast
    if (_loadingToast && _UINotifications && typeof _UINotifications.dismiss === "function") {
        _UINotifications.dismiss(_loadingToast);
        _loadingToast = null;
    }
    if (themeDetail) {
        showNotification(
            getLabel(
                "toast.theme.applied",
                String(themeDetail.themeName),
                String(themeDetail.layerCount)
            )
        );
    }
}

function onMapReady(): void {
    if (_pendingProfileToastDetail) {
        tryShowProfileToast(_pendingProfileToastDetail);
    }
}

/** Idempotent lifecycle for the toast renderer. */
export const ToastRendererLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        // Config gate (opt-out). The module is only registered when enabled, but
        // guard here too for direct calls (tests) and defensive parity.
        if (!getToastRendererConfig().enabled) return;
        _started = true;

        // ── Initialise the UI notification system ────────────────────────────
        if (typeof _UINotifications.init === "function") {
            try {
                let notificationContainer = document.getElementById("gl-notifications");
                if (!notificationContainer) {
                    notificationContainer = document.createElement("div");
                    notificationContainer.id = "gl-notifications";
                    notificationContainer.className = `gl-notifications gl-notifications--${DEFAULT_TOAST_POSITION}`;
                    document.body.appendChild(notificationContainer);
                    _ownedContainer = notificationContainer;
                }

                // `init()` is a full re-initialisation and comes back enabled on its own
                // (B.19) — the recreate path no longer needs an `enable()` of its own.
                _UINotifications.init({
                    container: "#gl-notifications",
                    position: DEFAULT_TOAST_POSITION,
                    maxVisible: DEFAULT_MAX_VISIBLE,
                    animations: true,
                });

                Log.info("Notification system initialized");

                // Wire the notify primitive to the toast renderer. Any messages
                // buffered before this point (early boot) are flushed immediately.
                _registeredRenderer = (message: string, level: NotifyLevel) => {
                    _UINotifications[level](message);
                };
                notifyPrimitive.registerRenderer(_registeredRenderer);
            } catch (e) {
                Log.warn("Error during notification system initialization:", e);
            }
        }

        // ── Boot / profile / theme toast listeners ───────────────────────────
        document.addEventListener("geoleaf:theme:applying", onThemeApplying);
        document.addEventListener("geoleaf:profile:loaded", onProfileLoaded);
        document.addEventListener("geoleaf:theme:applied", onThemeApplied);
        document.addEventListener("geoleaf:map:ready", onMapReady);
    },

    /**
     * Registry destroy / test seam: detaches listeners, unhooks the notify primitive,
     * tears down the renderer and removes the container this lifecycle created.
     *
     * Unregistering is not tidiness. `destroy()` leaves the singleton without a
     * container, where `_processQueue` drops everything it is handed — so a primitive
     * still pointing at it turns every later `notify()` into a **lost** message, with
     * no console fallback either, since the primitive believes it has a renderer.
     */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:theme:applying", onThemeApplying);
            document.removeEventListener("geoleaf:profile:loaded", onProfileLoaded);
            document.removeEventListener("geoleaf:theme:applied", onThemeApplied);
            document.removeEventListener("geoleaf:map:ready", onMapReady);
        }
        _loadingToast = null;
        _pendingProfileToastDetail = null;
        if (_registeredRenderer) {
            notifyPrimitive.unregisterRenderer(_registeredRenderer);
            _registeredRenderer = null;
        }
        if (_UINotifications && typeof _UINotifications.destroy === "function") {
            _UINotifications.destroy();
        }
        _ownedContainer?.remove();
        _ownedContainer = null;
        _started = false;
    },
};
