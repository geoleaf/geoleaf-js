/**
 * Phase 60 — Step 1.3: src/globals/globals.ts (0% → 60%)
 * Teste l'orchestrateur globals : export de _g (globalThis/window/{}).
 * Sub-modules mocked to only execute the body of globals.ts.
 */
vi.mock("../../src/globals/globals.core.js", () => ({}));
vi.mock("../../src/globals/globals.config.js", () => ({}));
vi.mock("../../src/globals/globals.geojson.js", () => ({}));
vi.mock("../../src/globals/globals.ui.js", () => ({}));
vi.mock("../../src/globals/globals.storage.js", () => ({}));
vi.mock("../../src/globals/globals.poi.js", () => ({}));
vi.mock("../../src/globals/globals.api.js", () => ({}));
import { _g } from "../../src/globals/globals.js";

describe("globals/globals (step 1.3)", () => {
    it("exporte _g (reference globalThis ou window)", () => {
        expect(_g).toBeDefined();
        expect(_g).toBe(globalThis);
    });
});
