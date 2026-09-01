/*!
 * @geoleaf-plugins/navigation — The driver's own marker
 *
 * A cone on the route, pointing where they are actually facing.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { Position } from "../engine/snap.js";

/**
 * ## 🛑 Why the rotation is the RAW heading and not `heading − bearing`
 *
 * The obvious implementation reads the map bearing on each fix and writes
 * `rotate(heading − bearing)` onto the element. It is wrong, and provably so: the engine
 * already re-derives exactly that expression on **every rendered frame** for a marker created
 * with `rotationAlignment: "map"`, because its update runs on the map's `move` event. Computing
 * it once per fix instead freezes the icon while the camera is still easing round — through a
 * 90° corner the arrow points 90° away from the truth for the whole turn, which is the one
 * moment anybody looks at it.
 *
 * So the arrow is handed the heading in MAP space and the engine does the rest, per frame, for
 * free. That also keeps the plugin's own rule intact: no `requestAnimationFrame`, no interval,
 * nothing that wakes the GPU between two fixes.
 *
 * ## Why a DOM marker and not a symbol layer
 *
 * The plugin's boundary says no MapLibre source is created here. The adapter's marker seam is
 * the sanctioned route, and it is the same one the core's own geolocation capability uses.
 *
 * ## Why the element is not positioned or rotated by this module
 *
 * The adapter puts `className` on the marker root — which is also the node the engine writes
 * its own positioning `transform` onto. Anything this module wrote there would be overwritten
 * on the next frame, or would overwrite the engine's placement. Position goes through
 * `updateMarkerPosition`, rotation through `setMarkerRotation`; the stylesheet only ever sets
 * size and colour.
 */

/** The marker id. Unique to this plugin, so nothing else can move or drop it. */
const ARROW_ID = "gl-nav-position-arrow";

/**
 * The arrow, as a STATIC hard-coded SVG string.
 *
 * ⚠️ Static is a contract requirement, not a preference: the adapter's `icon` is documented as
 * never taking user-provided or network-fetched content, because SVG can carry executable
 * payloads. It is sanitised on the way in regardless — which is also why there is no wrapping
 * `<div>` here: the allow-list is SVG-only and would drop it silently, taking the shape with it.
 *
 * `currentColor` lets the stylesheet theme it; the tail circle keeps the arrow readable when it
 * sits over dark terrain.
 */
const ARROW_SVG =
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none">' +
    '<circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.25" />' +
    '<path d="M12 3 L19 20 L12 16 L5 20 Z" fill="currentColor" ' +
    'stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round" />' +
    "</svg>";

/** The slice of the map adapter this needs. `GeoLeafHost.Core.getMap()` is an untyped bag. */
interface MarkerCapableAdapter {
    createMarker(id: string, position: { lat: number; lng: number }, options?: unknown): void;
    removeMarker(id: string): void;
    updateMarkerPosition(id: string, position: { lat: number; lng: number }): void;
    setMarkerRotation?(id: string, degrees: number): void;
}

/** The driver's marker, for as long as a session lasts. */
export interface PositionArrow {
    /**
     * Places or moves the arrow.
     *
     * @param position Where the driver is, `[longitude, latitude]`.
     * @param heading Degrees clockwise from north, or `null` to keep the last known facing.
     */
    update(position: Position, heading: number | null): void;
    /** Removes the marker. Idempotent, and safe when nothing was ever placed. */
    destroy(): void;
}

/**
 * Resolves the live map adapter.
 *
 * @returns The adapter, or `null` when no core or no map is available. The cast is this
 *          module's assertion, the same arrangement `getNativeMap` documents for the engine
 *          handle.
 */
function adapter(): MarkerCapableAdapter | null {
    const map = getGeoLeaf()?.Core?.getMap?.() as MarkerCapableAdapter | undefined;
    return typeof map?.createMarker === "function" ? map : null;
}

/**
 * Creates the driver's position arrow.
 *
 * ⚠️ Nothing is drawn until the first `update`. A session may start before the map exists, and
 * a marker placed at a position nobody has measured yet would sit at `0, 0` in the Atlantic
 * until the first fix arrived.
 *
 * @returns The arrow. Every method is a no-op when no map is available — a guidance session
 *          must not fail because the map was torn down under it.
 */
export function createPositionArrow(): PositionArrow {
    let placed = false;

    return {
        update(position: Position, heading: number | null): void {
            const map = adapter();
            if (!map) return;
            const at = { lng: position[0], lat: position[1] };

            if (!placed) {
                map.createMarker(ARROW_ID, at, {
                    icon: ARROW_SVG,
                    className: "gl-nav-arrow-marker",
                    // 🛑 The alignment is what makes the engine counter-rotate per frame. Set it
                    // at creation: it decides which formula the engine's update uses, and there
                    // is no seam to change it afterwards.
                    rotationAlignment: "map",
                    rotation: heading ?? 0,
                });
                placed = true;
                return;
            }

            map.updateMarkerPosition(ARROW_ID, at);
            // ⚠️ Rotation is left ALONE when the heading is unknown, never reset to 0. The
            // platform withholds the heading precisely while standing still, and zeroing it
            // would swing the arrow to due north at every red light — the same trap the camera
            // avoids by omitting `bearing` rather than sending 0.
            if (heading !== null) map.setMarkerRotation?.(ARROW_ID, heading);
        },

        destroy(): void {
            if (!placed) return;
            placed = false;
            adapter()?.removeMarker(ARROW_ID);
        },
    };
}
