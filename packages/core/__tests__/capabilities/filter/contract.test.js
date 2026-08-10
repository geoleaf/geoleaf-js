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
