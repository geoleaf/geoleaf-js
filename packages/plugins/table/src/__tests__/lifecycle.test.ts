/**
 * Unit coverage for packages/plugins/table/src/lifecycle.ts — TableLifecycle.
 *
 * The path is written in full from the repository root on purpose, and this note must not
 * restate the short form. `TSDOC-PATHS` resolves a root-relative citation through a suffix
 * index that only accepts a UNIQUE match: the short form stopped resolving the day a second
 * plugin shipped a file of the same name under its own `src/`. The file had not moved — the
 * suffix had merely stopped being unique, and a sentence quoting the short form to explain it
 * would re-create the very citation it describes.
 *
 * `Table.init` is mocked (allowed per the task brief) to isolate the lifecycle
 * wiring: we assert init() is idempotent, that the `geoleaf:map:ready` handler
 * is registered once, and that the lazy build behaves correctly:
 *   - `_onMapReady` builds eagerly ONLY when enabled AND defaultVisible.
 *   - `ensureInitialized()` is the lazy build path (first toolbar click): builds
 *     when enabled AND a map is available, regardless of defaultVisible, and
 *     short-circuits once the panel container exists.
 *
 * The config seam is driven through the shared helper (Config.get on
 * `modules.table`); the map seam through `globalThis.GeoLeaf.Core.getMap`.
 *
 * The lifecycle module holds a private `_initialized` flag and binds a single
 * `_onMapReady` listener on `document`. Tests dispatch a real DOM event so the
 * already-registered handler runs against the freshly-wired globals. `Table.init`
 * is a bare mock (never sets `tableState._container`), so `ensureInitialized()`
 * returns false even after building — we assert the `Table.init` call, not the
 * return value, except where the container is pre-seeded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { resetGeoLeaf, setTableConfig, setGeoLeaf } from "./_helpers/geoleaf-global.js";

// Mock Table so lifecycle wiring is observable without the real table DOM build.
vi.mock("../table-api.js", () => ({
    Table: { init: vi.fn() },
}));

import { TableLifecycle } from "../lifecycle.js";
import { Table } from "../table-api.js";
import { tableState } from "../table-state.js";

/** Fires the map-ready event the lifecycle listens for. */
function fireMapReady(): void {
    document.dispatchEvent(new Event("geoleaf:map:ready"));
}

describe("lifecycle.ts — TableLifecycle", () => {
    beforeEach(() => {
        resetGeoLeaf();
        tableState._container = null;
        vi.clearAllMocks();
    });

    it("init() registers the geoleaf:map:ready listener (first call)", () => {
        const addSpy = vi.spyOn(document, "addEventListener");
        TableLifecycle.init();
        expect(addSpy.mock.calls.some((c) => c[0] === "geoleaf:map:ready")).toBe(true);
        addSpy.mockRestore();
    });

    it("init() is idempotent — a second call does not re-register the listener", () => {
        // First init() already happened above (module singleton). Calling again
        // must short-circuit on the `_initialized` guard.
        const addSpy = vi.spyOn(document, "addEventListener");
        TableLifecycle.init();
        TableLifecycle.init();
        const mapReadyRegistrations = addSpy.mock.calls.filter((c) => c[0] === "geoleaf:map:ready");
        expect(mapReadyRegistrations.length).toBe(0); // already initialized → no new add
        addSpy.mockRestore();
    });

    // ── _onMapReady — eager build only when defaultVisible ────────────────────

    it("map-ready with enabled:false does not build", () => {
        TableLifecycle.init(); // idempotent — listener already wired
        setTableConfig({ enabled: false, defaultVisible: true });
        fireMapReady();
        expect(Table.init).not.toHaveBeenCalled();
    });

    it("map-ready stays lazy when defaultVisible is false (no build at boot)", () => {
        TableLifecycle.init();
        setTableConfig({ enabled: true, defaultVisible: false });
        const fakeMap = { on: vi.fn(), fire: vi.fn() };
        setGeoLeaf({ Core: { getMap: () => fakeMap } });
        fireMapReady();
        expect(Table.init).not.toHaveBeenCalled();
    });

    it("map-ready builds eagerly when defaultVisible is true", () => {
        TableLifecycle.init();
        setTableConfig({ enabled: true, defaultVisible: true });
        const fakeMap = { on: vi.fn(), fire: vi.fn() };
        setGeoLeaf({ Core: { getMap: () => fakeMap } });
        fireMapReady();
        expect(Table.init).toHaveBeenCalledTimes(1);
        expect(Table.init).toHaveBeenCalledWith({ map: fakeMap });
    });

    it("map-ready with defaultVisible:true but no map does not build", () => {
        TableLifecycle.init();
        setTableConfig({ enabled: true, defaultVisible: true });
        setGeoLeaf({ getAllMaps: () => [] }); // empty → undefined → null
        fireMapReady();
        expect(Table.init).not.toHaveBeenCalled();
    });

    // ── ensureInitialized — lazy build on first toolbar click ─────────────────

    it("ensureInitialized builds via Core.getMap when enabled (lazy, defaultVisible irrelevant)", () => {
        setTableConfig({ enabled: true, defaultVisible: false });
        const fakeMap = { on: vi.fn(), fire: vi.fn() };
        setGeoLeaf({ Core: { getMap: () => fakeMap } });
        TableLifecycle.ensureInitialized();
        expect(Table.init).toHaveBeenCalledWith({ map: fakeMap });
    });

    it("ensureInitialized falls back to getAllMaps()[0] when Core.getMap is absent", () => {
        setTableConfig({ enabled: true });
        const fakeMap = { on: vi.fn(), fire: vi.fn() };
        setGeoLeaf({ getAllMaps: () => [fakeMap] });
        TableLifecycle.ensureInitialized();
        expect(Table.init).toHaveBeenCalledWith({ map: fakeMap });
    });

    it("ensureInitialized returns false and does not build when disabled", () => {
        setTableConfig({ enabled: false });
        setGeoLeaf({ Core: { getMap: () => ({ on: vi.fn(), fire: vi.fn() }) } });
        expect(TableLifecycle.ensureInitialized()).toBe(false);
        expect(Table.init).not.toHaveBeenCalled();
    });

    it("ensureInitialized returns false when no map is available", () => {
        setTableConfig({ enabled: true });
        setGeoLeaf({ getAllMaps: () => [] });
        expect(TableLifecycle.ensureInitialized()).toBe(false);
        expect(Table.init).not.toHaveBeenCalled();
    });

    it("ensureInitialized short-circuits (returns true, no build) when already built", () => {
        tableState._container = document.createElement("div");
        setTableConfig({ enabled: true });
        setGeoLeaf({ Core: { getMap: () => ({ on: vi.fn(), fire: vi.fn() }) } });
        expect(TableLifecycle.ensureInitialized()).toBe(true);
        expect(Table.init).not.toHaveBeenCalled();
    });
});
