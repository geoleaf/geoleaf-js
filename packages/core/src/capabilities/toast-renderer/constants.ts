/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Toast-renderer capability — shared renderer defaults.
 *
 * These numbers used to be bare literals scattered across the renderer and its boot
 * wiring, with one already drifting: `NotificationSystem`'s constructor set
 * `maxVisible = 3` and `init()` re-derived the same `3` a few lines below, while
 * `ToastRendererLifecycle.init()` passed a third hard-coded `3` from `lifecycle.ts`.
 * `maxPersistent` was worse — declared on `INotificationInitConfig` and documented
 * `@default 2`, but never read by `init()`, so the constructor value was the only one
 * that ever applied and configuring the field silently did nothing (S8).
 *
 * All four sites now read from here — the constructor, the `init()` fallback, the boot
 * wiring in `lifecycle.ts` and the documented default — so they are the same value *by
 * construction* and the drift cannot reopen.
 */

import type { NotifyType } from "./types.js";

/** Maximum number of simultaneously visible *temporary* (auto-dismissing) toasts. */
export const DEFAULT_MAX_VISIBLE = 3;

/**
 * Maximum number of simultaneously visible *persistent* toasts. Counted separately from
 * `DEFAULT_MAX_VISIBLE` so a long-lived progress toast never starves transient feedback.
 */
export const DEFAULT_MAX_PERSISTENT = 2;

/**
 * Maximum number of notifications kept waiting in the priority queue. Past this, the
 * lowest-priority (then oldest) entry is evicted to admit a higher-priority one; an
 * incoming entry that outranks nothing is rejected outright.
 */
export const DEFAULT_MAX_QUEUE_SIZE = 15;

/**
 * Delay (ms) between marking a toast for removal and detaching it from the DOM — must
 * stay in step with the exit transition in `css/toast-renderer.css`. `0` when animations
 * are disabled.
 */
export const TOAST_EXIT_ANIMATION_MS = 200;

/** Default auto-dismiss duration (ms) per notification type. */
export const DEFAULT_DURATIONS: Record<NotifyType, number> = {
    success: 3000,
    error: 5000,
    warning: 4000,
    info: 3000,
};

/** Default anchor position of the toast container. */
export const DEFAULT_TOAST_POSITION = "bottom-center";
