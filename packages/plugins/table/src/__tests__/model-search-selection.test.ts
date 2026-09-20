/**
 * 🛑 THE DEFECT THESE TARGETS MEASURE. Beyond `VIRTUAL_THRESHOLD` (150) the table renders
 * only the visible window, while search and selection read the **DOM**. Each target below
 * is seen RED on the assertion of the defect before a single line of fix is written; the
 * day of the fix the target goes green and this comment stops being a description of the
 * present.
 *
 * ⚠️ WHY THIS FILE MOCKS ALMOST NOTHING. `table-renderer-branches.test.ts` stubs
 * `VIRTUAL_THRESHOLD` at 500 AND `feature-id.js#getFeatureId` — between the two, no test in
 * the package has ever reached the virtual path with the real identity resolver, which is
 * exactly where the drift of S6 lives. An instrument carrying the blindness it measures
 * cannot measure it: here the virtual scroller and `feature-id` are the REAL modules.
 *
 * Importing `../table-api.js` is what registers the live module into `TableContract`
 * (`table-api.ts:366`), so selection runs through the real model rather than a stub.
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
import { toggleAllRows, selectRange, handleRowSelection } from "../selection-actions.js";
import { getSelectedIds, setSelection, clearSelection } from "../table-selection.js";
import { VIRTUAL_THRESHOLD } from "../table-renderer-virtual-scroll.js";
import * as viewModel from "../view-model.js";
import langFr from "../lang/lang-fr.js";

/**
 * Comfortably above the 150-row threshold, small enough to stay a unit test — and large
 * enough that a filtered view is STILL virtual, which is what S2 needs to measure.
 */
const VIRTUAL_COUNT = VIRTUAL_THRESHOLD * 8;

/** The columns every fixture layer declares. `ref` is what `searchFields` narrows to. */
const COLUMNS = [
    { field: "properties.ref", label: "Ref" },
    { field: "properties.label", label: "Label" },
];

/**
 * Builds a layer, mounts the panel, fills the model and renders — the production path,
 * not a hand-built DOM.
 *
 * @param count - How many features the layer holds.
 * @param opts.naturalId - false drops `feature.id` AND `properties.id`, which is what
 *   forces `feature-id.ts` onto its synthetic counter.
 * @param opts.searchFields - Forwarded to the layer's `table` config block.
 */
function mountLayer(
    count: number,
    opts: {
        naturalId?: boolean;
        searchFields?: string[];
        cap?: number;
        notify?: (message: string, level?: string) => void;
    } = {}
): HTMLElement {
    const { naturalId = true, searchFields, cap, notify } = opts;
    const features = Array.from({ length: count }, (_, i) => {
        const properties: Record<string, unknown> = { ref: `PT-${i}`, label: `Label ${i}` };
        if (naturalId) properties.id = `f${i}`;
        const feature: Record<string, unknown> = { type: "Feature", properties };
        if (naturalId) feature.id = `f${i}`;
        return feature;
    });

    const layerConfig = {
        config: { table: { columns: COLUMNS, ...(searchFields ? { searchFields } : {}) } },
    };
    _g.GeoLeaf = {
        GeoJSON: {
            getLayerData: vi.fn(() => ({ features })),
            getLayerById: vi.fn(() => layerConfig),
            getAllLayers: vi.fn(() => []),
        },
        Layers: { isVisible: vi.fn(() => true) },
        notify,
        // The REAL French dictionary, so a message asserted here proves its key exists and
        // that the substitution runs — not merely that some string was handed over.
        I18n: { getLabel: (key: string) => langFr[key] ?? key },
    } as never;

    tableState._config = { maxRowsPerLayer: cap ?? 100000, resizable: false };
    tableState._currentLayerId = "ly1";
    const container = TablePanel.create({} as never, tableState._config as never);
    tableState._container = container;
    Table.refresh();
    return container;
}

/** Drives the real search field and waits out its 300 ms debounce. */
async function search(text: string): Promise<void> {
    const input = document.querySelector("[data-table-search]") as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 350));
}

/** Scrolls the virtual wrapper, which is what rebuilds the `tbody`. */
function scrollTo(container: HTMLElement, scrollTop: number): void {
    const wrapper = container.querySelector(".gl-table-panel__wrapper") as HTMLElement;
    Object.defineProperty(wrapper, "scrollTop", { value: scrollTop, configurable: true });
    Object.defineProperty(wrapper, "clientHeight", { value: 400, configurable: true });
    wrapper.dispatchEvent(new Event("scroll", { bubbles: true }));
}

/** Feature rows only — spacers carry no `data-feature-id`. */
function featureRows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll("tr[data-feature-id]"));
}

/** The id of the nth rendered feature row. Throws rather than yield `undefined`. */
function rowIdAt(container: HTMLElement, position: number): string {
    const row = featureRows(container)[position];
    if (!row) throw new Error(`no rendered row at position ${position}`);
    return row.getAttribute("data-feature-id") as string;
}

function visibleFeatureRows(container: HTMLElement): HTMLElement[] {
    return featureRows(container).filter((r) => r.style.display !== "none");
}

describe("2.7 — search and selection read the MODEL, not the rendered window", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        TablePanel._eventCleanups = [];
        tableState._selectedIds.clear();
        tableState._cachedData = [];
        tableState._featureIdMap.clear();
        tableState._sortState = { field: null, direction: null };
        // The view model is module state, and it keeps the search text across a rebuild
        // ON PURPOSE — the input keeps its text when the layer changes, so the filter must
        // keep applying. Between tests that is pollution, so it is reset here explicitly.
        viewModel.reset();
    });

    afterEach(() => {
        clearSelection();
        document.body.innerHTML = "";
    });

    // ── Search ───────────────────────────────────────────────────────────────

    it("S1 — a search survives a scroll", async () => {
        const container = mountLayer(VIRTUAL_COUNT);
        await search("label 7");
        const beforeScroll = visibleFeatureRows(container).length;
        expect(beforeScroll).toBeGreaterThan(0);

        scrollTo(container, 2000);

        // THE DEFECT: `updateVirtualRows` clears the tbody and rebuilds rows without
        // re-applying the filter, so every row of the new window shows again.
        const afterScroll = visibleFeatureRows(container);
        const offenders = afterScroll.filter(
            (r) => !(r.textContent ?? "").toLowerCase().includes("label 7")
        );
        expect(offenders).toEqual([]);
    });

    it("S2 — the scroll geometry follows the filtered set, spacers included", async () => {
        const container = mountLayer(VIRTUAL_COUNT);
        // "label 1" keeps 1, 10-19, 100-199 and 1000-1199 — above the threshold, so the
        // filtered view is still virtual and still owes a correct height.
        await search("label 1");
        expect(viewModel.visibleCount()).toBeGreaterThan(VIRTUAL_THRESHOLD);

        const tbody = container.querySelector("tbody[data-virtual=true]") as HTMLElement;
        const spacers = Array.from(
            container.querySelectorAll<HTMLElement>(".gl-table-panel__spacer")
        );

        // THE DEFECT, in two halves. The filter hid the spacers — their `<td>` is empty so
        // it never matched — collapsing the very geometry that positions the window. And
        // the tbody height was posed once, at first render, on the UNFILTERED count: the
        // user scrolled through hundreds of pixels of nothing.
        expect(spacers.filter((sp) => sp.style.display === "none")).toEqual([]);
        expect(tbody.style.height).toBe(viewModel.visibleCount() * 32 + "px");
    });

    it("S7 — a layer declaring searchFields is searched on those fields only", async () => {
        const container = mountLayer(VIRTUAL_COUNT, { searchFields: ["properties.ref"] });
        await search("label 7");

        // THE DEFECT: the filter compares the `textContent` of EVERY cell, so it matches
        // the `label` column although the layer restricted the search to `ref` — the
        // guide promises "seules ces propriétés sont interrogées" and no code reads it.
        expect(visibleFeatureRows(container)).toEqual([]);
    });

    // ── Selection ────────────────────────────────────────────────────────────

    it("S3 — select-all takes the whole layer, not the rendered window", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        expect(featureRows(container).length).toBeLessThan(VIRTUAL_COUNT);

        toggleAllRows(true);

        // THE DEFECT: `toggleAllRows` walks `tbody.querySelectorAll("tr")`, which is the
        // window — on a real 30 000-row layer this selects a few dozen rows in silence.
        expect(getSelectedIds().length).toBe(VIRTUAL_COUNT);
    });

    it("S4 — a range whose anchor scrolled out of the window still selects", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        const firstId = rowIdAt(container, 0);
        handleRowSelection(firstId, true, false, false); // a real single click: it anchors

        scrollTo(container, 4000);
        const targetId = rowIdAt(container, 0);
        expect(targetId).not.toBe(firstId);

        selectRange(targetId);

        // THE DEFECT: the anchor's row is no longer in the DOM, `findIndex` yields -1 and
        // `selectRange` returns — silently, so the user sees a shift-click do nothing.
        expect(getSelectedIds().length).toBeGreaterThan(2);
    });

    it("S5 — the header checkbox reflects the model, not the window", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        setSelection(
            tableState._cachedData.map((_, i) => `f${i}`),
            false
        );
        TableRenderer.updateSelection(container, tableState._selectedIds);

        const checkboxAll = container.querySelector(
            ".gl-table-panel__checkbox-all"
        ) as HTMLInputElement;

        // THE DEFECT: `totalRows` counts the window, `selectedIds.size` counts the model.
        // Everything is selected, yet the box reads neither checked nor indeterminate.
        expect(checkboxAll.checked).toBe(true);
        expect(checkboxAll.indeterminate).toBe(false);
    });

    it("S8 — after a sort, the id→feature map still designates what the model holds", () => {
        mountLayer(VIRTUAL_COUNT);
        Table.sortByField("properties.ref"); // asc
        Table.sortByField("properties.ref"); // desc — reverses the whole array

        // 🛑 THE DEFECT, and it predates this sprint: `refresh()` keys `_featureIdMap` by
        // index BEFORE `applySorting()` reorders `_cachedData` in place. Every entry then
        // points at a pre-sort position, so `getSelectedFeatures()` — read by zoom,
        // highlight and export-of-selection — hands back a DIFFERENT feature than the one
        // the user selected. Measured 20/09/2026: 300 desynchronised entries out of 300.
        //
        // ⚠️ Asserting on a single row would pass on the defect: with a descending sort
        // the fixture's first row happens to keep a coherent id. The invariant is checked
        // over the whole map, which is the only form that cannot be satisfied by luck.
        const desynced = Array.from(tableState._featureIdMap.entries()).filter(([id, index]) => {
            const feature = tableState._cachedData[index] as
                { properties: { id: string } } | undefined;
            return feature?.properties.id !== id;
        });
        expect(desynced).toEqual([]);
    });

    it("S9 — a range selected AFTER a sort follows the displayed order", () => {
        const container = mountLayer(VIRTUAL_COUNT);
        Table.sortByField("properties.ref"); // asc
        Table.sortByField("properties.ref"); // desc

        const rows = featureRows(container);
        const anchorId = rowIdAt(container, 0);
        const targetId = rowIdAt(container, 4);
        handleRowSelection(anchorId, true, false, false);
        selectRange(targetId);

        // ⚠️ WHAT THIS CATCHES THAT S8 DOES NOT. `_featureIdMap` is rebuilt from the sorted
        // rows on every refresh, so it survives a stale internal index; the ANCHOR does
        // not. Without re-deriving `indexById` after a sort, `visiblePositionOfId` returns
        // a pre-sort position and the range runs between two rows the user never picked.
        // Found by mutation on 20/09/2026: dropping `reindex()` from `sortRows` left the
        // whole suite green until this target existed.
        const expected = rows.slice(0, 5).map((r) => r.getAttribute("data-feature-id"));
        expect(getSelectedIds()).toEqual(expected);
    });

    // ── The cap ──────────────────────────────────────────────────────────────

    it("S10 — a capped layer TELLS the user, once per layer and per session", () => {
        const notify = vi.fn();
        mountLayer(20, { cap: 5, notify });

        // 🛑 THE DEFECT: the cut had exactly one channel, `Log.warn`. A user whose layer
        // was silently reduced to its first 1 000 rows read a complete-looking table of an
        // incomplete parc — the same class `truncation-notice.ts` closed for the GeoJSON
        // loader at task 2.4, and for the same reason.
        expect(notify).toHaveBeenCalledTimes(1);
        const [message, level] = notify.mock.calls[0] ?? [];
        expect(level).toBe("warning");
        expect(message).toContain("5");
        expect(message).toContain("20");

        // A refresh must not re-notify: `autoRefresh` re-fetches on every map move, and a
        // warning that fires forty times teaches the user to dismiss it without reading.
        Table.refresh();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("S11 — maxRowsPerLayer: 0 means ZERO, not the default", () => {
        // `||` made a declared 0 fall back to 1 000 — a value the integrator wrote and the
        // code silently replaced.
        const container = mountLayer(20, { cap: 0 });
        expect(featureRows(container)).toEqual([]);
    });

    // ── Identity ─────────────────────────────────────────────────────────────

    it("S6 — a row identity designates the feature the row DISPLAYS, after a scroll", () => {
        const container = mountLayer(VIRTUAL_COUNT, { naturalId: false });
        scrollTo(container, 4000);

        // 🛑 THE DEFECT, AND IT IS WORSE THAN "the id is unknown". `getFeatureId` advances
        // a module counter reset only in `render()`; `updateVirtualRows` mints ids from
        // wherever the previous window left it. Those values ARE keys of `_featureIdMap`
        // — the map holds `__gl_row_0…N-1` — they are simply the keys of OTHER features.
        // So the defect is not a silent EMPTY, it is a silent WRONG: the row shows one
        // entity and its id designates another. Selecting it selects the wrong feature,
        // and zoom flies somewhere else. Asserting "the id is a key of the map" would
        // pass on the defect — measured 20/09/2026.
        const mismatches = featureRows(container)
            .map((row) => {
                const id = row.getAttribute("data-feature-id") as string;
                const index = tableState._featureIdMap.get(id);
                const designated =
                    index == null
                        ? null
                        : (tableState._cachedData[index] as { properties: { ref: string } })
                              .properties.ref;
                const displayed = row.querySelectorAll("td")[1]?.textContent ?? null;
                return { id, designated, displayed };
            })
            .filter((r) => r.designated !== r.displayed);
        expect(mismatches).toEqual([]);
    });
});
