/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter engine — internal types (S5, F1).
 *
 * The engine is the geometry-agnostic predicate core: given the active field
 * selections and a feature, decide visibility. Multi-source, no POI/Route
 * special-casing. (The native-expression half was retired in S5/N-4 — see `taxonomy-options.ts`.)
 */
"use strict";

import type { FilterFieldDescriptor } from "../types.js";

/** Minimal structural view of a feature the engine reads (GeoJSON or POI bag). */
export interface FeatureLike {
    properties?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    geometry?: { type?: string; coordinates?: unknown };
    [key: string]: unknown;
}

/** Proximity selection payload (`proximity` kind). */
export interface ProximitySelection {
    center: { lat: number; lng: number };
    radius: number;
}

/** Numeric range selection payload (`range` kind). */
export interface RangeSelection {
    min?: number;
    max?: number;
}

/**
 * One field's active selection. Only fields the user has actually constrained are
 * present in the active set; the payload used depends on `descriptor.kind`.
 */
export interface ActiveField {
    /** The field descriptor this selection targets. */
    descriptor: FilterFieldDescriptor;
    /** Selected values — `taxonomy` / `tag` / `enum`. */
    values?: string[];
    /** Numeric bounds — `range`. */
    range?: RangeSelection;
    /** Search query — `text`. */
    text?: string;
    /** Toggle — `boolean` (active only when `true`). */
    bool?: boolean;
    /** Center + radius — `proximity`. */
    proximity?: ProximitySelection;
}
