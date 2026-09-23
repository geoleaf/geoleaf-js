/**
 * Unit tests — capabilities/filter/panel/write.ts (S13).
 *
 * writePanelControls is the exact inverse of readActiveFilter: reflecting a
 * serialised state onto a freshly rendered panel and reading it back yields the
 * same state (the DOM round-trip that replaces permalink's ghost-injection). A taxonomy
 * `subValues` restores a shared sub-category id under the category it was checked under.
 */
import { afterEach, describe, expect, it } from "vitest";

const { renderFilterPanel } = await import("../../../src/capabilities/filter/panel/render.ts");
const { readActiveFilter } = await import("../../../src/capabilities/filter/panel/state.ts");
const { writePanelControls, resetPanelControls } =
    await import("../../../src/capabilities/filter/panel/write.ts");
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

describe("writePanelControls — taxonomy subValues", () => {
    const SUB_CONFIG = {
        enabled: true,
        fields: [{ id: "cats", kind: "taxonomy", field: "cat", subField: "sub" }],
    };
    // LAC is listed under two categories: a sub-category id is unique only within its category.
    const SUB_OPTIONS = {
        cats: {
            categories: {
                NATURE: { subcategories: { PARC: {}, LAC: {} } },
                SPORT: { subcategories: { LAC: {}, STADE: {} } },
                MUSEE: {},
                PLAGE: {},
            },
        },
    };
    // PLAGE is both a leaf category and a sub-category id of NATURE.
    const COLLIDING_OPTIONS = {
        cats: { categories: { NATURE: { subcategories: { PARC: {}, PLAGE: {} } }, PLAGE: {} } },
    };
    function mount(options = SUB_OPTIONS) {
        const p = renderFilterPanel(SUB_CONFIG, options);
        document.body.appendChild(p);
        return p;
    }
    const cat = (p, id) =>
        [...p.querySelectorAll(".gl-filter-tree__checkbox--category")].find(
            (el) => el.value === id
        );
    const sub = (p, c, s) =>
        p.querySelector(
            `.gl-filter-tree__checkbox--subcategory[data-gl-filter-category-id="${c}"][data-gl-filter-subcategory-id="${s}"]`
        );
    const tick = (el) => {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    /** Every tree box as [category, sub-category, checked, indeterminate]. */
    const boxes = (p) =>
        [...p.querySelectorAll(".gl-filter-tree__checkbox")].map((el) => [
            el.getAttribute("data-gl-filter-category-id") ?? el.value,
            el.getAttribute("data-gl-filter-subcategory-id") ?? "",
            el.checked,
            el.indeterminate,
        ]);
    const write = (p, field) => writePanelControls(p, { fields: [field] }, SUB_CONFIG);

    /** Drives panel A, captures it, writes the capture onto a fresh panel B, compares the boxes. */
    function roundTrip(act, options) {
        const a = mount(options);
        act(a);
        const before = boxes(a);
        const captured = serializeActiveFilter(readActiveFilter(a, SUB_CONFIG));
        document.body.innerHTML = "";
        const b = mount(options);
        writePanelControls(b, captured, SUB_CONFIG);
        expect(boxes(b)).toEqual(before);
        expect(serializeActiveFilter(readActiveFilter(b, SUB_CONFIG))).toEqual(captured);
        return b;
    }

    it("restores a sub-category checked alone under its category", () => {
        roundTrip((p) => tick(sub(p, "NATURE", "PARC")));
    });

    it("restores a cascaded category without checking its sub-category ids elsewhere", () => {
        const b = roundTrip((p) => tick(cat(p, "NATURE")));
        expect(sub(b, "SPORT", "LAC").checked).toBe(false);
    });

    it("restores a shared sub-category id under the category it was checked under only", () => {
        const b = roundTrip((p) => tick(sub(p, "SPORT", "LAC")));
        expect(sub(b, "NATURE", "LAC").checked).toBe(false);
    });

    it("does not check a leaf category whose id is a checked sub-category's", () => {
        const b = roundTrip((p) => tick(sub(p, "NATURE", "PLAGE")), COLLIDING_OPTIONS);
        expect(cat(b, "PLAGE").checked).toBe(false);
        roundTrip((p) => {
            tick(sub(p, "NATURE", "PLAGE"));
            tick(cat(p, "PLAGE"));
        }, COLLIDING_OPTIONS);
    });

    it("ignores malformed entries, and falls back to values when none is usable", () => {
        const p = mount();
        expect(() =>
            write(p, {
                id: "cats",
                kind: "taxonomy",
                values: ["LAC"],
                subValues: [null, 42, { value: "LAC" }],
            })
        ).not.toThrow();
        expect(sub(p, "NATURE", "LAC").checked).toBe(true);
        expect(sub(p, "SPORT", "LAC").checked).toBe(true);
        expect(() =>
            write(p, { id: "cats", kind: "taxonomy", values: ["LAC"], subValues: "LAC" })
        ).not.toThrow();
        expect(sub(p, "NATURE", "LAC").checked).toBe(true);

        document.body.innerHTML = "";
        const q = mount();
        write(q, {
            id: "cats",
            kind: "taxonomy",
            values: ["LAC"],
            subValues: [null, { value: "LAC", category: "SPORT" }],
        });
        expect(sub(q, "SPORT", "LAC").checked).toBe(true);
        expect(sub(q, "NATURE", "LAC").checked).toBe(false);
    });

    it("checks nothing for a pair whose sub-category id is missing from values", () => {
        const p = mount();
        write(p, {
            id: "cats",
            kind: "taxonomy",
            values: ["PARC"],
            subValues: [
                { value: "PARC", category: "NATURE" },
                { value: "STADE", category: "SPORT" },
            ],
        });
        expect(sub(p, "NATURE", "PARC").checked).toBe(true);
        expect(sub(p, "SPORT", "STADE").checked).toBe(false);
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
