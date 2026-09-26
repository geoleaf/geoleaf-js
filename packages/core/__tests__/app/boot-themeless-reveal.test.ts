/**
 * A profile WITHOUT a default theme boots with its legend, scale bar and coordinates readout.
 *
 * 🛑 Reported by an integrator on 3.10.3, then measured in the page: with no `defaultTheme`,
 * `setupReveal()` revealed the app synchronously inside `UIModule.init()`, so
 * `geoleaf:app:ready` fired BEFORE the capability modules the registry runs after `ui` (every
 * module depending on `geojson` alone) had registered their `{ once: true }` listener. The
 * legend stayed empty, the scale bar and the coordinates readout never mounted, and nothing was
 * logged. A themed profile hid the defect: its reveal waits for `geoleaf:theme:applied`, which
 * `theme-engine` — the last module of the registry — dispatches.
 *
 * The case where `themes` exists without `defaultTheme` (the reported one) is subtler: the
 * theme loader falls back to `themes[0]`, so `theme-engine` does apply a theme and dispatches
 * `geoleaf:theme:applied` — but the reveal had already run, and it is idempotent.
 *
 * This boots through the real `bootWithPreset()`, the real `ModuleRegistry`, the real
 * `UIModule` (hence the real `setupReveal()`), the real `ThemeEngineModule` and the real
 * capability modules of the five capabilities that mount on `geoleaf:app:ready`. The other
 * kernel modules are stand-ins carrying their real ids and dependencies, so the registry
 * computes the production order. Only the leaves are stubbed: the controls' own `init()`, the
 * layer-legend loader, and the theme applier.
 *
 * Seen red on the unfixed code: variants (a) and (b) failed on every assertion below, (c) passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    // A plain function, not a class: a constructor that returns an object yields that object
    // under `new` just the same.
    MaplibreAdapter: vi.fn().mockImplementation(function () {
        return { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
    }),
}));

// `UIModule` builds the panels, the basemaps and the GeoJSON layers through these three: none
// of them bears on the reveal, and each needs a real map.
vi.mock("../../src/app/init-features.js", () => ({
    initBasemaps: vi.fn(),
    initGeoJSON: vi.fn(),
    initUIPanels: vi.fn(),
}));

import { ModuleRegistry } from "../../src/app/module-registry.js";
import { UIModule } from "../../src/app/boot-modules/ui.module.js";
import { ThemeEngineModule } from "../../src/app/boot-modules/theme-engine.module.js";
import { bootWithPreset } from "../../src/app/boot-core.js";
import { ThemeLoader } from "../../src/kernel/themes/theme-loader.js";
import { ThemeApplierCore } from "../../src/kernel/themes/theme-applier/core.js";
import { setAllLayerConfigs } from "../../src/kernel/shared/layer-configs-state.js";
import { COORDINATES_INSTALLER } from "../../src/capabilities/coordinates/install.js";
import { SCALE_INSTALLER } from "../../src/capabilities/scale/install.js";
import { LEGEND_INSTALLER } from "../../src/capabilities/legend/install.js";
import { FILTER_INSTALLER } from "../../src/capabilities/filter/install.js";
import { THEME_SELECTOR_INSTALLER } from "../../src/capabilities/theme-selector/install.js";
import { CoordinatesLifecycle } from "../../src/capabilities/coordinates/lifecycle.js";
import { ScaleLifecycle } from "../../src/capabilities/scale/lifecycle.js";
import { LegendLifecycle } from "../../src/capabilities/legend/lifecycle.js";
import { FilterLifecycle } from "../../src/capabilities/filter/lifecycle.js";
import { ThemeSelectorLifecycle } from "../../src/capabilities/theme-selector/lifecycle.js";
import { CoordinatesDisplay } from "../../src/capabilities/coordinates/coordinates.js";
import { ScaleControl } from "../../src/capabilities/scale/scale-control.js";
import { Legend } from "../../src/capabilities/legend/legend.js";

type Preset = Parameters<typeof bootWithPreset>[0];
type Ctx = Parameters<typeof bootWithPreset>[1];

const PRESET = {
    id: "boot-themeless-reveal",
    capabilities: [
        COORDINATES_INSTALLER,
        SCALE_INSTALLER,
        LEGEND_INSTALLER,
        FILTER_INSTALLER,
        THEME_SELECTOR_INSTALLER,
    ],
} as unknown as Preset;

const LAYERS = [{ id: "roads" }, { id: "parks" }];
const THEMES = [
    { id: "t1", label: "T1", layers: [] },
    { id: "t2", label: "T2", layers: [] },
];

/** What happened, in order: module inits, `app:ready` subscriptions, and the event itself. */
let journal: string[];
let loadLayerLegend: ReturnType<typeof vi.fn>;
const disposers: (() => void)[] = [];
const hadGeoLeaf = "GeoLeaf" in globalThis;
const previousGeoLeaf = (globalThis as { GeoLeaf?: unknown }).GeoLeaf;

/** A kernel stand-in: the real id and dependencies, an `init()` that only records itself. */
function standIn(id: string, dependencies: string[], init: () => void = () => undefined) {
    return {
        id,
        dependencies,
        init: () => {
            journal.push(`init:${id}`);
            init();
        },
        destroy: () => undefined,
    };
}

/** Boots `profile` through the real `bootWithPreset()`; resolves once the boot has returned. */
async function boot(profile: Record<string, unknown>): Promise<void> {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const fakeMap = {
        getNativeMap: () => ({ resize: vi.fn() }),
        fitBounds: vi.fn(),
    };
    const app: Record<string, unknown> = {
        AppLog,
        getProfilesBasePath: () => "../profiles/",
        _appStarted: false,
    };
    loadLayerLegend = vi.fn();
    const GeoLeaf: Record<string, unknown> = {
        _app: app,
        _GeoJSONLayerManager: { _loadLayerLegend: loadLayerLegend },
        loadConfig: (opts: { onLoaded: (c: unknown) => void }) => {
            setTimeout(() => opts.onLoaded({}), 0);
        },
        Config: {
            loadActiveProfileResources: vi.fn(() => Promise.resolve({ ui: {} })),
            getActiveProfile: () => profile,
            getActiveProfileId: () => "p",
        },
    };
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = GeoLeaf;

    // The theme loader falls back to `themes[0]` when `defaultTheme` is absent — its real
    // validation runs; only the network branch (a profile with no `themes`) is replaced.
    vi.spyOn(ThemeLoader, "loadThemesConfig").mockImplementation(async () => {
        if (!profile.themes) throw new Error("themes.json: 404");
        return ThemeLoader._validateConfig(profile.themes);
    });
    vi.spyOn(ThemeApplierCore, "applyTheme").mockImplementation(async (theme) => {
        document.dispatchEvent(
            new CustomEvent("geoleaf:theme:applied", { detail: { themeId: theme.id } })
        );
    });
    const engineInit = ThemeEngineModule.prototype.init;
    vi.spyOn(ThemeEngineModule.prototype, "init").mockImplementation(function (
        this: ThemeEngineModule,
        ...args: Parameters<ThemeEngineModule["init"]>
    ) {
        journal.push("init:theme-engine");
        return engineInit.apply(this, args);
    });

    // Production registration order (`boot-install.ts`): the kernel first, the capability
    // modules later — in `bootWithPreset`'s Pass 2.
    const registry = new ModuleRegistry();
    registry.register(
        standIn("core-map", ["config"], () => {
            app._currentMap = fakeMap;
        })
    );
    registry.register(standIn("config", []));
    registry.register(standIn("shared", ["config"]));
    registry.register(standIn("geojson", ["config", "core-map"], () => setAllLayerConfigs(LAYERS)));
    registry.register(new UIModule());
    registry.register(new ThemeEngineModule());

    const ctx = { GeoLeaf, app, registry } as unknown as Ctx;
    await bootWithPreset(PRESET, ctx, { watchdogMs: 0 });
}

beforeEach(() => {
    journal = [];
    document.body.replaceChildren();
    vi.spyOn(Legend, "init").mockImplementation(() => undefined as never);
    vi.spyOn(ScaleControl, "init").mockImplementation(() => undefined as never);
    vi.spyOn(CoordinatesDisplay, "init").mockImplementation(() => undefined as never);

    const realAdd = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ) => {
        if (type === "geoleaf:app:ready") journal.push("listen:app:ready");
        realAdd(type, listener, options);
    }) as typeof document.addEventListener);
    const onReady = () => journal.push("app:ready");
    realAdd("geoleaf:app:ready", onReady);
    disposers.push(() => document.removeEventListener("geoleaf:app:ready", onReady));
});

afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    // A listener that missed its event is still on `document`: detach it before the next boot
    // dispatches one, then put the controls back to rest.
    CoordinatesLifecycle._reset();
    ScaleLifecycle._reset();
    LegendLifecycle._reset();
    FilterLifecycle._reset();
    ThemeSelectorLifecycle._reset();
    // The reveal's own `{ once: true }` listener survives a boot that never applied a theme,
    // and would reveal THAT boot again on the next one's `geoleaf:theme:applied` — one
    // `app:ready` too many, charged to the wrong variant. Firing it here consumes it.
    document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
    setAllLayerConfigs([]);
    vi.restoreAllMocks();
    if (hadGeoLeaf) (globalThis as { GeoLeaf?: unknown }).GeoLeaf = previousGeoLeaf;
    else delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
    document.body.replaceChildren();
});

/** Every expectation of a boot that reached `geoleaf:app:ready` in a usable state. */
function expectMountedAfterEveryModule(): void {
    const ready = journal.indexOf("app:ready");
    // Exactly one `app:ready`.
    expect(journal.filter((entry) => entry === "app:ready")).toHaveLength(1);
    // Nothing subscribed to it after it had fired: every listener was in place in time.
    expect(journal.slice(ready + 1)).not.toContain("listen:app:ready");
    // It fired once the last module of the registry had started.
    expect(ready).toBeGreaterThan(journal.indexOf("init:theme-engine"));

    expect(Legend.init).toHaveBeenCalledTimes(1);
    expect(loadLayerLegend.mock.calls.map(([id]) => id)).toEqual(["roads", "parks"]);
    expect(ScaleControl.init).toHaveBeenCalledTimes(1);
    expect(CoordinatesDisplay.init).toHaveBeenCalledTimes(1);
}

describe("a profile without a default theme mounts what waits on geoleaf:app:ready", () => {
    it("🛑 (a) no `themes` at all — legend, scale bar and coordinates are mounted", async () => {
        await boot({ id: "p" });
        expectMountedAfterEveryModule();
    });

    it("🛑 (b) `themes` without `defaultTheme` — the loader's `themes[0]` is applied, and the same controls are mounted", async () => {
        await boot({ id: "p", themes: { themes: THEMES } });
        expectMountedAfterEveryModule();
        expect(ThemeApplierCore.applyTheme).toHaveBeenCalledWith(
            expect.objectContaining({ id: "t1" })
        );
    });

    it("control — (c) a declared `defaultTheme` boots exactly as before", async () => {
        await boot({ id: "p", themes: { defaultTheme: "t2", themes: THEMES } });
        expectMountedAfterEveryModule();
        expect(ThemeApplierCore.applyTheme).toHaveBeenCalledWith(
            expect.objectContaining({ id: "t2" })
        );
    });
});
