/*!
 * GeoLeaf Core (toast-renderer capability) — Types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Public type boundary for the in-core `toast-renderer` capability.
 *
 * Formal TypeScript types for the notification renderer API. Relocated from
 * `contracts/notification.contract.ts` (S7 — capacités-extraction). Consumed by
 * `notifications.ts` (the `NotificationSystem` class) and `public-api.ts`
 * (the `Notifications` facade), and re-exported for any integrator relying on the
 * ESM build.
 *
 * The kernel `notify()` primitive keeps its own zero-dependency contract in
 * `contracts/notify.contract.ts` — this file is the *rich* renderer surface.
 */
"use strict";

/**
 * Supported notification types.
 *
 * - `"info"` — Neutral informational message
 * - `"success"` — Confirmation of a successful action
 * - `"warning"` — Non-blocking alert requiring user attention
 * - `"error"` — Error requiring immediate attention (longest default duration)
 */
export type NotifyType = "info" | "success" | "warning" | "error";

/**
 * Options accepted by all `Notifications.*` methods.
 *
 * All fields are optional. When omitted, the system applies defaults
 * configured at `notifications.init()` time (or the built-in defaults).
 */
export interface NotifyOptions {
    /**
     * Type override — useful when passing options to the generic `notify()` method.
     * When omitted, the caller's method name determines the type
     * (e.g. `Notifications.success()` forces `type: "success"`).
     */
    type?: NotifyType;

    /**
     * Auto-dismiss duration in milliseconds.
     * Ignored when `persistent` is `true`.
     *
     * Built-in defaults per type:
     * - `info`    → 3 000 ms
     * - `success` → 3 000 ms
     * - `warning` → 4 000 ms
     * - `error`   → 5 000 ms
     */
    duration?: number;

    /**
     * When `true`, the toast will not be auto-dismissed.
     * The user must close it manually (requires `dismissible: true`) or
     * the integrator must call `Notifications.dismiss()` / `Notifications.clearAll()`.
     *
     * @default false
     */
    persistent?: boolean;

    /**
     * When `true`, a close button is rendered on the toast.
     * The user can dismiss the notification at any time.
     *
     * @default true
     */
    dismissible?: boolean;
}

/**
 * Shape of the current notification system status snapshot
 * returned by `Notifications.getStatus()`.
 */
export interface NotifyStatus {
    /** Whether the notification system is currently enabled. */
    enabled: boolean;
    /** Whether `init()` has been called successfully. */
    initialized: boolean;
    /** Number of toasts currently visible (temporary + persistent). */
    activeToasts: number;
    /** Number of temporary (auto-dismiss) toasts visible. */
    temporaryToasts: number;
    /** Number of persistent toasts visible. */
    persistentToasts: number;
    /** Number of notifications waiting in the priority queue. */
    queued: number;
    /** Configured maximum number of simultaneous visible toasts. */
    maxVisible: number;
    /** Configured maximum number of simultaneous persistent toasts. */
    maxPersistent: number;
    /** Current display position (e.g. `"bottom-center"`, `"top-right"`). */
    position: string;
}

// ─── Internal implementation types ───────────────────────────────────────────

/**
 * A single entry in the `NotificationSystem` priority queue.
 *
 * Managed internally by `_enqueue()` / `_processQueue()`.
 *
 * @internal
 */
export interface INotificationQueueEntry {
    /** Text to display in the toast. */
    message: string;
    /** Resolved display options for this notification. */
    options: {
        type: NotifyType;
        duration: number | undefined;
        persistent: boolean;
        dismissible: boolean;
    };
    /** Numeric priority: 3 = error, 2 = warning, 1 = info / success. */
    priority: number;
    /** Unix timestamp (ms) at enqueue time — FIFO tiebreaker within same priority. */
    timestamp: number;
}

/**
 * Configuration object accepted by `NotificationSystem.init()`.
 *
 * All fields are optional — missing fields retain their built-in defaults.
 */
export interface INotificationInitConfig {
    /** CSS selector of the notification container element. @default "#gl-notifications" */
    container?: string;
    /** Maximum number of simultaneously visible temporary toasts. @default 3 */
    maxVisible?: number;
    /** Maximum number of simultaneously visible persistent toasts. @default 2 */
    maxPersistent?: number;
    /** Per-type auto-dismiss durations in milliseconds. */
    durations?: Partial<Record<NotifyType, number>>;
    /** Toast anchor position. @default "bottom-center" */
    position?: string;
    /** Whether CSS enter/exit animations are enabled. @default true */
    animations?: boolean;
}
