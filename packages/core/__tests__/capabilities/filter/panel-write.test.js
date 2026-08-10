/**
 * Unit tests — capabilities/filter/panel/write.ts (S13).
 *
 * writePanelControls is the exact inverse of readActiveFilter: reflecting a
 * serialised state onto a freshly rendered panel and reading it back yields the
 * same state (the DOM round-trip that replaces permalink's ghost-injection).
 */
import { afterEach, describe, expect, it } from "vitest";

const { renderFilterPanel } = await import("../../../src/capabilities/filter/panel/render.ts");
const { readActiveFilter } = await import("../../../src/capabilities/filter/panel/state.ts");
const { writePanelControls, resetPanelControls } = await import(
    "../../../src/capabilities/filter/panel/write.ts"
);
const { serializeActiveFilter } = await import("../../../src/capabilities/filter/serialize.ts");

const CONFIG = {
    enabled: true,
    fields: [
        { id: "searchText", kind: "text", label: "Recherche" },
        { id: "categories", kind: "taxonomy", label: "Catégories", field: "fclass" },
        { id: "tags", kind: "tag", label: "Tags", field: "attributes.tags" },
        { id: "surface", kind: "range", label: "Surface", field: "surface", min: 0, max: 100 },
        { id: "pmr", kind: "boolean", label: "PMR", field: "acc" },
    ],
};
const OPTIONS = {
    categories: {
        categories: {
            NATURE: {
                label: "Nature",
                subcategories: { PARC: { label: "Parc" }, LAC: { label: "Lac" } },
            },
        },
    },
    tags: { values: [{ value: "free" }, { value: "paid" }] },
};

afterEach(() => {
    document.body.innerHTML = "";
});

function panel() {
    const p = renderFilterPanel(CONFIG, OPTIONS);
    document.body.appendChild(p);
    return p;
}

describe("writePanelControls", () => {
    it("reflects each kind onto the controls (read-back matches)", () => {
        const p = panel();
        const state = {
            fields: [
                { id: "searchText", kind: "text", text: "mus" },
                { id: "categories", kind: "taxonomy", values: ["NATURE", "PARC", "LAC"] },
                { id: "tags", kind: "tag", values: ["free"] },
                { id: "surface", kind: "range", range: { min: 40 } },
                { id: "pmr", kind: "boolean", bool: true },
            ],
        };
        writePanelControls(p, state, CONFIG);

        expect(p.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value).toBe(
            "mus"
        );
        expect(p.querySelector(".gl-filter-tree__checkbox--category").checked).toBe(true);
        expect(
            [...p.querySelectorAll(".gl-filter-tree__checkbox--subcategory")].every(
                (s) => s.checked
            )
        ).toBe(true);
        expect(
            p
                .querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]')
                .classList.contains("gl-is-selected")
        ).toBe(true);
        expect(p.querySelector('[data-gl-filter-id="surface"] input[type="range"]').value).toBe(
            "40"
        );
        expect(
            p.querySelector('[data-gl-filter-id="surface"] .gl-filter-panel__range-value')
                .textContent
        ).toBe("40");
        expect(p.querySelector('[data-gl-filter-id="pmr"] input[type="checkbox"]').checked).toBe(
            true
        );
    });

    it("marks the parent category indeterminate on a partial sub-selection", () => {
        const p = panel();
        writePanelControls(
            p,
            { fields: [{ id: "categories", kind: "taxonomy", values: ["LAC"] }] },
            CONFIG
        );
        const cat = p.querySelector(".gl-filter-tree__checkbox--category");
        expect(cat.checked).toBe(false);
        expect(cat.indeterminate).toBe(true);
    });

    it("round-trips a driven panel → read → serialize → write → read (identical)", () => {
        const a = panel();
        a.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value = "Mus";
        a.querySelector(".gl-filter-tree__checkbox--category").checked = true;
        a.querySelectorAll(".gl-filter-tree__checkbox--subcategory").forEach(
            (s) => (s.checked = true)
        );
        a.querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]').classList.add(
            "gl-is-selected"
        );
        a.querySelector('[data-gl-filter-id="surface"] input[type="range"]').value = "25";
        const captured = serializeActiveFilter(readActiveFilter(a, CONFIG));

        document.body.innerHTML = "";
        const b = panel();
        writePanelControls(b, captured, CONFIG);
        const restored = serializeActiveFilter(readActiveFilter(b, CONFIG));
        expect(restored).toEqual(captured);
    });

    it("no-ops on a null panel", () => {
        expect(() => writePanelControls(null, { fields: [] }, CONFIG)).not.toThrow();
    });
});

describe("resetPanelControls", () => {
    it("clears every control", () => {
        const p = panel();
        writePanelControls(
            p,
            {
                fields: [
                    { id: "searchText", kind: "text", text: "x" },
                    { id: "tags", kind: "tag", values: ["free"] },
                ],
            },
            CONFIG
        );
        resetPanelControls(p);
        expect(p.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value).toBe(
            ""
        );
        expect(p.querySelector(".gl-filter-panel__tag-badge.gl-is-selected")).toBeNull();
        expect(readActiveFilter(p, CONFIG)).toEqual([]);
    });
});
