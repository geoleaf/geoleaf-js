/*!
 * @geoleaf-plugins/isochrone — Origin markers
 *
 * One marker per point the zones start from — shared by all the zones of that point, and taken
 * away with the last of them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { tLabel } from "@geoleaf/host-runtime";
import type { IsochroneMap } from "./map-binding.js";
import type { IsochroneLayer } from "./model.js";

/**
 * Class of an origin marker — DRAWN by the plugin's stylesheet, and only by it.
 *
 * ⚠️ Given a class and no icon, the adapter builds an EMPTY element: without the stylesheet's
 * rule it measures 0 × 0, sits in the DOM and shows nothing — the origin of a zone was present
 * and invisible that way. The rule gives it its size; the end-to-end scenario measures it.
 */
const MARKER_CLASS = "gl-isochrone-origin";

/**
 * Tells two origins apart: two zones share a marker when they start from the same point.
 *
 * @param origin Longitude, latitude.
 * @returns A key equal for equal points.
 */
function originKey(origin: IsochroneLayer["origin"]): string {
    return `${origin[0]},${origin[1]}`;
}

/** The markers on the map, by origin. */
export class OriginMarkers {
    private readonly shown = new Map<string, string>();
    private next = 0;

    /**
     * Puts a marker on every origin the stack still has, and takes away the others.
     *
     * @param map The adapter.
     * @param layers The zones of the stack.
     */
    sync(map: IsochroneMap, layers: readonly IsochroneLayer[]): void {
        const wanted = new Map(layers.map((l) => [originKey(l.origin), l.origin]));
        for (const [key, markerId] of this.shown) {
            if (wanted.has(key)) continue;
            map.removeMarker(markerId);
            this.shown.delete(key);
        }
        for (const [key, [lng, lat]] of wanted) {
            if (this.shown.has(key)) continue;
            const markerId = `__gl_isochrone_origin_${++this.next}`;
            // `title` becomes the element's accessible name, with the role of an image.
            map.createMarker(
                markerId,
                { lat, lng },
                { className: MARKER_CLASS, title: tLabel("isochrone.origin.label") }
            );
            this.shown.set(key, markerId);
        }
    }

    /**
     * Takes every marker away, and forgets them.
     *
     * @param map The adapter — `null` when the map is already gone, and its markers with it.
     */
    clear(map: IsochroneMap | null): void {
        if (map) this.sync(map, []);
        this.shown.clear();
    }
}
