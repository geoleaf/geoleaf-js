/**
 * The desktop side panel's tab titles follow the language the boot fixed.
 *
 * Their defaults were French literals — « Filtres », « Couches », « Legende » (no accent) — while
 * the mobile sheets read the same three titles from the dictionary. A page in English therefore
 * showed English everywhere except the three tabs of the panel, and only above 1440 px. A host
 * could not work around it: a profile title (`modules.filter.title`, `layerManagerConfig.title`,
 * `modules.legend.title`) is written in one language, and it freezes the mobile sheets too.
 *
 * The tabs are icons: their name lives in `aria-label` and `title`, never in the text.
 *
 * The order reproduced is the boot's: configure, then `initI18n()`, then build the panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfigGet = vi.hoisted(() => vi.fn((_key: string, def?: unknown) => def));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: (key: string, def?: unknown) => mockConfigGet(key, def) },
}));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The panel only builds its media query listener; jsdom has no matchMedia.
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
        matches: true,
        media: "(min-width: 1440px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

type DesktopPanelModule = typeof import("../../src/kernel/ui/desktop/desktop-panel.js");
let panelModule: DesktopPanelModule | null = null;

/** Makes `Config.get` answer `values`, and the caller's default for every other key. */
function configure(values: Record<string, unknown>): void {
    mockConfigGet.mockImplementation((key: string, def?: unknown) =>
        key in values ? values[key] : def
    );
}

/** The boot's own i18n resolution, then a fresh copy of the panel module. */
async function boot(): Promise<DesktopPanelModule> {
    const { initI18n } = await import("../../src/utils/i18n/i18n.js");
    initI18n();
    panelModule = await import("../../src/kernel/ui/desktop/desktop-panel.js");
    return panelModule;
}

function makeGlMain(): HTMLElement {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    return glMain;
}

/** The accessible name of each built-in tab, after checking `title` carries the same. */
function tabTitles(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const id of ["filters", "layers", "legend"]) {
        const btn = document.getElementById("gl-rp-tab-" + id);
        expect(btn, `tab ${id}`).not.toBeNull();
        expect(btn!.title).toBe(btn!.getAttribute("aria-label"));
        out[id] = btn!.getAttribute("aria-label");
    }
    return out;
}

beforeEach(() => {
    vi.resetModules();
    configure({});
    document.body.innerHTML = "";
});

afterEach(() => {
    panelModule?.destroyDesktopPanel();
    panelModule = null;
    document.body.innerHTML = "";
});

describe("desktop panel — default tab titles come from the dictionary", () => {
    it.each([
        ["en", { filters: "Filters", layers: "Layers", legend: "Legend" }],
        ["es", { filters: "Filtros", layers: "Capas", legend: "Leyenda" }],
    ])("ui.language=%s, no profile title", async (lang, expected) => {
        configure({ "ui.language": lang });
        const { initDesktopPanel } = await boot();
        initDesktopPanel({ glMain: makeGlMain() });
        expect(tabTitles()).toEqual(expected);
    });

    it("the default language is French, with its accent on « Légende »", async () => {
        const { initDesktopPanel } = await boot();
        initDesktopPanel({ glMain: makeGlMain() });
        expect(tabTitles()).toEqual({ filters: "Filtres", layers: "Couches", legend: "Légende" });
    });

    it("a profile `labels` override of `sheet.title.*` is honoured", async () => {
        configure({ "ui.language": "en", labels: { "sheet.title.filters": "Search the network" } });
        const { initDesktopPanel } = await boot();
        initDesktopPanel({ glMain: makeGlMain() });
        expect(tabTitles().filters).toBe("Search the network");
    });
});

describe("desktop panel — a title passed in keeps priority over the default", () => {
    it("the option bag's titles win over the language", async () => {
        configure({ "ui.language": "en" });
        const { initDesktopPanel } = await boot();
        initDesktopPanel({
            glMain: makeGlMain(),
            titleFilters: "Recherche",
            titleLayers: "Réseau",
            titleLegend: "Symboles",
        });
        expect(tabTitles()).toEqual({ filters: "Recherche", layers: "Réseau", legend: "Symboles" });
    });

    it("the profile keys reach the tabs through the boot's `initUIPanels`", async () => {
        configure({ "ui.language": "en" });
        const panel = await boot();
        const { initUIPanels } = await import("../../src/app/init-features.js");
        makeGlMain();
        const cfg = {
            ui: {},
            modules: { filter: { title: "Recherche" }, legend: { title: "Symboles" } },
            layerManagerConfig: { title: "Réseau" },
        };
        const GeoLeaf = {
            UI: { initDesktopPanel: panel.initDesktopPanel },
            Filter: { hasActiveFilters: () => false },
        };
        const AppLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };

        initUIPanels({ GeoLeaf, cfg, map: null, AppLog } as never);

        expect(AppLog.warn).not.toHaveBeenCalled();
        expect(tabTitles()).toEqual({ filters: "Recherche", layers: "Réseau", legend: "Symboles" });
    });
});
