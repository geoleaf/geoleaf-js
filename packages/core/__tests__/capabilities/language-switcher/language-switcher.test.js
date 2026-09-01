/**
 * Unit tests — `language-switcher` capability.
 *
 * Covers in priority the TWO risks the CDC names as major:
 *   1. `initI18n()` runs before any `getLabel()` — a throwing `localStorage`
 *      access (private browsing) would break the whole boot;
 *   2. the URL's `?lang=` must stay PRIORITY over the saved preference,
 *      otherwise a shared link is no longer reproducible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { LANGUAGE_SWITCHER_CAPABILITY } =
    await import("../../../src/capabilities/language-switcher/language-switcher-capability.ts");
const { Config } = await import("../../../src/kernel/config/config-primitives.ts");
const { getLanguageSwitcherConfig, getOfferedLanguages } =
    await import("../../../src/capabilities/language-switcher/config.ts");
const { switchToLanguage } =
    await import("../../../src/capabilities/language-switcher/language-switch.ts");
const { LanguageSwitcherLifecycle } =
    await import("../../../src/capabilities/language-switcher/lifecycle.ts");
const { LANG_BUTTON_CLASS } =
    await import("../../../src/capabilities/language-switcher/language-button.ts");
const { emitDesktopTabsReady } =
    await import("../../../src/kernel/ui/desktop/desktop-tabs-seam.ts");
const { initI18n, getActiveLang, LANG_STORAGE_KEY } =
    await import("../../../src/utils/i18n/i18n.ts");

const _originalGet = Config.get;
function stubConfig(cfg) {
    Config.get = (path, def) => {
        const v = path.split(".").reduce((o, k) => o?.[k], cfg);
        return v === undefined ? def : v;
    };
}

/** Rewrites the query string initI18n / switchToLanguage see. */
function setSearch(search) {
    delete window.location;
    window.location = {
        href: `https://example.test/${search}`,
        search,
    };
}

beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    setSearch("");
    CapabilityRegistry._reset();
    LanguageSwitcherLifecycle._reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    LanguageSwitcherLifecycle._reset();
    if (_originalGet === undefined) delete Config.get;
    else Config.get = _originalGet;
});

describe("LANGUAGE_SWITCHER_CAPABILITY declaration", () => {
    it("has id 'language-switcher' and gates on modules.language-switcher.enabled", () => {
        expect(LANGUAGE_SWITCHER_CAPABILITY.id).toBe("language-switcher");
        expect(LANGUAGE_SWITCHER_CAPABILITY.gate.configPath).toBe(
            "modules.language-switcher.enabled"
        );
    });

    it("registers when absent but declares a user-facing default of OFF", () => {
        expect(LANGUAGE_SWITCHER_CAPABILITY.gate.enableWhenAbsent).toBe(true);
        expect(LANGUAGE_SWITCHER_CAPABILITY.configSchema.enabled.default).toBe(false);
    });
});

describe("config", () => {
    it("defaults to disabled, flag display, every compiled language", () => {
        stubConfig({});
        const cfg = getLanguageSwitcherConfig();
        expect(cfg.enabled).toBe(false);
        expect(cfg.display).toBe("flag");
        // 6 = the dictionaries compiled into the kernel (`LANGS`, utils/i18n/i18n.ts).
        expect(getOfferedLanguages()).toHaveLength(6);
    });

    it("narrows the list to the configured codes", () => {
        stubConfig({ modules: { "language-switcher": { languages: ["fr", "en"] } } });
        expect(getOfferedLanguages().map((l) => l.code)).toEqual(["fr", "en"]);
    });

    it("ignores unknown codes rather than offering a dictionary-less language", () => {
        stubConfig({ modules: { "language-switcher": { languages: ["fr", "klingon"] } } });
        expect(getOfferedLanguages().map((l) => l.code)).toEqual(["fr"]);
    });

    it("falls back to the full list when the filter matches nothing (empty popover)", () => {
        stubConfig({ modules: { "language-switcher": { languages: ["klingon"] } } });
        // 6 = the dictionaries compiled into the kernel (`LANGS`, utils/i18n/i18n.ts).
        expect(getOfferedLanguages()).toHaveLength(6);
    });

    it("treats an invalid display value as 'flag'", () => {
        stubConfig({ modules: { "language-switcher": { display: "banner" } } });
        expect(getLanguageSwitcherConfig().display).toBe("flag");
    });
});

describe("initI18n() — ordre de résolution (risque CDC n°2)", () => {
    it("le ?lang= de l'URL PRIME sur la préférence enregistrée", () => {
        // Otherwise a shared link would display the recipient's language, not the link's.
        localStorage.setItem(LANG_STORAGE_KEY, "de");
        setSearch("?lang=es");
        stubConfig({ ui: { language: "fr" } });
        initI18n();
        expect(getActiveLang()).toBe("es");
    });

    it("la préférence enregistrée prime sur ui.language", () => {
        localStorage.setItem(LANG_STORAGE_KEY, "de");
        stubConfig({ ui: { language: "fr" } });
        initI18n();
        expect(getActiveLang()).toBe("de");
    });

    it("ui.language s'applique sans URL ni préférence", () => {
        stubConfig({ ui: { language: "it" } });
        initI18n();
        expect(getActiveLang()).toBe("it");
    });

    it("un code inconnu retombe sur le français sans casser le boot", () => {
        localStorage.setItem(LANG_STORAGE_KEY, "klingon");
        stubConfig({});
        initI18n();
        expect(getActiveLang()).toBe("fr");
    });

    it("NE JETTE PAS quand localStorage est inaccessible (risque CDC n°1)", () => {
        // initI18n() runs before the first getLabel(): an exception here
        // would take the whole boot down.
        const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("SecurityError: localStorage is not available");
        });
        stubConfig({ ui: { language: "en" } });
        expect(() => initI18n()).not.toThrow();
        expect(getActiveLang()).toBe("en"); // repli silencieux sur ui.language
        spy.mockRestore();
    });
});

describe("switchToLanguage()", () => {
    let assigned;

    beforeEach(() => {
        assigned = null;
        setSearch("?a=1");
        Object.defineProperty(window.location, "href", {
            get: () => "https://example.test/?a=1",
            set: (v) => {
                assigned = v;
            },
            configurable: true,
        });
    });

    it("persiste le choix et recharge avec ?lang=", () => {
        switchToLanguage("en");
        expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("en");
        expect(assigned).toContain("lang=en");
    });

    it("refuse un code forgé sans rien persister ni naviguer", () => {
        switchToLanguage("../../etc");
        expect(localStorage.getItem(LANG_STORAGE_KEY)).toBeNull();
        expect(assigned).toBeNull();
    });

    it("bascule quand même si localStorage est indisponible", () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        expect(() => switchToLanguage("de")).not.toThrow();
        expect(assigned).toContain("lang=de");
        spy.mockRestore();
    });
});

describe("LanguageSwitcherLifecycle", () => {
    /** Builds the desktop tab strip as the kernel produces it. */
    function buildTabs() {
        const tabs = document.createElement("div");
        tabs.className = "gl-rp-tabs";
        const toggle = document.createElement("button");
        toggle.className = "gl-rp-tab-btn gl-rp-theme-toggle";
        tabs.appendChild(toggle);
        document.body.appendChild(tabs);
        return { tabs, toggle };
    }

    it("ne monte rien quand la capacité est désactivée (opt-in)", () => {
        stubConfig({});
        const { tabs } = buildTabs();
        LanguageSwitcherLifecycle.init();
        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${LANG_BUTTON_CLASS}`)).toBeNull();
    });

    it("insère le bouton AVANT le toggle de thème", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        const { tabs, toggle } = buildTabs();
        LanguageSwitcherLifecycle.init();
        emitDesktopTabsReady(tabs);

        const btn = tabs.querySelector(`.${LANG_BUTTON_CLASS}`);
        expect(btn).not.toBeNull();
        expect(btn.nextElementSibling).toBe(toggle);
    });

    it("ne duplique pas le bouton sur une seconde émission du seam", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        const { tabs } = buildTabs();
        LanguageSwitcherLifecycle.init();
        emitDesktopTabsReady(tabs);
        emitDesktopTabsReady(tabs);
        expect(document.querySelectorAll(`.${LANG_BUTTON_CLASS}`)).toHaveLength(1);
    });

    it("rattrape un bandeau déjà construit au moment de l'init", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        buildTabs(); // the seam was already emitted before init()
        LanguageSwitcherLifecycle.init();
        expect(document.querySelector(`.${LANG_BUTTON_CLASS}`)).not.toBeNull();
    });

    it("injecte aussi la variante mobile dans la barre d'outils", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        const scroll = document.createElement("div");
        scroll.className = "gl-map-toolbar__scroll";
        document.body.appendChild(scroll);
        LanguageSwitcherLifecycle.init();
        expect(scroll.querySelector(`.${LANG_BUTTON_CLASS}`)).not.toBeNull();
    });

    it("ouvre un popover listant les langues, puis le referme sur Échap", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        const { tabs } = buildTabs();
        LanguageSwitcherLifecycle.init();
        emitDesktopTabsReady(tabs);

        tabs.querySelector(`.${LANG_BUTTON_CLASS}`).click();
        const popover = document.querySelector(".gl-lang-popover");
        expect(popover).not.toBeNull();
        expect(popover.querySelectorAll(".gl-lang-popover__item").length).toBeGreaterThan(1);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.querySelector(".gl-lang-popover")).toBeNull();
    });

    it("_reset() retire le bouton et cesse d'écouter", () => {
        stubConfig({ modules: { "language-switcher": { enabled: true } } });
        const { tabs } = buildTabs();
        LanguageSwitcherLifecycle.init();
        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${LANG_BUTTON_CLASS}`)).not.toBeNull();

        LanguageSwitcherLifecycle._reset();
        expect(document.querySelector(`.${LANG_BUTTON_CLASS}`)).toBeNull();

        emitDesktopTabsReady(tabs);
        expect(document.querySelector(`.${LANG_BUTTON_CLASS}`)).toBeNull();
    });
});
