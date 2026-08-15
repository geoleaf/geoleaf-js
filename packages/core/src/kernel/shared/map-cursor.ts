/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Map cursor ownership for tools that take over map clicks.
 *
 * Single home for two things that had none, and whose absence produced the same bug twice:
 *
 * 1. **WHICH element carries the cursor.** MapLibre v6 never writes `style.cursor` from
 *    JavaScript — verified, zero occurrences in `maplibre-gl.mjs`. It drives the cursor
 *    entirely through CSS classes on `.maplibregl-canvas-container`, the element BETWEEN
 *    the root container and the canvas:
 *
 *    ```css
 *    .maplibregl-canvas-container.maplibregl-interactive          { cursor: grab }
 *    .maplibregl-canvas-container.maplibregl-interactive:active   { cursor: grabbing }
 *    ```
 *
 *    An explicit rule on that descendant beats anything inherited from the root, so
 *    writing `getContainer().style.cursor` lands in the DOM and is never painted. The
 *    proximity capability did exactly that and its crosshair was invisible from the day it
 *    was written — measured in a real browser on 14/08/2026: computed cursor `crosshair`
 *    on `.maplibregl-map`, `grab` on the canvas the pointer actually sits on.
 *
 * 2. **The `__geoleafExclusiveMode` flag.** It is the contract by which an armed tool tells
 *    the core's hover handlers to keep their hands off the cursor (and off feature popups).
 *    It was set by plugins and read in three core places, while being declared nowhere —
 *    so two of those three readers simply forgot it, and the cursor of a drag tool was
 *    wiped on the first POI mouseleave.
 *
 * The flag lives on the NATIVE map, because that is the object the core's hover handlers
 * hold. {@link armToolCursor} therefore unwraps the adapter before setting it.
 *
 * @version 1.0.0
 */

/**
 * Structural view of a map able to expose its cursor-painting element.
 *
 * Deliberately loose so both an `IMapAdapter` and a raw MapLibre `Map` satisfy it: the
 * proximity capability holds the former, the plugins the latter.
 *
 * Not exported: callers pass whatever map they already hold and TypeScript matches it
 * structurally, so naming the type buys them nothing — and `check-orphan-exports` would
 * (rightly) report it as an export nobody consumes. Same treatment as `ExclusiveModeHost`.
 */
interface CursorCapableMap {
    /** The drawing canvas — the element that actually paints the pointer. */
    getCanvas?(): HTMLCanvasElement;
    /** Root container. Fallback only: see the module header for why it is not equivalent. */
    getContainer(): HTMLElement;
    /** Escape hatch to the engine map, where {@link EXCLUSIVE_MODE_KEY} is read. */
    getNativeMap?(): unknown;
}

/**
 * Anything carrying the "a tool owns the interactions" flag.
 *
 * ⚠️ The property is written LITERALLY, never through a `const KEY = "…"` indirection.
 * A named constant reads tidier and turns every write into a dynamic-key write, which
 * `check-dynamic-key-writes` rejects as a prototype-pollution sink — rightly, since the
 * analyser cannot tell a frozen constant from a user-controlled string. It caught this
 * exact shape on the first run.
 */
interface ExclusiveModeHost {
    __geoleafExclusiveMode?: boolean;
}

/**
 * Remembers the cursor each map showed before a tool armed, so disarming restores it
 * rather than guessing `""`. Keyed weakly: a disposed map must not be retained here.
 */
const _originalCursor = new WeakMap<object, string>();

/**
 * Resolves the element whose `style.cursor` is actually painted.
 *
 * Falls back to the root container when the engine exposes no canvas — which happens with
 * test doubles, `getCanvas` being optional on the contract. The fallback is not equivalent
 * (see the module header); it exists so a mock cannot throw, not because it works.
 *
 * Internal: the arm/disarm pair is the supported way in, so that the saved-cursor
 * bookkeeping cannot be bypassed by a caller resolving the element itself.
 */
function cursorTarget(map: CursorCapableMap): HTMLElement {
    return map.getCanvas?.() ?? map.getContainer();
}

/** Unwraps an adapter to the engine map that carries the exclusive-mode flag. */
function _flagHost(map: CursorCapableMap): ExclusiveModeHost {
    return (map.getNativeMap?.() ?? map) as ExclusiveModeHost;
}

/**
 * Reports whether a tool currently owns the map interactions.
 *
 * Hover handlers that write the cursor MUST consult this before touching it, otherwise
 * they wipe an armed tool's crosshair the first time the pointer leaves a feature.
 *
 * @param map - The native engine map, or an adapter wrapping one.
 */
export function isExclusiveMode(map: CursorCapableMap | ExclusiveModeHost): boolean {
    const host =
        typeof (map as CursorCapableMap).getContainer === "function"
            ? _flagHost(map as CursorCapableMap)
            : (map as ExclusiveModeHost);
    return host.__geoleafExclusiveMode === true;
}

/**
 * Arms a tool cursor: paints `cursor` on the canvas and claims exclusive mode.
 *
 * Idempotent on the saved value — arming twice does not lose the original cursor.
 *
 * @param map - The map the tool operates on (adapter or native).
 * @param cursor - CSS cursor keyword, e.g. `"crosshair"`.
 */
export function armToolCursor(map: CursorCapableMap, cursor: string): void {
    const target = cursorTarget(map);
    if (!_originalCursor.has(target)) {
        _originalCursor.set(target, target.style.cursor || "");
    }
    target.style.cursor = cursor;
    _flagHost(map).__geoleafExclusiveMode = true;
}

/**
 * Disarms a tool cursor: restores what the map showed before {@link armToolCursor} and
 * releases exclusive mode.
 *
 * Safe to call when nothing was armed — it then clears the inline cursor, letting
 * MapLibre's own `grab` rule apply again.
 *
 * @param map - The same map that was passed to {@link armToolCursor}.
 */
export function disarmToolCursor(map: CursorCapableMap): void {
    const target = cursorTarget(map);
    target.style.cursor = _originalCursor.get(target) ?? "";
    _originalCursor.delete(target);
    _flagHost(map).__geoleafExclusiveMode = false;
}
