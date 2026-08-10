/*!
 * @geoleaf-plugins/measure — Recap box (measurement summary table)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Sprint 2: table rows for each vertex/segment, footer with perimeter + optional area.
 * PLUGINS S5: wired to the engine. The module was complete since Sprint 2 but nothing
 * ever called it — the capability is specified in six places of the CDC (overview, the
 * distance-tool flow, the file tree, the `clearAll` contract, `addVertex`, and the §2.8
 * rendering spec) and its eight i18n keys are translated in all six dictionaries, yet
 * `initRecapBox` had no production caller. Same shape as `deletePoi` (S3) and
 * `geoCompute` (S4): a missing consumer, not a superfluous producer.
 * https://geoleaf.dev
 */
import { _el, _getLabel } from "./internal.js";
import {
    segmentLengths,
    perimeter,
    area,
    formatDistance,
    formatArea,
    withClosingVertex,
} from "./compute.js";
import type { Units } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the recap table: a vertex and the segment that reaches it. */
interface RecapRow {
    /** Vertex index (1-based). */
    index: number;
    /** Formatted coordinate string, e.g. "2.35010 ; 48.85020". */
    coordStr: string;
    /** Formatted segment length, e.g. "124 m" — empty on the first vertex. */
    lengthStr: string;
}

/** Footer row summarising the complete measurement. */
interface RecapTotal {
    /** Total perimeter / cumulative distance string. */
    perimeterStr: string;
    /** Optional area string (only for closed polygon measurements). */
    areaStr?: string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _recapEl: HTMLElement | null = null;
let _tbody: HTMLTableSectionElement | null = null;
let _tfoot: HTMLTableSectionElement | null = null;

// Visibility has two independent reasons to be false: there is no active measurement,
// and the floating menu is closed. Tracking them separately avoids one clobbering the
// other — closing the menu mid-measure must not discard the rows.
let _hasContent = false;
// Defaults to true so `renderRecap()` is self-sufficient when driven directly; the
// floating menu takes over as soon as it opens or closes.
let _menuOpen = true;

/** Applies the combined visibility state to the box. */
function _syncVisibility(): void {
    _recapEl?.classList.toggle("gl-measure-recap--hidden", !(_hasContent && _menuOpen));
}

/**
 * Formats a coordinate pair for the "Coord X;Y" column.
 * Five decimals ≈ 1 m at the equator — the finest resolution the tool can measure.
 */
function _formatCoord(coord: [number, number]): string {
    return `${coord[0].toFixed(5)} ; ${coord[1].toFixed(5)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates the recap box DOM and appends it to the given container.
 * Called once from floating-menu._buildDOM.
 */
export function initRecapBox(container: HTMLElement): void {
    _hasContent = false;
    _menuOpen = true;
    _recapEl = _el("div", "gl-measure-recap gl-measure-recap--hidden");

    const table = _el("table", "gl-measure-recap__table");

    // Table header
    const thead = table.createTHead();
    const headRow = thead.insertRow();
    const thIndex = document.createElement("th");
    thIndex.textContent = _getLabel("measure.recap.header.index");
    const thCoord = document.createElement("th");
    thCoord.textContent = _getLabel("measure.recap.header.coord");
    const thLength = document.createElement("th");
    thLength.textContent = _getLabel("measure.recap.header.length");
    headRow.appendChild(thIndex);
    headRow.appendChild(thCoord);
    headRow.appendChild(thLength);

    // Table body (rows filled by renderRecap)
    _tbody = table.createTBody();

    // Table footer (total row)
    _tfoot = table.createTFoot();

    _recapEl.appendChild(table);
    container.appendChild(_recapEl);
}

/**
 * Renders the given rows and total in the recap table and makes it visible.
 * All text is inserted via textContent — never innerHTML.
 */
export function renderRecap(rows: RecapRow[], total: RecapTotal): void {
    if (!_tbody || !_tfoot || !_recapEl) return;

    // Rebuild body rows
    _tbody.textContent = "";
    for (const row of rows) {
        const tr = _tbody.insertRow();
        const tdIdx = tr.insertCell();
        tdIdx.textContent = String(row.index);
        const tdCoord = tr.insertCell();
        tdCoord.textContent = row.coordStr;
        const tdLen = tr.insertCell();
        tdLen.textContent = row.lengthStr;
    }

    // Rebuild footer
    _tfoot.textContent = "";
    const footRow = _tfoot.insertRow();
    footRow.className = "gl-measure-recap__total";
    const tdLabel = footRow.insertCell();
    tdLabel.colSpan = 2;
    tdLabel.textContent = _getLabel("measure.recap.total");
    const tdPerim = footRow.insertCell();
    tdPerim.textContent = total.areaStr
        ? `${total.perimeterStr} — ${total.areaStr}`
        : total.perimeterStr;

    _hasContent = true;
    _syncVisibility();
}

/**
 * Renders the recap table straight from the active session state.
 *
 * One row per vertex, carrying the length of the segment that reaches it — the first
 * vertex has no incoming segment, so its length cell stays empty. On a closed ring the
 * closing edge is not given a row of its own (it would repeat vertex 1) but it IS
 * counted in the footer perimeter, which is what the CDC promises.
 *
 * Recomputes lengths rather than receiving the engine's: the two call sites pass
 * different arrays (open vs. ring-closed) and the cost is O(n) on a handful of
 * vertices — CDC §2.13 rules this negligible.
 */
export function renderRecapFromSession(
    vertices: [number, number][],
    closed: boolean,
    units: Units,
    decimals: { distance: number; area: number }
): void {
    if (vertices.length === 0) {
        clearRecap();
        return;
    }

    const isRing = closed && vertices.length >= 3;
    const segLens = segmentLengths(isRing ? withClosingVertex(vertices) : vertices);

    const rows: RecapRow[] = vertices.map((coord, i) => ({
        index: i + 1,
        coordStr: _formatCoord(coord),
        lengthStr:
            i === 0 ? "" : formatDistance(segLens[i - 1] ?? 0, units.distance, decimals.distance),
    }));

    const total: RecapTotal = {
        perimeterStr: formatDistance(
            perimeter(vertices, isRing),
            units.distance,
            decimals.distance
        ),
    };
    if (isRing) {
        total.areaStr = formatArea(area([vertices]), units.area, decimals.area);
    }

    renderRecap(rows, total);
}

/** Hides the recap box and empties its rows. */
export function clearRecap(): void {
    if (!_tbody || !_tfoot || !_recapEl) return;
    _tbody.textContent = "";
    _tfoot.textContent = "";
    _hasContent = false;
    _syncVisibility();
}

/**
 * Tells the box whether its host menu is open. The box stays hidden while the menu is
 * closed, without losing the rows of a measurement still in progress.
 */
export function setRecapMenuOpen(open: boolean): void {
    _menuOpen = open;
    _syncVisibility();
}

/**
 * Drops the DOM references. Called by `destroyMenu()`, which removes the whole menu
 * root — the box goes with it, so only the module state needs resetting here.
 */
export function destroyRecapBox(): void {
    _recapEl = null;
    _tbody = null;
    _tfoot = null;
    _hasContent = false;
    _menuOpen = true;
}
