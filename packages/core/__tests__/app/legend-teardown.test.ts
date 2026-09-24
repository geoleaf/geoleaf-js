/**
 * Does `Core.destroy()` reach the legend's teardown?
 *
 * 🛑 Same shape as `desktop-panel-teardown.test.ts`, and for the same reason: `Legend._reset()`
 * was correct — it cancels the debounced rebuild and drops the map — but on the integrator's
 * path NOBODY CALLED IT. `Core.destroy()` runs the lifecycle seam and nothing else, and the
 * legend's teardown hung only on `LegendModule.destroy()`, reached by `ModuleRegistry.destroy()`,
 * which no production path calls. Measured in a browser: a destroy landing in the rebuild window
 * (150 ms after `geoleaf:app:ready`) mounted the control on the destroyed map and threw
 * "map is not ready", uncaught — 3 times out of 3.
 *
 * The assertion therefore goes through `Core.destroy()`. Witness mutation: remove the
 * `registerLifecycleTeardown(...)` line from `capabilities/legend/lifecycle.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const legendReset = vi.fn();
vi.mock("../../src/capabilities/legend/legend.js", () => ({
    Legend: { init: vi.fn(), _reset: () => legendReset() },
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    // A plain function, not a class: `mockImplementation` is typed for callables, and a
    // constructor that returns an object yields that object under `new` just the same.
    MaplibreAdapter: vi.fn().mockImplementation(function () {
        return { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
    }),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

type CoreFacade = (typeof import("../../src/kernel/map/facade.js"))["Core"];
type LegendLifecycleT =
    (typeof import("../../src/capabilities/legend/lifecycle.js"))["LegendLifecycle"];

let Core: CoreFacade;
let LegendLifecycle: LegendLifecycleT;

beforeAll(async () => {
    ({ Core } = await import("../../src/kernel/map/facade.js"));
    ({ LegendLifecycle } = await import("../../src/capabilities/legend/lifecycle.js"));
});

afterEach(() => {
    for (const id of Core.listMaps()) Core.destroy(id);
    LegendLifecycle._reset();
    vi.clearAllMocks();
});

/** Boots a map through the façade and starts the legend capability, as the boot does. */
function bootWithLegend(mapId: string): void {
    (Core.init as (o: Record<string, unknown>) => unknown)({
        mapId,
        container: document.createElement("div"),
    });
    LegendLifecycle.init();
}

describe("Core.destroy() tears the legend down", () => {
    it("🛑 destroying the last map runs the legend's reset", () => {
        bootWithLegend("legend-teardown-1");
        legendReset.mockClear();

        Core.destroy("legend-teardown-1");

        expect(legendReset).toHaveBeenCalledTimes(1);
    });

    it("the app:ready mount is disarmed: a late event mounts nothing on the destroyed map", async () => {
        const { Legend } = await import("../../src/capabilities/legend/legend.js");
        bootWithLegend("legend-teardown-2");
        Core.destroy("legend-teardown-2");

        document.dispatchEvent(new Event("geoleaf:app:ready"));

        expect(Legend.init).not.toHaveBeenCalled();
    });

    it("destroying one of two maps leaves the legend alone", () => {
        bootWithLegend("legend-teardown-3a");
        (Core.init as (o: Record<string, unknown>) => unknown)({
            mapId: "legend-teardown-3b",
            container: document.createElement("div"),
        });
        legendReset.mockClear();

        Core.destroy("legend-teardown-3a");

        expect(legendReset).not.toHaveBeenCalled();
    });
});
