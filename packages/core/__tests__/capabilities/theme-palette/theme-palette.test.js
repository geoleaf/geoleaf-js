/**
 * Unit tests — capacité `theme-palette` (S3).
 *
 * Insiste sur les propriétés que le CDC désigne comme porteuses :
 *   • la palette et le mode clair/sombre sont ORTHOGONAUX (axes indépendants) ;
 *   • la palette `default` est l'ABSENCE d'attribut, pas un attribut valant "default" ;
 *   • le `default` de config s'applique MÊME quand le sélecteur est désactivé — c'est le
 *     cas majoritaire en production ;
 *   • un accès `localStorage` qui jette ne casse rien.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { THEME_PALETTE_CAPABILITY } = await import(
    "../../../src/capabilities/theme-palette/theme-palette-capability.ts"
);
const { Config } = await import("../../../src/kernel/config/config-primitives.ts");
const { getThemePaletteConfig, getPalettes } = await import(
    "../../../src/capabilities/theme-palette/config.ts"
);
const { applyPalette, getPalette, resolveInitialPalette, PALETTE_STORAGE_KEY } = await import(
    "../../../src/capabilities/theme-palette/palette-engine.ts"
);
const { ThemePaletteLifecycle } = await import(
    "../../../src/capabilities/theme-palette/lifecycle.ts"
);
const { PALETTE_BUTTON_CLASS } = await import(
    "../../../src/capabilities/theme-palette/palette-button.ts"
);
const { emitDesktopTabsReady } = await import(
    "../../../src/kernel/ui/desktop/desktop-tabs-seam.ts"
);

const _originalGet = Config.get;
function stubConfig(cfg) {
    Config.get = (path, def) => {
        const v = path.split(".").reduce((o, k) => o?.[k], cfg);
        return v === undefined ? def : v;
    };
}

const ENABLED = { modules: { "theme-palette": { enabled: true } } };

beforeEach(() => {
    document.body.innerHTML = "";
    delete document.documentElement.dataset.glPalette;
    localStorage.clear();
    CapabilityRegistry._reset();
    ThemePaletteLifecycle._reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    ThemePaletteLifecycle._reset();
    delete document.documentElement.dataset.glPalette;
    if (_originalGet === undefined) delete Config.get;
    else Config.get = _originalGet;
});

describe("THEME_PALETTE_CAPABILITY declaration", () => {
    it("has id 'theme-palette' and gates on modules.theme-palette.enabled", () => {
        expect(THEME_PALETTE_CAPABILITY.id).toBe("theme-palette");
        expect(THEME_PALETTE_CAPABILITY.gate.configPath).toBe("modules.theme-palette.enabled");
    });

    it("registers when absent but declares a user-facing default of OFF", () => {
        expect(THEME_PALETTE_CAPABILITY.gate.enableWhenAbsent).toBe(true);
        expect(THEME_PALETTE_CAPABILITY.configSchema.enabled.default).toBe(false);
    });
});

describe("config", () => {
    it("ships the three built-in palettes by default", () => {
        stubConfig({});
        expect(getPalettes().map((p) => p.id)).toEqual(["default", "green", "blue"]);
        expect(getThemePaletteConfig().enabled).toBe(false);
    });

    it("honours a configured list", () => {
        stubConfig({
            modules: {
                "theme-palette": { palettes: [{ id: "green", label: "V", swatch: "#0f0" }] },
            },
        });
        expect(getPalettes().map((p) => p.id)).toEqual(["green"]);
    });

    it("falls back to the built-ins when every configured entry is malformed", () => {
        stubConfig({ modules: { "theme-palette": { palettes: [null, { label: "no id" }] } } });
        expect(getPalettes().map((p) => p.id)).toEqual(["default", "green", "blue"]);
    });
});

describe("palette-engine", () => {
    it("applies a palette as an attribute on <html>", () => {
        stubConfig({});
        applyPalette("green");
        expect(document.documentElement.dataset.glPalette).toBe("green");
        expect(getPalette()).toBe("green");
    });

    it("'default' REMOVES the attribute — it is the absence, not a value", () => {
        // Un bloc `[data-gl-palette="default"]` n'existe pas : le défaut, ce sont les
        // tokens du kernel tels quels.
        stubConfig({});
        applyPalette("green");
        applyPalette("default");
        expect(document.documentElement.dataset.glPalette).toBeUndefined();
        expect(getPalette()).toBe("default");
    });

    it("persists the choice, and restores it", () => {
        stubConfig({});
        applyPalette("blue");
        expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe("blue");
        expect(resolveInitialPalette()).toBe("blue");
    });

    it("ignores an unknown palette rather than leaving the UI unstyled", () => {
        stubConfig({});
        applyPalette("green");
        applyPalette("chartreuse");
        expect(getPalette()).toBe("green");
    });

    it("emits geoleaf:palette-changed", () => {
        stubConfig({});
        const seen = [];
        const h = (e) => seen.push(e.detail.palette);
        document.addEventListener("geoleaf:palette-changed", h);
        applyPalette("green");
        document.removeEventListener("geoleaf:palette-changed", h);
        expect(seen).toEqual(["green"]);
    });

    it("resolves stored → configured default → 'default'", () => {
        stubConfig({ modules: { "theme-palette": { default: "blue" } } });
        expect(resolveInitialPalette()).toBe("blue");

        localStorage.setItem(PALETTE_STORAGE_KEY, "green");
        expect(resolveInitialPalette()).toBe("green");

        localStorage.setItem(PALETTE_STORAGE_KEY, "chartreuse"); // inconnue
        expect(resolveInitialPalette()).toBe("blue"); // repli sur la config
    });

    it("ne jette pas quand localStorage est inaccessible", () => {
        stubConfig({});
        const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("SecurityError");
        });
        const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("SecurityError");
        });
        expect(() => resolveInitialPalette()).not.toThrow();
        expect(() => applyPalette("green")).not.toThrow();
        expect(getPalette()).toBe("green"); // appliquée quand même
        get.mockRestore();
        set.mockRestore();
    });

    it("est ORTHOGONAL au mode clair/sombre", () => {
        // La palette vit sur <html>, le mode sur <body> : changer l'une ne doit jamais
        // réinitialiser l'autre.
        stubConfig({});
        document.body.className = "gl-theme-dark";
        applyPalette("green");
        expect(document.body.className).toBe("gl-theme-dark");

        document.body.className = "gl-theme-light";
        expect(document.documentElement.dataset.glPalette).toBe("green");
    });
});

describe("ThemePaletteLifecycle", () => {
    function buildTabs() {
        const tabs = document.createElement("div");
        tabs.className = "gl-rp-tabs";
        const toggle = document.createElement("button");
        toggle.className = "gl-rp-tab-btn gl-rp-theme-toggle";
        tabs.appendChild(toggle);
        document.body.appendChild(tabs);
        return { tabs, toggle };
    }

    it("applique le `default` de config MÊME sélecteur désactivé (cas majoritaire)", () => {
        // L'intégrateur qui fixe sa couleur de marque met enabled:false et garde default.
        stubConfig({ modules: { "theme-palette": { enabled: false, default: "green" } } });
        ThemePaletteLifecycle.init();
        expect(document.documentElement.dataset.glPalette).toBe("green");
        expect(document.querySelector(`.${PALETTE_BUTTON_CLASS}`)).toBeNull();
    });

    it("n'écrase pas la préférence stockée en l'appliquant au boot", () => {
        stubConfig({ modules: { "theme-palette": { enabled: true, default: "blue" } } });
        localStorage.setItem(PALETTE_STORAGE_KEY, "green");
        ThemePaletteLifecycle.init();
        expect(document.documentElement.dataset.glPalette).toBe("green");
        expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe("green");
    });

    it("insère le bouton AVANT le toggle de thème", () => {
        stubConfig(ENABLED);
        const { tabs, toggle } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);

        const btn = tabs.querySelector(`.${PALETTE_BUTTON_CLASS}`);
        expect(btn).not.toBeNull();
        expect(btn.nextElementSibling).toBe(toggle);
    });

    it("ne duplique pas le bouton sur une seconde émission du seam", () => {
        stubConfig(ENABLED);
        const { tabs } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);
        emitDesktopTabsReady(tabs);
        expect(document.querySelectorAll(`.${PALETTE_BUTTON_CLASS}`)).toHaveLength(1);
    });

    it("ne monte pas le bouton avec une seule palette (choix unique = leurre)", () => {
        stubConfig({
            modules: {
                "theme-palette": {
                    enabled: true,
                    palettes: [{ id: "green", label: "V", swatch: "#0f0" }],
                },
            },
        });
        const { tabs } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${PALETTE_BUTTON_CLASS}`)).toBeNull();
    });

    it("bascule À CHAUD depuis le popover, sans rechargement", () => {
        stubConfig(ENABLED);
        const { tabs } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);

        tabs.querySelector(`.${PALETTE_BUTTON_CLASS}`).click();
        const popover = document.querySelector(".gl-palette-popover");
        expect(popover).not.toBeNull();

        popover.querySelector('[data-gl-palette="green"]').click();
        expect(document.documentElement.dataset.glPalette).toBe("green");
        // Marquage actif mis à jour sans reconstruire le popover.
        expect(
            popover.querySelector('[data-gl-palette="green"]').getAttribute("aria-current")
        ).toBe("true");
    });

    it("ferme le popover sur Échap", () => {
        stubConfig(ENABLED);
        const { tabs } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);
        tabs.querySelector(`.${PALETTE_BUTTON_CLASS}`).click();
        expect(document.querySelector(".gl-palette-popover")).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.querySelector(".gl-palette-popover")).toBeNull();
    });

    it("_reset() retire le bouton et cesse d'écouter", () => {
        stubConfig(ENABLED);
        const { tabs } = buildTabs();
        ThemePaletteLifecycle.init();
        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${PALETTE_BUTTON_CLASS}`)).not.toBeNull();

        ThemePaletteLifecycle._reset();
        expect(document.querySelector(`.${PALETTE_BUTTON_CLASS}`)).toBeNull();

        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${PALETTE_BUTTON_CLASS}`)).toBeNull();
    });
});
