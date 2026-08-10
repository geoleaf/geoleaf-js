/**
 * Unit tests — capabilities/filter/panel (S5, F2).
 *
 * Mapping-driven renderer + state reader round-trip: build the panel from the
 * config, drive the controls, read back the engine's ActiveField[].
 */
import { describe, expect, it } from "vitest";

const { renderFilterPanel } = await import("../../../src/capabilities/filter/panel/render.ts");
const { readActiveFilter } = await import("../../../src/capabilities/filter/panel/state.ts");

const CONFIG = {
    enabled: true,
    title: "Filtrer",
    fields: [
        { id: "searchText", kind: "text", label: "Recherche", placeholder: "Rechercher…" },
        {
            id: "categories",
            kind: "taxonomy",
            label: "Catégories",
            field: "fclass",
            taxonomyRef: "poi",
        },
        { id: "tags", kind: "tag", label: "Tags", field: "attributes.tags" },
        { id: "surface", kind: "range", label: "Surface", field: "surface", min: 0, max: 100 },
        { id: "pmr", kind: "boolean", label: "PMR", field: "accessible" },
    ],
    actions: { applyLabel: "Appliquer", resetLabel: "Réinitialiser" },
};

const OPTIONS = {
    categories: {
        categories: {
            CULTURES: { label: "Culture", subcategories: { MUSEE: { label: "Musée" } } },
        },
    },
    tags: { values: [{ value: "free", label: "Gratuit" }, { value: "paid" }] },
};

describe("renderFilterPanel", () => {
    it("builds the panel shell with a group per field", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        expect(panel.id).toBe("gl-filter-panel");
        expect(panel.querySelector(".gl-filter-panel__header")).toBeTruthy();
        expect(panel.querySelector(".gl-filter-panel__footer")).toBeTruthy();
        expect(panel.querySelectorAll(".gl-filter-panel__group")).toHaveLength(5);
        expect(
            panel
                .querySelector('[data-gl-filter-id="categories"]')
                ?.getAttribute("data-gl-filter-kind")
        ).toBe("taxonomy");
    });
    it("renders the taxonomy tree + tag badges from options", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        expect(panel.querySelectorAll(".gl-filter-tree__checkbox--category")).toHaveLength(1);
        expect(panel.querySelectorAll(".gl-filter-tree__checkbox--subcategory")).toHaveLength(1);
        expect(panel.querySelectorAll(".gl-filter-panel__tag-badge")).toHaveLength(2);
    });
    it("emits apply/reset actions with the configured labels", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        expect(panel.querySelector('[data-gl-action="filter-apply"]')?.textContent).toBe(
            "Appliquer"
        );
        expect(panel.querySelector('[data-gl-action="filter-reset"]')?.textContent).toBe(
            "Réinitialiser"
        );
    });
});

describe("readActiveFilter — round-trip", () => {
    it("returns [] for an untouched panel", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        expect(readActiveFilter(panel, CONFIG)).toEqual([]);
    });
    it("reads each kind back into ActiveField[]", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);

        panel.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value = "Mus";
        panel.querySelector(".gl-filter-tree__checkbox--category").checked = true;
        panel.querySelector(".gl-filter-tree__checkbox--subcategory").checked = true;
        panel
            .querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]')
            .classList.add("gl-is-selected");
        const range = panel.querySelector('[data-gl-filter-id="surface"] input[type="range"]');
        range.value = "30";
        panel.querySelector('[data-gl-filter-id="pmr"] input[type="checkbox"]').checked = true;

        const active = readActiveFilter(panel, CONFIG);
        const byId = Object.fromEntries(active.map((a) => [a.descriptor.id, a]));

        expect(byId.searchText.text).toBe("mus");
        expect(byId.categories.values).toEqual(["CULTURES", "MUSEE"]);
        expect(byId.tags.values).toEqual(["free"]);
        expect(byId.surface.range).toEqual({ min: 30 });
        expect(byId.pmr.bool).toBe(true);
    });
    it("omits a range left at its minimum", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        // range value stays at min (0) → not active
        const active = readActiveFilter(panel, CONFIG);
        expect(active.find((a) => a.descriptor.id === "surface")).toBeUndefined();
    });
});

describe("readActiveFilter — proximity", () => {
    const PROX_CONFIG = {
        enabled: true,
        fields: [{ id: "proximity", kind: "proximity", label: "Proximité" }],
    };
    it("reads an active proximity from the toolbar wrapper (driven by the toolbar, not the panel — S5)", () => {
        const wrapper = document.createElement("div");
        wrapper.id = "gl-proximity-toolbar-wrapper";
        wrapper.setAttribute("data-proximity-active", "true");
        wrapper.setAttribute("data-proximity-lat", "48.85");
        wrapper.setAttribute("data-proximity-lng", "2.35");
        wrapper.setAttribute("data-proximity-radius", "5");
        document.body.appendChild(wrapper);
        // Panel not required: proximity is read straight from the toolbar wrapper.
        const active = readActiveFilter(null, PROX_CONFIG);
        expect(active).toHaveLength(1);
        // Radius is converted km → metres (engine compares against haversine metres).
        expect(active[0].proximity).toEqual({ center: { lat: 48.85, lng: 2.35 }, radius: 5000 });
        wrapper.remove();
    });
    it("omits proximity when no active toolbar wrapper is present", () => {
        expect(readActiveFilter(null, PROX_CONFIG)).toEqual([]);
    });
});

describe("taxonomy tree — cascade, tri-state & expand", () => {
    const TREE_CONFIG = {
        enabled: true,
        fields: [{ id: "categories", kind: "taxonomy", label: "Catégories", field: "cat" }],
    };
    const TREE_OPTIONS = {
        categories: {
            categories: {
                NATURE: {
                    label: "Nature",
                    subcategories: { PARC: { label: "Parc" }, LAC: { label: "Lac" } },
                },
            },
        },
    };

    it("nests sub-categories under their category (real tree, not a flat list)", () => {
        const panel = renderFilterPanel(TREE_CONFIG, TREE_OPTIONS);
        const item = panel.querySelector(".gl-filter-tree__item--category");
        expect(item.querySelector(".gl-filter-tree--subcategories")).toBeTruthy();
        expect(item.querySelectorAll(".gl-filter-tree__checkbox--subcategory")).toHaveLength(2);
        expect(item.querySelector(".gl-filter-tree__arrow")).toBeTruthy();
    });
    it("checking a category checks all its sub-categories", () => {
        const panel = renderFilterPanel(TREE_CONFIG, TREE_OPTIONS);
        const cat = panel.querySelector(".gl-filter-tree__checkbox--category");
        cat.checked = true;
        cat.dispatchEvent(new Event("change", { bubbles: true }));
        const subs = [...panel.querySelectorAll(".gl-filter-tree__checkbox--subcategory")];
        expect(subs.every((s) => s.checked)).toBe(true);
        expect(cat.indeterminate).toBe(false);
    });
    it("a partial sub-category selection makes the parent indeterminate", () => {
        const panel = renderFilterPanel(TREE_CONFIG, TREE_OPTIONS);
        const [sub1] = panel.querySelectorAll(".gl-filter-tree__checkbox--subcategory");
        sub1.checked = true;
        sub1.dispatchEvent(new Event("change", { bubbles: true }));
        const cat = panel.querySelector(".gl-filter-tree__checkbox--category");
        expect(cat.indeterminate).toBe(true);
        expect(cat.checked).toBe(false);
    });
    it("expands the category via the arrow", () => {
        const panel = renderFilterPanel(TREE_CONFIG, TREE_OPTIONS);
        const item = panel.querySelector(".gl-filter-tree__item--category");
        expect(item.classList.contains("is-expanded")).toBe(false);
        panel
            .querySelector(".gl-filter-tree__arrow")
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(item.classList.contains("is-expanded")).toBe(true);
    });
    it("keeps the parent-category link on sub-category checkboxes (permalink)", () => {
        const panel = renderFilterPanel(TREE_CONFIG, TREE_OPTIONS);
        const sub = panel.querySelector(".gl-filter-tree__checkbox--subcategory");
        expect(sub.getAttribute("data-gl-filter-category-id")).toBe("NATURE");
        expect(sub.getAttribute("data-gl-filter-subcategory-id")).toBe("PARC");
    });
});

describe("tag badges — auto-apply", () => {
    it("toggles the badge and bubbles a change (auto-apply parity)", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        const badge = panel.querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]');
        let changed = false;
        panel.addEventListener("change", () => {
            changed = true;
        });
        badge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(badge.classList.contains("gl-is-selected")).toBe(true);
        expect(changed).toBe(true);
    });
});

describe("text search — pill widget", () => {
    it("renders the shared pill (magnifier + clear) with the state/indicator hooks", () => {
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        const group = panel.querySelector('[data-gl-filter-id="searchText"]');
        expect(group.querySelector(".gl-pill-search")).toBeTruthy();
        const input = group.querySelector("input.gl-pill-search__input");
        expect(input).toBeTruthy();
        expect(input.type).toBe("text");
        expect(group.querySelector(".gl-pill-search__submit")).toBeTruthy();
        expect(group.querySelector(".gl-pill-search__clear")).toBeTruthy();
    });
});
