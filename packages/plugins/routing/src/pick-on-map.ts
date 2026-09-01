/*!
 * @geoleaf-plugins/routing — Picking a stop on the map
 *
 * One click, one waypoint — and a mode that can be left.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";
import type { Waypoint } from "./model.js";

/**
 * ## 🛑 The property that matters here is the EXIT, not the entry
 *
 * Attaching a click handler is three lines. What makes this a mode rather than a leak is that
 * every way out removes it — the second click on the toggle, the Escape key, the panel closing,
 * and picking a point. A handler that survives its mode turns every later click on the map into a
 * stop nobody asked for, and the user has no idea what they did to deserve it.
 *
 * That is why `stop()` is idempotent and why the cursor is restored to whatever it was rather than
 * to `""`: the map may be inside another mode that set it, and blanking it would silently undo
 * that mode's own signal.
 *
 * ## Why Escape, and why it is captured on the document
 *
 * A modal mode with no keyboard exit is a trap for anyone not using a mouse, and the map canvas
 * does not reliably hold focus. Listening on the document is what makes Escape work from wherever
 * the user actually is — which, in this flow, is usually the panel.
 */

/** A live picking mode. */
export interface PickMode {
    /** Leaves the mode and detaches everything. Idempotent. */
    stop(): void;
    /** Whether the mode is still attached. */
    readonly active: boolean;
}

/** The slice of the map this needs. */
interface ClickableMap {
    on(type: "click", handler: (e: MapClick) => void): void;
    off(type: "click", handler: (e: MapClick) => void): void;
    getCanvas?(): HTMLElement;
    getContainer?(): HTMLElement;
}

/** What a map click carries. */
interface MapClick {
    readonly lngLat?: { readonly lng: number; readonly lat: number };
}

/**
 * Enters "pick a stop" mode.
 *
 * @param onPick Called once, with the waypoint, when the user clicks the map. The mode ends
 *               itself before calling — one click, one stop, so a distracted second click does
 *               not add a point the user has stopped expecting.
 * @returns The live mode. When no map is available the returned mode is inert and `active` is
 *          `false`, so a caller can tell "not picking" from "picking" without a second question.
 */
export function pickWaypointOnMap(onPick: (waypoint: Waypoint) => void): PickMode {
    const map = getNativeMap<ClickableMap>();
    if (typeof map?.on !== "function" || typeof map.off !== "function") {
        return { stop: () => {}, active: false };
    }

    const cursorTarget = map.getCanvas?.() ?? map.getContainer?.() ?? null;
    const previousCursor = cursorTarget?.style.cursor ?? "";
    if (cursorTarget) cursorTarget.style.cursor = "crosshair";

    let active = true;

    const onKey = (e: KeyboardEvent): void => {
        if (e.key === "Escape") stop();
    };

    const onClick = (e: MapClick): void => {
        const ll = e?.lngLat;
        // A click with no position is not a place. Adding `[0, 0]` would drop a stop off the
        // coast of Africa, which reads as a bug in the router rather than in this handler.
        if (!ll || typeof ll.lng !== "number" || typeof ll.lat !== "number") return;
        stop();
        onPick({ coordinates: [ll.lng, ll.lat] });
    };

    function stop(): void {
        if (!active) return;
        active = false;
        map?.off("click", onClick);
        document.removeEventListener("keydown", onKey);
        // Restored to what it WAS, not blanked: another mode may own the cursor, and blanking
        // it would undo that mode's signal without ending that mode.
        if (cursorTarget) cursorTarget.style.cursor = previousCursor;
    }

    map.on("click", onClick);
    document.addEventListener("keydown", onKey);

    return {
        stop,
        get active(): boolean {
            return active;
        },
    };
}
