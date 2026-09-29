/**
 * Witness — `GeoLeaf.mount()` gives the WHOLE application back, mount after mount.
 *
 * ## What this file pins
 *
 * Before `mount()`, the only teardown was `Core.destroy()`: it removed the map and nothing else,
 * a second `boot()` was refused, and `Core.init()` gave back a bare map — no control, no panel.
 * The controller (`app/mount.ts`) tears the application down in one order — end the boot, wait
 * for it, destroy the registry while the map lives, destroy the map, forget what the boot owned —
 * and boots it again.
 *
 * This boots through the real `bootWithPreset()`, the real `ModuleRegistry`, the real
 * `UIModule` and `ThemeEngineModule`, and the real modules of five capabilities that mount on
 * `geoleaf:app:ready` (the harness of `boot-themeless-reveal.test.ts`). The other kernel modules
 * are stand-ins with their real ids and dependencies; `core-map` registers a real `Core` map.
 *
 * Seen RED by mutation, each named in the commit: without `registry.destroy()` in the teardown,
 * the scale bar, the legend and the coordinates mounted once and never again (4 cases); without
 * the reset of `_appStarted`, every later boot was refused (5 cases); without the checkpoint
 * after the configuration, a mount unmounted during it still loaded its profile (1 case — the
 * next checkpoint kept the map from being built, which is why the case asserts the profile).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: vi.fn().mockImplementation(function () {
        return {
            init: vi.fn(),
            destroy: vi.fn(),
            getNativeMap: vi.fn(() => ({ resize: vi.fn() })),
            fitBounds: vi.fn(),
        };
    }),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/app/init-features.js", () => ({
    initBasemaps: vi.fn(),
    initGeoJSON: vi.fn(),
    initUIPanels: vi.fn(),
}));

import { ModuleRegistry } from "../../src/app/module-registry.js";
import { UIModule } from "../../src/app/boot-modules/ui.module.js";
import { ThemeEngineModule } from "../../src/app/boot-modules/theme-engine.module.js";
import { bootWithPreset } from "../../src/app/boot-core.js";
import { createMountController, type GeoLeafMount } from "../../src/app/mount.js";
import { Core } from "../../src/kernel/map/facade.js";
import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";
import { ThemeLoader } from "../../src/kernel/themes/theme-loader.js";
import { ThemeApplierCore } from "../../src/kernel/themes/theme-applier/core.js";
import { Config } from "../../src/kernel/config/geoleaf-config/config-loaders.js";
import { setAllLayerConfigs } from "../../src/kernel/shared/layer-configs-state.js";
import { COORDINATES_INSTALLER } from "../../src/capabilities/coordinates/install.js";
import { SCALE_INSTALLER } from "../../src/capabilities/scale/install.js";
import { LEGEND_INSTALLER } from "../../src/capabilities/legend/install.js";
import { FILTER_INSTALLER } from "../../src/capabilities/filter/install.js";
import { THEME_SELECTOR_INSTALLER } from "../../src/capabilities/theme-selector/install.js";
import { CoordinatesDisplay } from "../../src/capabilities/coordinates/coordinates.js";
import { ScaleControl } from "../../src/capabilities/scale/scale-control.js";
import { Legend } from "../../src/capabilities/legend/legend.js";
import type { AppNamespace } from "../../src/app/app-types.js";

type Preset = Parameters<typeof bootWithPreset>[0];
type Ctx = Parameters<typeof bootWithPreset>[1];

const PRESET = {
    id: "mount-remount",
    capabilities: [
        COORDINATES_INSTALLER,
        SCALE_INSTALLER,
        LEGEND_INSTALLER,
        FILTER_INSTALLER,
        THEME_SELECTOR_INSTALLER,
    ],
} as unknown as Preset;

const THEMES = { defaultTheme: "t1", themes: [{ id: "t1", label: "T1", layers: [] }] };
const MAP_ID = "geoleaf-map";

const hadGeoLeaf = "GeoLeaf" in globalThis;
const previousGeoLeaf = (globalThis as { GeoLeaf?: unknown }).GeoLeaf;

let journal: string[];
let loadConfig: ReturnType<typeof vi.fn>;
let registryInit: ReturnType<typeof vi.spyOn>;
let app: AppNamespace;
let registry: ModuleRegistry;
let lifecycle: ReturnType<typeof createMountController>;
const disposers: (() => void)[] = [];

/** A kernel stand-in: the real id and dependencies, an `init()` that only records itself. */
function standIn(id: string, dependencies: string[], init: () => void = () => undefined) {
    return {
        id,
        dependencies,
        init: () => {
            journal.push(`init:${id}`);
            init();
        },
        destroy: () => journal.push(`destroy:${id}`),
    };
}

/** Counts `geoleaf:app:ready` and `geoleaf:boot:aborted` on the page. */
function countSignals(): { ready: number; aborted: unknown[] } {
    const signals = { ready: 0, aborted: [] as unknown[] };
    const onReady = () => signals.ready++;
    const onAborted = (e: Event) => signals.aborted.push((e as CustomEvent).detail?.reason);
    document.addEventListener("geoleaf:app:ready", onReady);
    document.addEventListener("geoleaf:boot:aborted", onAborted);
    disposers.push(() => document.removeEventListener("geoleaf:app:ready", onReady));
    disposers.push(() => document.removeEventListener("geoleaf:boot:aborted", onAborted));
    return signals;
}

beforeEach(() => {
    journal = [];
    document.body.replaceChildren();
    vi.spyOn(Legend, "init").mockImplementation(() => undefined as never);
    vi.spyOn(ScaleControl, "init").mockImplementation(() => undefined as never);
    vi.spyOn(CoordinatesDisplay, "init").mockImplementation(() => undefined as never);
    vi.spyOn(ThemeLoader, "loadThemesConfig").mockImplementation(async () =>
        ThemeLoader._validateConfig(THEMES)
    );
    vi.spyOn(ThemeApplierCore, "applyTheme").mockImplementation(async (theme) => {
        document.dispatchEvent(
            new CustomEvent("geoleaf:theme:applied", { detail: { themeId: theme.id } })
        );
    });

    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    app = {
        AppLog,
        getProfilesBasePath: () => "../profiles/",
        _appStarted: false,
    } as unknown as AppNamespace;
    // The real configuration singleton, fed as `GeoLeaf.loadConfig` feeds it.
    loadConfig = vi.fn(
        (opts: { config?: Record<string, unknown>; onLoaded: (c: unknown) => void }) => {
            void Config.init({ config: opts.config ?? {} }).then((cfg) => {
                setTimeout(() => opts.onLoaded(cfg), 0);
            });
        }
    );
    const GeoLeaf: Record<string, unknown> = {
        _app: app,
        _GeoJSONLayerManager: { _loadLayerLegend: vi.fn() },
        loadConfig,
        Config: {
            loadActiveProfileResources: vi.fn(() => Promise.resolve({ ui: {} })),
            getActiveProfile: () => ({ id: "p", themes: THEMES }),
            getActiveProfileId: () => "p",
        },
    };
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = GeoLeaf;

    registry = new ModuleRegistry();
    registry.register(
        standIn("core-map", ["config"], () => {
            app._currentMap = Core.init({
                mapId: MAP_ID,
                _adapter: new MaplibreAdapter(),
            } as never);
        })
    );
    registry.register(standIn("config", []));
    registry.register(standIn("shared", ["config"]));
    registry.register(standIn("geojson", ["config", "core-map"], () => setAllLayerConfigs([])));
    registry.register(new UIModule());
    registry.register(new ThemeEngineModule());
    registryInit = vi.spyOn(registry, "init");

    const ctx = { GeoLeaf, app, registry } as unknown as Ctx;
    app.startApp = (options, run) => bootWithPreset(PRESET, ctx, options, run);
    lifecycle = createMountController({
        GeoLeaf: GeoLeaf as never,
        app,
        registry,
        onBootError: (e) => journal.push(`boot-error:${String(e)}`),
    });
});

afterEach(async () => {
    // The capabilities' lifecycles are module state, shared by every registry: an application a
    // case leaves alive would keep them started for the next one. A mount unmounted at once
    // tears down whatever is alive, and boots nothing itself.
    await lifecycle.mount(MAP_ID, { watchdogMs: 0 }).unmount();
    for (const id of Core.listMaps()) Core.destroy(id);
    while (disposers.length > 0) disposers.pop()?.();
    setAllLayerConfigs([]);
    vi.restoreAllMocks();
    if (hadGeoLeaf) (globalThis as { GeoLeaf?: unknown }).GeoLeaf = previousGeoLeaf;
    else delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
    document.body.replaceChildren();
});

describe("GeoLeaf.mount() — the application, mounted again and again", () => {
    it("🛑 three cycles: every control mounts once per mount, and the unmount leaves nothing", async () => {
        const signals = countSignals();
        for (let cycle = 1; cycle <= 3; cycle++) {
            const handle = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
            await handle.ready;

            expect(signals.ready).toBe(cycle);
            expect(ScaleControl.init).toHaveBeenCalledTimes(cycle);
            expect(Legend.init).toHaveBeenCalledTimes(cycle);
            expect(CoordinatesDisplay.init).toHaveBeenCalledTimes(cycle);
            expect(handle.getMap()).not.toBeNull();
            expect(Core.listMaps()).toEqual([MAP_ID]);

            await handle.unmount();

            expect(Core.listMaps()).toEqual([]);
            expect(registry.isInitialized()).toBe(false);
            expect(app._appStarted).toBe(false);
            expect(handle.getMap()).toBeNull();
            expect(Config.isLoaded()).toBe(false);
        }
        expect(signals.aborted).toEqual([]);
    });

    it("🛑 boot() after an unmount is not ignored", async () => {
        lifecycle.boot({ watchdogMs: 0 });
        await vi.waitFor(() => expect(Core.listMaps()).toEqual([MAP_ID]));

        // A mount takes the booted application over — the one way to unmount it.
        const handle = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        await handle.ready;
        await handle.unmount();

        lifecycle.boot({ watchdogMs: 0 });
        await vi.waitFor(() => expect(Core.listMaps()).toEqual([MAP_ID]));
        expect(registryInit).toHaveBeenCalledTimes(3);
    });

    it("🛑 unmounted during its configuration: no map is ever built, and ready says why", async () => {
        const signals = countSignals();
        let release: () => void = () => undefined;
        loadConfig.mockImplementation((opts: { onLoaded: (c: unknown) => void }) => {
            release = () => opts.onLoaded({});
        });

        const handle = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        await vi.waitFor(() => expect(loadConfig).toHaveBeenCalledTimes(1));
        const unmounted = handle.unmount();
        await expect(handle.ready).rejects.toMatchObject({
            name: "GeoLeafMountError",
            reason: "unmounted",
        });
        expect(signals.aborted).toEqual(["unmounted"]);

        release();
        await unmounted;

        // It stopped at the first step after the one it was in: not even the profile loaded.
        const gl = (
            globalThis as unknown as {
                GeoLeaf: { Config: { loadActiveProfileResources: unknown } };
            }
        ).GeoLeaf;
        expect(gl.Config.loadActiveProfileResources).not.toHaveBeenCalled();
        expect(registryInit).not.toHaveBeenCalled();
        expect(Core.listMaps()).toEqual([]);
        expect(app._appStarted).toBe(false);
    });

    it("🛑 StrictMode — mount, unmount, mount in one tick: one boot, one app:ready", async () => {
        const signals = countSignals();

        const first = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        void first.unmount();
        const second = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        await second.ready;

        await expect(first.ready).rejects.toMatchObject({ reason: "unmounted" });
        expect(loadConfig).toHaveBeenCalledTimes(1);
        expect(signals.ready).toBe(1);
        expect(ScaleControl.init).toHaveBeenCalledTimes(1);
        // The first never started: nothing was aborted, nothing to tell the page.
        expect(signals.aborted).toEqual([]);
    });

    it("🛑 a second mount without unmount takes over: the first handle goes inert", async () => {
        const first = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        await first.ready;

        const second = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        expect(first.getMap()).toBeNull();
        await second.ready;
        await first.unmount();

        expect(second.getMap()).not.toBeNull();
        expect(Core.listMaps()).toEqual([MAP_ID]);
        expect(ScaleControl.init).toHaveBeenCalledTimes(2);
        await second.unmount();
    });

    it("on() hears this application from its first event, and nothing once it is unmounted", async () => {
        const heard: string[] = [];
        const handle: GeoLeafMount = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        handle.on("geoleaf:app:ready", () => heard.push("ready"));
        await handle.ready;
        expect(heard).toEqual(["ready"]);

        await handle.unmount();
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        expect(heard).toEqual(["ready"]);
    });

    it("a queued mount does not hear the abort of the application it replaces", async () => {
        let release: () => void = () => undefined;
        loadConfig.mockImplementationOnce((opts: { onLoaded: (c: unknown) => void }) => {
            release = () => opts.onLoaded({});
        });
        const first = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        await vi.waitFor(() => expect(loadConfig).toHaveBeenCalledTimes(1));

        const second = lifecycle.mount(MAP_ID, { watchdogMs: 0 });
        const heard: unknown[] = [];
        second.on("geoleaf:boot:aborted", (e) => heard.push(e.detail.reason));
        release();
        await second.ready;

        await expect(first.ready).rejects.toMatchObject({ reason: "unmounted" });
        expect(heard).toEqual([]);
        await second.unmount();
    });

    it("an element container is the one the map is built in", async () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        const handle = lifecycle.mount(el, { watchdogMs: 0 });
        await handle.ready;

        expect(app._mountTarget).toEqual({ mapId: MAP_ID, element: el });
        await handle.unmount();
        expect(app._mountTarget).toBeNull();
    });

    it("a target that is neither an element nor an id is refused at once", () => {
        expect(() => lifecycle.mount(42 as never)).toThrow(/map container/);
    });
});
