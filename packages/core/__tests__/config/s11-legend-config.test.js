/**
 * Config-contract Phase C / B7 — config/plugins/legend.json: modules.legend.*
 *
 * Legend reads `modules.legend` via `getLegendConfig()` at init
 * (capabilities/legend/config.ts + public-api.ts) and folds
 * {title, collapsedByDefault, position} into its private `_options`, later handed
 * to `_LegendControl.create(_options)`. We observe `_options` by stubbing that
 * control factory and driving init() + _rebuildDisplay() with a minimal 1-layer
 * profile.
 *
 * S10 F2 — migrated from ui.json `legendConfig` (B3). The config is now LIVE
 * (décision option B): title/position/collapsedByDefault are actually read
 * (previously overwritten by hardcoded lifecycle options). `getLegendConfig` reads
 * `Config.get("modules.legend")` from config-primitives — mocked here (the config-core
 * guard `_initSubModules` would otherwise reset ConfigStore), mirroring
 * filter-config.test.js. The global `GeoLeaf.Config` stub (installConfig) only
 * satisfies legend-api's `typeof Config.get === "function"` guard + getActiveProfile.
 */

import {
    installConfig,
    resetConfig,
    makeFakeMap,
    REFERENCE_MODULE_LEGEND,
} from "./_helpers/config-harness.js";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

const { Legend } = await import("../../src/capabilities/legend/public-api.js");

/**
 * Drive Legend with the given modules.legend block and return the options object
 * passed to `_LegendControl.create`. The factory returns null so `_control` stays
 * null (the `if (_control) return` guard never trips) and creation is re-callable.
 */
function resolveLegendOptions(legendBlock) {
    const create = vi.fn(() => null);
    configGet.mockImplementation((path, dflt) =>
        path === "modules.legend" ? (legendBlock ?? {}) : dflt
    );
    installConfig({}); // installs global GeoLeaf.Config.get (legend-api's function guard)
    const g = globalThis;
    // Minimal active profile: one layer so _rebuildDisplay reaches the control factory.
    g.GeoLeaf.Config.getActiveProfile = () => ({ id: "ref", layers: [{ id: "l1" }] });
    g.GeoLeaf._LegendControl = { create };

    Legend.init(makeFakeMap());
    Legend._rebuildDisplay();
    return create.mock.calls[0]?.[0];
}

describe("config B7 — modules.legend (public-api.ts)", () => {
    afterEach(() => {
        configGet.mockReset();
        resetConfig();
        const g = globalThis;
        if (g.GeoLeaf) {
            if (g.GeoLeaf.Config) delete g.GeoLeaf.Config.getActiveProfile;
            delete g.GeoLeaf._LegendControl;
        }
    });

    // ── modules.legend.title → control title ──────────────────────────────────
    describe("modules.legend.title", () => {
        it("title → control title (réveillé)", () => {
            expect(resolveLegendOptions({ title: "Légende" }).title).toBe("Légende");
        });
        it("absent → défaut localisé (ex-'Legend', B.24/B.38)", () => {
            // Épinglait la chaîne ANGLAISE "Legend", servie aux six langues dans une
            // interface française. Le défaut vient désormais de `ui.legend.title` ; i18n
            // n'étant pas initialisé ici, le dictionnaire retombe sur fr.
            expect(resolveLegendOptions({}).title).toBe("Légende");
        });
    });

    // ── modules.legend.collapsedByDefault → control.collapsed ─────────────────
    describe("modules.legend.collapsedByDefault", () => {
        it("true → collapsed === true (réveillé)", () => {
            expect(resolveLegendOptions({ collapsedByDefault: true }).collapsed).toBe(true);
        });
        it("absent → default false", () => {
            expect(resolveLegendOptions({}).collapsed).toBe(false);
        });
    });

    // ── modules.legend.position → control position ────────────────────────────
    describe("modules.legend.position", () => {
        it("position → control position (réveillé)", () => {
            expect(resolveLegendOptions({ position: "topright" }).position).toBe("topright");
        });
        it("absent → default 'bottomleft'", () => {
            expect(resolveLegendOptions({}).position).toBe("bottomleft");
        });
    });

    // ── reference fixture resolves end-to-end ─────────────────────────────────
    it("reference fixture modules.legend resolves end-to-end (config réveillée)", () => {
        const opts = resolveLegendOptions(REFERENCE_MODULE_LEGEND);
        expect(opts).toMatchObject({ title: "Légende", collapsed: true, position: "topright" });
    });
});
