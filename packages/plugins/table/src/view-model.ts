/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — view model
 *
 * The single authority over three things the table needs and the DOM used to hold:
 * **row identity**, **what the search leaves visible**, and **the selection anchor**.
 *
 * ## 🛑 Why this module exists
 *
 * Beyond `VIRTUAL_THRESHOLD` the table renders only a window, while search and selection
 * read the DOM — so they only ever saw that window. "Select all" on a 30 000-row layer
 * took a few dozen rows, a search evaporated on the first scroll, and the header checkbox
 * compared a window count against a model count.
 *
 * The data model itself was never missing: `tableState._cachedData` has held the whole
 * layer all along. What was missing is this layer — the description of **which rows the
 * view shows, and under which identity**. Rendering is now a projection of it.
 *
 * ## The identity rule, and why it moved here
 *
 * A row's id used to be minted at render time by a module counter that only `render()`
 * reset. `updateVirtualRows` re-created rows without that reset, so after a scroll a row
 * displaying `PT-105` carried the id of `PT-33` — **a key of the model, but the wrong
 * one**. Not a silent empty: a silent WRONG. Identity is computed once here, from the
 * model, by index; the renderer is handed ids and never invents one.
 *
 * ## What it deliberately does NOT own
 *
 * The selection itself (`tableState._selectedIds`) and the data (`_cachedData`,
 * `_featureIdMap`) stay in `table-state.ts`. This module describes a **view** of them.
 * `rebuild()` is the one sync point; nothing else may write the arrays below.
 */

import { getNestedValue } from "@geoleaf/host-runtime";
import { resolveFeatureId } from "./feature-id.js";
import { formatValue } from "./format-value.js";
import { sortInPlace } from "./sort.js";
import type { SortState } from "./sort.js";
import type { TableColumnDef, TableFeature } from "./types.js";

/** Prefix of the ids minted for features that carry no natural identifier. */
const SYNTHETIC_PREFIX = "__gl_row_";

/** A rendered row: the feature and the identity the DOM will carry for it. */
export interface TableRow {
    feature: TableFeature;
    id: string;
}

interface ViewModelState {
    rows: TableRow[];
    indexById: Map<string, number>;
    visible: number[];
    anchorId: string | null;
    searchText: string;
    columns: TableColumnDef[];
    searchFields: string[] | null;
}

const state: ViewModelState = {
    rows: [],
    indexById: new Map(),
    visible: [],
    anchorId: null,
    searchText: "",
    columns: [],
    searchFields: null,
};

/**
 * The display-order feature array, memoised.
 *
 * Its REFERENCE is the synchronisation token between this module and `render()`: the
 * renderer re-describes the view only when handed an array this module did not emit. A
 * positional comparison would work too and cost O(n) on every render; an emitted-array
 * identity costs nothing and cannot be fooled by two arrays that happen to match.
 */
let orderedCache: TableFeature[] | null = null;

/** Re-derives `indexById` after any reordering of `rows`, and drops the order cache. */
function reindex(): void {
    state.indexById = new Map(state.rows.map((row, index) => [row.id, index]));
    orderedCache = null;
}

/**
 * Pairs every feature with its identity, in LOAD order.
 *
 * ⚠️ The synthetic index is the **count of synthetic ids handed out so far**, not the
 * array index — a layer mixing identified and unidentified features would otherwise skip
 * numbers. This convention is the one `table-api.refresh()` has always used to key
 * `_featureIdMap`, and keeping the two in one place is the point of this function.
 *
 * 🛑 Identity is fixed HERE and travels with the feature from then on. Recomputing it
 * after a sort would hand a re-ordered synthetic id to a feature that a user may already
 * have selected — the selection would silently change target. Sorting reorders the rows;
 * it never re-mints them.
 *
 * @param features - The features, in load order.
 * @returns One row per feature, positionally aligned with `features`.
 */
function buildRows(features: TableFeature[]): TableRow[] {
    const rows: TableRow[] = [];
    let synthetic = 0;
    for (const feature of features) {
        const id = resolveFeatureId(feature, synthetic);
        if (id.startsWith(SYNTHETIC_PREFIX)) synthetic++;
        rows.push({ feature, id });
    }
    return rows;
}

/**
 * Re-describes the view over a feature array — the ONE sync point.
 *
 * Call it whenever the layer's content changes. A **sort** does not go through here — it
 * goes through {@link sortRows}, which reorders without re-minting identity. The current
 * search text survives and is re-applied, because a user who reloads a layer while
 * filtering expects the filter to hold.
 *
 * @param features - The model, in load order — which is also the display order until a sort.
 * @param columns - The columns the search reads when no `searchFields` is declared.
 * @param searchFields - The layer's `table.searchFields`, or null for "all columns".
 */
export function rebuild(
    features: TableFeature[],
    columns: TableColumnDef[] = [],
    searchFields: string[] | null = null
): void {
    state.rows = buildRows(features);
    reindex();
    state.columns = columns;
    state.searchFields = searchFields && searchFields.length > 0 ? searchFields : null;
    state.anchorId = null;
    applySearch(state.searchText);
}

/**
 * Reorders the rows — identity untouched.
 *
 * ⚠️ **This is what keeps the selection honest across a sort.** `refresh()` used to key
 * `tableState._featureIdMap` by index and only THEN sort `_cachedData` in place, so every
 * entry of the map pointed at a pre-sort position: `getSelectedFeatures()` — read by zoom,
 * highlight and export-of-selection — handed back a different feature than the user had
 * selected. Measured 20/09/2026: 300 desynchronised entries out of 300. Here the order and
 * the index are re-derived in the same pass, so they cannot disagree.
 *
 * @param sortState - Field and direction; a null field leaves the order alone.
 */
export function sortRows(sortState: SortState): void {
    if (!sortState.field || !sortState.direction) return;
    sortInPlace(state.rows, sortState, (row, path) =>
        getNestedValue((row as TableRow).feature, path)
    );
    reindex();
    applySearch(state.searchText);
}

/** The features in DISPLAY order — what `tableState._cachedData` must mirror. */
export function orderedFeatures(): TableFeature[] {
    if (orderedCache === null) orderedCache = state.rows.map((row) => row.feature);
    return orderedCache;
}

/**
 * Re-describes the view UNLESS it already describes this exact array.
 *
 * Called by `render()`, which may be reached either through `refresh()` — where the view
 * model has just been built and sorted, and re-building would undo the sort — or directly,
 * by a caller holding features of its own.
 */
export function syncTo(
    features: TableFeature[],
    columns: TableColumnDef[] = [],
    searchFields: string[] | null = null
): void {
    if (orderedCache !== null && orderedCache === features) {
        state.columns = columns;
        state.searchFields = searchFields && searchFields.length > 0 ? searchFields : null;
        return;
    }
    rebuild(features, columns, searchFields);
}

/** Every `id → display index` pair — what `tableState._featureIdMap` must mirror. */
export function idIndexEntries(): [string, number][] {
    return state.rows.map((row, index) => [row.id, index]);
}

/**
 * Drops every trace of the current layer — called by `TablePanel.destroy()`.
 *
 * `tableState` survives a panel rebuild, and so does this module: without an explicit
 * teardown a stale search and a stale anchor outlive the rows they describe.
 */
export function reset(): void {
    state.searchText = "";
    rebuild([], [], null);
}

/**
 * Reads one searchable value off a feature.
 *
 * ⚠️ **Two published shapes, both honoured.** This repository documents `searchFields` in
 * two incompatible ways — `["properties.name"]` in the table guide and `["name"]` in the
 * configuration reference. Rather than pick one and make the other doc false, an entry is
 * tried as written, then under `properties.`. Both examples work; neither doc lies.
 */
function readSearchable(feature: TableFeature, field: string): unknown {
    const direct = getNestedValue(feature, field);
    if (direct !== undefined && direct !== null) return direct;
    return getNestedValue(feature, "properties." + field);
}

/** The strings a given feature is searched on, under the current declaration. */
function searchableText(feature: TableFeature): string {
    const parts: string[] = [];
    if (state.searchFields) {
        for (const field of state.searchFields) {
            parts.push(String(readSearchable(feature, field) ?? ""));
        }
    } else {
        for (const col of state.columns) {
            parts.push(formatValue(getNestedValue(feature, col.field), col.type));
        }
    }
    return parts.join(" ").toLowerCase();
}

/**
 * Applies a search over the MODEL and recomputes the visible set.
 *
 * The comparison runs on the model's values — formatted the way the cell displays them,
 * so what the user reads is what the search matches — and never on rendered text: the
 * rendered text is a window, and it also used to include the checkbox column.
 *
 * @param text - Raw search text; empty or blank restores every row.
 */
export function applySearch(text: string): void {
    const needle = (text ?? "").trim().toLowerCase();
    state.searchText = needle;
    if (!needle) {
        state.visible = state.rows.map((_, index) => index);
        return;
    }
    const visible: number[] = [];
    state.rows.forEach((row, index) => {
        if (searchableText(row.feature).includes(needle)) visible.push(index);
    });
    state.visible = visible;
}

/** The current search text, already trimmed and lowercased. */
export function searchText(): string {
    return state.searchText;
}

/** How many rows the view shows — the denominator the header checkbox compares against. */
export function visibleCount(): number {
    return state.visible.length;
}

/** How many rows the model holds, search or no search. */
export function totalCount(): number {
    return state.rows.length;
}

/**
 * The row at a position in the VISIBLE sequence — what the renderer and the virtual
 * window address. Out-of-range yields null rather than a partial row.
 */
function rowAt(position: number): TableRow | null {
    const index = state.visible[position];
    if (index == null) return null;
    return state.rows[index] ?? null;
}

/** Every visible row, in display order. */
export function visibleRows(): TableRow[] {
    const rows: TableRow[] = [];
    for (let position = 0; position < state.visible.length; position++) {
        const row = rowAt(position);
        if (row) rows.push(row);
    }
    return rows;
}

/** The ids of every visible row — what "select all" takes. */
export function visibleIds(): string[] {
    return state.visible.map((index) => (state.rows[index] as TableRow).id);
}

/** The position of an id within the VISIBLE sequence, or -1 when it is filtered out. */
export function visiblePositionOfId(id: string): number {
    const index = state.indexById.get(id);
    if (index == null) return -1;
    return state.visible.indexOf(index);
}

/**
 * Remembers where a range selection should start.
 *
 * ⚠️ There was no anchor before this: `selectRange` took the last entry of a `Set`, which
 * is an insertion order, not a user gesture — and it read it off the DOM, so a scroll made
 * shift-click a silent no-op. The anchor is a model index and survives any scroll.
 */
export function setAnchor(id: string | null): void {
    state.anchorId = id;
}

/**
 * The anchor's position in the visible sequence, or -1 when there is none.
 *
 * ⚠️ The anchor is held by ID, not by index: a sort reorders every index, and an anchor
 * stored as a number would quietly start pointing at another row.
 */
export function anchorVisiblePosition(): number {
    if (state.anchorId == null) return -1;
    return visiblePositionOfId(state.anchorId);
}
