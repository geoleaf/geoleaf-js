/*!
 * @geoleaf-plugins/measure — Custom tool envelope
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description Arms a tool registered through `registerMeasureType()`, wrapping its callbacks
 * in the same envelope the six built-in tools carry.
 *
 * ⚠️ **Why the envelope belongs here and not in the integrator's callback.** Three
 * invariants make a tool behave like a GeoLeaf tool, and none of the three is reachable from
 * `onActivate(map: unknown)`:
 *
 *   1. `map.__geoleafExclusiveMode` — the flag the core's hover handlers read
 *      (`feature-interaction`, `maplibre-{poi,cluster}-builders`) to keep their hands off the
 *      cursor and off feature popups. A third party would not know to set it.
 *   2. `setCursor(...)` — `draw-layers.ts`, not exported on `GeoLeaf.Measure`.
 *   3. `startCursorGuard(...)` — `tool-shared.ts`, not exported either. This is precisely what
 *      the `cursor` field of `MeasureTypeDef` was always meant to drive.
 *
 * So a custom tool declares its cursor and its behaviour; the plugin makes it a peer of the
 * built-ins. Everything else — map listeners, drawing state, feature production — stays the
 * integrator's, exactly as `MeasureTypeDef` implies.
 *
 * @version 1.0.0
 */
import { setCursor } from "../draw-layers.js";
import { startCursorGuard, type CursorGuard } from "./tool-shared.js";
import type { MeasureMap, MeasureTypeDef } from "../types.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _map: MeasureMap | null = null;
let _def: MeasureTypeDef | null = null;
let _activeId: string | null = null;
let _cursorGuard: CursorGuard | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the id of the armed custom tool, or `null` when none is. */
export function getActiveCustomId(): string | null {
    return _activeId;
}

/**
 * Arms a custom tool.
 *
 * Re-arming a different custom tool disarms the previous one first, so the pair stays balanced
 * however the caller switches tools.
 *
 * @param map - The native map, as captured by the plugin.
 * @param id - The identifier the tool was registered under.
 * @param def - Its definition. Every field is optional.
 */
export function activateCustom(map: MeasureMap, id: string, def: MeasureTypeDef): void {
    if (_activeId === id) return;
    if (_activeId !== null) deactivateCustom();

    _map = map;
    _def = def;
    _activeId = id;

    const cursor = def.cursor ?? "crosshair";
    map.__geoleafExclusiveMode = true;
    setCursor(cursor);
    _cursorGuard = startCursorGuard(map.getCanvas(), {
        isActive: () => _activeId === id,
        cursor: () => cursor,
    });

    // Last, so the callback observes a fully armed map — and so a throw from third-party code
    // cannot leave the envelope half-applied.
    def.onActivate?.(map);
}

/**
 * Disarms the custom tool currently armed, if any. Safe to call when none is.
 *
 * `onDeactivate` runs BEFORE the envelope comes down, mirroring `onActivate` running after it
 * goes up: the callback always sees the same armed state on both edges.
 */
export function deactivateCustom(): void {
    if (_activeId === null) return;

    const def = _def;
    _activeId = null; // first: stops the cursor guard from fighting the restore below
    _def = null;

    def?.onDeactivate?.();

    _cursorGuard?.stop();
    _cursorGuard = null;
    if (_map) {
        _map.__geoleafExclusiveMode = false;
        setCursor("grab");
    }
    _map = null;
}
