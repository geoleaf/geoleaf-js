/**
 * T22 branch coverage — src/selection-actions.ts and
 * src/table-renderer-virtual-scroll.ts.
 *
 * Split out of the core `table-renderer.test.js` suite (700-line cap). Shared mock
 * handles are declared via `vi.hoisted` so the factories stay TDZ-safe; `events` is
 * mocked to `null` to exercise the addEventListener fallback path in setupVirtualScroll.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedIds: vi.fn(() => []),
    updateToolbarButtons: vi.fn(),
}));

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../utils/dom-helpers.js", () => ({
    $create: (tag, attrs = {}) => {
        const el = document.createElement(tag);
        if (attrs.className) el.className = attrs.className;
        if (attrs.type) el.setAttribute("type", attrs.type);
        return el;
    },
}));
vi.mock("../utils/events.js", () => ({ events: null }));
vi.mock("../table-seam.js", () => ({
    TableContract: {
        setSelection: h.setSelection,
        clearSelection: h.clearSelection,
        getSelectedIds: h.getSelectedIds,
        updateToolbarButtons: h.updateToolbarButtons,
    },
}));

import { handleRowSelection, selectRange, toggleAllRows } from "../selection-actions.js";
import {
    updateVirtualRows,
    setupVirtualScroll,
    initVirtualState,
} from "../table-renderer-virtual-scroll.js";

const { setSelection, clearSelection, getSelectedIds, updateToolbarButtons } = h;

// ── T22 — selection-actions.ts branch coverage ────────────────────────
describe("selection-actions — T22 branch coverage", () => {
    beforeEach(() => {
        setSelection.mockClear();
        clearSelection.mockClear();
        getSelectedIds.mockReturnValue([]);
        updateToolbarButtons.mockClear();
    });

    it("handleRowSelection ctrlKey=false, isCheckbox=true, selected=true (|| right-side branch)", () => {
        // ctrlKey=false → || evaluates isCheckbox=true (right-side of ||)
        getSelectedIds.mockReturnValue(["f0"]);
        handleRowSelection("f1", true, false, false, true);
        expect(setSelection).toHaveBeenCalledWith(["f0", "f1"], false);
    });

    it("handleRowSelection shiftKey=true but currentSelection empty → falls to simple (length > 0 false)", () => {
        // shiftKey=true but length=0 → && is false → else-if → else
        getSelectedIds.mockReturnValue([]);
        handleRowSelection("f1", true, true, false, false);
        expect(setSelection).toHaveBeenCalledWith(["f1"], false);
    });

    it("selectRange returns early when tbody is not in document (null check)", () => {
        // No .gl-table-panel__table tbody in document.body → selectRange returns early
        document.body.innerHTML = "";
        expect(() => selectRange("f1")).not.toThrow();
        expect(setSelection).not.toHaveBeenCalled();
    });

    it("selectRange returns early when targetIndex not found (targetIndex === -1)", () => {
        const tableDiv = document.createElement("div");
        tableDiv.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr");
        tr.dataset.featureId = "f1";
        tbody.appendChild(tr);
        tableDiv.appendChild(tbody);
        document.body.appendChild(tableDiv);
        getSelectedIds.mockReturnValue(["f1"]);
        selectRange("nonexistent"); // targetIndex = -1
        expect(setSelection).not.toHaveBeenCalled();
        tableDiv.remove();
    });

    it("toggleAllRows returns early when tbody is absent", () => {
        document.body.innerHTML = "";
        expect(() => toggleAllRows(true)).not.toThrow();
        expect(setSelection).not.toHaveBeenCalled();
    });

    it("toggleAllRows with checked=false calls clearSelection", () => {
        const tableDiv = document.createElement("div");
        tableDiv.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr");
        tr.dataset.featureId = "f1";
        tbody.appendChild(tr);
        tableDiv.appendChild(tbody);
        document.body.appendChild(tableDiv);
        clearSelection.mockClear();
        toggleAllRows(false);
        expect(clearSelection).toHaveBeenCalled();
        tableDiv.remove();
    });

    it("toggleAllRows skips row without data-feature-id (id falsy branch)", () => {
        const tableDiv = document.createElement("div");
        tableDiv.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr"); // no data-feature-id
        tbody.appendChild(tr);
        tableDiv.appendChild(tbody);
        document.body.appendChild(tableDiv);
        toggleAllRows(true);
        expect(setSelection).toHaveBeenCalledWith([], false); // empty ids — no valid rows
        tableDiv.remove();
    });

    it("toggleAllRows handles row without .gl-table-panel__checkbox (checkbox falsy branch)", () => {
        const tableDiv = document.createElement("div");
        tableDiv.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr");
        tr.dataset.featureId = "f1";
        // No .gl-table-panel__checkbox child → checkbox = null
        tbody.appendChild(tr);
        tableDiv.appendChild(tbody);
        document.body.appendChild(tableDiv);
        toggleAllRows(true);
        expect(setSelection).toHaveBeenCalledWith(["f1"], false);
        tableDiv.remove();
    });
});

// ── T22 — table-renderer-virtual-scroll.ts branch coverage ───────────────────
describe("table-renderer-virtual-scroll — T22 branch coverage", () => {
    const createRowFn = vi.fn((feature) => {
        const tr = document.createElement("tr");
        tr.textContent = (feature && feature.id) || "row";
        return tr;
    });

    beforeEach(() => createRowFn.mockClear());

    it("updateVirtualRows uses clientHeight=400 fallback when no wrapper (branch 0.1 false)", () => {
        const tbody = document.createElement("tbody");
        // tbody not inside .gl-table-panel__wrapper → wrapper is null → clientHeight = 400
        const features = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}` }));
        expect(() =>
            updateVirtualRows(tbody, features, [], new Set(), 0, createRowFn)
        ).not.toThrow();
    });

    it("updateVirtualRows creates top spacer when startIndex > 0 (branch 4.0 true)", () => {
        const tbody = document.createElement("tbody");
        const features = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}` }));
        // scrollTop=1000 → startIndex = Math.max(0, floor(1000/32)-20) = max(0,31-20) = 11 > 0
        updateVirtualRows(tbody, features, [], new Set(), 1000, createRowFn);
        const spacers = tbody.querySelectorAll(".gl-table-panel__spacer");
        // At least top spacer exists
        expect(spacers.length).toBeGreaterThan(0);
    });

    it("updateVirtualRows skips bottom spacer when all rows visible (branch 5.0 false)", () => {
        const tbody = document.createElement("tbody");
        // 3 features, no scroll → endIndex = min(3, large) = 3 = total → no bottom spacer
        const features = [{ id: "f0" }, { id: "f1" }, { id: "f2" }];
        updateVirtualRows(tbody, features, [], new Set(), 0, createRowFn);
        const spacers = tbody.querySelectorAll(".gl-table-panel__spacer");
        // startIndex=0 (no top), endIndex=3=total (no bottom) → no spacers
        expect(spacers.length).toBe(0);
    });

    it("updateVirtualRows uses colCount=2 when columns is null (branch 2.1 false)", () => {
        const tbody = document.createElement("tbody");
        const features = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}` }));
        // columns=null → colCount = 2
        expect(() =>
            updateVirtualRows(tbody, features, null, new Set(), 1000, createRowFn)
        ).not.toThrow();
    });

    it("setupVirtualScroll returns early when wrapper is missing (branch 7.0 true)", () => {
        const container = document.createElement("div");
        // No .gl-table-panel__wrapper → early return
        expect(() => setupVirtualScroll(container)).not.toThrow();
    });

    it("setupVirtualScroll returns early when tbody[data-virtual] is missing (branch 8.0 true)", () => {
        const container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        // No tbody[data-virtual=true] → early return
        container.appendChild(wrapper);
        container.appendChild(table);
        expect(() => setupVirtualScroll(container)).not.toThrow();
    });

    it("setupVirtualScroll uses addEventListener fallback when _events is null (branch 9.1 false)", () => {
        // events is mocked as null in this test file → uses wrapper.addEventListener
        const container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        tbody.dataset.virtual = "true";
        table.appendChild(tbody);
        container.appendChild(wrapper);
        container.appendChild(table);
        initVirtualState(container, [{ id: "f1" }], [], new Set(), {}, createRowFn);
        expect(() => setupVirtualScroll(container)).not.toThrow();
        // Trigger scroll to test the onScroll callback path
        wrapper.dispatchEvent(new Event("scroll"));
    });

    it("onScroll handler: skips update when no state registered (branch 9.2 true)", () => {
        const container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        tbody.dataset.virtual = "true";
        table.appendChild(tbody);
        container.appendChild(wrapper);
        container.appendChild(table);
        // Don't call initVirtualState → state is not set → onScroll returns early
        setupVirtualScroll(container);
        expect(() => wrapper.dispatchEvent(new Event("scroll"))).not.toThrow();
    });
});
