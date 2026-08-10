/*!
 * @geoleaf/host-runtime — floating-menu drag handler (touch, best-effort mobile)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S1 from `plugin-editor` and `plugin-measure`, which carried
 * identical implementations differing only in the CSS custom-property prefix.
 *
 * Excluded from coverage: touch events are not exercised in happy-dom. The exclusion is
 * carried over verbatim from both source packages, which each stated the same motive
 * ("S3 touch/tooltip UI: DOM event-driven, requires real browser interaction"). The
 * geometry it relies on is NOT excluded — it lives in `./drag.js` and is covered there.
 * https://geoleaf.dev
 */

import { applyDragOffset, readDragOffset } from "./drag.js";

/**
 * Attaches a touch-drag handler to the given handle element.
 * Repositions the root element within the container, same clamping as `wireDrag`.
 *
 * @param handle - Element that initiates the drag (the grip).
 * @param container - Bounding element the root is clamped within (the map container).
 * @param getRoot - Resolved at event time, so a rebuilt menu is picked up.
 * @param varPrefix - CSS custom-property prefix, e.g. `"measure"` → `--gl-measure-left`.
 */
export function wireTouchDrag(
    handle: HTMLElement,
    container: HTMLElement,
    getRoot: () => HTMLElement | null,
    varPrefix: string
): void {
    const onTouchStart = (e: TouchEvent): void => {
        const t0 = e.touches[0];
        const root = getRoot();
        if (!t0 || !root) return;
        const sx = t0.clientX,
            sy = t0.clientY;
        const { left: sl, top: st } = readDragOffset(root, varPrefix);
        let raf = 0;

        const onMove = (ev: TouchEvent): void => {
            const t = ev.touches[0];
            const r2 = getRoot();
            if (!t || !r2) return;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const r3 = getRoot();
                if (!r3) return;
                applyDragOffset(r3, container, varPrefix, sl, st, t.clientX - sx, t.clientY - sy);
            });
        };
        const onEnd = (): void => {
            cancelAnimationFrame(raf);
            handle.removeEventListener("touchmove", onMove);
            handle.removeEventListener("touchend", onEnd);
        };
        handle.addEventListener("touchmove", onMove, { passive: true });
        handle.addEventListener("touchend", onEnd);
    };
    handle.addEventListener("touchstart", onTouchStart, { passive: true });
}
