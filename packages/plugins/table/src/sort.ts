/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table – Sort Utilities
 * Pure sort helpers extracted from geoleaf.table.js (Phase 8.2.2)
 */

export interface SortState {
    field: string | null;
    direction: string | null;
}

/**
 * Sorts `cachedData` in place according to `sortState`.
 */
export function sortInPlace(
    cachedData: unknown[],
    sortState: SortState,
    getNestedValue: (obj: unknown, path: string) => unknown
): void {
    if (!sortState.field || !sortState.direction) return;

    const { field, direction } = sortState;

    cachedData.sort((a, b) => {
        const valA = getNestedValue(a, field);
        const valB = getNestedValue(b, field);

        if (valA == null && valB == null) return 0;
        if (valA == null) return direction === "asc" ? 1 : -1;
        if (valB == null) return direction === "asc" ? -1 : 1;

        let result: number;
        if (typeof valA === "number" && typeof valB === "number") {
            result = valA - valB;
        } else {
            result = String(valA).localeCompare(String(valB));
        }

        return direction === "asc" ? result : -result;
    });
}

/**
 * Computes the next sort state after a click on a column.
 * Cycle: (none) → asc → desc → (none).
 */
export function nextSortState(sortState: SortState, field: string): SortState {
    if (sortState.field === field) {
        if (sortState.direction === "asc") return { field, direction: "desc" };
        if (sortState.direction === "desc") return { field: null, direction: null };
        return { field, direction: "asc" };
    }
    return { field, direction: "asc" };
}
