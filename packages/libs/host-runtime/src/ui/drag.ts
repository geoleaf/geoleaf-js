/*!
 * @geoleaf/host-runtime — floating-menu drag handler (mouse)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S1 from `plugin-editor` and `plugin-measure`, which carried
 * identical implementations differing only in the CSS custom-property prefix
 * (`--gl-editor-*` vs `--gl-measure-*`) — now a parameter.
 *
 * The touch counterpart lives in `./touch-drag.js` and shares the geometry helpers
 * below. They are split because touch events are not exercisable outside a real
 * browser, so only the touch half carries a coverage exclusion.
 * https://geoleaf.dev
 */

/**
 * Reads the current offset from the root's inline CSS custom properties.
 * Defaults to 10px on both axes, matching the pre-consolidation behaviour.
 *
 * ⚠️ An EDGE-ANCHORED root carries `auto` here. The editor pill can be
 * anchored right or bottom (`--gl-editor-left: auto`), and `"auto"` is truthy, so the
 * `|| "10"` fallback never fired and `parseFloat("auto")` returned **NaN** — every
 * subsequent offset became `NaNpx` and the drag did nothing at all.
 *
 * Falling back to a flat 10 would be wrong too, and visibly so: a right-anchored pill
 * sitting at x≈1216 would JUMP to x=10 the instant the user grabbed it. The truthful
 * start of a drag is where the element actually IS, so the fallback measures it —
 * relative to the offset parent, since that is the frame the written value lives in.
 *
 * @internal Shared with `./touch-drag.js`; not part of the package surface.
 */
export function readDragOffset(
    root: HTMLElement,
    varPrefix: string
): { left: number; top: number } {
    const read = (edge: "left" | "top"): number => {
        const declared = parseFloat(root.style.getPropertyValue(`--gl-${varPrefix}-${edge}`));
        if (Number.isFinite(declared)) return declared;
        // `auto`, empty, or unparseable → measure. `getBoundingClientRect` is viewport
        // relative, which is the frame a `position: fixed` root is placed in.
        const measured = root.getBoundingClientRect()[edge];
        return Number.isFinite(measured) && measured !== 0 ? measured : 10;
    };
    return { left: read("left"), top: read("top") };
}

/**
 * Writes a new offset, clamped to the container's bounds.
 * Shared by the mouse and touch paths so they cannot drift apart.
 *
 * @internal Shared with `./touch-drag.js`; not part of the package surface.
 */
export function applyDragOffset(
    root: HTMLElement,
    container: HTMLElement,
    varPrefix: string,
    startLeft: number,
    startTop: number,
    deltaX: number,
    deltaY: number
): void {
    const rect = container.getBoundingClientRect();
    const nl = Math.max(0, Math.min(startLeft + deltaX, rect.width - root.offsetWidth));
    const nt = Math.max(0, Math.min(startTop + deltaY, rect.height - root.offsetHeight));
    root.style.setProperty(`--gl-${varPrefix}-left`, `${nl}px`);
    root.style.setProperty(`--gl-${varPrefix}-top`, `${nt}px`);
}

/**
 * Attaches a mouse-drag handler to the given handle element (RAF-throttled, bounded
 * to the container). Left button only.
 *
 * @param handle - Element that initiates the drag (the grip).
 * @param container - Bounding element the root is clamped within (the map container).
 * @param getRoot - Resolved at event time, so a rebuilt menu is picked up.
 * @param varPrefix - CSS custom-property prefix, e.g. `"editor"` → `--gl-editor-left`.
 */
export function wireDrag(
    handle: HTMLElement,
    container: HTMLElement,
    getRoot: () => HTMLElement | null,
    varPrefix: string
): void {
    handle.addEventListener("mousedown", (e: MouseEvent) => {
        const root = getRoot();
        if (e.button !== 0 || !root) return;
        e.preventDefault();
        const sx = e.clientX,
            sy = e.clientY;
        const { left: sl, top: st } = readDragOffset(root, varPrefix);
        let raf = 0;

        const onMove = (ev: MouseEvent): void => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const r = getRoot();
                if (!r) return;
                applyDragOffset(r, container, varPrefix, sl, st, ev.clientX - sx, ev.clientY - sy);
            });
        };
        const onUp = (): void => {
            cancelAnimationFrame(raf);
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}
