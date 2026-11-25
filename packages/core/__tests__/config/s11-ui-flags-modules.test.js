/**
 * Config-contract Phase C / C2 — B3 ui.json: ui.* flags read OUTSIDE app/init.ts.
 *
 *  - showGeolocation / showThemeSelector → initUIPanels forwards them to
 *    GeoLeaf.UI.initMobileToolbar, read from the capability registry (embarked AND on):
 *    geolocation is opt-out; theme-selector registers when its key is absent but builds its
 *    bar only on `enabled === true`, and the button follows that rule.
 *  - showBaseLayerControls → createBaseLayerControlsUI gates #gl-left-panel via
 *    _computeShowControls (basemaps/ui.ts-176).
 *  - ui.language → initI18n reads Config.get("ui.language","fr") and selects the
 *    active dictionary (i18n.ts).
 *
 * Consumers: app/init-features.ts, basemaps/ui.ts, utils/i18n/i18n.ts. Inventory B3.
 */

import { initUIPanels } from "../../src/app/init-features.js";
import { CapabilityRegistry } from "../../src/kernel/api/capability-registry.js";
import { GEOLOCATION_CAPABILITY } from "../../src/capabilities/geolocation/geolocation-capability.js";
import { THEME_SELECTOR_CAPABILITY } from "../../src/capabilities/theme-selector/theme-selector-capability.js";
import { createBaseLayerControlsUI } from "../../src/kernel/basemaps/ui.js";
import { initI18n, getLabel } from "../../src/utils/i18n/i18n.js";
import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";
import langFr from "../../src/lang/lang-fr.js";
import langEn from "../../src/lang/lang-en.js";

// ── showAddPoi / showGeolocation / showThemeSelector (mobile toolbar args) ────
describe("config B3 — ui flags via initUIPanels (init-features.ts)", () => {
    let GeoLeaf, mobileArgs;
    beforeEach(() => {
        document.body.innerHTML = '<div class="gl-main"></div>';
        mobileArgs = null;
        CapabilityRegistry._reset();
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        GeoLeaf = {
            UI: {
                initMobileToolbar: vi.fn((args) => {
                    mobileArgs = args;
                }),
                initDesktopPanel: vi.fn(),
            },
        };
    });

    function run(ui = {}, extra = {}) {
        initUIPanels({
            GeoLeaf,
            cfg: { ui, ...extra },
            map: {},
            AppLog: { log: vi.fn(), warn: vi.fn() },
        });
        return mobileArgs;
    }

    it("geolocation → showGeolocation default true, false when modules.geolocation.enabled=false", () => {
        expect(run({}).showGeolocation).toBe(true);
        expect(run({}, { modules: { geolocation: { enabled: false } } }).showGeolocation).toBe(
            false
        );
    });
    it("theme-selector → showThemeSelector only when modules.theme-selector.enabled=true (opt-in bar)", () => {
        expect(run({}).showThemeSelector).toBe(false);
        expect(
            run({}, { modules: { "theme-selector": { enabled: true } } }).showThemeSelector
        ).toBe(true);
        expect(
            run({}, { modules: { "theme-selector": { enabled: false } } }).showThemeSelector
        ).toBe(false);
    });
    it("sheet titles are sourced from *Config.title", () => {
        const args = run(
            {},
            { modules: { filter: { title: "Filtrer" }, legend: { title: "Légende" } } }
        );
        expect(args.sheetTitles).toMatchObject({ filters: "Filtrer", legend: "Légende" });
    });
});

// ── showBaseLayerControls ─────────────────────────────────────────────────────
describe("config B3 — ui.showBaseLayerControls (basemaps/ui.ts)", () => {
    beforeEach(() => {
        vi.useFakeTimers(); // createBaseLayerControlsUI schedules a deferred refreshUI
        document.body.innerHTML = '<div id="geoleaf-map"></div>';
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("false → left panel is not present", () => {
        createBaseLayerControlsUI({ ui: { showBaseLayerControls: false }, basemaps: {} });
        expect(document.getElementById("gl-left-panel")).toBeNull();
    });
    it("true → left panel is created", () => {
        createBaseLayerControlsUI({ ui: { showBaseLayerControls: true }, basemaps: {} });
        expect(document.getElementById("gl-left-panel")).not.toBeNull();
    });
    it("absent flag (ui present) → controls shown", () => {
        createBaseLayerControlsUI({ ui: {}, basemaps: {} });
        expect(document.getElementById("gl-left-panel")).not.toBeNull();
    });
});

// ── ui.language ───────────────────────────────────────────────────────────────
describe("config B3 — ui.language (i18n.ts initI18n)", () => {
    let origGet;
    beforeEach(() => {
        origGet = Config.get;
    });
    afterEach(() => {
        Config.get = origGet;
    });

    function setLangAndInit(lang) {
        Config.get = (key, dflt) => (key === "ui.language" ? lang : key === "labels" ? {} : dflt);
        initI18n();
    }

    // A flat key whose string value differs between the bundled fr and en dicts.
    const DIFF_KEY = Object.keys(langFr).find(
        (k) =>
            typeof langFr[k] === "string" &&
            typeof langEn[k] === "string" &&
            langFr[k] !== langEn[k]
    );

    it("the bundled fr/en dictionaries expose a differing key (sanity)", () => {
        expect(DIFF_KEY).toBeTruthy();
    });

    it("ui.language selects the active dictionary (fr vs en)", () => {
        setLangAndInit("fr");
        const fr = getLabel(DIFF_KEY);
        setLangAndInit("en");
        const en = getLabel(DIFF_KEY);
        expect(fr).toBe(langFr[DIFF_KEY]);
        expect(en).toBe(langEn[DIFF_KEY]);
        expect(fr).not.toBe(en);
    });

    it("absent ui.language → defaults to fr", () => {
        Config.get = (key, dflt) => (key === "labels" ? {} : dflt); // ui.language → dflt "fr"
        initI18n();
        expect(getLabel(DIFF_KEY)).toBe(langFr[DIFF_KEY]);
    });
});
