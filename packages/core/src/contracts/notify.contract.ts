/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Notify primitive (public type boundary)
 *
 * Defines the lightweight notify primitive that buffers user-facing messages
 * until a renderer (e.g. the toast UI system) registers itself.
 * This contract is the foundation that allows the toast renderer to become
 * a standalone plugin in Phase 3 without breaking the `GeoLeaf.notify()` API.
 */

/**
 * Severity level of a user-facing notification.
 * Mirrors `NotifyType` from the toast-renderer capability types but kept separate
 * so this kernel primitive has zero dependency on the renderer.
 */
export type NotifyLevel = "info" | "success" | "warning" | "error";

/**
 * A renderer registered via `INotifyPrimitive.registerRenderer()`.
 * Called for each queued or live notification when a renderer becomes available.
 */
export type NotifyRenderer = (message: string, level: NotifyLevel) => void;

/**
 * Lightweight notify primitive interface.
 *
 * Responsibilities:
 * - Accept user-facing notification requests at any time (including before boot).
 * - Buffer messages that arrive before a renderer is registered.
 * - Forward messages to the active renderer once one is registered.
 * - Fall back to `console` when no renderer is registered.
 */
export interface INotifyPrimitive {
    /**
     * Emits a user-facing notification.
     * - If a renderer is registered: delegates immediately.
     * - If no renderer yet: buffers the message and logs a console fallback.
     *
     * @param message - Text to display.
     * @param level - Severity level (default: `"info"`).
     */
    notify(message: string, level?: NotifyLevel): void;

    /**
     * Registers the active renderer and flushes any buffered messages.
     * Calling this a second time replaces the previous renderer.
     *
     * @param renderer - Function that displays one notification.
     */
    registerRenderer(renderer: NotifyRenderer): void;

    /**
     * Detaches the active renderer, returning the primitive to its pre-boot behaviour
     * (buffer + console fallback). A renderer that is torn down MUST call this, or the
     * primitive keeps handing messages to a dead renderer that silently drops them —
     * and the console fallback never fires, because the primitive believes it still
     * has somewhere to render.
     *
     * @param renderer - The renderer to detach. Passing the one currently registered
     *   clears it; passing any other value is a no-op, so a late teardown cannot
     *   unregister a renderer that replaced it in the meantime. Omit the argument to
     *   clear unconditionally.
     */
    unregisterRenderer(renderer?: NotifyRenderer): void;

    /**
     * Drains the internal queue, forwarding each buffered message to the
     * currently registered renderer. No-op if no renderer is registered.
     */
    flush(): void;
}
