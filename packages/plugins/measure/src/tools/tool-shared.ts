/*!
 * @geoleaf-plugins/measure — Shared tool primitives
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S5. Three tools (distance, polygon, annotation) each carried
 * their own copy of the pointer-to-coordinate conversion and of the cursor guard.
 *
 * The coordinate helper was a true duplicate — byte-identical between distance and
 * polygon, differing only by a local variable name in annotation. The cursor guard was
 * NOT: polygon resolves its cursor dynamically (`pointer` while snapping to the first
 * vertex, `crosshair` otherwise), so it is parameterised by a resolver rather than
 * lifted verbatim. Same treatment as `wireTouchDrag` at S1.
 *
 * 📌 Since 14/08/2026 the guard also arms inside `createDragTool`, so all five drawing tools
 * carry it — not just the three click tools named above. Circle and rect were the only ones
 * without it, and they were the only ones that lost their crosshair for good.
 * https://geoleaf.dev
 */
import {
    clearPreview,
    disableDragPan,
    enableDragPan,
    setCursor,
    updateVertices,
} from "../draw-layers.js";
import type { MeasureMap, MeasureMapMouseEvent, MeasureMapTouchEvent } from "../types.js";

/**
 * Converts a DOM MouseEvent client position to a `[lng, lat]` pair.
 *
 * The tools listen in DOM capture on the map *container* — not through MapLibre's own
 * event pipeline — so they receive raw client coordinates and must offset them against
 * the canvas rect themselves.
 */
export function containerCoord(map: MeasureMap, e: MouseEvent): [number, number] {
    const rect = map.getCanvas().getBoundingClientRect();
    const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return [lngLat.lng, lngLat.lat];
}

/** Handle returned by {@link startCursorGuard}. */
export interface CursorGuard {
    /** Disconnects the observer. Idempotent. */
    stop(): void;
}

/**
 * Options controlling what {@link startCursorGuard} enforces, and when.
 *
 * Not exported: callers pass an object literal, so naming the type buys them nothing
 * and knip would (rightly) report it as an unused export.
 */
interface CursorGuardOptions {
    /** The guard only acts while this returns true — tools disarm before their teardown. */
    isActive: () => boolean;
    /** The cursor the canvas must show. Re-evaluated on every mutation. */
    cursor: () => string;
}

/**
 * Keeps the map canvas showing the tool's cursor.
 *
 * A MutationObserver on the style attribute puts back any cursor written over the tool's.
 *
 * ⚠️ **This doc said "MapLibre and the GeoLeaf feature-hover handlers both write
 * `canvas.style.cursor` directly", and the MapLibre half was false** — measured 14/08/2026,
 * `style.cursor` appears ZERO times in `maplibre-gl.mjs` and `maplibre-gl-shared.mjs`.
 * MapLibre drives the cursor entirely through CSS classes on `.maplibregl-canvas-container`,
 * and never touches an inline style. Only GeoLeaf's own handlers write here.
 *
 * Those handlers are now guarded by `__geoleafExclusiveMode` on all three core sites
 * (`feature-interaction`, `maplibre-poi-builders`, `maplibre-cluster-builders`), so this
 * observer is a second line of defence rather than the primary mechanism. It stays because
 * the flag is a convention no gate enforces on plugins — at least one editor handler
 * still ignores it.
 */
export function startCursorGuard(canvas: HTMLCanvasElement, opts: CursorGuardOptions): CursorGuard {
    const observer = new MutationObserver(() => {
        if (!opts.isActive()) return;
        const expected = opts.cursor();
        if (canvas.style.cursor !== expected) {
            canvas.style.cursor = expected;
        }
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ["style"] });

    return {
        stop(): void {
            observer.disconnect();
        },
    };
}

// ---------------------------------------------------------------------------
// Drag-to-draw lifecycle (circle, rect)
// ---------------------------------------------------------------------------

/**
 * What a drag tool does with the drag; everything else is lifecycle and is shared.
 *
 * @typeParam S - The tool's own drag state (circle: centre + radius; rect: two corners).
 */
interface DragToolSpec<S> {
    /** Builds the initial state from the press coordinate. */
    start(coord: [number, number]): S;
    /** Folds a pointer move into the state and refreshes the live preview. */
    move(state: S, coord: [number, number]): S;
    /**
     * Whether the finished drag is worth committing. This is the one genuinely
     * tool-specific guard: circle measures a minimum radius in metres, rect a minimum
     * drag in screen pixels — hence the map handle.
     */
    isValid(state: S, map: MeasureMap): boolean;
    /** Commits the drag into a feature. Only reached when {@link isValid} passed. */
    commit(state: S): void;
}

/** A drag tool's arm/disarm pair, as consumed by public-api. */
interface DragTool {
    activate(map: MeasureMap): void;
    deactivate(): void;
}

/**
 * Builds a press-drag-release drawing tool.
 *
 * Consolidated at PLUGINS S5: circle and rect had ~60 lines of identical lifecycle each
 * — disable dragPan on press, follow `mousemove` on the map, listen for a one-shot
 * `mouseup` on the document, flag exclusive mode, swap the cursor, and undo all of it on
 * disarm. Only the state they accumulate and their validity threshold ever differed.
 *
 * The `mouseup` listener is bound to `document`, not the map: releasing outside the
 * canvas must still end the drag. Same reason for `touchend` / `touchcancel`.
 *
 * ## §TOUCH — why the mouse path could not serve a finger (14/08/2026)
 *
 * 🛑 Two stacked locks, and one would have sufficed: a finger drag emits NO
 * compatibility mouse event, and the `originalEvent?.button !== 0` guard
 * rejected any buttonless event anyway (`undefined !== 0` is true). Circle
 * and rectangle were thus unusable on a phone — and the type already said so,
 * without being read that way.
 *
 * ⚠️ **`preventDefault()` on the `MapTouchEvent` is NOT the lever**, contrary
 * to what its MapLibre-side TSDoc suggests: it only covers the `touchstart`
 * pass and stops holding at the first `touchmove`. `disableDragPan()` — which
 * the mouse path already called — is what holds for the gesture's whole
 * duration. The `touchmove`'s `preventDefault()` only serves to block the
 * BROWSER's scrolling (MapLibre's DOM listener is `{ passive: false }`, so it
 * is honoured rather than reported).
 *
 * ⚠️ **One finger only.** A second means pinch, which must keep reaching
 * MapLibre's zoom/rotation handler: swallowing it here would break the map to
 * draw a circle.
 *
 * Exercised in a real browser by `e2e/33-measure-drag.touch.spec.js`
 * (`chromium-touch` project), seen red before the fix.
 */
export function createDragTool<S>(spec: DragToolSpec<S>): DragTool {
    let map: MeasureMap | null = null;
    let active = false;
    let state: S | null = null;
    let cursorGuard: CursorGuard | null = null;

    /**
     * Starts a drag at `coord`, whatever the input device.
     *
     * The anchor vertex is what answers "I cannot see where I pressed": neither tool draws
     * anything until the gesture is already large — the circle needs a metre of radius
     * (`tool-circle.ts`), the rect two distinct points (`updatePreview` is a no-op below
     * two) — so without it the press produced no feedback at all. It was missing under the
     * mouse too; touch only made it unbearable.
     */
    function begin(coord: [number, number]): void {
        state = spec.start(coord);
        updateVertices([coord]);
        disableDragPan();
    }

    /** Folds a move into the state and keeps the anchor painted under the moving finger. */
    function extend(coord: [number, number]): void {
        if (state === null) return;
        state = spec.move(state, coord);
    }

    /**
     * Ends the gesture. Shared by the mouse and touch paths so they cannot drift apart —
     * and so the body is not duplicated, which `jscpd` would rightly flag.
     *
     * @param commit Whether a valid gesture should produce a feature. `false` is the
     *   abandon path: a `touchcancel` means the gesture was TAKEN AWAY (scroll claim,
     *   incoming call), not completed, so it must undo the drag state without measuring
     *   anything. Committing there would record a measure the user never released.
     */
    function finish(commit: boolean): void {
        map?.off("mousemove", onMouseMove);
        map?.off("touchmove", onTouchMove);
        enableDragPan();

        const finished = state;
        state = null;
        // ⚠️ `clearPreview()` only empties the PREVIEW source, never the vertices one, so
        // the anchor has to be cleared explicitly or it survives the gesture that drew it.
        updateVertices([]);

        if (!commit || finished === null || !map || !spec.isValid(finished, map)) {
            clearPreview();
            return;
        }
        spec.commit(finished);
    }

    function onMouseDown(e: MeasureMapMouseEvent): void {
        // Left button only — a right-click drag pans, it does not draw.
        if (!active || e.originalEvent?.button !== 0) return;
        begin([e.lngLat.lng, e.lngLat.lat]);
        map?.on("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp, { once: true });
    }

    function onMouseMove(e: MeasureMapMouseEvent): void {
        extend([e.lngLat.lng, e.lngLat.lat]);
    }

    function onMouseUp(): void {
        finish(true);
    }

    /** Touch counterpart of {@link onMouseDown} — single finger only (see §TOUCH above). */
    function onTouchStart(e: MeasureMapTouchEvent): void {
        if (!active) return;
        if ((e.points?.length ?? 1) !== 1) return;
        begin([e.lngLat.lng, e.lngLat.lat]);
        map?.on("touchmove", onTouchMove);
        document.addEventListener("touchend", onTouchEnd, { once: true });
        document.addEventListener("touchcancel", onTouchCancel, { once: true });
    }

    function onTouchMove(e: MeasureMapTouchEvent): void {
        if (state === null) return;
        // Blocks the browser's own scroll only — map panning is held by `disableDragPan()`.
        e.originalEvent?.preventDefault?.();
        extend([e.lngLat.lng, e.lngLat.lat]);
    }

    /** Both endings share their teardown; only the commit decision differs. */
    function _endTouch(commit: boolean): void {
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", onTouchCancel);
        finish(commit);
    }

    const onTouchEnd = (): void => _endTouch(true);
    const onTouchCancel = (): void => _endTouch(false);

    return {
        activate(m: MeasureMap): void {
            if (active) return;
            map = m;
            active = true;
            state = null;
            m.__geoleafExclusiveMode = true;
            setCursor("crosshair");
            // Same guard the click tools have had since S5, and whose absence here was the
            // whole difference: circle and rect lost their crosshair on the first POI
            // mouseleave and never got it back, while distance and polygon recovered.
            cursorGuard = startCursorGuard(m.getCanvas(), {
                isActive: () => active,
                cursor: () => "crosshair",
            });
            m.on("mousedown", onMouseDown);
            m.on("touchstart", onTouchStart);
        },

        deactivate(): void {
            if (!active) return;
            active = false;
            cursorGuard?.stop();
            cursorGuard = null;
            if (map) {
                map.__geoleafExclusiveMode = false;
                map.off("mousedown", onMouseDown);
                map.off("mousemove", onMouseMove);
                map.off("touchstart", onTouchStart);
                map.off("touchmove", onTouchMove);
            }
            document.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchcancel", onTouchCancel);
            enableDragPan();
            clearPreview();
            updateVertices([]);
            setCursor("grab");
            state = null;
            map = null;
        },
    };
}
