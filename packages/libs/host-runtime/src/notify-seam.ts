/*!
 * @geoleaf/host-runtime — notification renderer runtime seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S1 from the byte-identical copies carried by
 * `plugin-addpoi` and `plugin-storage`.
 * https://geoleaf.dev
 */

/**
 * Runtime seam for the toast renderer.
 *
 * S7 (capacités-extraction): the notification renderer moved out of the core into
 * the in-core `toast-renderer` capability. Plugins reach it off
 * `globalThis.GeoLeaf._UINotifications` at call time — never via a static
 * `@core/…/notifications` import (which also stopped plugins from bundling their own
 * duplicate copy of the renderer). When the capability is disabled/absent,
 * `getUINotifications()` returns `undefined`, so callers optional-chain and
 * notifications degrade to silent no-ops.
 *
 * ⚠️ Sharing ONE implementation of the seam does not dissolve it: the decoupling is
 * that the lookup happens at call time through the global namespace, and that is
 * preserved verbatim. No static import to `@geoleaf/core` is reintroduced.
 */

/** Rich renderer surface mounted on `GeoLeaf._UINotifications` by the capability. */
export interface UINotificationsSeam {
    show(
        message: string,
        typeOrOptions?: unknown,
        duration?: number
    ): HTMLElement | null | undefined;
    success(message: string, durationOrOptions?: number | object): HTMLElement | null | undefined;
    error(message: string, durationOrOptions?: number | object): HTMLElement | null | undefined;
    warning(message: string, durationOrOptions?: number | object): HTMLElement | null | undefined;
    info(message: string, durationOrOptions?: number | object): HTMLElement | null | undefined;
    dismiss(toastEl: HTMLElement): void;
    clearAll(): void;
}

/**
 * Resolves the live toast renderer off the GeoLeaf global, or `undefined` when the
 * `toast-renderer` capability is disabled/absent.
 */
export function getUINotifications(): UINotificationsSeam | undefined {
    return (globalThis as unknown as { GeoLeaf?: { _UINotifications?: UINotificationsSeam } })
        .GeoLeaf?._UINotifications;
}
