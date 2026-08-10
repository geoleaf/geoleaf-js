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
 * https://geoleaf.dev
 */
import { clearPreview, disableDragPan, enableDragPan, setCursor } from "../draw-layers.js";
import type { MeasureMap, MeasureMapMouseEvent } from "../types.js";

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
 * MapLibre and the GeoLeaf feature-hover handlers both write `canvas.style.cursor`
 * directly, which would otherwise clobber a tool's crosshair as soon as the pointer
 * crosses a feature layer. A MutationObserver on the style attribute puts it back.
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
 * canvas must still end the drag.
 */
export function createDragTool<S>(spec: DragToolSpec<S>): DragTool {
    let map: MeasureMap | null = null;
    let active = false;
    let state: S | null = null;

    function onMouseDown(e: MeasureMapMouseEvent): void {
        // Left button only — a right-click drag pans, it does not draw.
        if (!active || e.originalEvent?.button !== 0) return;
        state = spec.start([e.lngLat.lng, e.lngLat.lat]);
        disableDragPan();
        map?.on("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp, { once: true });
    }

    function onMouseMove(e: MeasureMapMouseEvent): void {
        if (state === null) return;
        state = spec.move(state, [e.lngLat.lng, e.lngLat.lat]);
    }

    function onMouseUp(): void {
        map?.off("mousemove", onMouseMove);
        enableDragPan();

        const finished = state;
        state = null;

        if (finished === null || !map || !spec.isValid(finished, map)) {
            clearPreview();
            return;
        }
        spec.commit(finished);
    }

    return {
        activate(m: MeasureMap): void {
            if (active) return;
            map = m;
            active = true;
            state = null;
            m.__geoleafExclusiveMode = true;
            setCursor("crosshair");
            m.on("mousedown", onMouseDown);
        },

        deactivate(): void {
            if (!active) return;
            active = false;
            if (map) {
                map.__geoleafExclusiveMode = false;
                map.off("mousedown", onMouseDown);
                map.off("mousemove", onMouseMove);
            }
            document.removeEventListener("mouseup", onMouseUp);
            enableDragPan();
            clearPreview();
            setCursor("grab");
            state = null;
            map = null;
        },
    };
}
