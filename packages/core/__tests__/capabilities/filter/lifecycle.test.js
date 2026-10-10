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
const { markAppReady, resetAppReady } = await import("../../../src/kernel/shared/app-ready.ts");

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
    resetAppReady();
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

    // 🛑 A profile without a default theme dispatched `geoleaf:app:ready` before this module's
    // init() had run, and the panel never mounted. An init after the reveal mounts at once.
    it("an init that runs AFTER the reveal mounts the panel at once", () => {
        markAppReady();
        FilterLifecycle.init();
        expect(document.getElementById("gl-filter-panel")).toBeTruthy();
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

// A layer's store changed while a filter is active: the filter judges it again — after a
// quiet moment, and no later than a bound when the writes never stop.
describe("FilterLifecycle — geoleaf:layer:updated", () => {
    const updated = () =>
        document.dispatchEvent(
            new CustomEvent("geoleaf:layer:updated", { detail: { layerId: "ly1" } })
        );

    /** Mounts the panel and types a search text: a filter is active. */
    function mountWithActiveFilter() {
        FilterLifecycle.init();
        appReady();
        const input = document.querySelector("#gl-filter-panel input");
        input.value = "pont";
        return input;
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("un filtre actif est rejugé une fois, après le silence", () => {
        mountWithActiveFilter();
        updated();
        updated();
        vi.advanceTimersByTime(299);
        expect(h.applyFilterFromPanel).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(h.applyFilterFromPanel).toHaveBeenCalledTimes(1);
    });

    it("aucun filtre actif : rien à rejuger", () => {
        FilterLifecycle.init();
        appReady();
        updated();
        vi.advanceTimersByTime(2000);
        expect(h.applyFilterFromPanel).not.toHaveBeenCalled();
    });

    // 🛑 A TRAILING WAIT NEVER ENDS UNDER A STREAM: writes closer together than the wait kept
    // the map on the verdict from before the burst for as long as it lasted.
    it("🛑 des écritures plus serrées que la temporisation sont rejugées PENDANT la rafale", () => {
        mountWithActiveFilter();
        for (let i = 0; i < 30; i++) {
            updated();
            vi.advanceTimersByTime(100);
        }
        expect(h.applyFilterFromPanel.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // The bound is the stream's, not the keyboard's: typing keeps the trailing wait alone.
    it("la SAISIE reste en attente traînante : une frappe continue n'applique qu'à son arrêt", () => {
        const input = mountWithActiveFilter();
        for (let i = 0; i < 30; i++) {
            input.dispatchEvent(new Event("input", { bubbles: true }));
            vi.advanceTimersByTime(100);
        }
        expect(h.applyFilterFromPanel).not.toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(h.applyFilterFromPanel).toHaveBeenCalledTimes(1);
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

    // `initProximityFilter` attaches two DOCUMENT-level listeners whose
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
