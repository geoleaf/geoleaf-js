/**
 * Phase 60 — Step 4.1: src/kernel/layer-manager/basemap-selector.ts
 * Canonical implementation (legend/basemap-selector was a @deprecated shim)
 */
import * as legendBasemap from "../../src/kernel/layer-manager/basemap-selector.js";

describe("legend/basemap-selector (step 4.1)", () => {
    it("exports BasemapSelector (re-export from layer-manager)", () => {
        expect(legendBasemap.BasemapSelector).toBeDefined();
        expect(typeof legendBasemap.BasemapSelector.render).toBe("function");
        expect(typeof legendBasemap.BasemapSelector.destroy).toBe("function");
    });
});
