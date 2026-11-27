/*!
 * @geoleaf-plugins/isochrone — Bringing computed zones into view
 *
 * Five to fifteen minutes on foot is a few pixels at the scale the map opens at: « Zones ajoutées :
 * 3 », and the map showed only the marker. The zones are framed when they are not readable — out
 * of the view, or too small in it — and left alone otherwise, the rule routing applies to a route.
 * « The view » is the part of the map nothing covers: the plugin's own window, the side panel or
 * the sheet, the theme bar, the toolbar, the credit.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coveredInsets, paddingClearOf } from "@geoleaf/host-runtime";

/**
 * A margin per edge, in pixels. Declared here, not imported: this type reaches the published
 * `.d.ts`, and the shared runtime it mirrors is a private workspace never on the registry.
 */
interface Insets {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}
import type { IsochroneGeometry } from "./model.js";

/** A geographic box, as the adapter speaks it. */
interface Bounds {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
}

/** The adapter members this needs — optional on the plugin's slice of it. */
export interface FrameableMap {
    getBounds?(): Bounds;
    fitBounds?(bounds: Bounds, options?: { padding?: { x: number; y: number } | Insets }): void;
    getContainer?(): Element;
    latLngToPoint?(latlng: { lat: number; lng: number }): { x: number; y: number };
}

/** Below this share of the view's width AND height, zones are too small to read. */
const READABLE_SHARE = 0.15;

/** Room kept around framed zones, in pixels. */
const MARGIN_PX = 48;

/** The uniform margin — what the fit keeps when nothing is measured, or the covered edges leave no room. */
const PADDING = { x: MARGIN_PX, y: MARGIN_PX };

/** The plugin's own surface over the map: its floating window. */
const OWN_SURFACES: readonly string[] = [".gl-isochrone__panel"];

/** The box of every ring of `geometries`, or `null` when none carries a position. */
function zonesBounds(geometries: readonly IsochroneGeometry[]): Bounds | null {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    const visit = (node: unknown): void => {
        if (!Array.isArray(node)) return;
        if (typeof node[0] === "number" && typeof node[1] === "number") {
            const [lng, lat] = node as [number, number];
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
            return;
        }
        for (const child of node) visit(child);
    };
    for (const g of geometries) visit((g as { coordinates?: unknown }).coordinates);
    return Number.isFinite(west) && Number.isFinite(south) ? { north, south, east, west } : null;
}

/**
 * Whether the zones are readable on the part of the map nothing covers — inside it, and not a
 * speck in it.
 *
 * Read on screen positions: a zone under the window is inside the geographic view and seen by
 * nobody.
 *
 * @returns `null` when the map cannot project — the caller then reads the geographic view.
 */
function readableInUncovered(
    map: FrameableMap,
    box: Bounds,
    container: Element,
    insets: Insets
): boolean | null {
    if (typeof map.latLngToPoint !== "function") return null;
    const { width, height } = container.getBoundingClientRect();
    const free = {
        left: insets.left,
        top: insets.top,
        right: width - insets.right,
        bottom: height - insets.bottom,
    };
    if (!(free.right > free.left && free.bottom > free.top)) return null;
    const corners = [
        map.latLngToPoint({ lat: box.north, lng: box.west }),
        map.latLngToPoint({ lat: box.north, lng: box.east }),
        map.latLngToPoint({ lat: box.south, lng: box.east }),
        map.latLngToPoint({ lat: box.south, lng: box.west }),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    if (![...xs, ...ys].every(Number.isFinite)) return null;
    const inside =
        Math.min(...xs) >= free.left &&
        Math.max(...xs) <= free.right &&
        Math.min(...ys) >= free.top &&
        Math.max(...ys) <= free.bottom;
    const wide = (Math.max(...xs) - Math.min(...xs)) / (free.right - free.left);
    const tall = (Math.max(...ys) - Math.min(...ys)) / (free.bottom - free.top);
    return inside && (wide >= READABLE_SHARE || tall >= READABLE_SHARE);
}

/** Whether the zones are readable in the geographic view — the reading without a projection. */
function readableInView(map: FrameableMap, box: Bounds): boolean {
    const view = map.getBounds?.();
    if (!view) return false;
    const inside =
        box.west >= view.west &&
        box.east <= view.east &&
        box.south >= view.south &&
        box.north <= view.north;
    const wide = (box.east - box.west) / Math.max(view.east - view.west, 1e-9);
    const tall = (box.north - box.south) / Math.max(view.north - view.south, 1e-9);
    return inside && (wide >= READABLE_SHARE || tall >= READABLE_SHARE);
}

/**
 * Frames the zones when they are out of the uncovered part of the view, or too small in it.
 *
 * The fit pads each edge by what covers it, plus a 48-px margin; with nothing measured, or covered
 * edges leaving no room, the margin alone.
 *
 * @param map - The adapter slice; without `fitBounds`, nothing happens.
 * @param geometries - The zones just drawn.
 * @returns `true` when the map was moved.
 */
export function frameZonesIfUnreadable(
    map: FrameableMap,
    geometries: readonly IsochroneGeometry[]
): boolean {
    if (typeof map.fitBounds !== "function") return false;
    const box = zonesBounds(geometries);
    if (!box) return false;
    const container = map.getContainer?.();
    const insets = container ? coveredInsets(container, OWN_SURFACES) : null;
    const onScreen = container && insets ? readableInUncovered(map, box, container, insets) : null;
    if (onScreen ?? readableInView(map, box)) return false;
    const padding = container && insets ? paddingClearOf(container, insets, MARGIN_PX) : null;
    map.fitBounds(box, { padding: padding ?? PADDING });
    return true;
}
