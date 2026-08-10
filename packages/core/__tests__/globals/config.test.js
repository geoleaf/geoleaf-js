/**
 * S5.5.2 — globals.config.ts branch coverage (B3+B4)
 *
 * Targets:
 *   - All _g.GeoLeaf.* assignments in globals.config.ts
 *   - B3: Helpers (DOM), Validators, Renderers, DataNormalizer
 *   - B4: Config (Object.assign), DataConverter, ConfigLoader, ConfigNormalizer,
 *         ProfileLoader
 *   - Guards: if(!_g.GeoLeaf.Helpers), if(!_g.GeoLeaf._Validators), if(!_g.GeoLeaf._Renderers),
 *             if(!_g.GeoLeaf.Config)
 *   - Side-effect imports (config-loaders, config-accessors, config-validation)
 *
 * NB: `Helpers` no longer carries the three POI style resolvers (`StyleResolver`,
 * `getColorsFromLayerStyle`, `resolvePoiColors`). They were an orphan public API —
 * zero production callers — and they hard-coded `properties.categoryId`. Layer
 * styling belongs to `styleRulesToPaint`, which resolves any field.
 *
 * Strategy: vi.hoisted() + vi.mock() on all imported modules. ESM static import
 * ensures Istanbul instruments globals.config.ts (no require() bypass).
 */

const mocks = vi.hoisted(() => {
    const StyleValidator = { validate: vi.fn() };
    const StyleValidatorRules = { rules: [] };

    const Config = { get: vi.fn(), set: vi.fn(), _loaded: false };
    const DataConverter = { convert: vi.fn() };
    const ConfigLoader = { load: vi.fn() };
    const ConfigNormalizer = { normalize: vi.fn() };
    const ModularProfileLoader = { loadProfile: vi.fn() };

    return {
        StyleValidator,
        StyleValidatorRules,
        Config,
        DataConverter,
        ConfigLoader,
        ConfigNormalizer,
        ModularProfileLoader,
    };
});

// B3 mocks
vi.mock("../../src/utils/validators/style-validator.js", () => ({
    StyleValidator: mocks.StyleValidator,
}));
vi.mock("../../src/utils/validators/style-validator-rules.js", () => ({
    StyleValidatorRules: mocks.StyleValidatorRules,
}));
// scale-control relocated to the in-core `scale` capability (no longer mounted by globals.config).

// B4 mocks
vi.mock("../../src/kernel/geojson/loader/data-converter.js", () => ({
    DataConverter: mocks.DataConverter,
}));
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: mocks.ConfigLoader,
}));
vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: mocks.ConfigNormalizer,
}));
vi.mock("../../src/kernel/config/profile-loader.js", () => ({
    ProfileLoader: mocks.ModularProfileLoader,
}));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: mocks.Config,
}));
// Side-effect imports — stubbed as no-ops
vi.mock("../../src/kernel/config/geoleaf-config/config-loaders.js", () => ({}));
vi.mock("../../src/kernel/config/geoleaf-config/config-accessors.js", () => ({}));
vi.mock("../../src/kernel/config/geoleaf-config/config-validation.js", () => ({}));

// Side-effect import: triggers B3+B4 assignments
import "../../src/globals/globals.config.ts";
// S1.3: trigger explicitly (ESM import — same module instance as globals.config.ts).

const GL = globalThis.GeoLeaf;

describe("globals.config.ts — B3+B4 registrations", () => {
    // ── B3 ──────────────────────────────────────────────────────────────────

    it("creates the GeoLeaf.Helpers namespace", () => {
        expect(GL.Helpers).toBeDefined();
    });

    it("no longer exposes the removed POI style resolvers", () => {
        // Breaking, and deliberate: an orphan public API with zero production callers.
        expect(GL.Helpers.StyleResolver).toBeUndefined();
        expect(GL.Helpers.getColorsFromLayerStyle).toBeUndefined();
        expect(GL.Helpers.resolvePoiColors).toBeUndefined();
    });

    it("registers GeoLeaf._Validators.StyleValidator", () => {
        expect(GL._Validators).toBeDefined();
        expect(GL._Validators.StyleValidator).toBe(mocks.StyleValidator);
    });

    it("registers GeoLeaf._Validators.StyleValidatorRules", () => {
        expect(GL._Validators.StyleValidatorRules).toBe(mocks.StyleValidatorRules);
    });

    // GeoLeaf.ScaleControl / initScaleControl relocated to the in-core `scale` capability
    // (`GeoLeaf.Scale`, mounted by globals.ui) — no longer registered by globals.config.

    // ── B4 ──────────────────────────────────────────────────────────────────

    it("registers GeoLeaf.Config via Object.assign (guard branch: sets Config if absent)", () => {
        expect(GL.Config).toBeDefined();
        // Config was set with Object.assign(GeoLeaf.Config, Config)
        expect(typeof GL.Config.get).toBe("function");
    });

    it("registers GeoLeaf._DataConverter", () => {
        expect(GL._DataConverter).toBe(mocks.DataConverter);
    });

    it("registers GeoLeaf._ConfigLoader", () => {
        expect(GL._ConfigLoader).toBe(mocks.ConfigLoader);
    });

    // ── Side-effect imports ───────────────────────────────────────────────────

    it("side-effect imports (config-loaders, config-accessors, config-validation) are loaded without error", () => {
        // If they had crashed, the import above would have thrown.
        // Reaching this test confirms they were resolved as stubs.
        expect(true).toBe(true);
    });
});
