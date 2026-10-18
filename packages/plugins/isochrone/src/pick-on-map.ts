/*!
 * @geoleaf-plugins/isochrone — Picking a point on the map
 *
 * One click on the map gives the origin of the zones. While the mode is armed the cursor is a
 * crosshair and a click opens no feature's sheet; leaving it — by the click, by the window, or
 * by its teardown — releases both.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";

/**
 * Everything goes through the adapter
 *
 * The click: `on("click")` hands the handler the event with `latlng` added, and `off()` takes
 * the same function back. The crosshair and the guard that keeps a click from opening a
 * feature's sheet: `enterExclusiveMode("crosshair")` (core 3.17.0), which paints the cursor and
 * puts back the one it found on `exitExclusiveMode()`. There is no token: tools exclude each
 * other, the last entry wins and any exit releases the mode — so leaving the picking does not
 * hand the mode back to a tool that held it before; that tool had been superseded.
 *
 * On an adapter without the two members (a core older than 3.17.0) the picking still works,
 * without crosshair and without the guard: a click may then also open a feature's sheet.
 *
 * ⚠️ Escape is not listened to here. The window owns the one Escape handler, so that a single
 * press does a single thing — leave the picking, else cancel the computation, else close.
 */

/** A live picking mode. */
export interface PickMode {
    /** Leaves the mode and releases the crosshair and the guard. Idempotent. */
    stop(): void;
    /** Whether the mode is still armed. */
    readonly active: boolean;
}

/** The slice of the core's adapter the picking needs. */
interface ClickableMap {
    on(event: "click", handler: (e: unknown) => void): void;
    off(event: "click", handler: (e: unknown) => void): void;
    /** Optional on the adapter's contract (core 3.17.0). */
    enterExclusiveMode?(cursor?: string): void;
    /** Optional on the adapter's contract (core 3.17.0). */
    exitExclusiveMode?(): void;
}

/** A position as the adapter's click event carries it. */
interface ClickPosition {
    readonly lat?: unknown;
    readonly lng?: unknown;
}

/**
 * The adapter, if it can be clicked.
 *
 * @returns The slice, or `null` when no map is mounted or it has no `on`/`off`.
 */
function clickableMap(): ClickableMap | null {
    const adapter: unknown = getGeoLeaf()?.Core?.getMap?.();
    if (typeof adapter !== "object" || adapter === null) return null;
    const members = adapter as Record<string, unknown>;
    return typeof members.on === "function" && typeof members.off === "function"
        ? (adapter as ClickableMap)
        : null;
}

/**
 * Reads the clicked position: the adapter's `latlng` first, the engine's `lngLat` otherwise.
 *
 * @param e The click event.
 * @returns `[lon, lat]`, or `null` when the event carries no finite position.
 */
function clickedOrigin(e: unknown): [lon: number, lat: number] | null {
    const event = (typeof e === "object" && e !== null ? e : {}) as {
        latlng?: ClickPosition;
        lngLat?: ClickPosition;
    };
    const { lng, lat } = event.latlng ?? event.lngLat ?? {};
    if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

/**
 * Arms the picking mode.
 *
 * @param onPick Called once, with `[lon, lat]`, when the map is clicked. The mode ends itself
 *   before calling: one click, one point.
 * @returns The live mode. With no map to click, the mode is inert and `active` is `false` — the
 *   caller reflects that rather than its own intent.
 */
export function pickOriginOnMap(onPick: (origin: [lon: number, lat: number]) => void): PickMode {
    const map = clickableMap();
    if (!map) return { stop: () => {}, active: false };

    map.enterExclusiveMode?.("crosshair");

    let active = true;

    const onClick = (e: unknown): void => {
        const origin = clickedOrigin(e);
        // A click with no position is not a place: computing from [0, 0] would draw zones in
        // the Gulf of Guinea, and read as the engine's error.
        if (!origin) return;
        stop();
        onPick(origin);
    };

    function stop(): void {
        if (!active) return;
        active = false;
        map?.off("click", onClick);
        map?.exitExclusiveMode?.();
    }

    map.on("click", onClick);

    return {
        stop,
        get active(): boolean {
            return active;
        },
    };
}
