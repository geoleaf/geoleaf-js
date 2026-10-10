/*!
 * GeoLeaf Core – App / Boot install
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Bundle-eval installation of the boot, parameterised by a preset manifest (S4).
 *
 * `installBoot()` is the former **module-eval body** of `boot.ts`, generalised over a
 * {@link PresetManifest} instead of hard-wiring the shipped one. It owns everything that
 * must happen when the bundle is *evaluated*, before any user code calls `GeoLeaf.boot()`:
 *
 *   - the `?perf=1` latch (must run before the very first boot mark) ;
 *   - the 6 kernel module registrations ;
 *   - the `GeoLeaf._registry` / `GeoLeaf.registry` anchors ;
 *   - `_app.startApp`, bound to {@link bootWithPreset} with THIS entry's manifest ;
 *   - the public `GeoLeaf.boot()` and `GeoLeaf.mount()` facades, both driven by one
 *     application lifecycle (`app/mount.ts`).
 *
 * Why it is a function and no longer top-level code: every bundle entry needs the same
 * module-eval, but each with **its own** manifest. Duplicating it per entry is precisely
 * the `boot-lite.ts` debt this chantier removed. `boot.ts` now does nothing but call this
 * with the shipped manifest; a consumer entry calls it with theirs.
 *
 * ⚠ Call **exactly once** per bundle: it registers modules and writes `GeoLeaf.*`.
 */

import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";
import { ModuleRegistry } from "./module-registry.js";
import { CoreMapModule } from "./boot-modules/core-map.module.js";
import { ConfigModule } from "./boot-modules/config.module.js";
import { SharedModule } from "./boot-modules/shared.module.js";
import { GeoJSONModule } from "./boot-modules/geojson.module.js";
import { UIModule } from "./boot-modules/ui.module.js";
import { ThemeEngineModule } from "./boot-modules/theme-engine.module.js";
import { bootWithPreset } from "./boot-core.js";
import { failBoot } from "./boot-failure.js";
import { captureGlobalErrors } from "../utils/log/log-record.js";
import { createMountController, type GeoLeafMount } from "./mount.js";
import type { PresetManifest } from "../contracts/preset.contract.js";
import type { AppNamespace, BootOptions, BootRun } from "./app-types.js";
import { asFn, member, perfWindow } from "./app-types.js";

/** What {@link installBoot} hands back — the collaborators an entry may want to re-expose. */
export interface BootInstallation {
    GeoLeaf: GeoLeafGlobal;
    app: AppNamespace;
    registry: ModuleRegistry;
}

/**
 * R-perf S1 — enable perf instrumentation via the URL query param `?perf=1`.
 *
 * Runs at bundle-eval time, before any boot/init performance mark — so the very first
 * cold-load marks are captured. Once seen, the flag is latched into sessionStorage so it
 * survives reloads even though the permalink rewrites the URL and drops the query param.
 * Disable with `?perf=0`. No effect by default.
 */
function latchPerfFlag(): void {
    try {
        if (typeof window === "undefined" || perfWindow().__GEOLEAF_PERF__) return;
        const _perfParam = new URLSearchParams(window.location.search).get("perf");
        let _perfOn = _perfParam === "1" || _perfParam === "true";
        if (_perfParam === "0" || _perfParam === "false") {
            _perfOn = false;
            try {
                window.sessionStorage?.removeItem("__GEOLEAF_PERF__");
            } catch (_s) {
                void _s;
            }
        } else if (!_perfParam) {
            // No explicit param — fall back to the latched session flag.
            try {
                _perfOn = window.sessionStorage?.getItem("__GEOLEAF_PERF__") === "1";
            } catch (_s) {
                void _s;
            }
        }
        if (_perfOn) {
            perfWindow().__GEOLEAF_PERF__ = true;
            try {
                window.sessionStorage?.setItem("__GEOLEAF_PERF__", "1");
            } catch (_s) {
                void _s;
            }
        }
    } catch (_e) {
        void _e;
    }
}

/**
 * Installs the boot for one bundle entry: kernel modules, registry anchors and the
 * `GeoLeaf.boot()` facade, all bound to `preset`.
 *
 * @param preset - the capability manifest THIS entry embarks. It reaches two places:
 *   `SharedModule` (which drives the app-global lifecycles, #7 pwa → #8 offline) and
 *   `bootWithPreset` (which registers the declarations and the gated modules).
 * @returns the `GeoLeaf` namespace, the `_app` namespace and the module registry.
 */
export function installBoot(preset: PresetManifest): BootInstallation {
    const GeoLeaf = ensureGeoLeaf();
    const _app = (GeoLeaf._app = GeoLeaf._app || {}) as AppNamespace;

    latchPerfFlag();

    // ── ModuleRegistry setup ─────────────────────────────────────────────────
    // Modules are registered here, at module-init time, before startApp() is called.
    // Registration order does NOT determine initialization order — the registry
    // resolves the dependency graph at init() time.
    // 6 kernel modules, not 8. `SecurityModule` and `APIModule` were wrappers whose
    // init()/destroy() had become empty — their subsystems are pure FACADES, posted at import
    // by phase A (`globals.core.ts` / `globals.api.ts`), with nothing that needs the map, the
    // merged config, or an ordering. They carried a graph node and nothing else.
    const _registry = new ModuleRegistry();
    _registry.register(new CoreMapModule());
    _registry.register(new ConfigModule());
    // SharedModule receives the preset's installers: it drives their app-global lifecycles
    // (#7 pwa → #8 offline) WITHOUT importing a single capability. See shared.module.ts —
    // that inversion is what lets an entry drop pwa/offline entirely.
    _registry.register(new SharedModule(preset.capabilities));
    _registry.register(new GeoJSONModule());
    _registry.register(new UIModule());
    // Kernel, unconditional (S8/F2): applies the profile's default theme, decoupled from
    // the theme-selector UI. Registered after UIModule so its `["geojson","ui"]` deps put
    // its init() (which dispatches `geoleaf:theme:applied`) after setupReveal (#23).
    _registry.register(new ThemeEngineModule());

    // Expose on GeoLeaf namespace:
    //   GeoLeaf._registry — internal access (boot internals)
    //   GeoLeaf.registry  — public API for third-party module self-registration:
    //                       GeoLeaf.registry.register(new MyCustomModule())
    GeoLeaf._registry = _registry;
    GeoLeaf.registry = _registry;
    // ─────────────────────────────────────────────────────────────────────────

    /** Refuses a boot while an application is mounted; cleared when it is unmounted. */
    _app._appStarted = false;

    // startApp — the boot sequence, bound to THIS entry's preset. The sequence itself lives
    // in `boot-core.ts#bootWithPreset()`; binding it here keeps `GeoLeaf._app.startApp` as
    // the single entry the tests and the two facades call.
    _app.startApp = function (options?: BootOptions, run?: BootRun) {
        return bootWithPreset(preset, { GeoLeaf, app: _app, registry: _registry }, options, run);
    };

    // One application lifecycle for both facades: `mount()` takes over an application `boot()`
    // started, and `boot()` waits for an unmount in progress.
    const _lifecycle = createMountController({
        GeoLeaf,
        app: _app,
        registry: _registry,
        // A throw outside every step's own handling is still a boot that did not complete — and
        // still owed a signal and a screen.
        onBootError: (e: unknown) => {
            console.error("[GeoLeaf] Boot sequence failed:", e);
            failBoot({
                reason: "internal",
                message: e instanceof Error ? e.message : String(e),
            });
        },
    });

    /**
     * Starts the GeoLeaf application.
     * Loads the configuration, initializes the map and all modules.
     * Eagerly loaded optional plugins (e.g. Storage) must be loaded before this call.
     * Lazy ones (editor, table, print…) declare their toolbar slot instead and load on
     * first use — they must NOT be waited on here.
     *
     * From this call on, uncaught errors and unhandled promise rejections are recorded in the
     * log's record (`GeoLeaf.Log.getEntries()`), which the boot failure diagnostic carries.
     *
     * One application per page: a call while an application is mounted is refused, with a
     * warning. Since 3.13.0 the application can be unmounted — `GeoLeaf.mount()` returns the
     * handle that does it, and takes over an application `boot()` started —, and a `boot()` after
     * the unmount starts it again; one called while an unmount is in progress waits for it.
     *
     * @param options - Optional boot options.
     * @param options.beforeBoot - Async hook called after config load, before map creation.
     *   Return void to proceed, throw to abort boot: `geoleaf:boot:aborted` is emitted and the
     *   `#gl-loader` veil is hidden, so that whatever the host draws next is not covered.
     *   Use case: SSO / external auth gate (any identity provider) without the connector plugin.
     *   It is also where a host overrides a value that the profile declares, with
     *   `GeoLeaf.Config.set`. The profile has loaded by then, and no module has read the
     *   configuration yet. A `set` made before `boot()` is replaced by any section the profile
     *   declares.
     * @param options.onPerformanceMetrics - Callback to receive runtime metrics after geoleaf:app:ready.
     * @param options.config - A configuration object handed over in memory. When present, the
     *   boot applies it directly and issues no request for it. Wins over `configUrl`.
     * @param options.configUrl - An explicit URL to fetch the configuration from. Used when
     *   `config` is absent. Without either, the path is derived from the host page — unchanged.
     * @param options.watchdogMs - Milliseconds without a reveal before the boot is reported as
     *   stalled (`geoleaf:boot:failed`, `reason: "timeout"`, provisional). Default 45 000; `0`
     *   disables it. Paused while `beforeBoot` runs.
     * @param options.maplibregl - The MapLibre GL JS engine (`import * as maplibregl from
     *   "maplibre-gl"`), installed on `globalThis.maplibregl` at the start of the boot. Without
     *   it the global is read as before; with neither, the boot fails with `reason: "engine"`.
     * @example
     * GeoLeaf.boot();
     * // Configuration handed over in memory — no request is issued for it. An embedding
     * // application whose router answers unknown paths with its own HTML document needs
     * // this: the derived path would return HTML in HTTP 200 where JSON is expected.
     * GeoLeaf.boot({ config: { map: { center: [4.85, 45.75], zoom: 12 } } });
     * // Explicit URL, when the configuration is served from somewhere the page cannot imply
     * GeoLeaf.boot({ configUrl: '/assets/geoleaf/config.json' });
     * // Auth gate (SSO without connector)
     * GeoLeaf.boot({
     *   beforeBoot: async ({ config }) => {
     *     const ok = await checkSession();
     *     if (!ok) throw new Error('Not authenticated');
     *   }
     * });
     * // Host override of a profile value — here the interface language
     * GeoLeaf.boot({
     *   beforeBoot: () => {
     *     GeoLeaf.Config?.set('ui.language', 'en');
     *   }
     * });
     * // Performance metrics
     * GeoLeaf.boot({ onPerformanceMetrics: (m) => console.log(m.timeToMapReadyMs) });
     */
    GeoLeaf.boot = function (options?: BootOptions) {
        // From the boot call on — never at import: loading the bundle attaches nothing to the page.
        captureGlobalErrors();
        if (options?.beforeBoot) {
            GeoLeaf._beforeBootCallback = options.beforeBoot;
        }
        if (options?.onPerformanceMetrics) {
            GeoLeaf._perfCallback = options.onPerformanceMetrics;
        }
        // Loaded-plugin report — silent when core only. There is a single report:
        // every plugin is reported the same way, none is singled out.
        asFn(member(GeoLeaf.plugins, "reportPlugins"))?.call(GeoLeaf.plugins);

        // `startApp` is async, but `GeoLeaf.boot()` is a SYNCHRONOUS public API:
        // returning its promise would change the published signature. So the rejection is
        // HANDLED rather than propagated (`onBootError` above) — a failed boot is the loudest
        // error this runtime can produce and must never degrade into an unhandled rejection.
        //
        // ⚠️ The call site is unchanged: `startApp()` still fires at the same instant, nothing
        // is awaited, and the B1→B11 ordering is untouched — unless an unmount is in progress,
        // which the lifecycle lets finish first.
        const _startApp = () => {
            _lifecycle.boot(options);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", _startApp);
        } else {
            _startApp();
        }
    };

    /**
     * Mounts the GeoLeaf application in `el`, and returns the handle that unmounts it — the
     * lifecycle a host that mounts and unmounts views can run again and again.
     *
     * Boots as `GeoLeaf.boot()` does — configuration, profile, map, every module —, in the
     * background: the handle is returned at once, so a host can subscribe before the first
     * event and unmount while the application is still starting. `unmount()` takes the WHOLE
     * application down — modules, controls, panels, map, and the state they held —, and the next
     * `mount()` gives it back whole. ⚠️ `Core.destroy()` is not an unmount: it removes the map
     * alone.
     *
     * One application per page. A `mount()` while an application is alive — mounted by
     * `mount()` or by `boot()` — unmounts it first, and its handle goes inert. `boot()` while an
     * application is mounted is refused, as it always was; after `unmount()`, it boots again.
     *
     * ⚠️ A plugin that subscribes to a boot event once, when its script loads, does not wire itself
     * again after a remount.
     *
     * @param el - The map container: an element, or its id. The page's shell (`.gl-main`,
     *   `#gl-loader`) is found as `boot()` finds it. Checked at once: neither an element nor a
     *   non-empty id, the call throws a `GeoLeafError` — a programming error, not a boot failure.
     * @param options - The options of `GeoLeaf.boot()`: `config` / `configUrl`, `beforeBoot`,
     *   `onPerformanceMetrics`, `watchdogMs`, and `maplibregl` — the engine, which MapLibre 6 no
     *   longer puts on `globalThis`.
     * @returns The handle: `ready`, `unmount()`, `on()`, `getMap()`.
     * @example
     * import * as maplibregl from "maplibre-gl";
     *
     * const mount = GeoLeaf?.mount;
     * if (mount) {
     *     const app = mount("map", { configUrl: "/geoleaf/geoleaf.config.json", maplibregl });
     *     app.on("geoleaf:layer:toggle", (e) => console.log(e.detail.layerId, e.detail.visible));
     *     app.ready.then(
     *         () => console.log("ready", app.getMap()),
     *         (err) => console.warn(err.reason, err.message)
     *     );
     *     // When the view goes away — the next mount() gives the whole application back:
     *     void app.unmount();
     * }
     */
    GeoLeaf.mount = function (el: HTMLElement | string, options?: BootOptions): GeoLeafMount {
        captureGlobalErrors();
        asFn(member(GeoLeaf.plugins, "reportPlugins"))?.call(GeoLeaf.plugins);
        return _lifecycle.mount(el, options);
    };

    return { GeoLeaf, app: _app, registry: _registry };
}
