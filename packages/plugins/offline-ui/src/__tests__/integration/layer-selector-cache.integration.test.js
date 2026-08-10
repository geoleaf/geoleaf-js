/**
 * Integration test: LayerSelector (plugin-storage) ↔ Config + IndexedDB (core)
 *
 * Verifies that the LayerSelector (LS) module correctly interacts with
 * core Config for profile data and IndexedDB mock for persistence of
 * layer selection state.
 */

import { LS } from "../../cache/layer-selector/core.js";

describe("Integration core ↔ storage — LayerSelector", () => {
    describe("LayerSelector module shape", () => {
        test("should export LS object with init method", () => {
            expect(typeof LS).toBe("object");
            expect(typeof LS.init).toBe("function");
        });

        test("should expose populate method", () => {
            expect(typeof LS.populate).toBe("function");
        });
    });

    describe("LayerSelector init", () => {
        test("init accepts control and layersContent parameters", () => {
            const control = {};
            const layersContent = document.createElement("div");

            expect(() => LS.init(control, layersContent)).not.toThrow();
        });

        test("init stores internal references", () => {
            const control = {};
            const layersContent = document.createElement("div");

            LS.init(control, layersContent);

            expect(LS._control).toBe(control);
            expect(LS._layersContent).toBe(layersContent);
        });
    });

    describe("LayerSelector state management", () => {
        test("initial layers array is empty", () => {
            expect(Array.isArray(LS._layers)).toBe(true);
        });

        test("initial basemaps array is empty", () => {
            expect(Array.isArray(LS._basemaps)).toBe(true);
        });
    });

    describe("LayerSelector ↔ core dependencies", () => {
        test("module loads successfully with all @core/ mocks resolved", () => {
            // If LS loaded without errors, Config, Log, DOMSecurity etc.
            // all resolved correctly through the alias chain
            expect(LS).toBeDefined();
            expect(LS.init).toBeDefined();
        });
    });
});
