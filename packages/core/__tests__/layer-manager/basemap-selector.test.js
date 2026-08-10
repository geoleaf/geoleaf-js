/**
 * Phase 60 — Step 3.3: src/kernel/layer-manager/basemap-selector.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetActiveKey = vi.hoisted(() => vi.fn(() => null));
const mockSetBaseLayer = vi.hoisted(() => vi.fn());
vi.mock("../../src/api/geoleaf.baselayers.ts", () => ({
    Baselayers: {
        getActiveKey: mockGetActiveKey,
        setBaseLayer: mockSetBaseLayer,
    },
}));

import { BasemapSelector } from "../../src/kernel/layer-manager/basemap-selector.js";

describe("layer-manager/basemap-selector (step 3.3)", () => {
    let sectionEl;

    beforeEach(() => {
        sectionEl = document.createElement("div");
        mockGetActiveKey.mockReturnValue(null);
        mockSetBaseLayer.mockClear();
    });

    it("exporte BasemapSelector avec render et destroy", () => {
        expect(BasemapSelector).toBeDefined();
        expect(typeof BasemapSelector.render).toBe("function");
        expect(typeof BasemapSelector.destroy).toBe("function");
    });

    it("render ne fait rien si section ou sectionEl manquant", () => {
        BasemapSelector.render(null, sectionEl);
        BasemapSelector.render({}, null);
        expect(sectionEl.children.length).toBe(0);
    });

    it("render creates select et options quand section.items fourni", () => {
        const section = { items: [{ id: "osm", label: "OSM" }, { id: "sat" }] };
        BasemapSelector.render(section, sectionEl);
        const select = sectionEl.querySelector("select");
        expect(select).toBeTruthy();
        expect(select.options.length).toBe(2);
        expect(select.options[0].value).toBe("osm");
        expect(select.options[0].textContent).toBe("OSM");
        expect(select.options[1].value).toBe("sat");
        expect(select.options[1].textContent).toBe("sat");
    });

    it("render uses getActiveKey to preselect", () => {
        mockGetActiveKey.mockReturnValue("osm");
        const section = { items: [{ id: "osm" }, { id: "sat" }] };
        BasemapSelector.render(section, sectionEl);
        const select = sectionEl.querySelector("select");
        expect(select.value).toBe("osm");
    });

    it("change sur select appelle setBaseLayer", () => {
        const section = { items: [{ id: "osm" }, { id: "sat" }] };
        BasemapSelector.render(section, sectionEl);
        const select = sectionEl.querySelector("select");
        // Source now uses select.addEventListener("change", handler)
        select.value = "sat";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(mockSetBaseLayer).toHaveBeenCalledWith("sat", {});
    });

    it("destroy retire le listener geoleaf:basemap:change", () => {
        const removeSpy = vi.spyOn(document, "removeEventListener");
        BasemapSelector.render({ items: [{ id: "x" }] }, sectionEl);
        BasemapSelector.destroy();
        expect(removeSpy).toHaveBeenCalledWith("geoleaf:basemap:change", expect.any(Function));
        removeSpy.mockRestore();
    });
});
