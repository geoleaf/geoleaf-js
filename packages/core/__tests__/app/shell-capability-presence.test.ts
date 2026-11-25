/**
 * The shell draws a control only when the capability that serves it is embarked AND on.
 *
 * ## The defect
 *
 * The mobile pill and the desktop panel decided their controls on the CONFIGURATION alone
 * (`modules.<id>.enabled !== false`). A bundle that does not embark `filter`, `legend`,
 * `geolocation` or `theme-selector` therefore still showed their tabs and buttons — empty
 * tabs, buttons that did nothing when pressed, and not a word to say why. Proximity was not
 * even read from the configuration: it was always drawn, and it kept filtering while the
 * filter capability was switched off.
 *
 * ## What the gate demands
 *
 * The shell asks the capability registry, which answers "declared AND switched on" — the
 * absence of a declaration is the fact that a capability is not in the bundle. And it reads
 * each capability's own rule: `theme-selector` builds its bar only on `enabled === true`, so
 * the shell's « Thèmes » button follows that, not the registration gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initUIPanels } from "../../src/app/init-features.js";
import { CapabilityRegistry } from "../../src/kernel/api/capability-registry.js";
import { FILTER_CAPABILITY } from "../../src/capabilities/filter/filter-capability.js";
import { LEGEND_CAPABILITY } from "../../src/capabilities/legend/legend-capability.js";
import { GEOLOCATION_CAPABILITY } from "../../src/capabilities/geolocation/geolocation-capability.js";
import { THEME_SELECTOR_CAPABILITY } from "../../src/capabilities/theme-selector/theme-selector-capability.js";
import type { MobileToolbarOptions } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";

type Bag = Record<string, unknown>;

let mobile: Bag | null;
let desktop: Bag | null;

function run(cfg: Bag = {}): { mobile: Bag; desktop: Bag } {
    mobile = null;
    desktop = null;
    initUIPanels({
        GeoLeaf: {
            UI: {
                initMobileToolbar: vi.fn((o: Bag) => {
                    mobile = o;
                }),
                initDesktopPanel: vi.fn((o: Bag) => {
                    desktop = o;
                }),
            },
        },
        cfg,
        map: {},
        AppLog: { log: vi.fn(), warn: vi.fn() },
    } as never);
    if (!mobile || !desktop) throw new Error("initUIPanels did not build both option bags");
    return { mobile, desktop };
}

function embarkAll(): void {
    for (const decl of [
        FILTER_CAPABILITY,
        LEGEND_CAPABILITY,
        GEOLOCATION_CAPABILITY,
        THEME_SELECTOR_CAPABILITY,
    ]) {
        CapabilityRegistry.register(decl);
    }
}

beforeEach(() => {
    CapabilityRegistry._reset();
    document.body.innerHTML = '<div class="gl-main"></div>';
});

afterEach(() => {
    CapabilityRegistry._reset();
    document.body.innerHTML = "";
});

describe("coquille — un contrôle n'existe que si sa capacité est embarquée et allumée", () => {
    it("noyau seul : ni filtre, ni légende, ni position, ni proximité, ni thèmes", () => {
        const { mobile, desktop } = run();

        expect(mobile).toMatchObject({
            showFilterPanel: false,
            showLegend: false,
            showGeolocation: false,
            showProximity: false,
            showThemeSelector: false,
        });
        expect(desktop).toMatchObject({ showFilters: false, showLegend: false });
    });

    it("bundle complet, aucune clé : les capacités opt-out sont là, theme-selector (opt-in) non", () => {
        embarkAll();
        const { mobile, desktop } = run();

        expect(mobile).toMatchObject({
            showFilterPanel: true,
            showLegend: true,
            showGeolocation: true,
            showProximity: true,
            showThemeSelector: false,
        });
        expect(desktop).toMatchObject({ showFilters: true, showLegend: true });
    });

    it("theme-selector allumé (`enabled: true`) : le bouton « Thèmes » revient", () => {
        embarkAll();
        expect(run({ modules: { "theme-selector": { enabled: true } } }).mobile).toMatchObject({
            showThemeSelector: true,
        });
    });

    it("filter éteint : ni panneau ni proximité", () => {
        embarkAll();
        const { mobile, desktop } = run({ modules: { filter: { enabled: false } } });

        expect(mobile).toMatchObject({ showFilterPanel: false, showProximity: false });
        expect(desktop).toMatchObject({ showFilters: false });
    });

    it("chaque capacité éteinte retire son seul contrôle", () => {
        embarkAll();
        const { mobile } = run({
            modules: { legend: { enabled: false }, geolocation: { enabled: false } },
        });

        expect(mobile).toMatchObject({
            showLegend: false,
            showGeolocation: false,
            showFilterPanel: true,
            showProximity: true,
        });
    });
});

describe("barre mobile — `showProximity`", () => {
    const globalView = globalThis as unknown as { GeoLeaf?: unknown };

    async function actions(options: Partial<MobileToolbarOptions>): Promise<string[]> {
        vi.resetModules();
        vi.doMock("../../src/utils/i18n/i18n.js", () => ({ getLabel: (k: string) => k }));
        globalView.GeoLeaf = {
            registry: { getAll: () => [] },
            plugins: { getLazyUISlots: () => [] },
        };
        const { domState } = await import("../../src/kernel/ui/mobile/mobile-toolbar-state.js");
        domState.options = { glMain: document.createElement("div"), ...options };
        const { createToolbarDom } =
            await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.js");
        const scroll = createToolbarDom().querySelector(".gl-map-toolbar__scroll");
        if (!scroll) throw new Error("the pill has no .gl-map-toolbar__scroll");
        return [...scroll.children].map(
            (el) =>
                el.getAttribute("data-gl-sheet") ?? el.getAttribute("data-gl-toolbar-action") ?? ""
        );
    }

    afterEach(() => {
        delete globalView.GeoLeaf;
        vi.doUnmock("../../src/utils/i18n/i18n.js");
        vi.resetModules();
    });

    it("false : aucun bouton de proximité", async () => {
        expect(await actions({ showProximity: false })).not.toContain("proximity");
    });

    it("absent : le bouton reste (défaut inchangé pour un appelant direct)", async () => {
        expect(await actions({})).toContain("proximity");
    });
});
