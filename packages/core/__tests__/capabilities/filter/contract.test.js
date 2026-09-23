/**
 * Unit tests — capabilities/filter/public-api.ts serialisation contract (S13).
 *
 * The `GeoLeaf.Filter` facade delegates to the capability modules: getActiveFilter
 * reads the mounted panel, applyFilter writes it + applies + notifies, reset/applyNow
 * drive the apply pipeline, proximity delegates. The apply pipeline and proximity
 * module are mocked (unit isolation from GeoJSONCore / the map).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));
const { applyToSources, applyFromPanel } = vi.hoisted(() => ({
    applyToSources: vi.fn(),
    applyFromPanel: vi.fn(),
}));
const { setRadius, toggleToolbar } = vi.hoisted(() => ({
    setRadius: vi.fn(),
    toggleToolbar: vi.fn(() => true),
}));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));
vi.mock("../../../src/capabilities/filter/apply.js", () => ({
    applyActiveFilterToSources: (...a) => applyToSources(...a),
    applyFilterFromPanel: (...a) => applyFromPanel(...a),
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity.js", () => ({
    FilterPanelProximity: {
        setProximityRadius: (...a) => setRadius(...a),
        toggleProximityToolbar: (...a) => toggleToolbar(...a),
    },
}));

const { renderFilterPanel } = await import("../../../src/capabilities/filter/panel/render.ts");
const { buildPublicApi } = await import("../../../src/capabilities/filter/public-api.ts");

const CONFIG = {
    enabled: true,
    fields: [
        { id: "searchText", kind: "text" },
        { id: "tags", kind: "tag", field: "attributes.tags" },
        { id: "surface", kind: "range", field: "surface", min: 0, max: 100 },
    ],
};
const OPTIONS = { tags: { values: [{ value: "free" }] } };

function mountPanel() {
    const p = renderFilterPanel(CONFIG, OPTIONS);
    document.body.appendChild(p);
    return p;
}

afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
});

describe("GeoLeaf.Filter — serialisation contract", () => {
    it("getActiveFilter() reads the mounted panel as a serialisable state", () => {
        configGet.mockReturnValue(CONFIG);
        const p = mountPanel();
        p.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value = "abc";
        p.querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]').classList.add(
            "gl-is-selected"
        );
        expect(buildPublicApi().getActiveFilter().fields).toEqual([
            { id: "searchText", kind: "text", text: "abc" },
            { id: "tags", kind: "tag", values: ["free"] },
        ]);
    });

    it("getActiveFilter() returns an empty state when no panel is mounted", () => {
        configGet.mockReturnValue(CONFIG);
        expect(buildPublicApi().getActiveFilter()).toEqual({ fields: [] });
    });

    it("applyFilter() writes the panel, applies to sources and notifies", () => {
        configGet.mockReturnValue(CONFIG);
        const p = mountPanel();
        let notified = false;
        document.addEventListener("geoleaf:filters:applied", () => (notified = true), {
            once: true,
        });
        buildPublicApi().applyFilter({ fields: [{ id: "searchText", kind: "text", text: "xyz" }] });
        expect(p.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value).toBe(
            "xyz"
        );
        expect(applyToSources).toHaveBeenCalledTimes(1);
        expect(notified).toBe(true);
    });

    it("hasActiveFilters() reflects the panel", () => {
        configGet.mockReturnValue(CONFIG);
        const p = mountPanel();
        const api = buildPublicApi();
        expect(api.hasActiveFilters()).toBe(false);
        p.querySelector('[data-gl-filter-id="searchText"] input[type="text"]').value = "q";
        expect(api.hasActiveFilters()).toBe(true);
    });
});

describe("GeoLeaf.Filter — taxonomy sub-categories (subValues)", () => {
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
    function mountSubPanel() {
        const p = renderFilterPanel(SUB_CONFIG, SUB_OPTIONS);
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

    it("getActiveFilter() names the category of a sub-category checked alone", () => {
        configGet.mockReturnValue(SUB_CONFIG);
        tick(sub(mountSubPanel(), "NATURE", "PARC"));
        expect(buildPublicApi().getActiveFilter().fields).toEqual([
            {
                id: "cats",
                kind: "taxonomy",
                values: ["PARC"],
                subValues: [{ value: "PARC", category: "NATURE" }],
            },
        ]);
    });

    it("getActiveFilter() lists every sub-category a checked category cascades to", () => {
        configGet.mockReturnValue(SUB_CONFIG);
        tick(cat(mountSubPanel(), "NATURE"));
        expect(buildPublicApi().getActiveFilter().fields).toEqual([
            {
                id: "cats",
                kind: "taxonomy",
                values: ["NATURE", "PARC", "LAC"],
                subValues: [
                    { value: "PARC", category: "NATURE" },
                    { value: "LAC", category: "NATURE" },
                ],
            },
        ]);
    });

    it("getActiveFilter() adds no subValues key when only leaf categories are checked", () => {
        configGet.mockReturnValue(SUB_CONFIG);
        const p = mountSubPanel();
        tick(cat(p, "MUSEE"));
        tick(cat(p, "PLAGE"));
        const [field] = buildPublicApi().getActiveFilter().fields;
        expect(field).toEqual({ id: "cats", kind: "taxonomy", values: ["MUSEE", "PLAGE"] });
        expect(field).not.toHaveProperty("subValues");
    });

    it("getActiveFilter() pairs a shared sub-category id with the category it was checked under", () => {
        configGet.mockReturnValue(SUB_CONFIG);
        tick(sub(mountSubPanel(), "SPORT", "LAC"));
        expect(buildPublicApi().getActiveFilter().fields).toEqual([
            {
                id: "cats",
                kind: "taxonomy",
                values: ["LAC"],
                subValues: [{ value: "LAC", category: "SPORT" }],
            },
        ]);
    });

    it.each([
        ["a sub-category alone", (p) => tick(sub(p, "NATURE", "PARC"))],
        ["a cascaded category", (p) => tick(cat(p, "NATURE"))],
        ["a shared id under one category", (p) => tick(sub(p, "SPORT", "LAC"))],
        [
            "a shared id under both categories",
            (p) => {
                tick(sub(p, "NATURE", "LAC"));
                tick(sub(p, "SPORT", "LAC"));
            },
        ],
        [
            "leaf categories and a sub-category",
            (p) => {
                tick(cat(p, "MUSEE"));
                tick(sub(p, "SPORT", "STADE"));
            },
        ],
    ])("applyFilter(getActiveFilter()) checks the same boxes on a fresh panel — %s", (_, act) => {
        configGet.mockReturnValue(SUB_CONFIG);
        const api = buildPublicApi();
        const a = mountSubPanel();
        act(a);
        const before = boxes(a);
        const state = JSON.parse(JSON.stringify(api.getActiveFilter()));

        document.body.innerHTML = "";
        const b = mountSubPanel();
        api.applyFilter(state);
        expect(boxes(b)).toEqual(before);
        // The engine still filters on the flat `values` (the taxonomy expansion runs them
        // through a Set; no taxonomy is registered here, so it adds nothing).
        expect(applyToSources.mock.calls[0][0][0].values).toEqual([
            ...new Set(state.fields[0].values),
        ]);
    });

    it("applyFilter() restores a state without subValues exactly as before", () => {
        configGet.mockReturnValue(SUB_CONFIG);
        const p = mountSubPanel();
        buildPublicApi().applyFilter({
            fields: [{ id: "cats", kind: "taxonomy", values: ["LAC"] }],
        });
        // A flat state cannot tell the two LAC apart: both are checked, as they always were.
        expect(sub(p, "NATURE", "LAC").checked).toBe(true);
        expect(sub(p, "SPORT", "LAC").checked).toBe(true);
        expect(cat(p, "NATURE").indeterminate).toBe(true);
        expect(cat(p, "SPORT").indeterminate).toBe(true);
    });
});

describe("GeoLeaf.Filter — imperative helpers", () => {
    it("applyNow() re-applies from the panel", () => {
        configGet.mockReturnValue(CONFIG);
        const p = mountPanel();
        buildPublicApi().applyNow();
        expect(applyFromPanel).toHaveBeenCalledWith(p, expect.objectContaining({ enabled: true }));
    });

    it("reset() clears controls and re-applies", () => {
        configGet.mockReturnValue(CONFIG);
        const p = mountPanel();
        p.querySelector('.gl-filter-panel__tag-badge[data-tag-value="free"]').classList.add(
            "gl-is-selected"
        );
        buildPublicApi().reset();
        expect(p.querySelector(".gl-filter-panel__tag-badge.gl-is-selected")).toBeNull();
        expect(applyFromPanel).toHaveBeenCalledTimes(1);
    });

    it("proximity delegates to the proximity module", () => {
        configGet.mockReturnValue(CONFIG);
        const api = buildPublicApi();
        api.proximity.setRadius(7);
        expect(setRadius).toHaveBeenCalledWith(7);
        const map = {};
        expect(api.proximity.toggle(map, 12)).toBe(true);
        expect(toggleToolbar).toHaveBeenCalledWith(map, 12, undefined);
    });
});
