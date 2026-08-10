/**
 * Unit tests — capabilities/filter/lifecycle.ts (S5, F4)
 *
 * FilterLifecycle mounts the mapping-driven panel on `geoleaf:app:ready` (deferred
 * so POI/GeoJSON data is loaded), wires Apply/Reset + debounced auto-apply, inits
 * the reused proximity module and installs the `_UIFilterPanel*` consumer shims.
 * Inert when the resolved config carries no `fields` (un-migrated profile).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    cfg: {
        value: {
            enabled: true,
            fields: [{ id: "searchText", kind: "text", label: "Recherche" }],
        },
    },
    applyFilterFromPanel: vi.fn(),
    resolveOptionsWithData: vi.fn(() => ({})),
    resetPanelControls: vi.fn(),
    proximityInit: vi.fn(),
    proximityDestroy: vi.fn(),
    getMap: vi.fn(() => null),
}));

vi.mock("../../../src/capabilities/filter/config.js", () => ({
    getFilterConfig: () => h.cfg.value,
}));
vi.mock("../../../src/capabilities/filter/apply.js", () => ({
    applyFilterFromPanel: h.applyFilterFromPanel,
    resolveOptionsWithData: h.resolveOptionsWithData,
}));
vi.mock("../../../src/capabilities/filter/panel/write.js", () => ({
    resetPanelControls: h.resetPanelControls,
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({ Core: { getMap: h.getMap } }));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity.js", () => ({
    FilterPanelProximity: { initProximityFilter: h.proximityInit, destroy: h.proximityDestroy },
}));

const { FilterLifecycle } = await import("../../../src/capabilities/filter/lifecycle.ts");

function appReady() {
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    h.cfg.value = {
        enabled: true,
        fields: [{ id: "searchText", kind: "text", label: "Recherche" }],
    };
    h.getMap.mockReturnValue(null);
});

afterEach(() => {
    FilterLifecycle._reset();
});

describe("FilterLifecycle — mount on app:ready", () => {
    it("mounts the panel when the profile is migrated", () => {
        FilterLifecycle.init();
        expect(document.getElementById("gl-filter-panel")).toBeNull(); // deferred
        appReady();
        expect(document.getElementById("gl-filter-panel")).toBeTruthy();
    });

    it("is inert when the config carries no fields (un-migrated profile)", () => {
        h.cfg.value = { enabled: true };
        FilterLifecycle.init();
        appReady();
        expect(document.getElementById("gl-filter-panel")).toBeNull();
    });

    it("is inert when the capability is disabled", () => {
        h.cfg.value = { enabled: false, fields: [{ id: "t", kind: "text" }] };
        FilterLifecycle.init();
        appReady();
        expect(document.getElementById("gl-filter-panel")).toBeNull();
    });

    it("initialises the proximity module with the active adapter", () => {
        h.getMap.mockReturnValue({ id: "adapter" });
        FilterLifecycle.init();
        appReady();
        expect(h.proximityInit).toHaveBeenCalledWith({ id: "adapter" });
    });

    it("init() is idempotent (second call does not double-mount)", () => {
        FilterLifecycle.init();
        FilterLifecycle.init();
        appReady();
        expect(document.querySelectorAll("#gl-filter-panel")).toHaveLength(1);
    });
});

describe("FilterLifecycle — wiring", () => {
    it("applies on the Apply action", () => {
        FilterLifecycle.init();
        appReady();
        document.querySelector('[data-gl-action="filter-apply"]').click();
        expect(h.applyFilterFromPanel).toHaveBeenCalledTimes(1);
    });

    it("resets controls then applies on the Reset action", () => {
        FilterLifecycle.init();
        appReady();
        document.querySelector('[data-gl-action="filter-reset"]').click();
        expect(h.resetPanelControls).toHaveBeenCalledTimes(1);
        expect(h.applyFilterFromPanel).toHaveBeenCalledTimes(1);
    });

    it("toggles the panel open/closed from #gl-filter-toggle", () => {
        const toggle = document.createElement("button");
        toggle.id = "gl-filter-toggle";
        document.body.appendChild(toggle);
        FilterLifecycle.init();
        appReady();
        const panel = document.getElementById("gl-filter-panel");
        toggle.click();
        expect(panel.classList.contains("gl-is-open")).toBe(true);
        toggle.click();
        expect(panel.classList.contains("gl-is-open")).toBe(false);
    });
});

describe("FilterLifecycle — reset", () => {
    it("_reset() unmounts the panel and detaches the listener", () => {
        FilterLifecycle.init();
        appReady();
        expect(document.getElementById("gl-filter-panel")).toBeTruthy();
        FilterLifecycle._reset();
        expect(document.getElementById("gl-filter-panel")).toBeNull();
        // Listener detached: a later app:ready does not re-mount.
        appReady();
        expect(document.getElementById("gl-filter-panel")).toBeNull();
    });

    // CAPACITÉS S3.3 — `initProximityFilter` attaches two DOCUMENT-level listeners whose
    // cleanups live in `ProximityState.eventCleanups`, and `FilterPanelProximity.destroy()`
    // is the only code that releases them. `_reset()` used to purge the panel and toggle
    // listeners only, so the proximity listeners, circle and draggable marker survived
    // `FilterModule.destroy()`. Teardown must mirror setup.
    it("_reset() tears the proximity module down (mirrors the mount)", () => {
        h.getMap.mockReturnValue({ id: "adapter" });
        FilterLifecycle.init();
        appReady();
        expect(h.proximityInit).toHaveBeenCalledTimes(1);
        FilterLifecycle._reset();
        expect(h.proximityDestroy).toHaveBeenCalledTimes(1);
    });

    it("_reset() does not tear proximity down when it was never mounted", () => {
        h.getMap.mockReturnValue(null); // no adapter → `_initProximity` is a no-op
        FilterLifecycle.init();
        appReady();
        expect(h.proximityInit).not.toHaveBeenCalled();
        FilterLifecycle._reset();
        expect(h.proximityDestroy).not.toHaveBeenCalled();
    });
});
