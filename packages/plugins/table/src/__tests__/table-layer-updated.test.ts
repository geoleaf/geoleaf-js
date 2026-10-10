/**
 * The open table follows its layer's store (`geoleaf:layer:updated`, core 3.12.0).
 *
 * A creation, an edit, a deletion changed the layer's store, and the open table kept its rows
 * until the next filter or visibility change — measured on the shipped bundle (`e2e/69`). Only
 * the layer on display refreshes, once per burst.
 *
 * ⚠️ In a file of its own, on a fresh module: `attachMapEvents` never detaches its document
 * listeners, so every `init()` of a longer suite leaves one more set behind, and their pending
 * fallbacks would refresh too and count against these assertions.
 */
import {
    describe,
    it,
    expect,
    vi,
    beforeAll,
    beforeEach,
    afterEach,
    type MockInstance,
} from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("table — geoleaf:layer:updated", () => {
    let TableModule: (typeof import("../table-api.js"))["Table"];
    let tableState: (typeof import("../table-state.js"))["tableState"];
    let refreshSpy: MockInstance;

    beforeAll(async () => {
        vi.doMock("../panel.js", () => ({
            TablePanel: {
                create: vi.fn(() => document.createElement("div")),
                refreshLayerSelector: vi.fn(),
            },
        }));
        vi.doMock("../renderer.js", () => ({
            TableRenderer: { render: vi.fn(), updateSelection: vi.fn() },
        }));
        TableModule = (await import("../table-api.js")).Table;
        ({ tableState } = await import("../table-state.js"));
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.GeoJSON = {
            getLayerData: () => ({ features: [] }),
            getAllLayers: () => [],
        };
        TableModule.init({ map: { on: vi.fn(), fire: vi.fn() }, config: { enabled: true } });
    });

    beforeEach(() => {
        vi.useFakeTimers();
        tableState._currentLayerId = "ly1";
        refreshSpy = vi.spyOn(TableModule, "refresh").mockImplementation(() => {});
    });

    afterEach(() => {
        refreshSpy.mockRestore();
        vi.useRealTimers();
    });

    const updated = (layerId: string) =>
        document.dispatchEvent(new CustomEvent("geoleaf:layer:updated", { detail: { layerId } }));

    it("🛑 la couche affichée rafraîchit le tableau ouvert, une fois par rafale", () => {
        tableState._isVisible = true;
        updated("ly1");
        updated("ly1");
        vi.advanceTimersByTime(200);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    // 🛑 A TRAILING WAIT NEVER ENDS UNDER A STREAM. Each event pushed the refresh back, so a
    // source writing faster than the wait left the open table on its rows from before the
    // burst for as long as the burst lasted — measured on the shipped bundle, 30 writes at
    // 100 ms over three seconds, rows frozen throughout.
    it("🛑 une rafale plus serrée que la temporisation rafraîchit PENDANT la rafale", () => {
        tableState._isVisible = true;
        const at: number[] = [];
        refreshSpy.mockImplementation(() => void at.push(Date.now()));
        const start = Date.now();
        for (let i = 0; i < 20; i++) {
            updated("ly1");
            vi.advanceTimersByTime(100);
        }
        const lastWrite = start + 1900;
        expect(at.filter((t) => t < lastWrite).length).toBeGreaterThanOrEqual(3);

        // …and the rows shown once it stops are those of the LAST write.
        vi.advanceTimersByTime(1000);
        expect(at.at(-1)).toBeGreaterThanOrEqual(lastWrite);
        const settled = at.length;
        vi.advanceTimersByTime(2000);
        expect(at.length).toBe(settled);
    });

    it("une autre couche : rien", () => {
        tableState._isVisible = true;
        updated("other");
        vi.advanceTimersByTime(200);
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("tableau fermé : rien", () => {
        tableState._isVisible = false;
        updated("ly1");
        vi.advanceTimersByTime(200);
        expect(refreshSpy).not.toHaveBeenCalled();
    });
});
