/*!
 * @geoleaf-plugins/isochrone — Valhalla normaliser
 *
 * Turns what a Valhalla instance answers into the zones that were asked for. Written against a
 * captured answer (`fixtures/`), never against the engine's documentation.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { IsochroneContour, IsochroneGeometry, IsochronePosition } from "./model.js";

/**
 * ## What the captured answer taught, and what this file does about it
 *
 * - The polygons arrive **from the largest to the smallest**, whatever order they were asked
 *   in. A zone is therefore matched to its duration by the `contour` property of its feature,
 *   NEVER by its position in the list.
 * - Each feature carries the engine's own **style properties** — colours, opacities. None is
 *   kept: a zone's look belongs to the plugin, and a text an engine wrote is an external input
 *   this package never displays.
 * - A point far from any road is answered with polygons the size of one grid cell. They are
 *   kept like any other: this file reads a shape, it does not judge an area.
 *
 * 🛑 **All the zones asked for, or nothing.** A missing contour or a geometry of another kind
 * answers `null`, which the adapter reports as `malformed`. A partial answer drawn as if it
 * were whole would show two zones where three were asked, with nothing on screen to say so.
 */

/**
 * Copies a position, keeping numbers only.
 *
 * @param value What the engine sent where a position is expected.
 * @returns The position, or `null` when it is not at least two finite numbers.
 */
function readPosition(value: unknown): IsochronePosition | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    return value.every((n) => typeof n === "number" && Number.isFinite(n)) ? [...value] : null;
}

/**
 * Copies a list, reading each entry with `read`.
 *
 * @param value What the engine sent where a list is expected.
 * @param read Reads one entry, or answers `null`.
 * @returns The entries, or `null` when the list is empty, is not a list, or holds an entry
 *   that cannot be read.
 */
function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const out: T[] = [];
    for (const entry of value) {
        const item = read(entry);
        if (item === null) return null;
        out.push(item);
    }
    return out;
}

/**
 * Copies the rings of one polygon.
 *
 * @param value What the engine sent where a polygon's coordinates are expected.
 * @returns The rings, or `null`.
 */
function readPolygon(value: unknown): IsochronePosition[][] | null {
    return readList(value, (ring) => readList(ring, readPosition));
}

/**
 * Reads the geometry of one feature.
 *
 * @param value The feature's `geometry`.
 * @returns A polygon or a multi-polygon, or `null` for anything else.
 */
function readGeometry(value: unknown): IsochroneGeometry | null {
    const geometry = (value ?? {}) as { type?: unknown; coordinates?: unknown };
    if (geometry.type === "Polygon") {
        const coordinates = readPolygon(geometry.coordinates);
        return coordinates ? { type: "Polygon", coordinates } : null;
    }
    if (geometry.type === "MultiPolygon") {
        const coordinates = readList(geometry.coordinates, readPolygon);
        return coordinates ? { type: "MultiPolygon", coordinates } : null;
    }
    return null;
}

/**
 * Normalises a Valhalla isochrone answer.
 *
 * @param body The parsed response body.
 * @param minutes The durations that were asked, in the order the caller wants them back.
 * @returns One zone per duration asked, in that order — or `null` when the body cannot be
 *   read, a duration has no contour, or a contour is not a polygon.
 */
export function normalizeValhalla(
    body: unknown,
    minutes: readonly number[]
): IsochroneContour[] | null {
    const features = ((body ?? {}) as { features?: unknown }).features;
    if (!Array.isArray(features)) return null;

    const contours: IsochroneContour[] = [];
    for (const asked of minutes) {
        const feature = features.find(
            (f) =>
                (f as { properties?: { contour?: unknown } } | null)?.properties?.contour === asked
        ) as { geometry?: unknown } | undefined;
        const geometry = readGeometry(feature?.geometry);
        if (geometry === null) return null;
        contours.push({ minutes: asked, geometry });
    }
    return contours;
}
