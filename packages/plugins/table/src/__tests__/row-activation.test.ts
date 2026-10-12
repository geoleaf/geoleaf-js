/**
 * Row activation — `geoleaf:table:rowActivated`.
 *
 * Mounted through the production path (panel, model, renderer, virtual scroller, identity
 * resolver are the REAL modules — same reasons as `model-search-selection.test.ts`), because
 * what is measured here is a chain: a DOM gesture, a delegated listener, a model lookup, an
 * emission on two buses, and a selection that must come back to where it started.
 *
 * ⚠️ A real double-click is THREE events — `click` (detail 1), `click` (detail 2),
 * `dblclick`. Dispatching `dblclick` alone would prove the emission and nothing about the
 * selection, which is where the gesture is delicate. `doubleClick()` sends all three.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { Table } from "../table-api.js";
import { TablePanel } from "../panel.js";
import { TableRenderer } from "../renderer.js";
import { tableState, _g } from "../table-state.js";
import { getSelectedIds, setSelection } from "../table-selection.js";
import { VIRTUAL_THRESHOLD } from "../table-renderer-virtual-scroll.js";
import * as viewModel from "../view-model.js";

const ACTIVATED = "geoleaf:table:rowActivated";
const SELECTION = "geoleaf:table:selectionChanged";
const VIRTUAL_COUNT = VIRTUAL_THRESHOLD * 8;

const COLUMNS = [{ field: "properties.ref", label: "Ref" }];

function mountLayer(count: number, opts: { naturalId?: boolean } = {}): HTMLElement {
    const { naturalId = true } = opts;
    const features = Array.from({ length: count }, (_, i) => {
        // `hidden` is displayed by no column: it proves the payload carries the feature's
        // properties, not the cells.
        const properties: Record<string, unknown> = { ref: `PT-${i}`, hidden: `H-${i}` };
        const feature: Record<string, unknown> = { type: "Feature", properties };
        if (naturalId) feature.id = `f${i}`;
        return feature;
    });
    _g.GeoLeaf = {
        GeoJSON: {
            getLayerData: vi.fn(() => ({ features })),
            getLayerById: vi.fn(() => ({ config: { table: { columns: COLUMNS } } })),
            getAllLayers: vi.fn(() => []),
        },
        Layers: { isVisible: vi.fn(() => true) },
        I18n: { getLabel: (key: string) => key },
    } as never;

    tableState._config = { maxRowsPerLayer: 100000, resizable: false };
    tableState._currentLayerId = "ly1";
    const container = TablePanel.create({} as never, tableState._config as never);
    tableState._container = container;
    Table.refresh();
    return container;
}

function rowOf(container: HTMLElement, featureId: string): HTMLElement {
    const row = container.querySelector<HTMLElement>(`tr[data-feature-id="${featureId}"]`);
    if (!row) throw new Error(`no rendered row for ${featureId}`);
    return row;
}

/** The first data cell of a row — where a user double-clicks. */
function cellOf(row: HTMLElement): HTMLElement {
    return row.querySelector("td:not(.gl-table-panel__td--checkbox)") as HTMLElement;
}

function click(target: HTMLElement, detail = 1, init: MouseEventInit = {}): void {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail, ...init }));
}

/** The three events a browser sends for one double-click. */
function doubleClick(target: HTMLElement): void {
    click(target, 1);
    click(target, 2);
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

function scrollTo(container: HTMLElement, scrollTop: number): void {
    const wrapper = container.querySelector(".gl-table-panel__wrapper") as HTMLElement;
    Object.defineProperty(wrapper, "scrollTop", { value: scrollTop, configurable: true });
    Object.defineProperty(wrapper, "clientHeight", { value: 400, configurable: true });
    wrapper.dispatchEvent(new Event("scroll", { bubbles: true }));
}

describe("row activation — geoleaf:table:rowActivated", () => {
    let onActivated: ReturnType<typeof vi.fn>;
    let onSelection: ReturnType<typeof vi.fn>;
    let mapFire: ReturnType<typeof vi.fn>;

    const activatedDetails = () =>
        onActivated.mock.calls.map((call) => (call[0] as CustomEvent).detail);
    const activatedOnMap = () => mapFire.mock.calls.filter((call) => call[0] === ACTIVATED);

    beforeEach(() => {
        document.body.innerHTML = "";
        TablePanel._eventCleanups = [];
        tableState._selectedIds.clear();
        tableState._cachedData = [];
        tableState._featureIdMap.clear();
        tableState._sortState = { field: null, direction: null };
        viewModel.reset();

        onActivated = vi.fn();
        onSelection = vi.fn();
        mapFire = vi.fn();
        tableState._map = { fire: mapFire } as never;
        document.addEventListener(ACTIVATED, onActivated as EventListener);
        document.addEventListener(SELECTION, onSelection as EventListener);
    });

    afterEach(() => {
        document.removeEventListener(ACTIVATED, onActivated as EventListener);
        document.removeEventListener(SELECTION, onSelection as EventListener);
        // Not `clearSelection()`: after T2's destroy there is no container left to repaint.
        tableState._selectedIds.clear();
        TableRenderer.destroy();
        tableState._map = null as never;
        document.body.innerHTML = "";
    });

    // ── Emission ─────────────────────────────────────────────────────────────

    it("A1 — a double-click emits once, on document and on the map, with the row's payload", () => {
        const container = mountLayer(5);
        doubleClick(cellOf(rowOf(container, "f2")));

        const expected = {
            layerId: "ly1",
            featureId: "f2",
            properties: { ref: "PT-2", hidden: "H-2" },
        };
        expect(activatedDetails()).toEqual([expected]);
        expect(activatedOnMap()).toEqual([[ACTIVATED, expected]]);
    });

    it("A2 — the payload is cloneable, and its properties are a copy, not the layer's object", () => {
        const container = mountLayer(5);
        doubleClick(cellOf(rowOf(container, "f2")));

        const [detail] = activatedDetails();
        expect(structuredClone(detail)).toEqual(detail);
        expect(detail.properties).not.toBe(viewModel.rowById("f2")?.feature.properties);
    });

    it("A3 — Enter on the focused row emits once and touches no selection", () => {
        const container = mountLayer(5);
        const row = rowOf(container, "f3");
        expect(row.getAttribute("tabindex")).toBe("0");

        pressKey(row, "Enter");

        expect(activatedDetails()).toEqual([
            { layerId: "ly1", featureId: "f3", properties: { ref: "PT-3", hidden: "H-3" } },
        ]);
        expect(onSelection).not.toHaveBeenCalled();
    });

    it("A4 — a feature without identifier is activated under its synthetic row id", () => {
        const container = mountLayer(3, { naturalId: false });
        const row = container.querySelectorAll<HTMLElement>("tr[data-feature-id]")[1]!;
        const rowId = row.getAttribute("data-feature-id") as string;
        expect(rowId.startsWith("__gl_row_")).toBe(true);

        doubleClick(cellOf(row));

        expect(activatedDetails()).toEqual([
            { layerId: "ly1", featureId: rowId, properties: { ref: "PT-1", hidden: "H-1" } },
        ]);
    });

    // ── What does NOT activate ───────────────────────────────────────────────

    it("N1 — a single click does not activate", () => {
        const container = mountLayer(5);
        click(cellOf(rowOf(container, "f1")));
        expect(onActivated).not.toHaveBeenCalled();
        expect(getSelectedIds()).toEqual(["f1"]);
    });

    it("N2 — a double-click in the checkbox cell does not activate", () => {
        const container = mountLayer(5);
        const row = rowOf(container, "f1");
        const cell = row.querySelector(".gl-table-panel__td--checkbox") as HTMLElement;
        const checkbox = row.querySelector(".gl-table-panel__checkbox") as HTMLElement;

        doubleClick(checkbox);
        doubleClick(cell);

        expect(onActivated).not.toHaveBeenCalled();
    });

    it("N3 — Enter activates only from the row itself, and only Enter does", () => {
        const container = mountLayer(5);
        const row = rowOf(container, "f1");

        pressKey(row.querySelector(".gl-table-panel__checkbox") as HTMLElement, "Enter");
        // Enter coming from INSIDE the row belongs to whatever holds the focus there.
        pressKey(cellOf(row), "Enter");
        pressKey(row, " ");
        pressKey(row, "ArrowDown");
        pressKey(row, "Enter", { repeat: true });

        expect(onActivated).not.toHaveBeenCalled();
    });

    it("N4 — the sort header does not activate, clicked or double-clicked", () => {
        const container = mountLayer(5);
        const th = () => container.querySelector(".gl-table-panel__th--sortable") as HTMLElement;

        click(th());
        th().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        pressKey(th(), "Enter");

        expect(onActivated).not.toHaveBeenCalled();
    });

    // ── Selection across a double-click ──────────────────────────────────────

    it("S1 — from an empty selection: back to empty, two selectionChanged", () => {
        const container = mountLayer(5);
        doubleClick(cellOf(rowOf(container, "f2")));

        expect(getSelectedIds()).toEqual([]);
        expect(viewModel.anchorId()).toBeNull();
        expect(onSelection).toHaveBeenCalledTimes(2);
        expect(rowOf(container, "f2").classList.contains("gl-is-selected")).toBe(false);
    });

    it("S2 — from the row alone selected: it stays selected, anchor included", () => {
        const container = mountLayer(5);
        click(cellOf(rowOf(container, "f2")));
        expect(viewModel.anchorId()).toBe("f2");
        onSelection.mockClear();

        doubleClick(cellOf(rowOf(container, "f2")));

        expect(getSelectedIds()).toEqual(["f2"]);
        expect(viewModel.anchorId()).toBe("f2");
        expect(onSelection).toHaveBeenCalledTimes(2);
        expect(rowOf(container, "f2").classList.contains("gl-is-selected")).toBe(true);
    });

    it("S3 — a multiple selection survives a double-click on one of its rows, and on another row", () => {
        const container = mountLayer(6);
        click(cellOf(rowOf(container, "f1")));
        click(cellOf(rowOf(container, "f3")), 1, { shiftKey: true });
        expect(getSelectedIds()).toEqual(["f1", "f2", "f3"]);
        onSelection.mockClear();

        doubleClick(cellOf(rowOf(container, "f2")));
        expect(getSelectedIds().sort()).toEqual(["f1", "f2", "f3"]);
        expect(viewModel.anchorId()).toBe("f1");
        expect(onSelection).toHaveBeenCalledTimes(2);

        doubleClick(cellOf(rowOf(container, "f5")));
        expect(getSelectedIds().sort()).toEqual(["f1", "f2", "f3"]);
        expect(viewModel.anchorId()).toBe("f1");
        expect(activatedDetails().map((d) => d.featureId)).toEqual(["f2", "f5"]);
    });

    it("S4 — the last selectionChanged of a double-click carries the initial selection", () => {
        const container = mountLayer(6);
        setSelection(["f1", "f4"]);
        onSelection.mockClear();

        doubleClick(cellOf(rowOf(container, "f4")));

        const last = onSelection.mock.calls.at(-1)?.[0] as CustomEvent;
        expect([...last.detail.selectedIds].sort()).toEqual(["f1", "f4"]);
    });

    it("S5 — a third click of the same burst toggles nothing", () => {
        const container = mountLayer(5);
        const cell = cellOf(rowOf(container, "f2"));
        doubleClick(cell);
        onSelection.mockClear();

        click(cell, 3);

        expect(onSelection).not.toHaveBeenCalled();
        expect(getSelectedIds()).toEqual([]);
    });

    // ── Virtual scrolling ────────────────────────────────────────────────────

    it("V1 — a row re-created by the virtual scroll still activates, by double-click and by Enter", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        scrollTo(container, 400 * 32);
        scrollTo(container, 600 * 32);

        const row = rowOf(container, "f600");
        doubleClick(cellOf(row));
        pressKey(row, "Enter");

        expect(activatedDetails().map((d) => d.featureId)).toEqual(["f600", "f600"]);
        expect(activatedDetails()[0].properties).toEqual({ ref: "PT-600", hidden: "H-600" });
        expect(getSelectedIds()).toEqual([]);
    });

    it("V2 — scrolling attaches nothing and registers nothing: the tbody carries every row listener", () => {
        // 🛑 Measured in Chromium on 30 000 rows before this held: 2 000 scroll events left
        // 98 122 detached rows alive, each kept by the teardown of its own click listener.
        const container = mountLayer(VIRTUAL_COUNT);
        const tbody = container.querySelector("tbody") as HTMLElement;
        const onTbody = vi.spyOn(tbody, "addEventListener");
        const onRows = vi.spyOn(HTMLTableRowElement.prototype, "addEventListener");
        const onInputs = vi.spyOn(HTMLInputElement.prototype, "addEventListener");
        const registered = TableRenderer._eventCleanups.length;

        for (let step = 1; step <= 10; step++) scrollTo(container, step * 50 * 32);

        expect(onTbody).not.toHaveBeenCalled();
        expect(onRows).not.toHaveBeenCalled();
        expect(onInputs).not.toHaveBeenCalled();
        expect(TableRenderer._eventCleanups.length).toBe(registered);
        onRows.mockRestore();
        onInputs.mockRestore();
    });

    it("V3 — a row re-created by the virtual scroll still selects, by click and by its checkbox", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        scrollTo(container, 600 * 32);

        click(cellOf(rowOf(container, "f600")));
        expect(getSelectedIds()).toEqual(["f600"]);

        const box = rowOf(container, "f601").querySelector(
            ".gl-table-panel__checkbox"
        ) as HTMLInputElement;
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        expect(getSelectedIds().sort()).toEqual(["f600", "f601"]);

        // A click ON the checkbox is the checkbox's: it ticks the box, whose `change` selects
        // — ONCE. The row click must not toggle on top of it.
        const other = rowOf(container, "f602").querySelector(
            ".gl-table-panel__checkbox"
        ) as HTMLInputElement;
        onSelection.mockClear();
        click(other);
        expect(onSelection.mock.calls.length).toBe(1);
        expect(getSelectedIds().sort()).toEqual(["f600", "f601", "f602"]);

        // A `change` bubbling from anything else in a row is not a selection gesture.
        onSelection.mockClear();
        cellOf(rowOf(container, "f600")).dispatchEvent(new Event("change", { bubbles: true }));
        expect(onSelection).not.toHaveBeenCalled();
    });

    // ── Teardown ─────────────────────────────────────────────────────────────

    it("T1 — a re-render does not double the emission", () => {
        const container = mountLayer(5);
        Table.refresh();
        Table.refresh();

        doubleClick(cellOf(rowOf(container, "f2")));

        expect(onActivated).toHaveBeenCalledTimes(1);
    });

    it("T2 — after destroy, no listener is left: the old rows activate nothing", () => {
        const container = mountLayer(5);
        const row = rowOf(container, "f2");
        const cell = cellOf(row);
        // ⚠️ Dispatching on the dead rows is not enough of a witness: destroy also empties
        // the model, so a listener left behind would find no row and stay silent. The
        // removal itself is what is observed.
        const removed = vi.spyOn(row.parentElement as HTMLElement, "removeEventListener");

        Table.destroy();

        expect(removed.mock.calls.map((call) => call[0]).sort()).toEqual([
            "change",
            "click",
            "dblclick",
            "keydown",
        ]);
        expect(TableRenderer._eventCleanups.length).toBe(0);
        doubleClick(cell);
        pressKey(row, "Enter");
        expect(onActivated).not.toHaveBeenCalled();
        expect(onSelection).not.toHaveBeenCalled();
    });
});
