/*!
 * @geoleaf-plugins/isochrone — Picking a point on the map
 *
 * One click on the map gives the origin of the zones. While the mode is armed the cursor is a
 * crosshair and a click opens no feature's sheet; leaving it — by the click, by the window, or
 * by its teardown — gives both back as they were.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf, getNativeMap } from "@geoleaf/host-runtime";

/**
 * Why the click goes through the adapter, and the flag through the native map
 *
 * The click is the adapter's: `on("click")` hands the handler the event with `latlng` added,
 * and `off()` takes the same function back. The flag that keeps a click from opening a
 * feature's sheet is not: the core reads `__geoleafExclusiveMode` on the native map, on its
 * three click and hover paths, and the adapter has no member that sets it. Reaching the native
 * map for that one write is the only native access of this package.
 *
 * The cursor and the flag are restored to what they WERE, not reset: another mode may own them,
 * and blanking them would undo its signal without ending it.
 *
 * ⚠️ Escape is not listened to here. The window owns the one Escape handler, so that a single
 * press does a single thing — leave the picking, else cancel the computation, else close.
 */

/** A live picking mode. */
export interface PickMode {
    /** Leaves the mode and gives the cursor and the flag back. Idempotent. */
    stop(): void;
    /** Whether the mode is still armed. */
    readonly active: boolean;
}

/** The slice of the core's adapter the picking needs. */
interface ClickableMap {
    on(event: "click", handler: (e: unknown) => void): void;
    off(event: "click", handler: (e: unknown) => void): void;
    getCanvas?(): HTMLElement;
    getContainer?(): HTMLElement;
}

/** What the core reads, on the native map, before opening a feature's sheet. */
interface ExclusiveHost {
    __geoleafExclusiveMode?: boolean;
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

    const cursorTarget = map.getCanvas?.() ?? map.getContainer?.() ?? null;
    const previousCursor = cursorTarget?.style.cursor ?? "";
    if (cursorTarget) cursorTarget.style.cursor = "crosshair";

    const native = getNativeMap<ExclusiveHost>();
    const previousExclusive = native?.__geoleafExclusiveMode === true;
    if (native) native.__geoleafExclusiveMode = true;

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
        if (cursorTarget) cursorTarget.style.cursor = previousCursor;
        if (native) native.__geoleafExclusiveMode = previousExclusive;
    }

    map.on("click", onClick);

    return {
        stop,
        get active(): boolean {
            return active;
        },
    };
}
