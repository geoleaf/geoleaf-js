/*!
 * GeoLeaf Core (toast-renderer capability) — Public facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Public facade for the toast-renderer capability. Exposes {@link Notifications} —
 * a rich shortcut to the internal `NotificationSystem` singleton (`_UINotifications`).
 *
 * Relocated from `modules/geoleaf.notifications.ts` (S7). Complements the top-level
 * `GeoLeaf.notify()` kernel primitive: `notify()` is the lossy, always-present
 * emitter; this facade is the rich renderer surface (duration, persistent,
 * dismiss(handle), clearAll, getStatus). Re-exported as `{ Notifications }` from
 * `@geoleaf/core` via `bundle-esm-entry.ts`.
 *
 * @example
 * // Shortcut (UMD / CDN)
 * GeoLeaf.notify("Données chargées", "success");
 *
 * @example
 * // Namespace complet (ESM)
 * import { Notifications } from "@geoleaf/core";
 * Notifications.success("Données chargées");
 * Notifications.error("Échec du chargement", { persistent: true, dismissible: true });
 */

import { _UINotifications } from "./notifications.js";
import type { NotifyType, NotifyOptions, NotifyStatus } from "./types.js";

/**
 * The emitting methods below all return `HTMLElement | null | undefined`: the toast
 * element, `null` when the priority queue rejected the notification (queue full and
 * nothing lower-priority to evict), `undefined` when the renderer is not initialised
 * yet. Pass a non-null value to {@link Notifications.dismiss} to close that toast.
 *
 * The union is written inline on each signature rather than exported as a named alias —
 * a public type with no consumer would be a contract invented for its own sake
 * (same rule as ARCHI S12.2; the `check-orphan-exports` gate enforces it).
 */

/**
 * Public Notifications namespace.
 *
 * Delegates all calls to the internal `_UINotifications` singleton
 * (initialized during the toast-renderer capability lifecycle).
 *
 * Available as a named ESM export `{ Notifications }` from `@geoleaf/core`.
 */
export const Notifications = {
    /**
     * Displays a notification toast.
     *
     * Supports two call signatures:
     * - `notify(message, type, duration)` — positional, e.g. `notify("OK", "success", 3000)`
     * - `notify(message, options)`        — options object, e.g. `notify("OK", { type: "success", duration: 3000 })`
     *
     * @param message - Text to display.
     * @param typeOrOptions - Notification type (`"info"` | `"success"` | `"warning"` | `"error"`) or options object.
     * @param duration - Auto-dismiss duration in ms (only when `typeOrOptions` is a string).
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     */
    notify(
        message: string,
        typeOrOptions?: NotifyType | NotifyOptions,
        duration?: number
    ): HTMLElement | null | undefined {
        // `show` accepts `string | NotifyOptions`; `NotifyType` is a string-literal
        // union, so `typeOrOptions ?? "info"` is assignable without a cast.
        return _UINotifications.show(message, typeOrOptions ?? "info", duration);
    },

    /**
     * Displays a notification toast. Alias of {@link Notifications.notify}, kept because
     * the renderer, the legacy `GeoLeaf.UI.showNotification` surface and the plugin
     * documentation all name this method — calling it used to hit `undefined` and fail
     * silently.
     *
     * @param message - Text to display.
     * @param typeOrOptions - Notification type or options object.
     * @param duration - Auto-dismiss duration in ms (only when `typeOrOptions` is a string).
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     *
     * @example
     * GeoLeaf.Notifications.show("Feature is stale", { type: "warning" });
     */
    show(
        message: string,
        typeOrOptions?: NotifyType | NotifyOptions,
        duration?: number
    ): HTMLElement | null | undefined {
        return _UINotifications.show(message, typeOrOptions ?? "info", duration);
    },

    /**
     * Displays a success toast.
     *
     * @param message - Text to display.
     * @param options - Optional duration (ms) or options object.
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     *
     * @example
     * Notifications.success("Sauvegarde réussie");
     * Notifications.success("Sauvegarde réussie", { duration: 2000 });
     */
    success(message: string, options?: number | NotifyOptions): HTMLElement | null | undefined {
        return _UINotifications.success(message, options);
    },

    /**
     * Displays an error toast (highest priority, longest default duration: 5 s).
     *
     * @param message - Text to display.
     * @param options - Optional duration (ms) or options object.
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     *
     * @example
     * Notifications.error("Erreur réseau", { persistent: true, dismissible: true });
     */
    error(message: string, options?: number | NotifyOptions): HTMLElement | null | undefined {
        return _UINotifications.error(message, options);
    },

    /**
     * Displays a warning toast.
     *
     * @param message - Text to display.
     * @param options - Optional duration (ms) or options object.
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     *
     * @example
     * Notifications.warning("Connexion instable", { duration: 6000 });
     */
    warning(message: string, options?: number | NotifyOptions): HTMLElement | null | undefined {
        return _UINotifications.warning(message, options);
    },

    /**
     * Displays an informational toast.
     *
     * @param message - Text to display.
     * @param options - Optional duration (ms) or options object.
     * @returns The toast element (`null` if rejected, `undefined` if uninitialised).
     *
     * @example
     * Notifications.info("3 nouvelles alertes disponibles");
     */
    info(message: string, options?: number | NotifyOptions): HTMLElement | null | undefined {
        return _UINotifications.info(message, options);
    },

    /**
     * Dismisses a specific toast by its DOM element reference.
     *
     * @param toastEl - The toast `HTMLElement` returned by a previous call.
     *
     * @example
     * const toast = Notifications.info("Chargement…", { persistent: true });
     * // later:
     * if (toast) Notifications.dismiss(toast);
     */
    dismiss(toastEl: HTMLElement): void {
        _UINotifications.dismiss(toastEl);
    },

    /**
     * Removes all visible toasts and clears the pending queue.
     *
     * @example
     * Notifications.clearAll();
     */
    clearAll(): void {
        _UINotifications.clearAll();
    },

    /**
     * Returns a snapshot of the current notification system state.
     * Useful for debugging or building custom status indicators.
     *
     * @returns Current system status.
     *
     * @example
     * const status = Notifications.getStatus();
     * console.log(status.activeToasts, status.queued);
     */
    getStatus(): NotifyStatus {
        return _UINotifications.getStatus();
    },
} as const;
