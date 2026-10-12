/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The view a theme declares — one reading, for the boot and for a theme switch.
 *
 * A theme may carry `view`: an extent to fit (`bounds`), or a point to stand on (`center` with
 * `zoom`), written like the profile's own `map` block. Two readers must agree on it: the boot,
 * which starts the map on the view of the theme the profile starts on, and the theme engine,
 * which frames the map when a theme that declares one is activated.
 *
 * It sits below both. The boot lives in `app/`, which the kernel cannot import, and
 * `kernel/themes` already imports `kernel/config`: reading it here closes no cycle.
 */

import type {
    GeoLeafBounds,
    GeoLeafLatLng,
    GeoLeafPoint,
} from "../../contracts/map-adapter.contract.js";
import { asArray, asObject } from "../../utils/general/type-guards.js";
import { resolveDefaultThemeId } from "./default-theme.js";

/** `[lat, lng]`, as a profile writes a position. */
type LatLngPair = readonly [number, number];

/** A view that frames an extent: `[[south, west], [north, east]]`. */
interface ThemeBoundsView {
    readonly bounds: readonly [LatLngPair, LatLngPair];
}

/** A view that stands on a point: `[lat, lng]`, at a zoom level. */
interface ThemeCenterView {
    readonly center: LatLngPair;
    readonly zoom: number;
}

/**
 * A theme's `view`, in the writing of the profile and reduced to the one form that applies:
 * `bounds` when it is usable, `center` with `zoom` otherwise.
 */
export type ThemeViewDeclaration = ThemeBoundsView | ThemeCenterView;

/** What a declared view asks of the camera: an extent to fit, or a point to stand on. */
type ThemeViewTarget =
    { readonly bounds: GeoLeafBounds } | { readonly center: GeoLeafLatLng; readonly zoom: number };

/**
 * The room kept around a framed extent, in pixels.
 *
 * `x` and `y` are what the adapter contract knows — a symmetric padding. The four edges are
 * what the MapLibre adapter applies when it finds them, so a profile that keeps more room at the
 * bottom than at the top is framed as it asked.
 */
interface ViewPadding extends GeoLeafPoint {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}

/** Room kept on every edge when the profile declares no padding, in pixels. */
const DEFAULT_VIEW_PADDING_PX = 50;

function _isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** Reads a `[lat, lng]` pair whose first value can be a latitude; `null` otherwise. */
function _readLatLng(value: unknown): LatLngPair | null {
    const pair = asArray(value);
    if (!pair || pair.length !== 2) return null;
    const [lat, lng] = pair;
    if (!_isFiniteNumber(lat) || !_isFiniteNumber(lng) || Math.abs(lat) > 90) return null;
    return [lat, lng];
}

/** Reads `[[south, west], [north, east]]`; `null` when it is not an extent with an inside. */
function _readBounds(value: unknown): ThemeBoundsView["bounds"] | null {
    const corners = asArray(value);
    if (!corners || corners.length !== 2) return null;
    const southWest = _readLatLng(corners[0]);
    const northEast = _readLatLng(corners[1]);
    if (!southWest || !northEast) return null;
    // Corners written the wrong way round frame nothing: refused rather than guessed.
    if (southWest[0] >= northEast[0] || southWest[1] >= northEast[1]) return null;
    return [southWest, northEast];
}

/**
 * Reads a theme's `view` off a profile.
 *
 * @param raw - The value of `view`, as parsed from the profile.
 * @returns The view in the form that applies — `bounds` when it holds two `[lat, lng]` corners,
 *   south-west then north-east, otherwise `center` with `zoom` — or `null` when neither form is
 *   usable: the theme then frames nothing.
 *
 * @example
 * ```ts
 * readThemeView({ bounds: [[43, 1], [44, 2]] }); // { bounds: [[43, 1], [44, 2]] }
 * readThemeView({ center: [43.5, 1.5], zoom: 9 }); // { center: [43.5, 1.5], zoom: 9 }
 * readThemeView({ center: [43.5, 1.5] }); // null — a centre needs its zoom
 * ```
 */
export function readThemeView(raw: unknown): ThemeViewDeclaration | null {
    const declared = asObject(raw);
    if (!declared) return null;
    const bounds = _readBounds(declared.bounds);
    if (bounds) return { bounds };
    const center = _readLatLng(declared.center);
    const zoom = declared.zoom;
    return center && _isFiniteNumber(zoom) && zoom >= 0 ? { center, zoom } : null;
}

/**
 * What a declared view asks of the camera.
 *
 * @param view - A view read by {@link readThemeView}.
 * @returns The extent to fit, or the point and zoom to stand on.
 */
export function resolveThemeView(view: ThemeViewDeclaration): ThemeViewTarget {
    if ("bounds" in view) {
        const [southWest, northEast] = view.bounds;
        return {
            bounds: {
                south: southWest[0],
                west: southWest[1],
                north: northEast[0],
                east: northEast[1],
            },
        };
    }
    return { center: { lat: view.center[0], lng: view.center[1] }, zoom: view.zoom };
}

/**
 * The view of the theme a profile starts on.
 *
 * @param themes - A profile's `themes` block, as {@link resolveDefaultThemeId} reads it.
 * @returns That theme's view, or `null` when the profile declares no theme, or when the theme
 *   it starts on declares no usable view: the map then starts on the profile's own extent.
 */
export function readStartThemeView(themes: unknown): ThemeViewDeclaration | null {
    const startId = resolveDefaultThemeId(themes);
    const list = asArray(asObject(themes)?.themes);
    if (startId === null || !list) return null;
    const startTheme = list.find((theme) => asObject(theme)?.id === startId);
    return readThemeView(asObject(startTheme)?.view);
}

/** The extent a view occupies — a point for a view that stands on its centre. */
function _extentOf(view: ThemeViewDeclaration): GeoLeafBounds {
    const target = resolveThemeView(view);
    if ("bounds" in target) return target.bounds;
    const { lat, lng } = target.center;
    return { south: lat, north: lat, west: lng, east: lng };
}

/**
 * The themes whose view reaches outside an extent.
 *
 * @param themes - A profile's `themes` block.
 * @param extent - The extent the views are held to.
 * @returns The id of every theme whose view — its whole extent, or its centre — is not inside
 *   `extent`, edges included. A theme without an id or without a usable view is not listed.
 */
export function themeViewsOutside(themes: unknown, extent: GeoLeafBounds): string[] {
    const outside: string[] = [];
    for (const theme of asArray(asObject(themes)?.themes) ?? []) {
        const id = asObject(theme)?.id;
        const view = readThemeView(asObject(theme)?.view);
        if (typeof id !== "string" || !view) continue;
        const occupied = _extentOf(view);
        const inside =
            occupied.south >= extent.south &&
            occupied.north <= extent.north &&
            occupied.west >= extent.west &&
            occupied.east <= extent.east;
        if (!inside) outside.push(id);
    }
    return outside;
}

/** One edge of a padding: the declared number, or `fallback`. */
function _edge(value: unknown, fallback: number): number {
    return _isFiniteNumber(value) ? value : fallback;
}

/**
 * Reads the profile's `map.padding` into the room kept around a framed extent.
 *
 * @param padding - The value of `map.padding`: an array, or an object of edges.
 * @returns The four edges, with the symmetric padding that covers them. An array reads
 *   `[horizontal, vertical]`, a missing entry giving 50; an object gives each edge it names and
 *   `0` for the others; anything else gives 50 pixels on every edge.
 */
export function resolveViewPadding(padding: unknown): ViewPadding {
    const fallback = DEFAULT_VIEW_PADDING_PX;
    const pair = asArray(padding);
    const edges = asObject(padding);
    let insets = { top: fallback, bottom: fallback, left: fallback, right: fallback };
    if (pair) {
        const horizontal = _edge(pair[0], fallback);
        const vertical = _edge(pair[1], fallback);
        insets = { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
    } else if (edges) {
        insets = {
            top: _edge(edges.top, 0),
            bottom: _edge(edges.bottom, 0),
            left: _edge(edges.left, 0),
            right: _edge(edges.right, 0),
        };
    }
    return {
        ...insets,
        x: Math.max(insets.left, insets.right),
        y: Math.max(insets.top, insets.bottom),
    };
}
