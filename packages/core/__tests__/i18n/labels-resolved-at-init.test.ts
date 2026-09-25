/**
 * A label is resolved when its control is BUILT — never when its module is imported.
 *
 * Two modules held a module-level object literal whose default carried a translated string:
 * the layer manager's `_options.title` and the branding's `_options.text`. Importing either
 * one resolved the label, so the string was fixed by the configuration of that instant. At
 * import, nothing is configured yet: `ui.language` falls back to `"fr"`, and the profile's
 * `labels` are empty. A profile in English therefore kept « Gestionnaire de couches ».
 *
 * The import had a second effect, which a host cannot undo: that first label was the first
 * i18n resolution of the page, and it published `<html lang>` using defaults. A host embedding
 * the map, which says `ui.syncDocumentLang: false`, had not had the chance to say it yet.
 *
 * The order reproduced here is the host's: import first, then configure, then boot (the
 * boot's `initI18n()`), then build the controls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandingMapLike } from "../../src/capabilities/branding/types.js";
import langEn from "../../src/lang/lang-en.js";
import langEs from "../../src/lang/lang-es.js";

const mockConfigGet = vi.hoisted(() => vi.fn((_key: string, def?: unknown) => def));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: (key: string, def?: unknown) => mockConfigGet(key, def) },
}));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** The value the host page set for itself — the map must never overwrite it. */
const HOST_LANG = "en-US";

type Globals = { GeoLeaf?: Record<string, unknown> };
const _g = globalThis as unknown as Globals;

/** Makes `Config.get` answer `values`, and the caller's default for every other key. */
function configure(values: Record<string, unknown>): void {
    mockConfigGet.mockImplementation((key: string, def?: unknown) =>
        key in values ? values[key] : def
    );
}

/** The boot's own i18n resolution — `shared.module.ts` #1. */
async function boot(): Promise<void> {
    const { initI18n } = await import("../../src/utils/i18n/i18n.js");
    initI18n();
}

async function importLayerManager() {
    return (await import("../../src/kernel/layer-manager/layer-manager-api.js")).LayerManager;
}

async function importBranding() {
    return (await import("../../src/capabilities/branding/branding.js")).Branding;
}

/** Mounts the layer manager and returns the options its control was created with. */
function mountLayerManager(
    lm: Awaited<ReturnType<typeof importLayerManager>>,
    options: Record<string, unknown> = {}
): Record<string, unknown> {
    const create = vi.fn((_opts: Record<string, unknown>) => ({ addTo: vi.fn() }));
    _g.GeoLeaf = { ..._g.GeoLeaf, _LayerManagerControl: { create } };
    lm.init({ map: {}, ...options });
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0]![0];
}

/** Mounts the branding overlay and returns the text it displays. */
function mountBranding(branding: Awaited<ReturnType<typeof importBranding>>): string | null {
    const map = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
    branding.init(map as unknown as BrandingMapLike);
    expect(map.addControl).toHaveBeenCalledTimes(1);
    return (branding._container as HTMLElement | null)?.textContent ?? null;
}

beforeEach(() => {
    vi.resetModules();
    configure({});
    document.documentElement.lang = HOST_LANG;
    _g.GeoLeaf = {};
});

describe("importing a control resolves no label", () => {
    it("the layer manager and the branding leave <html lang> alone at import", async () => {
        await importLayerManager();
        await importBranding();
        expect(document.documentElement.lang).toBe(HOST_LANG);
    });
});

describe("layer manager — the default title follows the language resolved at boot", () => {
    it.each([
        ["en", langEn["ui.layer_manager.title"]],
        ["es", langEs["ui.layer_manager.title"]],
    ])("ui.language=%s configured AFTER the import", async (lang, expected) => {
        const lm = await importLayerManager();
        configure({ "ui.language": lang });
        await boot();
        expect(mountLayerManager(lm).title).toBe(expected);
    });

    it("a profile `labels` override configured after the import is honoured", async () => {
        const lm = await importLayerManager();
        configure({ labels: { "ui.layer_manager.title": "Réseau" } });
        await boot();
        expect(mountLayerManager(lm).title).toBe("Réseau");
    });

    it("a title passed by the caller keeps priority over the default", async () => {
        const lm = await importLayerManager();
        configure({ "ui.language": "en" });
        await boot();
        expect(mountLayerManager(lm, { title: "Mine" }).title).toBe("Mine");
    });

    it("a title from `layerManagerConfig` keeps priority over the default", async () => {
        const lm = await importLayerManager();
        configure({ "ui.language": "en" });
        await boot();
        _g.GeoLeaf = {
            Config: {
                get: (key: string) =>
                    key === "layerManagerConfig" ? { title: "Couches du profil" } : undefined,
            },
        };
        expect(mountLayerManager(lm).title).toBe("Couches du profil");
    });
});

describe("branding — the default text follows the language resolved at boot", () => {
    it.each([
        ["en", langEn["ui.branding.default_text"]],
        ["es", langEs["ui.branding.default_text"]],
    ])("ui.language=%s configured AFTER the import", async (lang, expected) => {
        const branding = await importBranding();
        configure({ "ui.language": lang, "modules.branding": { enabled: true } });
        await boot();
        expect(mountBranding(branding)).toBe(expected);
    });

    it("a text from `modules.branding` keeps priority over the default", async () => {
        const branding = await importBranding();
        configure({
            "ui.language": "en",
            "modules.branding": { enabled: true, text: "Réseau d'éclairage" },
        });
        await boot();
        expect(mountBranding(branding)).toBe("Réseau d'éclairage");
    });
});
