/*!
 * @geoleaf-plugins/print — Emprise selector
 *
 * Overlay-based rectangle selection over the MapLibre container.
 *   Phase 1 — draw  : mousedown → mousemove → mouseup
 *   Phase 2 — adjust: corner-handle drag, interior drag, OK / Enter / Escape
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { EmpriseBbox, PageOrientation } from "./types.js";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import { _getNativeMap } from "./internal.js";

const MIN_PX = 8;

/**
 * The area the user selected for printing, and the scale it implies.
 *
 * Returned once the selection is confirmed; a cancelled selection yields nothing rather than
 * an empty result, so the caller need not distinguish "cancelled" from "degenerate".
 */
export interface EmpriseResult {
    bbox: EmpriseBbox;
    scaleDenominator: number;
    orientation: PageOrientation;
    center: { lng: number; lat: number };
}

interface EmpriseSelector {
    activate(): void;
    deactivate(): void;
}

type Phase = "idle" | "drawing" | "drawn";
interface PxRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Creates an emprise (bounding-box) selector overlay on `container`.
 *
 * @param container   - The map DOM element (from `nativeMap.getContainer()`).
 * @param onValidate  - Called with the captured result when the user confirms.
 * @param onCancel    - Called when the user presses Escape or cancels.
 */
export function createEmpriseSelector(
    container: HTMLElement,
    onValidate: (result: EmpriseResult) => void,
    onCancel: () => void
): EmpriseSelector {
    // --- State ---
    let phase: Phase = "idle";
    let pxRect: PxRect = { x: 0, y: 0, w: 0, h: 0 };
    let startX = 0,
        startY = 0;
    let activeHandle: string | null = null;
    let moving = false;
    let moveOrigin: PxRect | null = null;
    let moveAnchorX = 0,
        moveAnchorY = 0;

    // --- DOM ---
    const overlay = _mkEl<HTMLDivElement>("div", "gl-emprise-overlay", container);
    // Structural styles inline — works even if CSS injection is delayed or absent.
    Object.assign(overlay.style, {
        position: "absolute",
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
        zIndex: "500",
        pointerEvents: "auto",
        userSelect: "none",
        display: "none", // shown by activate()
    });

    const hintEl = _mkEl<HTMLDivElement>("div", "gl-emprise-hint", overlay);
    const rectEl = _mkEl<HTMLDivElement>("div", "gl-emprise-rect", overlay);
    const handles = {
        tl: _mkEl<HTMLDivElement>("div", "gl-emprise-handle gl-emprise-handle--tl", overlay),
        tr: _mkEl<HTMLDivElement>("div", "gl-emprise-handle gl-emprise-handle--tr", overlay),
        bl: _mkEl<HTMLDivElement>("div", "gl-emprise-handle gl-emprise-handle--bl", overlay),
        br: _mkEl<HTMLDivElement>("div", "gl-emprise-handle gl-emprise-handle--br", overlay),
    };
    const okBtn = _mkEl<HTMLButtonElement>("button", "gl-emprise-ok", overlay);
    okBtn.type = "button";
    okBtn.textContent = "OK";

    // Hidden initially
    rectEl.style.display = "none";
    _setHandleDisplay("none");
    okBtn.style.display = "none";

    // --- Helpers ---
    function _disableDrag() {
        _getNativeMap()?.dragPan?.disable?.();
    }
    function _enableDrag() {
        _getNativeMap()?.dragPan?.enable?.();
    }
    function _cr() {
        return container.getBoundingClientRect();
    }
    function _clamp(v: number, lo: number, hi: number) {
        return Math.max(lo, Math.min(hi, v));
    }

    function _toLocal(cx: number, cy: number): { x: number; y: number } {
        const r = _cr();
        return { x: cx - r.left, y: cy - r.top };
    }

    function _setHandleDisplay(d: string) {
        for (const h of Object.values(handles)) h.style.display = d;
    }

    function _applyRect(r: PxRect) {
        const cr = _cr();
        const x = _clamp(r.x, 0, cr.width);
        const y = _clamp(r.y, 0, cr.height);
        const w = _clamp(r.w, 0, cr.width - x);
        const h = _clamp(r.h, 0, cr.height - y);
        pxRect = { x, y, w, h };

        Object.assign(rectEl.style, {
            left: x + "px",
            top: y + "px",
            width: w + "px",
            height: h + "px",
        });

        const pos: Record<string, [number, number]> = {
            tl: [x, y],
            tr: [x + w, y],
            bl: [x, y + h],
            br: [x + w, y + h],
        };
        for (const [id, [hx, hy]] of Object.entries(pos)) {
            Object.assign(handles[id as keyof typeof handles].style, {
                left: hx + "px",
                top: hy + "px",
            });
        }

        // OK button anchored just outside bottom-right corner
        Object.assign(okBtn.style, {
            left: x + w + 10 + "px",
            top: y + h + 10 + "px",
        });
    }

    // --- Validation ---
    function _validate() {
        const nm = _getNativeMap();
        if (!nm) {
            onCancel();
            return;
        }

        const { x, y, w, h } = pxRect;
        const tl = nm.unproject([x, y]);
        const br = nm.unproject([x + w, y + h]);
        const bbox: EmpriseBbox = {
            minLng: Math.min(tl.lng, br.lng),
            maxLng: Math.max(tl.lng, br.lng),
            minLat: Math.min(tl.lat, br.lat),
            maxLat: Math.max(tl.lat, br.lat),
        };
        const center = {
            lng: (bbox.minLng + bbox.maxLng) / 2,
            lat: (bbox.minLat + bbox.maxLat) / 2,
        };
        const orientation: PageOrientation = w >= h ? "landscape" : "portrait";
        const gl = getGeoLeaf();
        const scaleUtils = (
            gl?.Utils as { ScaleUtils?: { calculateMapScale?(map: unknown): number } } | undefined
        )?.ScaleUtils;
        const scaleDenominator: number = scaleUtils?.calculateMapScale?.(nm) ?? 0;

        onValidate({ bbox, scaleDenominator, orientation, center });
    }

    // --- Phase: draw ---
    function _beginDraw(cx: number, cy: number) {
        const p = _toLocal(cx, cy);
        startX = p.x;
        startY = p.y;
        phase = "drawing";
        _disableDrag();
        overlay.style.cursor = "crosshair";
        rectEl.style.display = "block";
        _setHandleDisplay("none");
        okBtn.style.display = "none";
        _applyRect({ x: startX, y: startY, w: 0, h: 0 });
    }

    function _progressDraw(cx: number, cy: number) {
        const p = _toLocal(cx, cy);
        _applyRect({
            x: Math.min(p.x, startX),
            y: Math.min(p.y, startY),
            w: Math.abs(p.x - startX),
            h: Math.abs(p.y - startY),
        });
    }

    function _endDraw() {
        if (pxRect.w < MIN_PX || pxRect.h < MIN_PX) {
            _reset();
            return;
        }
        phase = "drawn";
        overlay.style.cursor = "default";
        _setHandleDisplay("block");
        okBtn.style.display = "block";
    }

    function _reset() {
        phase = "idle";
        rectEl.style.display = "none";
        _setHandleDisplay("none");
        okBtn.style.display = "none";
        overlay.style.cursor = "crosshair";
        _enableDrag();
    }

    // --- Pointer-agnostic primitives -------------------------------------------------
    // Extracted from the three mouse handlers so the touch path feeds them
    // instead of copying their bodies — the resize block alone runs some
    // twenty lines, and `jscpd` (3% threshold) would see it go by. They take
    // raw `clientX/Y`, like `_beginDraw`/`_progressDraw` just above: the file's idiom.

    /** What a press triggers, deciding nothing about `preventDefault`. */
    type PressKind = "handle" | "ok" | "move" | "draw";

    function _pressAt(t: HTMLElement, cx: number, cy: number): PressKind {
        if (phase === "drawn") {
            for (const [id, h] of Object.entries(handles)) {
                if (h === t || h.contains(t)) {
                    activeHandle = id;
                    return "handle";
                }
            }
            // OK button — we let the click bubble up to it.
            if (t === okBtn || okBtn.contains(t)) return "ok";
            if (t === rectEl || rectEl.contains(t)) {
                moving = true;
                moveOrigin = { ...pxRect };
                moveAnchorX = cx;
                moveAnchorY = cy;
                return "move";
            }
            // Press outside the drawn rectangle → we start a new draw.
        }
        _beginDraw(cx, cy);
        return "draw";
    }

    function _dragTo(cx: number, cy: number) {
        if (phase === "drawing") {
            _progressDraw(cx, cy);
            return;
        }

        if (activeHandle) {
            const p = _toLocal(cx, cy);
            let { x, y, w, h } = pxRect;
            if (activeHandle === "tl") {
                w += x - p.x;
                h += y - p.y;
                x = p.x;
                y = p.y;
            } else if (activeHandle === "tr") {
                w = p.x - x;
                h += y - p.y;
                y = p.y;
            } else if (activeHandle === "bl") {
                w += x - p.x;
                x = p.x;
                h = p.y - y;
            } else {
                w = p.x - x;
                h = p.y - y;
            }
            if (w > MIN_PX && h > MIN_PX) _applyRect({ x, y, w, h });
            return;
        }

        if (moving && moveOrigin) {
            const dx = cx - moveAnchorX,
                dy = cy - moveAnchorY;
            _applyRect({
                x: moveOrigin.x + dx,
                y: moveOrigin.y + dy,
                w: moveOrigin.w,
                h: moveOrigin.h,
            });
        }
    }

    function _release() {
        if (phase === "drawing") _endDraw();
        activeHandle = null;
        moving = false;
        moveOrigin = null;
    }

    // --- Mouse events ---
    function _onMouseDown(e: MouseEvent) {
        if (e.button !== 0) return;
        const kind = _pressAt(e.target as HTMLElement, e.clientX, e.clientY);
        // ⚠️ Do NOT generalise `preventDefault` to all four cases: the `draw`
        // branch did not call it, and `ok` must above all not call it — the
        // click must reach the button. Uniformising here would change the
        // mouse behaviour, i.e. exactly what this extraction must guarantee not to do.
        if (kind === "handle" || kind === "move") e.preventDefault();
    }

    function _onMouseMove(e: MouseEvent) {
        _dragTo(e.clientX, e.clientY);
    }

    function _onMouseUp() {
        _release();
    }

    function _onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            onCancel();
            return;
        }
        if (e.key === "Enter" && phase === "drawn") {
            _validate();
        }
    }

    // --- Touch ---
    //
    // ⚠️ These three handlers only covered the DRAW: `phase !== "drawn"` at
    // start and `phase === "drawing"` on move made them INERT as soon as the
    // rectangle existed. By finger you could thus draw an extent and never
    // again resize or move it — only the OK button responded, through the
    // synthesised `click`. Those two conditions are what goes, not the logic,
    // which is now the shared primitives'.
    //
    // ⚠️ Single-finger guard kept: a second finger means pinch, and swallowing
    // it here would break the map's zoom to draw a rectangle.
    function _onTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!t) return;
        const kind = _pressAt(e.target as HTMLElement, t.clientX, t.clientY);
        // Same rule as the mouse: above all not on `ok`, whose synthesised
        // `click` must reach the button.
        if (kind === "handle" || kind === "move") e.preventDefault();
    }
    function _onTouchMove(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        // Unconditional, and deliberately before the state test: it is what
        // keeps the browser from scrolling during the gesture, whatever the phase.
        e.preventDefault();
        const t = e.touches[0];
        if (!t) return;
        _dragTo(t.clientX, t.clientY);
    }
    function _onTouchEnd() {
        _release();
    }

    okBtn.addEventListener("click", _validate);

    // --- Public interface ---
    function activate() {
        phase = "idle";
        rectEl.style.display = "none";
        _setHandleDisplay("none");
        okBtn.style.display = "none";

        const gl = getGeoLeaf();
        hintEl.textContent =
            gl?.I18n?.getLabel?.("print.emprise.hint") ?? "Click and drag to set the print area";

        overlay.style.display = "block";
        overlay.style.cursor = "crosshair";
        overlay.addEventListener("mousedown", _onMouseDown);
        document.addEventListener("mousemove", _onMouseMove);
        document.addEventListener("mouseup", _onMouseUp);
        document.addEventListener("keydown", _onKeyDown);
        // ⚠️ `{ passive: false }` on `touchstart`, and it is NOT a default
        // being restored: `touchstart` is only passive by default on `window`
        // / `document` / `document.body`. Here the listener is on `overlay`,
        // so `{ passive: true }` was a CHOICE — one that made the handle/move
        // branches' `preventDefault()` inoperative, with a Chrome warning on top.
        overlay.addEventListener("touchstart", _onTouchStart, { passive: false });
        overlay.addEventListener("touchmove", _onTouchMove, { passive: false });
        overlay.addEventListener("touchend", _onTouchEnd);
        // A claimed-away gesture (scroll takeover, OS interruption) never
        // emits `touchend`: without this, `activeHandle` and `moving` stayed
        // set indefinitely and the document `mousemove` kept resizing with no button down.
        overlay.addEventListener("touchcancel", _onTouchEnd);
        _disableDrag();
    }

    function deactivate() {
        phase = "idle";
        overlay.style.display = "none";
        overlay.removeEventListener("mousedown", _onMouseDown);
        document.removeEventListener("mousemove", _onMouseMove);
        document.removeEventListener("mouseup", _onMouseUp);
        document.removeEventListener("keydown", _onKeyDown);
        overlay.removeEventListener("touchstart", _onTouchStart);
        overlay.removeEventListener("touchmove", _onTouchMove);
        overlay.removeEventListener("touchend", _onTouchEnd);
        overlay.removeEventListener("touchcancel", _onTouchEnd);
        _enableDrag();
    }

    return { activate, deactivate };
}

// --- DOM factory helper ---
function _mkEl<T extends HTMLElement>(tag: string, cls: string, parent: HTMLElement): T {
    const el = document.createElement(tag) as T;
    el.className = cls;
    parent.appendChild(el);
    return el;
}
