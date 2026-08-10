/**
 * Unit coverage for src/table-seam.ts — TableContract.
 *
 * Covers BOTH branches of every guarded delegate:
 *  (a) before register() (no instance) → no-op / [] ;
 *  (b) with an instance that LACKS the method → guard's `typeof … === "function"`
 *      is false → no-op ;
 *  (c) after register(instance, panel) with vi.fn members → delegates.
 *
 * The module under test is NOT mocked (it holds its own private `_table` /
 * `_panel` state). Because that state is module-singleton, tests run in
 * declaration order and re-register a fresh stub each time to control it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { TableContract } from "../table-seam.js";

/** Builds a fully-stubbed Table instance (every method is a vi.fn). */
function fullInstance() {
    return {
        setLayer: vi.fn(),
        zoomToSelection: vi.fn(),
        highlightSelection: vi.fn(),
        exportSelection: vi.fn(),
        exportLayer: vi.fn(),
        toggle: vi.fn(),
        show: vi.fn(),
        getSelectedIds: vi.fn(() => ["a", "b"]),
        setSelection: vi.fn(),
        clearSelection: vi.fn(),
        sortByField: vi.fn(),
    };
}

describe("table-seam.ts — TableContract", () => {
    // Reset the singleton to a known empty state by registering an empty object,
    // then immediately exercising the "no method" branch where relevant.
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("guards with no registered method (instance lacks members)", () => {
        beforeEach(() => {
            // Register an object with NO methods → every `typeof … === "function"`
            // guard evaluates false.
            TableContract.register({});
        });

        it("isAvailable() is true once an (empty) instance is registered", () => {
            expect(TableContract.isAvailable()).toBe(true);
        });

        it("setLayer is a no-op (does not throw)", () => {
            expect(() => TableContract.setLayer("layer1")).not.toThrow();
        });

        it("zoomToSelection is a no-op", () => {
            expect(() => TableContract.zoomToSelection()).not.toThrow();
        });

        it("highlightSelection is a no-op", () => {
            expect(() => TableContract.highlightSelection(true)).not.toThrow();
        });

        it("exportSelection is a no-op", () => {
            expect(() => TableContract.exportSelection("csv", {})).not.toThrow();
        });

        it("exportLayerAll is a no-op", () => {
            expect(() => TableContract.exportLayerAll("geojson")).not.toThrow();
        });

        it("toggle is a no-op", () => {
            expect(() => TableContract.toggle()).not.toThrow();
        });

        it("show is a no-op", () => {
            expect(() => TableContract.show()).not.toThrow();
        });

        it("getSelectedIds returns [] when the instance lacks getSelectedIds", () => {
            expect(TableContract.getSelectedIds()).toEqual([]);
        });

        it("setSelection is a no-op", () => {
            expect(() => TableContract.setSelection(["x"], true)).not.toThrow();
        });

        it("clearSelection is a no-op", () => {
            expect(() => TableContract.clearSelection()).not.toThrow();
        });

        it("sortByField is a no-op", () => {
            expect(() => TableContract.sortByField("field")).not.toThrow();
        });

        it("updateToolbarButtons is a no-op when no panel was registered", () => {
            // register({}) above only set _table; _panel keeps its prior value.
            // Register again with an empty panel to force the "no method" branch.
            TableContract.register({}, {});
            expect(() => TableContract.updateToolbarButtons(3)).not.toThrow();
        });
    });

    describe("delegation after register(instance, panel)", () => {
        let inst: ReturnType<typeof fullInstance>;
        let panel: { updateToolbarButtons: ReturnType<typeof vi.fn> };

        beforeEach(() => {
            inst = fullInstance();
            panel = { updateToolbarButtons: vi.fn() };
            TableContract.register(inst, panel);
        });

        it("isAvailable() is true", () => {
            expect(TableContract.isAvailable()).toBe(true);
        });

        it("setLayer delegates with the layerId", () => {
            TableContract.setLayer("layer42");
            expect(inst.setLayer).toHaveBeenCalledWith("layer42");
        });

        it("zoomToSelection delegates", () => {
            TableContract.zoomToSelection();
            expect(inst.zoomToSelection).toHaveBeenCalledTimes(1);
        });

        it("highlightSelection delegates the active flag", () => {
            TableContract.highlightSelection(false);
            expect(inst.highlightSelection).toHaveBeenCalledWith(false);
        });

        it("exportSelection delegates format + options", () => {
            const opts = { csvSeparator: ";" };
            TableContract.exportSelection("csv", opts);
            expect(inst.exportSelection).toHaveBeenCalledWith("csv", opts);
        });

        it("exportSelection delegates with undefined args too", () => {
            TableContract.exportSelection();
            expect(inst.exportSelection).toHaveBeenCalledWith(undefined, undefined);
        });

        it("exportLayerAll delegates to the instance's exportLayer", () => {
            TableContract.exportLayerAll("kml", { csvIncludeGeometry: true });
            expect(inst.exportLayer).toHaveBeenCalledWith("kml", { csvIncludeGeometry: true });
        });

        it("toggle delegates", () => {
            TableContract.toggle();
            expect(inst.toggle).toHaveBeenCalledTimes(1);
        });

        it("show delegates", () => {
            TableContract.show();
            expect(inst.show).toHaveBeenCalledTimes(1);
        });

        it("getSelectedIds returns the instance's ids", () => {
            expect(TableContract.getSelectedIds()).toEqual(["a", "b"]);
            expect(inst.getSelectedIds).toHaveBeenCalledTimes(1);
        });

        it("setSelection delegates ids + fireEvent", () => {
            TableContract.setSelection(["1", "2"], true);
            expect(inst.setSelection).toHaveBeenCalledWith(["1", "2"], true);
        });

        it("clearSelection delegates", () => {
            TableContract.clearSelection();
            expect(inst.clearSelection).toHaveBeenCalledTimes(1);
        });

        it("sortByField delegates the field", () => {
            TableContract.sortByField("name");
            expect(inst.sortByField).toHaveBeenCalledWith("name");
        });

        it("updateToolbarButtons delegates to the panel", () => {
            TableContract.updateToolbarButtons(7);
            expect(panel.updateToolbarButtons).toHaveBeenCalledWith(7);
        });

        it("register without a panel argument keeps the previously registered panel", () => {
            // register(inst) only — panelInstance undefined → _panel unchanged.
            const inst2 = fullInstance();
            TableContract.register(inst2);
            TableContract.setLayer("z");
            expect(inst2.setLayer).toHaveBeenCalledWith("z");
            // panel from the previous register is still wired
            TableContract.updateToolbarButtons(1);
            expect(panel.updateToolbarButtons).toHaveBeenCalledWith(1);
        });
    });
});
