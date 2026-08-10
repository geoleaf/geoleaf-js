/**
 * Test suite: i18n module + lang files
 * T6 — Sprint 5 GeoLeaf-JS Roadmap 2026-03-13
 *
 * Coverage:
 *  - All 6 lang files contain every required key (including T5 new keys)
 *  - getLabel() default FR, fallback, interpolation
 *  - getLabel() language switching via initI18n()
 *  - getLabel() config label overrides
 *  - getLabel() unknown key falls back to key string
 */

const mockConfigGet = vi.hoisted(() => vi.fn((key, def) => def));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: (...args) => mockConfigGet(...args) },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Keys that every lang file must provide (includes T5 additions)
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_KEYS = [
    "toast.geoloc.position_found",
    "toast.geoloc.locating",
    "aria.toolbar.fullscreen",
    "aria.geoloc.toggle",
    "ui.proximity.point_placed",
    "ui.proximity.instruction_initial",
    // T5 new keys
    "ui.filter.activate",
    "ui.filter.disable",
    "ui.offline.badge",
    "ui.theme.select_placeholder",
    // pre-existing
    "ui.layer_manager.empty",
    "ui.filter_panel.apply",
    "ui.filter_panel.reset",
    "format.proximity.radius",
    "format.zoom.level",
];

const LANG_CODES = ["fr", "en", "de", "es", "it", "pt"];

// ─────────────────────────────────────────────────────────────────────────────
describe("lang files — key completeness", () => {
    // ── parametric: each lang file must have every required key ──────────────
    test.each(LANG_CODES)(
        "lang-%s exports all required keys as non-empty strings",
        async (code) => {
            const dict = (await import(/* @vite-ignore */ `../../src/lang/lang-${code}.js`))
                .default;
            expect(typeof dict).toBe("object");
            REQUIRED_KEYS.forEach((key) => {
                expect(typeof dict[key]).toBe("string");
                expect(dict[key].length).toBeGreaterThan(0);
            });
        }
    );

    // ── spot-checks for T5 new key values ────────────────────────────────────
    it("lang-fr: ui.layer_manager.empty is correct French (T4 fix)", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["ui.layer_manager.empty"]).toBe("Aucune couche \u00e0 afficher.");
    });

    it("lang-en: ui.filter.activate is 'Activate'", async () => {
        const en = (await import("../../src/lang/lang-en.ts")).default;
        expect(en["ui.filter.activate"]).toBe("Activate");
    });

    it("lang-en: ui.filter.disable is 'Disable'", async () => {
        const en = (await import("../../src/lang/lang-en.ts")).default;
        expect(en["ui.filter.disable"]).toBe("Disable");
    });

    it("lang-en: ui.offline.badge contains 'Offline'", async () => {
        const en = (await import("../../src/lang/lang-en.ts")).default;
        expect(en["ui.offline.badge"]).toContain("Offline");
    });

    it("lang-en: ui.theme.select_placeholder is 'Select a theme...'", async () => {
        const en = (await import("../../src/lang/lang-en.ts")).default;
        expect(en["ui.theme.select_placeholder"]).toBe("Select a theme...");
    });

    it("lang-de: ui.filter.activate is 'Aktivieren'", async () => {
        const de = (await import("../../src/lang/lang-de.ts")).default;
        expect(de["ui.filter.activate"]).toBe("Aktivieren");
    });

    it("lang-fr: ui.offline.badge contains warning emoji", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["ui.offline.badge"]).toContain("\u26a0");
    });

    it("lang-fr: ui.filter.activate is 'Activer'", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["ui.filter.activate"]).toBe("Activer");
    });

    it("lang-fr: ui.filter.disable is 'D\u00e9sactiver'", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["ui.filter.disable"]).toBe("D\u00e9sactiver");
    });

    // franglais guards (SOCLE Sprint 3): aria labels FR must not contain 'hide'/'layer'
    it("lang-fr: aria.layer.toggle is idiomatic French (no 'hide'/'layer' anglicism)", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["aria.layer.toggle"]).toBe("Afficher / masquer la couche");
        expect(fr["aria.layer.toggle"]).not.toMatch(/hide|layer/i);
    });

    it("lang-fr: aria.labels.toggle is idiomatic French (no 'hide' anglicism)", async () => {
        const fr = (await import("../../src/lang/lang-fr.ts")).default;
        expect(fr["aria.labels.toggle"]).toBe("Afficher/masquer les \u00e9tiquettes");
        expect(fr["aria.labels.toggle"]).not.toMatch(/hide/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — default French", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        mockConfigGet.mockImplementation((key, def) => def); // no language override → FR default
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
        initI18n();
    });

    it("returns French label for a known key", () => {
        expect(getLabel("toast.geoloc.position_found")).toBe("Position trouv\u00e9e");
    });

    it("returns the raw key for an unknown key (fallback)", () => {
        expect(getLabel("nonexistent.key.xyz")).toBe("nonexistent.key.xyz");
    });

    it("interpolates single {0} placeholder", () => {
        const result = getLabel("toast.profile.loaded", "MyProfile");
        expect(result).toBe("MyProfile chargé");
    });

    it("interpolates {0} in format.zoom.level", () => {
        expect(getLabel("format.zoom.level", "12")).toBe("Zoom : 12");
    });

    it("leaves {0} intact when no interpolation arg provided", () => {
        expect(getLabel("toast.profile.loaded")).toContain("{0}");
    });

    it("ui.filter.activate returns French 'Activer'", () => {
        expect(getLabel("ui.filter.activate")).toBe("Activer");
    });

    it("ui.filter.disable returns French 'D\u00e9sactiver'", () => {
        expect(getLabel("ui.filter.disable")).toBe("D\u00e9sactiver");
    });

    it("ui.offline.badge contains warning emoji", () => {
        expect(getLabel("ui.offline.badge")).toContain("\u26a0");
    });

    it("ui.theme.select_placeholder returns a non-empty string", () => {
        const val = getLabel("ui.theme.select_placeholder");
        expect(typeof val).toBe("string");
        expect(val.length).toBeGreaterThan(0);
    });

    it("ui.layer_manager.empty contains French text (no 'display' anglicism)", () => {
        const val = getLabel("ui.layer_manager.empty");
        expect(val).not.toContain("display");
        expect(val.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — language switching via initI18n()", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
    });

    it("switches to English when Config returns 'en'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "en" : def));
        initI18n();
        expect(getLabel("toast.geoloc.position_found")).toBe("Position found");
        expect(getLabel("ui.filter.activate")).toBe("Activate");
        expect(getLabel("ui.filter.disable")).toBe("Disable");
    });

    it("switches to German when Config returns 'de'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "de" : def));
        initI18n();
        expect(getLabel("ui.filter.activate")).toBe("Aktivieren");
        expect(getLabel("ui.filter.disable")).toBe("Deaktivieren");
    });

    it("switches to Spanish when Config returns 'es'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "es" : def));
        initI18n();
        expect(getLabel("ui.filter.activate")).toBe("Activar");
        expect(getLabel("ui.filter.disable")).toBe("Desactivar");
    });

    it("falls back to French for unknown language code 'zz'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "zz" : def));
        initI18n();
        expect(getLabel("toast.geoloc.position_found")).toBe("Position trouv\u00e9e");
    });

    afterAll(() => {
        // Reset to FR default for isolation
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — config label overrides", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
    });

    it("config 'labels' override takes precedence over lang dict", () => {
        mockConfigGet.mockImplementation((key, def) => {
            if (key === "ui.language") return "fr";
            if (key === "labels") return { "ui.filter.activate": "Custom Activate" };
            return def;
        });
        initI18n();
        expect(getLabel("ui.filter.activate")).toBe("Custom Activate");
    });

    it("non-overridden key still returns lang dict value", () => {
        expect(getLabel("toast.geoloc.position_found")).toBe("Position trouv\u00e9e");
    });

    it("override can inject brand-new keys not in any lang file", () => {
        mockConfigGet.mockImplementation((key, def) => {
            if (key === "ui.language") return "en";
            if (key === "labels") return { "custom.brand.name": "My App" };
            return def;
        });
        initI18n();
        expect(getLabel("custom.brand.name")).toBe("My App");
        // Unknown key without override still falls back to raw key
        expect(getLabel("custom.other.missing")).toBe("custom.other.missing");
    });

    afterAll(() => {
        // Restore defaults
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — 'al' alias (French shorthand for German)", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
    });

    it("'al' resolves to the same labels as 'de'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "de" : def));
        initI18n();
        const labelDe = getLabel("ui.filter.activate");

        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "al" : def));
        initI18n();
        const labelAl = getLabel("ui.filter.activate");

        expect(labelAl).toBe(labelDe);
    });

    afterAll(() => {
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — initI18n() resilience", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        mockConfigGet.mockImplementation((key, def) => def);
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
    });

    it("initI18n() can be called multiple times without crashing", () => {
        expect(() => {
            initI18n();
            initI18n();
            initI18n();
        }).not.toThrow();
    });

    it("getLabel() still returns correct value after multiple initI18n() calls", () => {
        initI18n();
        initI18n();
        expect(getLabel("ui.filter.activate")).toBe("Activer");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getLabel() — multi-arg interpolation {0} and {1}", () => {
    let getLabel, initI18n;

    beforeAll(async () => {
        mockConfigGet.mockImplementation((key, def) => {
            if (key === "ui.language") return "en";
            if (key === "labels") return { "test.two_args": "Hello {0} and {1}!" };
            return def;
        });
        ({ getLabel, initI18n } = await import("../../src/utils/i18n/i18n.ts"));
        initI18n();
    });

    it("{0} and {1} are both substituted in order", () => {
        expect(getLabel("test.two_args", "Alice", "Bob")).toBe("Hello Alice and Bob!");
    });

    it("only {0} substituted when only one arg provided", () => {
        const result = getLabel("test.two_args", "Alice");
        expect(result).toBe("Hello Alice and {1}!");
    });

    afterAll(() => {
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// RM-P2 #7 — `t(key, fallback)` seam mounted as GeoLeaf.I18n.t. Distinct from
// getLabel: 2nd arg is a fallback, not an interpolation value. Consumers
// (feature-info aria-labels) used to always fall back because `.t` was unmounted.
describe("t() — i18n seam (RM-P2 #7)", () => {
    let t, initI18n, registerDict;

    beforeAll(async () => {
        mockConfigGet.mockImplementation((key, def) => def); // FR default
        ({ t, initI18n, registerDict } = await import("../../src/utils/i18n/i18n.ts"));
        initI18n();
    });

    it("returns the provided fallback when the key is unresolved", () => {
        expect(t("no.such.key.rmp2", "Fallback")).toBe("Fallback");
    });

    it("returns the key itself when unresolved and no fallback is given", () => {
        expect(t("no.such.key.rmp2")).toBe("no.such.key.rmp2");
    });

    it("returns the resolved core label (ignoring the fallback) for a known key", () => {
        expect(t("toast.geoloc.position_found", "IGNORED")).toBe("Position trouvée");
    });

    it("resolves a key registered via a plugin dict — the seam now reads dicts", () => {
        registerDict("rmp2-test", { fr: { "aria.rmp2.close": "Fermer-RMP2" } });
        initI18n();
        expect(t("aria.rmp2.close", "fallback")).toBe("Fermer-RMP2");
    });

    afterAll(() => {
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6.3 — `<html lang>` suit la langue RÉSOLUE
//
// L'application déployée expédiait `<html lang="en">` en dur en servant six langues :
// l'attribut était faux pour cinq profils sur six, dont le défaut français, et un lecteur
// d'écran annonçait du français avec une phonétique anglaise.
//
// La propriété gardée ici est « une seule source de vérité » : l'attribut est écrit par la
// fonction qui RÉSOUT la langue, donc il ne peut pas diverger de `?lang=`, du préféré stocké
// ni de `ui.language`. Un test qui se contenterait de vérifier « lang n'est plus en » passerait
// sur une implémentation qui écrit une constante — d'où les bascules successives.
// ─────────────────────────────────────────────────────────────────────────────
describe("initI18n() — <html lang> suit la langue résolue (S6.3)", () => {
    let initI18n, getActiveLang;

    beforeAll(async () => {
        ({ initI18n, getActiveLang } = await import("../../src/utils/i18n/i18n.ts"));
    });

    it("pose le français par défaut, pas la valeur écrite dans le HTML", () => {
        document.documentElement.lang = "en"; // la valeur de départ du livrable
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
        expect(document.documentElement.lang).toBe("fr");
    });

    it.each([
        ["en", "en"],
        ["de", "de"],
        ["es", "es"],
        ["it", "it"],
        ["pt", "pt"],
    ])("suit ui.language=%s", (configured, expected) => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? configured : def));
        initI18n();
        expect(document.documentElement.lang).toBe(expected);
    });

    // 🛑 Le cas qui justifie de passer par `getActiveLang()` plutôt que par le code résolu.
    // `al` est un raccourci français pour l'allemand que LANGS accepte — mais ce n'est PAS
    // une sous-étiquette de langue. L'écrire dans `lang=` produirait un attribut qu'aucun
    // agent utilisateur ne sait interpréter, donc PIRE que le `en` codé en dur qu'on remplace.
    it("normalise l'alias 'al' vers la forme canonique 'de'", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "al" : def));
        initI18n();
        expect(getActiveLang()).toBe("de");
        expect(document.documentElement.lang).toBe("de");
    });

    // Une langue inconnue retombe sur le dictionnaire français : l'attribut doit suivre le
    // dictionnaire RÉELLEMENT actif, pas le code demandé, sans quoi il annoncerait une langue
    // que la page n'affiche pas.
    it("retombe sur 'fr' quand le code demandé n'existe pas", () => {
        mockConfigGet.mockImplementation((key, def) => (key === "ui.language" ? "xx" : def));
        initI18n();
        expect(document.documentElement.lang).toBe("fr");
    });

    afterAll(() => {
        mockConfigGet.mockImplementation((key, def) => def);
        initI18n();
    });
});
