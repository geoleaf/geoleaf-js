/*!
 * GeoLeaf Core (toast-renderer capability)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf notification system — the toast renderer itself.
 *
 * Owns a priority queue (errors first, FIFO within a priority) and the DOM rendering of
 * each toast. Two budgets are enforced separately: `maxVisible` for temporary
 * (auto-dismissing) toasts and `maxPersistent` for the ones that stay until dismissed.
 * Defaults live in `../constants.js`.
 *
 * Exposed as the `_UINotifications` singleton, wired by
 * `capabilities/toast-renderer/lifecycle.ts` and surfaced publicly by
 * `capabilities/toast-renderer/public-api.ts`.
 *
 * @version 1.3.0
 * @updated 2026-07-21 - S8: maxPersistent wired, priority eviction fixed, translated
 */

import { Log } from "../../utils/log/index.js";
import { createElement } from "../../utils/general/dom-helpers.js";
import { events } from "../../utils/general/event-listener-manager.js";
import type { EventListenerManager } from "../../utils/general/event-listener-manager.js";
import { TimerManager } from "../../utils/general/timer-manager.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import type {
    NotifyType,
    NotifyOptions,
    NotifyStatus,
    INotificationQueueEntry,
    INotificationInitConfig,
} from "./types.js";
import {
    DEFAULT_DURATIONS,
    DEFAULT_MAX_PERSISTENT,
    DEFAULT_MAX_QUEUE_SIZE,
    DEFAULT_MAX_VISIBLE,
    DEFAULT_TOAST_POSITION,
    TOAST_EXIT_ANIMATION_MS,
} from "./constants.js";

/** Queue priorities — higher wins; equal priorities are served FIFO by timestamp. */
const PRIORITY = {
    ERROR: 3,
    WARNING: 2,
    SUCCESS: 1,
    INFO: 1,
};

class NotificationSystem {
    container: HTMLElement | null;
    maxVisible: number;
    maxPersistent: number;
    durations: Record<NotifyType, number>;
    config: { enabled: boolean; position: string; animations: boolean };
    _eventManager: EventListenerManager | null;
    _timerManager: TimerManager | null;
    _queue: INotificationQueueEntry[];
    _maxQueueSize: number;

    constructor() {
        this.container = null;
        this.maxVisible = DEFAULT_MAX_VISIBLE;
        this.maxPersistent = DEFAULT_MAX_PERSISTENT;
        this.durations = { ...DEFAULT_DURATIONS };
        this.config = {
            enabled: true,
            position: DEFAULT_TOAST_POSITION,
            animations: true,
        };

        // Managers owning the listeners / timers to release on destroy().
        this._eventManager = null;
        this._timerManager = null;

        this._queue = [];
        this._maxQueueSize = DEFAULT_MAX_QUEUE_SIZE;
    }

    /**
     * (Re-)initialises the notification system against a container element.
     *
     * **`init()` is a full re-initialisation, not a merge** (B.19). Every option is
     * resolved from `config` alone, falling back to its built-in default when omitted,
     * and the renderer always comes back **enabled**. Calling `init(x)` therefore lands
     * on the same state whatever ran before it — including after a `destroy()`.
     *
     * It used to be neither: `position` / `animations` / `durations` merged over the
     * current state while `maxVisible` / `maxPersistent` fell back to the defaults, so
     * a second partial `init()` silently reset two budgets and kept three other
     * settings. Worse, `enabled` was never restored, and `destroy()` clears it — every
     * recreate path came back **mute** unless the caller knew to `enable()` by hand.
     * Per-field overrides (`durations: { success: 4000 }`) keep working: the config is
     * layered over the defaults, not over the previous call.
     *
     * **A successful `init()` DRAINS the queue** (17/08/2026). `show()` called before
     * initialisation fills `_queue` while rendering nothing — `_processQueue()` exits
     * early for lack of a container. Until now nothing called it back afterwards:
     * the queue waited for the **next** `show()`, and if none came, the message was
     * lost. Yet the messages emitted at boot ("profile not found", "layer failed")
     * are exactly the ones with no successor.
     *
     * ⚠️ An `init()` that FAILS drains nothing and empties nothing: the queue
     * survives for the next attempt. Losing it there would be worse than the
     * original defect.
     *
     * @param config - Renderer configuration; every field falls back to its built-in
     *   default (see `constants.ts`).
     * @returns `true` when the container was found and the system is ready, `false`
     *   otherwise — nothing is rendered until a successful `init()`. A successful one
     *   also flushes whatever piled up before it.
     */
    init(config: INotificationInitConfig = {}): boolean {
        this.config = {
            enabled: true,
            position: config.position ?? DEFAULT_TOAST_POSITION,
            animations: config.animations ?? true,
        };
        this.maxVisible = config.maxVisible ?? DEFAULT_MAX_VISIBLE;
        this.maxPersistent = config.maxPersistent ?? DEFAULT_MAX_PERSISTENT;
        this.durations = { ...DEFAULT_DURATIONS, ...config.durations };

        this.container = document.querySelector(config.container || "#gl-notifications");

        if (!this.container) {
            Log.warn("[GeoLeaf Notifications] Container not found:", config.container);
            return false;
        }

        // Applied from the RESOLVED position, not only when one was passed: otherwise a
        // partial re-init leaves the DOM anchored where the previous call put it while
        // `getStatus().position` reports the default.
        this.container.className = `gl-notifications gl-notifications--${this.config.position}`;

        Log.debug("[GeoLeaf Notifications] System initialized");

        // Managers owning the listeners / timers released by destroy().
        this._eventManager = events ? events.createManager("notifications") : null;
        this._timerManager = new TimerManager("notifications");

        // Anything emitted BEFORE this init() is drained now — `_processQueue()` bails on
        // `!this.container`, so a `show()` during boot only filled `_queue` and rendered
        // nothing. Nothing called it back afterwards: the queue waited for the NEXT
        // `show()`, and if none came the message was lost for good. Boot-time warnings
        // ("profile not found", "layer failed") are precisely the ones with no follow-up.
        //
        // 🛑 It must sit HERE, after both managers, not next to the container check. In
        // every case where the queue has content those two are still `null` (the
        // constructor leaves them so), and `_showImmediate` would then fall back to a bare
        // `setTimeout` that `destroy()` cannot cancel — a leak traded for a fix.
        this._processQueue();

        return true;
    }

    /**
     * Displays a notification toast. Two call signatures are supported:
     *
     * - `show(message, type, duration)` — positional
     * - `show(message, options)` — options object
     *
     * @param message - Text to display.
     * @param typeOrOptions - Notification type (`"success" | "error" | "warning" | "info"`)
     *   or an options object.
     * @param duration - Auto-dismiss duration (ms); ignored when `typeOrOptions` is an object.
     * @returns The toast element, `null` when the queue rejected it, or `undefined` when
     *   the system is not initialised.
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.show("Message", "success", 3000);
     * ```
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.show("Message", {
     *     type: "success",
     *     duration: 3000,
     *     persistent: false,
     *     dismissible: true,
     * });
     * ```
     */
    show(
        message: string,
        typeOrOptions: string | NotifyOptions = "info",
        duration?: number
    ): HTMLElement | null | undefined {
        let options: Partial<INotificationQueueEntry["options"]> & { type?: string };

        if (typeof typeOrOptions === "string") {
            options = { type: typeOrOptions as NotifyType, duration };
        } else if (typeof typeOrOptions === "object" && typeOrOptions !== null) {
            options = typeOrOptions;
        } else {
            // Anything else (null, number, …) — fall back to a plain info toast.
            options = { type: "info" };
        }

        return this._enqueue(message, options);
    }

    /**
     * Shared body of the four type shortcuts: resolves their
     * `number | NotifyOptions | undefined` second argument onto {@link show}.
     *
     * @param type - Notification type forced by the calling shortcut.
     * @param message - Text to display.
     * @param durationOrOptions - Duration (ms) or an options object.
     */
    _typed(
        type: NotifyType,
        message: string,
        durationOrOptions?: number | NotifyOptions
    ): HTMLElement | null | undefined {
        if (typeof durationOrOptions === "number") {
            return this.show(message, type, durationOrOptions);
        }
        if (typeof durationOrOptions === "object" && durationOrOptions !== null) {
            return this.show(message, { ...durationOrOptions, type });
        }
        return this.show(message, type);
    }

    /**
     * Displays a success toast (default duration: 3 s).
     *
     * @param message - Text to display.
     * @param durationOrOptions - Duration (ms) or an options object.
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.success("Save successful", 3000);
     * GeoLeaf.Notifications.success("Save successful", { duration: 3000, persistent: false });
     * ```
     */
    success(
        message: string,
        durationOrOptions?: number | NotifyOptions
    ): HTMLElement | null | undefined {
        return this._typed("success", message, durationOrOptions);
    }

    /**
     * Displays an error toast (highest priority, longest default duration: 5 s).
     *
     * @param message - Text to display.
     * @param durationOrOptions - Duration (ms) or an options object.
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.error("Perte de connexion au serveur", { persistent: true });
     *
     * // Later, when connection is restored:
     * GeoLeaf.Notifications.clearAll();
     * GeoLeaf.Notifications.success("Connexion rétablie");
     * ```
     */
    error(
        message: string,
        durationOrOptions?: number | NotifyOptions
    ): HTMLElement | null | undefined {
        return this._typed("error", message, durationOrOptions);
    }

    /**
     * Displays a warning toast (default duration: 4 s).
     *
     * @param message - Text to display.
     * @param durationOrOptions - Duration (ms) or an options object.
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.warning("Mise à jour disponible", {
     *     persistent: true,
     *     dismissible: true, // user can dismiss
     * });
     * ```
     */
    warning(
        message: string,
        durationOrOptions?: number | NotifyOptions
    ): HTMLElement | null | undefined {
        return this._typed("warning", message, durationOrOptions);
    }

    /**
     * Displays an informational toast (default duration: 3 s).
     *
     * @param message - Text to display.
     * @param durationOrOptions - Duration (ms) or an options object.
     *
     * @example
     * ```js
     * GeoLeaf.Notifications.info("Nouvelle mise à jour disponible");
     * GeoLeaf.Notifications.info("Message", { duration: 8000 }); // 8 seconds
     * ```
     */
    info(
        message: string,
        durationOrOptions?: number | NotifyOptions
    ): HTMLElement | null | undefined {
        return this._typed("info", message, durationOrOptions);
    }

    /**
     * Adds a notification to the priority queue, evicting a lower-priority entry when
     * the queue is full, then processes the queue.
     *
     * @param message - Text to display.
     * @param options - Partially resolved display options.
     * @returns The toast element, or `null` when the entry was rejected.
     */
    _enqueue(
        message: string,
        options: Partial<INotificationQueueEntry["options"]> & { type?: string }
    ): HTMLElement | null | undefined {
        const type = options.type ?? "info";
        const priority = PRIORITY[type.toUpperCase() as keyof typeof PRIORITY] ?? PRIORITY.INFO;

        const item: INotificationQueueEntry = {
            message,
            options: {
                type,
                duration: options.duration,
                persistent: options.persistent ?? false,
                dismissible: options.dismissible !== false, // true unless explicitly false
            },
            priority,
            timestamp: Date.now(),
        };

        if (this._queue.length >= this._maxQueueSize) {
            // Find the lowest priority element (and oldest if tie)
            const lowestPriorityIndex = this._queue.reduce((minIdx, qItem, idx, arr) => {
                const minItem = arr[minIdx];
                if (!minItem) return idx;
                if (
                    qItem.priority < minItem.priority ||
                    (qItem.priority === minItem.priority && qItem.timestamp < minItem.timestamp)
                ) {
                    return idx;
                }
                return minIdx;
            }, 0);

            // Admit the newcomer only if it outranks the queue's weakest entry.
            const weakest = this._queue[lowestPriorityIndex];
            if (weakest && item.priority > weakest.priority) {
                this._queue.splice(lowestPriorityIndex, 1);
                Log.warn("[GeoLeaf Notifications] Queue full, notification dropped");
            } else {
                Log.warn("[GeoLeaf Notifications] Queue full, notification rejected");
                return null;
            }
        }

        this._queue.push(item);

        this._queue.sort((a, b) => {
            if (b.priority !== a.priority) {
                return b.priority - a.priority; // Descending priority
            }
            return a.timestamp - b.timestamp; // FIFO within the same priority
        });

        return this._processQueue();
    }

    /**
     * Evicts one visible temporary toast to make room for a pending error.
     *
     * Only a toast that is not *already* being removed frees a slot: `_remove()` is a
     * no-op on one that is, and the actual DOM removal is deferred by the exit
     * animation. `temporaryToasts` — the live counter `_processQueue` loops on — is
     * therefore updated here, so a burst of errors handled in a single pass cannot
     * re-target the same toast over and over and overflow `maxVisible`.
     *
     * @returns `true` only when a slot was genuinely freed.
     */
    _makeSpaceForPriority(
        nextItem: INotificationQueueEntry,
        temporaryToasts: HTMLElement[]
    ): boolean {
        if (nextItem.priority !== PRIORITY.ERROR) return false;

        const isEvictable = (t: HTMLElement) => !t.classList.contains("gl-toast--removing");
        // Prefer the least important toast; fall back to the oldest evictable one.
        let index = temporaryToasts.findIndex(
            (t) =>
                isEvictable(t) &&
                (t.classList.contains("gl-toast--info") ||
                    t.classList.contains("gl-toast--success"))
        );
        if (index < 0) index = temporaryToasts.findIndex(isEvictable);
        if (index < 0) return false; // everything is already leaving — no slot to claim

        const victim = temporaryToasts[index];
        if (!victim) return false;
        this._remove(victim, true);
        temporaryToasts.splice(index, 1);
        return true;
    }

    /**
     * Drains as much of the queue as the visible-toast budget allows.
     *
     * @returns The last toast displayed by this pass, or `null` when none was.
     */
    _processQueue(): HTMLElement | null {
        if (!this.container || !this.config.enabled || this._queue.length === 0) {
            return null;
        }

        // Toasts currently on screen, split by budget (temporary vs persistent). These
        // arrays are the live counters for the whole pass: the DOM is not re-queried,
        // and removals are deferred, so every path that frees or fills a slot must
        // keep them in step (see `_makeSpaceForPriority`).
        const visibleToasts = this.container.querySelectorAll<HTMLElement>(
            ".gl-toast:not(.gl-toast--removing)"
        );
        const temporaryToasts = Array.from(visibleToasts).filter((t) => !t.dataset.persistent);
        const persistentToasts = Array.from(visibleToasts).filter((t) => t.dataset.persistent);

        let lastToast: HTMLElement | null = null;
        while (this._queue.length > 0) {
            const nextItem = this._queue[0];
            if (!nextItem) break;
            const isPersistent = nextItem.options.persistent;

            const canShow = isPersistent
                ? persistentToasts.length < this.maxPersistent
                : temporaryToasts.length < this.maxVisible;

            if (!canShow) {
                // An error may evict a visible toast to get through; anything else waits.
                if (!this._makeSpaceForPriority(nextItem, temporaryToasts)) {
                    break;
                }
            }

            const item = this._queue.shift()!;
            lastToast = this._showImmediate(item.message, item.options);

            if (isPersistent) {
                persistentToasts.push(lastToast);
            } else {
                temporaryToasts.push(lastToast);
            }
        }

        return lastToast;
    }

    /**
     * Renders one notification straight away — called by the queue once a slot is free.
     *
     * @param message - Text to display.
     * @param options - Fully resolved display options.
     * @returns The toast element appended to the container.
     */
    _showImmediate(message: string, options: INotificationQueueEntry["options"]): HTMLElement {
        const type = options.type;
        const duration = options.duration ?? this.durations[type];
        const persistent = !!options.persistent;
        const dismissible = options.dismissible !== false;

        const toast = createElement("div", {
            className: `gl-toast gl-toast--${type}`,
            attributes: {
                role: "alert",
                // Errors interrupt the screen reader; the rest waits its turn.
                "aria-live": type === "error" ? "assertive" : "polite",
            },
        });

        if (persistent) {
            toast.dataset.persistent = "true";
        }

        // `textContent` — never innerHTML: the message may carry untrusted text.
        const messageSpan = createElement("span", {
            className: "gl-toast__message",
            textContent: message,
        });
        toast.appendChild(messageSpan);

        if (dismissible) this._appendCloseButton(toast);

        this.container!.appendChild(toast);

        // Enter animation — double rAF so the browser paints the initial state first.
        if (this.config.animations) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toast.classList.add("gl-toast--visible");
                });
            });
        } else {
            toast.classList.add("gl-toast--visible");
        }

        // Schedule auto-dismissal (temporary toasts only).
        // Perf 6.2.6: a single timer — the manager when available, a bare setTimeout otherwise.
        if (!persistent) {
            if (this._timerManager) {
                toast.dataset.timerId = String(
                    this._timerManager.setTimeout(() => {
                        this._remove(toast, false);
                    }, duration)
                );
            } else {
                const autoRemove = setTimeout(() => {
                    this._remove(toast, false);
                }, duration);
                toast.dataset.timeoutId = String(autoRemove);
            }
        }

        return toast;
    }

    /**
     * Builds the toast's dismiss button and registers its click on the renderer's
     * OWN listener manager, recording the id on the toast so `_remove` can release it.
     *
     * ⚠️ Deliberately **not** `createElement({ onClick })`. That prop is not a plain
     * `addEventListener`: `dom-helpers` routes it to `GeoLeaf.Utils.events` whenever
     * that global exists — and in production it always does, pointing at the GLOBAL
     * manager. Every toast therefore left a permanent entry there, holding a strong
     * reference to a button detached seconds later, while `_eventManager` (created by
     * `init()` for precisely this, destroyed by `destroy()`) stayed empty.
     */
    _appendCloseButton(toast: HTMLElement): void {
        const closeBtn = createElement("button", {
            className: "gl-toast__close",
            attributes: {
                "aria-label": getLabel("aria.notification.close_label"),
                title: getLabel("aria.notification.close_title"),
            },
            textContent: getLabel("ui.notification.close_char"),
        });

        const onClose = () => {
            this._remove(toast, false);
        };
        const id = this._eventManager?.addEventListener(
            closeBtn,
            "click",
            onClose,
            false,
            "toast-close"
        );
        if (typeof id === "number") {
            toast.dataset.closeListenerId = String(id);
        } else {
            // No manager (pre-`init()` force-null, partial double): a direct listener
            // still dies with the button, which `_doRemove` detaches.
            closeBtn.addEventListener("click", onClose);
        }

        toast.appendChild(closeBtn);
    }

    /**
     * Drops the toast's close-button entry from the manager. Idempotent — the
     * dataset key is cleared first, so a second call is a no-op.
     */
    _releaseCloseListener(toast: HTMLElement): void {
        const raw = toast.dataset.closeListenerId;
        if (!raw) return;
        delete toast.dataset.closeListenerId;
        this._eventManager?.removeListener(Number.parseInt(raw, 10));
    }

    /**
     * Removes a notification: marks it, plays the exit animation, then detaches it and
     * re-processes the queue. A no-op on a toast already being removed.
     *
     * @param toast - The toast element to remove.
     * @param isReorganization - `true` when the toast is evicted to free a slot rather
     *   than dismissed on its own terms (plays a different animation).
     */
    _remove(toast: HTMLElement, isReorganization = false): void {
        if (!toast || toast.classList.contains("gl-toast--removing")) {
            return;
        }

        // Cancel the pending auto-dismiss when closed early.
        if (toast.dataset.timeoutId) {
            clearTimeout(Number.parseInt(toast.dataset.timeoutId, 10));
            delete toast.dataset.timeoutId;
        }
        if (toast.dataset.timerId && this._timerManager) {
            this._timerManager.clearTimeout(Number.parseInt(toast.dataset.timerId, 10));
            delete toast.dataset.timerId;
        }

        // Exit animation.
        toast.classList.add("gl-toast--removing");
        toast.classList.remove("gl-toast--visible");

        if (isReorganization && this.config.animations) {
            toast.classList.add("gl-toast--sliding-up");
        }

        const removeDelay = this.config.animations ? TOAST_EXIT_ANIMATION_MS : 0;
        // Perf 6.2.6: a single timer — the manager when available, a bare setTimeout otherwise.
        const _doRemove = () => {
            // Released with the DOM detach, not at destroy(): a session that shows
            // toasts for hours must not accumulate one entry per toast shown.
            this._releaseCloseListener(toast);
            if (toast.parentNode) {
                toast.remove();
            }
            this._processQueue();
        };
        if (this._timerManager) {
            this._timerManager.setTimeout(_doRemove, removeDelay);
        } else {
            setTimeout(_doRemove, removeDelay);
        }
    }

    /** Dismisses every visible toast and empties the pending queue. */
    clearAll() {
        if (!this.container) return;

        const toasts = this.container.querySelectorAll<HTMLElement>(".gl-toast");
        toasts.forEach((toast) => this._remove(toast, false));

        this._queue = [];
    }

    /**
     * Dismisses one specific notification by its DOM reference.
     *
     * @param toastEl - Toast element returned by `show` / `info` / `success` / etc.
     */
    dismiss(toastEl: HTMLElement): void {
        if (!toastEl) return;
        this._remove(toastEl, false);
    }

    /** Temporarily suspends rendering — queued items wait for {@link enable}. */
    disable() {
        this.config.enabled = false;
        Log.debug("[GeoLeaf Notifications] System disabled");
    }

    /** Resumes rendering and flushes anything that piled up while disabled. */
    enable() {
        this.config.enabled = true;
        Log.debug("[GeoLeaf Notifications] System enabled");
        this._processQueue();
    }

    /**
     * Tears the system down: releases every timer and listener, detaches all toasts,
     * empties the queue and marks the renderer disabled.
     *
     * A subsequent {@link init} brings it back enabled on its own (B.19) — the recreate
     * path needs no `enable()` of its own.
     */
    destroy() {
        if (this._timerManager) {
            this._timerManager.destroy();
            this._timerManager = null;
        }

        if (this._eventManager) {
            this._eventManager.destroy();
            this._eventManager = null;
        }

        if (this.container) {
            const toasts = this.container.querySelectorAll<HTMLElement>(".gl-toast");
            toasts.forEach((toast) => toast.remove());
        }

        this._queue = [];

        this.container = null;
        this.config.enabled = false;

        Log.info("[GeoLeaf Notifications] System destroyed and cleaned up");
    }

    /**
     * Snapshot of the current renderer state (visible counts, queue depth, budgets).
     *
     * Read-only and computed on call — it counts the toasts actually in the DOM rather than
     * a tally kept alongside, so it cannot drift from what the user sees.
     *
     * @returns The counts, the two budgets (`maxVisible`, `maxPersistent`) and the enabled /
     *   initialised flags.
     *
     * @example
     * ```js
     * const s = GeoLeaf.Notifications.getStatus();
     * // {
     * //   enabled: true,
     * //   initialized: true,
     * //   activeToasts: 1,
     * //   temporaryToasts: 1,
     * //   persistentToasts: 0,
     * //   queued: 0,
     * //   maxVisible: 3,
     * //   maxPersistent: 2,
     * // }
     * ```
     */
    getStatus(): NotifyStatus {
        const visibleToasts: HTMLElement[] = this.container
            ? Array.from(
                  this.container.querySelectorAll<HTMLElement>(".gl-toast:not(.gl-toast--removing)")
              )
            : [];
        const temporaryToasts = visibleToasts.filter((t) => !t.dataset.persistent);
        const persistentToasts = visibleToasts.filter((t) => t.dataset.persistent);

        return {
            enabled: this.config.enabled,
            initialized: !!this.container,
            activeToasts: visibleToasts.length,
            temporaryToasts: temporaryToasts.length,
            persistentToasts: persistentToasts.length,
            queued: this._queue.length,
            maxVisible: this.maxVisible,
            maxPersistent: this.maxPersistent,
            position: this.config.position,
        };
    }
}

// Singleton instance — the one the capability installs and the facade delegates to.
const _UINotifications = new NotificationSystem();

// ── ESM Export ──
export { NotificationSystem, _UINotifications };
