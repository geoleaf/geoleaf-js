/*!
 * @geoleaf-plugins/editor — Selection state
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Geometry } from "geojson";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Everything needed to identify a selected feature and to put it back if an edit is refused.
 *
 * Two identities coexist on purpose: `terradrawId` addresses the feature inside Terra Draw,
 * `featureId` addresses it in the host GeoJSON layer — they are not interchangeable.
 * `originalGeom` is captured at selection time precisely so a guard violation can roll the
 * geometry back rather than leave a half-applied edit.
 */
export interface SelectionSnapshot {
    /** Internal Terra Draw feature ID (numeric or string). */
    terradrawId: string;
    /** Original feature ID from the host GeoJSON layer. */
    featureId: string;
    /** MapLibre layer ID of the source layer. */
    layerId: string;
    /** Geometry snapshot captured at selection time — used for rollback on guard violations. */
    originalGeom: Geometry;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _current: SelectionSnapshot | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Stores (or replaces) the active selection snapshot. */
export function setSelection(snap: SelectionSnapshot): void {
    _current = snap;
}

/** Clears the active selection. */
export function clearSelection(): void {
    _current = null;
}

/** Returns the active selection snapshot, or null if nothing is selected. */
export function getSelection(): SelectionSnapshot | null {
    return _current;
}
