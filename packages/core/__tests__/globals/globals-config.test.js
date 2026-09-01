/**
 * Phase 60 — Step 1.5: src/globals/globals.config.ts (0% → 60%)
 */
const stub = vi.hoisted(() => ({}));
vi.mock("../../src/utils/validators/style-validator.ts", () => ({ StyleValidator: stub }));
vi.mock("../../src/utils/validators/style-validator-rules.ts", () => ({
    StyleValidatorRules: stub,
}));
vi.mock("../../src/utils/loaders/style-loader.ts", () => ({ StyleLoader: stub }));
// scale-control relocated to the in-core `scale` capability (no longer mounted by globals.config).
vi.mock("../../src/kernel/geojson/loader/data-converter.ts", () => ({ DataConverter: stub }));
vi.mock("../../src/kernel/config/loader.ts", () => ({ ConfigLoader: stub }));
vi.mock("../../src/kernel/config/normalization.ts", () => ({ ConfigNormalizer: stub }));
vi.mock("../../src/kernel/config/profile-loader.ts", () => ({ ProfileLoader: stub }));
vi.mock("../../src/kernel/config/profile.ts", () => ({ ProfileManager: stub }));
vi.mock("../../src/kernel/config/storage.ts", () => ({ ConfigStore: stub }));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.ts", () => ({
    Config: stub,
}));
vi.mock("../../src/kernel/config/geoleaf-config/config-loaders.ts", () => ({}));
vi.mock("../../src/kernel/config/geoleaf-config/config-accessors.ts", () => ({}));
vi.mock("../../src/kernel/config/geoleaf-config/config-validation.ts", () => ({}));

import "../../src/globals/globals.config.js";

describe("globals/globals.config (step 1.5)", () => {
    it("attache Helpers, _Validators, Config au namespace", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf.Helpers).toBeDefined();
        expect(globalThis.GeoLeaf._Validators).toBeDefined();
        expect(globalThis.GeoLeaf.Config).toBeDefined();
        // `_StyleValidator` a quitté le namespace (aucun lecteur).
        expect(globalThis.GeoLeaf._StyleValidator).toBeUndefined();
    });
});
