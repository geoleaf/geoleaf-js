/*!
 * @geoleaf-plugins/editor — Programmatic point placement ("tap the map to place")
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * One-shot point placement driven by a caller: arm, let the user tap once, hand back the
 * chosen position, disarm. Absorbed from `addpoi/src/poi-placement.ts` at task 5.1-a.
 *
 * ⚠️ THIS IS NOT A DUPLICATE OF THE TERRA DRAW POINT MODE, and the roadmap's R6 rests on the
 * difference. Terra Draw's point mode is a DRAWING TOOL: the user arms it from the editor
 * menu and it emits `finish` into the drawing pipeline. This module is a PROGRAMMATIC
 * one-shot: a caller asks for one position, the user taps once, a callback fires, and the
 * mode disarms itself.
 *
 * ⚠️ **This paragraph described a seam that no longer exists, and it said so AT THE PRESENT
 * TENSE until 05/08/2026** — it claimed the core's `mobile-toolbar.ts` called
 * `POIAddFormContract.activatePlacementMode(map, cb)`, and that "TODAY THAT SEAM STILL
 * RESOLVES `GeoLeaf.AddPOI`". Both were true when written and false from the moment task
 * 5.1-f landed. Worse, this file's declarations ship in `dist/types/`, so the false clause
 * was on its way to npm.
 *
 * What is true now: task 5.1-f did **not** repoint the seam, it **deleted** it. `editor`
 * being lazy where `addpoi` was eager, the core's boot-time probe could not survive a
 * repoint (R20), so the mobile "add a POI" button became a LAZY SLOT declared in
 * `apps/geoleaf-app/init.js`, and the 180 LOC of the core's POI add-form seam were removed
 * outright (decision D9) — the file is gone, so it is deliberately not cited by path here:
 * TSDOC-PATHS rejects a citation to a path that no longer resolves, even one made to say it
 * was deleted. This module is reached through `GeoLeaf.Editor.PlacementMode`
 * (`./placement-api.js`), which is now the only surface — there is no `GeoLeaf.AddPOI`.
 *
 * Two behaviours Terra Draw does not provide, and which are the actual content of 5.1-a:
 *   1. the snap-to-existing-feature guard (`./poi-snap.js`), in METRES — see its header;
 *   2. a temporary DRAGGABLE marker, so the surveyor can correct the tap before confirming.
 *
 * ⚠️ The plugin stays MapLibre-agnostic (no value import of `maplibre-gl`, which is a peer
 * and `external` in `rollup.config.mjs`). `Marker` is read off `globalThis` — same seam as
 * `addpoi/poi-placement.ts` and `print/offscreen-render.ts`.
 */
import { Log, getUINotifications, chooseDialog } from "@geoleaf/host-runtime";
import { _getLabel, _getNativeMap } from "../internal.js";
import { findNearbyFeature, type SnappedFeature } from "./poi-snap.js";
import type { EditorMap, EditorMapMouseEvent } from "../types.js";

/** The marker surface this module uses — structural, so no `maplibre-gl` type import. */
interface PlacementMarker {
    setLngLat(coords: [number, number]): PlacementMarker;
    addTo(map: unknown): PlacementMarker;
    on(event: string, handler: () => void): void;
    getLngLat(): { lat: number; lng: number };
    remove(): void;
}

/** The MapLibre surface this module uses — the `Marker` constructor, nothing else. */
interface MapLibreLike {
    Marker: new (opts: { element?: HTMLElement; draggable?: boolean }) => PlacementMarker;
}

/**
 * MapLibre read off `globalThis`, as an ACCESSOR and never a module constant.
 *
 * ⚠️ A `const` evaluated at import time would capture the value BEFORE MapLibre is placed:
 * the plugin loads as `<script type="module">` with no ordering guarantee, and the measured
 * result was `undefined` at `new Marker(...)`. Same trap as the connector's `healthCheck`.
 *
 * ⚠️ `Reflect.get` rather than `globalThis as unknown as {…}`: since `@geoleaf/core` publishes
 * its ambient namespace, `globalThis` carries a known shape and a direct cast is
 * refused (TS2352), which pushes toward a DOUBLE cast through `unknown` — and NNA-01 refuses
 * to let one be born. `Reflect.get` returns `any`, so one assertion is enough.
 */
const _maplibregl = (): MapLibreLike | undefined =>
    Reflect.get(globalThis, "maplibregl") as MapLibreLike | undefined;

/** Handed back to the caller once the user has picked a position. */
export interface PlacementResult {
    /**
     * Chosen coordinates.
     *
     * 🛑 THE TAP COORDINATE IS KEPT ON `"create"`, and that is the fix. It used to be
     * OVERWRITTEN by the neighbour's whenever one sat within the snap radius, and the flow
     * then opened a CREATION form on it — so the duplicate guard manufactured duplicates,
     * perfectly superimposed and therefore indistinguishable downstream.
     */
    latlng: { lat: number; lng: number };
    /** The existing feature found within the snap radius, or `null` for a fresh position. */
    snapped: SnappedFeature | null;
    /**
     * What the user decided when the duplicate guard found a neighbour. Always `"create"`
     * when it found none — the question is only asked when there is something to ask about.
     *
     * ⚠️ Spelled INLINE rather than behind an exported alias: the alias would be an export
     * with no consumer of its own (`check-orphan-exports`), and de-exporting it is not an
     * option — `tsc` refuses to emit a declaration whose member type is not exported. Naming
     * it below through `PlacementResult["intent"]` costs nothing and adds no surface.
     */
    intent: "create" | "edit" | "abandon";
}

/** Options accepted by {@link PlacementMode.activate}. */
export interface PlacementOptions {
    /** Disable map panning while placing, so a drag cannot be read as a tap. */
    disableDrag?: boolean;
    /** Snap radius in metres. `<= 0` disables the duplicate guard. Default `50`. */
    snapMeters?: number;
}

/** Default snap radius in metres, applied when the caller passes none. */
export const DEFAULT_SNAP_METERS = 50;

/** SVG namespace — `createElement` would build an HTML element that never paints. */
const _SVG_NS = "http://www.w3.org/2000/svg";

/** Path data of the map-pin glyph. */
const _PIN_PATH =
    "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 " +
    "0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

/**
 * Builds the map-pin glyph through the DOM rather than `innerHTML`.
 *
 * ⚠️ `addpoi` assigned an interpolated HTML string here and had to justify it with a `SAFE:`
 * comment; PC-07 flags the pattern whatever the justification. Building the nodes removes
 * the question instead of arguing it — and the two visual states are carried by CSS through
 * `currentColor`, so no value ever reaches the markup.
 *
 * @returns the wrapper element holding the pin.
 */
function _buildPin(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gl-editor-placement-marker__pin";
    const svg = document.createElementNS(_SVG_NS, "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(_SVG_NS, "path");
    path.setAttribute("d", _PIN_PATH);
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "1");
    svg.appendChild(path);
    wrap.appendChild(svg);
    return wrap;
}

interface PlacementState {
    active: boolean;
    map: EditorMap | null;
    clickHandler: ((e: EditorMapMouseEvent) => void) | null;
    marker: PlacementMarker | null;
    callback: ((result: PlacementResult) => void) | null;
    cursorOriginal: string;
    dragWasDisabled: boolean;
    snapMeters: number;
}

const _state: PlacementState = {
    active: false,
    map: null,
    clickHandler: null,
    marker: null,
    callback: null,
    cursorOriginal: "",
    dragWasDisabled: false,
    snapMeters: DEFAULT_SNAP_METERS,
};

/**
 * Resolves the native map to drive.
 *
 * The core hands its map ADAPTER (`GeoLeaf.Core.getMap()`), not the native instance, so the
 * argument is unwrapped when it carries `getNativeMap`. Callers inside the plugin pass
 * nothing and get the map through the plugin's usual seam.
 */
function _resolveMap(map?: unknown): EditorMap | null {
    const adapter = map as { getNativeMap?(): unknown } | null | undefined;
    if (adapter?.getNativeMap) return (adapter.getNativeMap() as EditorMap) ?? null;
    if (map && typeof (map as EditorMap).getCanvas === "function") return map as EditorMap;
    return _getNativeMap();
}

/**
 * The cursor must be set on the CANVAS, not on the container: the canvas sits on top and
 * is what actually paints the pointer.
 */
function _cursorTarget(map: EditorMap): HTMLElement {
    return (map.getCanvas?.() ?? map.getContainer()) as HTMLElement;
}

/**
 * Removes the temporary marker, if any. Safe to call when none exists.
 */
function _removeMarker(): void {
    if (!_state.marker) return;
    _state.marker.remove();
    _state.marker = null;
}

/**
 * Builds the draggable marker that lets the surveyor correct the tap.
 *
 * No-op when MapLibre is absent from `globalThis` — placement still works, the user simply
 * loses the drag-to-adjust affordance rather than the whole capture.
 *
 * 🛑 `callback` and `snapMeters` are passed IN and captured, never read back off `_state`.
 * The marker outlives the activation by design (`deactivate({ keepMarker: true })`), and
 * `deactivate` nulls `_state.callback` — reading the shared state at drag time made every
 * `dragend` a silent no-op: the marker moved, and nothing was ever reported. Caught by
 * `placement-mode.test.ts` on its first run.
 */
function _createTemporaryMarker(
    map: EditorMap | null,
    latlng: { lat: number; lng: number },
    snapped: boolean,
    callback: ((result: PlacementResult) => void) | null,
    snapMeters: number
): void {
    const mlgl = _maplibregl();
    if (!map || !mlgl?.Marker) {
        if (!mlgl?.Marker) Log?.debug?.("[editor/placement] MapLibre absent — marker skipped");
        return;
    }
    _removeMarker();

    const el = document.createElement("div");
    el.className = snapped ? "gl-editor-placement-marker snapped" : "gl-editor-placement-marker";
    el.title = _getLabel(
        snapped ? "editor.placement.markerExisting" : "editor.placement.markerNew"
    );
    el.appendChild(_buildPin());

    const marker = new mlgl.Marker({ element: el, draggable: true })
        .setLngLat([latlng.lng, latlng.lat])
        // `addTo` takes `unknown` on purpose (see {@link PlacementMarker}): the editor stays
        // MapLibre-agnostic, so there is nothing to cast the map TO.
        .addTo(map);
    _state.marker = marker;

    marker.on("dragend", () => {
        const moved = marker.getLngLat();
        const next = { lat: moved.lat, lng: moved.lng };
        Log?.debug?.("[editor/placement] Marker dragged to:", next);
        // Re-run the guard at the new position: dragging AWAY from a duplicate must clear
        // the snap, and dragging ONTO one must raise it. Reporting the original verdict
        // would let a corrected position keep an identity it no longer sits on.
        // The drag corrects a position the user already committed to creating, so the intent
        // does not reopen: re-asking on every drag would make the guard unusable.
        callback?.({
            latlng: next,
            snapped: findNearbyFeature(next, snapMeters),
            intent: "create",
        });
    });
}

/**
 * Asks what to do about a feature already sitting where the user tapped.
 *
 * 🛑 THREE OUTCOMES, NOT TWO, AND THE THIRD IS THE POINT. Folding "neither" onto one of the
 * two actions would make Escape or a backdrop click perform something — and since the only
 * candidate is "create", a gesture of renunciation would have produced the duplicate this
 * guard exists to prevent. Hence `chooseDialog` rather than `confirmDialog`, and hence
 * `cancel` FIRST so it also takes the initial focus.
 *
 * @param snapped - The neighbour found within the snap radius.
 * @returns the intent the user settled on.
 */
async function _askAboutNeighbour(snapped: SnappedFeature): Promise<PlacementResult["intent"]> {
    const title = snapped.title ?? _getLabel("editor.placement.duplicateUnnamed");
    const message = _getLabel("editor.placement.duplicateBody")
        .replace("{title}", title)
        .replace("{d}", String(Math.round(snapped.distanceMeters)));

    const answer = await chooseDialog({
        title: _getLabel("editor.placement.duplicateTitle"),
        message,
        choices: [
            { id: "cancel", label: _getLabel("editor.modal.btn.cancel") },
            {
                id: "edit",
                label: _getLabel("editor.placement.duplicateEdit"),
                tone: "primary",
            },
            {
                id: "create",
                label: _getLabel("editor.placement.duplicateCreate"),
                tone: "danger",
            },
        ],
    });
    return answer === "edit" || answer === "create" ? answer : "abandon";
}

/**
 * Handles the single tap that ends placement.
 *
 * ⚠️ Asynchronous since the duplicate guard asks a question. `map.on("click", …)` ignores
 * the returned promise, which is fine — nothing downstream waits on it — but a TEST that
 * does not await it observes a handler still mid-flight.
 */
async function _handleMapClick(e: EditorMapMouseEvent): Promise<void> {
    const lngLat = e.lngLat;
    if (!lngLat) {
        Log?.warn?.("[editor/placement] Map click carried no lngLat — ignored");
        return;
    }
    const tap = { lat: lngLat.lat, lng: lngLat.lng };
    const snapped = findNearbyFeature(tap, _state.snapMeters);

    // 🛑 CAPTURED BEFORE ANY DISARM. `deactivate()` nulls `_state.callback` AND `_state.map`,
    // and the marker is planted AFTER the question is answered — reading either back off the
    // shared state at that point yields null, so the marker silently never appears.
    const callback = _state.callback;
    const snapMeters = _state.snapMeters;
    const map = _state.map;

    if (!snapped) {
        // Disarm BEFORE calling back: the callback typically opens the capture form, and a
        // still-armed mode would treat the next tap as a second placement.
        _createTemporaryMarker(map, tap, false, callback, snapMeters);
        PlacementMode.deactivate({ keepMarker: true });
        _report(callback, { latlng: tap, snapped: null, intent: "create" });
        return;
    }

    Log?.debug?.("[editor/placement] Existing feature within reach:", snapped.id);
    // Disarmed BEFORE the question, and with NO marker: the dialog is modal, but a stray tap
    // reaching the map underneath must not read as a second placement, and a marker planted
    // before the user has answered would designate a position they may well refuse.
    PlacementMode.deactivate({ keepMarker: false });

    const intent = await _askAboutNeighbour(snapped);
    if (intent === "abandon") {
        _report(callback, { latlng: tap, snapped, intent });
        return;
    }

    const chosen = intent === "edit" ? snapped.latlng : tap;
    _createTemporaryMarker(map, chosen, intent === "edit", callback, snapMeters);
    _report(callback, { latlng: chosen, snapped, intent });
}

/** Hands the outcome to the caller, or says loudly that there is nobody to hand it to. */
function _report(
    callback: ((result: PlacementResult) => void) | null,
    result: PlacementResult
): void {
    if (callback) callback(result);
    else Log?.error?.("[editor/placement] No callback registered");
}

/**
 * One-shot programmatic point placement.
 *
 * @example
 * ```ts
 * PlacementMode.activate(null, (result) => {
 *     if (result.snapped) console.log("duplicate of", result.snapped.id);
 * });
 * ```
 */
export const PlacementMode = {
    /**
     * Arms placement mode. The next map tap resolves it.
     *
     * @param map      - Core map adapter, native map, or `null` to use the plugin's seam.
     * @param callback - Receives the chosen position and the snap verdict.
     * @param options  - See {@link PlacementOptions}.
     */
    activate(
        map: unknown,
        callback: (result: PlacementResult) => void,
        options: PlacementOptions = {}
    ): void {
        if (_state.active) {
            Log?.warn?.("[editor/placement] Already active");
            return;
        }
        const resolved = _resolveMap(map);
        if (!resolved) {
            Log?.error?.("[editor/placement] No map available — cannot activate");
            return;
        }

        _state.map = resolved;
        _state.callback = callback;
        _state.snapMeters = options.snapMeters ?? DEFAULT_SNAP_METERS;
        _state.active = true;

        const target = _cursorTarget(resolved);
        _state.cursorOriginal = target.style.cursor || "";
        target.style.cursor = "crosshair";

        _state.dragWasDisabled = false;
        if (options.disableDrag) {
            resolved.dragPan?.disable?.();
            _state.dragWasDisabled = true;
        }

        // ⚠️ `void`, not a bare arrow: `_handleMapClick` is async since the duplicate guard
        // asks a question, and MapLibre's listener slot expects a void return. Handing it a
        // promise it never awaits is what `no-misused-promises` refuses — the rejection would
        // become an unhandled one, with no user-visible trace.
        _state.clickHandler = (e: EditorMapMouseEvent) => {
            void _handleMapClick(e);
        };
        resolved.on("click", _state.clickHandler);

        getUINotifications()?.info?.(_getLabel("editor.placement.prompt"));
        Log?.debug?.("[editor/placement] Activated");
    },

    /**
     * Disarms placement mode and restores the map.
     *
     * @param opts - `keepMarker: true` leaves the temporary marker in place, which is what
     *               the tap path needs: the marker IS the drag-to-adjust affordance and
     *               removing it on disarm would delete it the instant it appears.
     */
    deactivate(opts: { keepMarker?: boolean } = {}): void {
        if (!_state.active) return;

        const map = _state.map;
        if (map && _state.clickHandler) map.off("click", _state.clickHandler);
        if (map) {
            _cursorTarget(map).style.cursor = _state.cursorOriginal;
            // Re-enable panning only when THIS activation disabled it, so a host that
            // keeps drag off for its own reasons is not silently overridden.
            if (_state.dragWasDisabled) map.dragPan?.enable?.();
        }
        if (!opts.keepMarker) _removeMarker();

        _state.active = false;
        _state.map = null;
        _state.callback = null;
        _state.clickHandler = null;
        _state.dragWasDisabled = false;
        Log?.debug?.("[editor/placement] Deactivated");
    },

    /** @returns whether placement mode is currently armed. */
    isActive(): boolean {
        return _state.active;
    },

    /** Removes the temporary marker left behind after a placement. */
    clearMarker(): void {
        _removeMarker();
    },
};
