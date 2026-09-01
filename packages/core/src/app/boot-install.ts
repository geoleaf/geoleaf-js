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
 *   - the public `GeoLeaf.boot()` facade.
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
import type { PresetManifest } from "../contracts/preset.contract.js";
import type { AppNamespace, BootOptions } from "./app-types.js";
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
    // S6 Lot 6: 6 kernel modules, not 8. `SecurityModule` and `APIModule` were wrappers whose
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

    // Expose on GeoLeaf namespace (task 3.3.4):
    //   GeoLeaf._registry — internal access (boot internals)
    //   GeoLeaf.registry  — public API for third-party module self-registration:
    //                       GeoLeaf.registry.register(new MyCustomModule())
    GeoLeaf._registry = _registry;
    GeoLeaf.registry = _registry;
    // ─────────────────────────────────────────────────────────────────────────

    /** Prevents startApp from running more than once (double-boot guard). */
    _app._appStarted = false;

    // startApp — the boot sequence, bound to THIS entry's preset. The sequence itself lives
    // in `boot-core.ts#bootWithPreset()`; binding it here keeps `GeoLeaf._app.startApp` as
    // the single entry the tests and the `GeoLeaf.boot()` facade call.
    _app.startApp = function (options?: BootOptions) {
        return bootWithPreset(preset, { GeoLeaf, app: _app, registry: _registry }, options);
    };

    /**
     * Starts the GeoLeaf application.
     * Loads the configuration, initializes the map and all modules.
     * Eagerly loaded optional plugins (e.g. Storage) must be loaded before this call.
     * Lazy ones (editor, table, print…) declare their toolbar slot instead and load on
     * first use — they must NOT be waited on here.
     *
     * @param options - Optional boot options.
     * @param options.beforeBoot - Async hook called after config load, before map creation.
     *   Return void to proceed, throw to abort boot (emits `geoleaf:boot:aborted`).
     *   Use case: SSO / external auth gate (any identity provider) without the connector plugin.
     * @param options.onPerformanceMetrics - Callback to receive runtime metrics after geoleaf:app:ready.
     * @param options.config - A configuration object handed over in memory. When present, the
     *   boot applies it directly and issues no request for it. Wins over `configUrl`.
     * @param options.configUrl - An explicit URL to fetch the configuration from. Used when
     *   `config` is absent. Without either, the path is derived from the host page — unchanged.
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
     * // Performance metrics
     * GeoLeaf.boot({ onPerformanceMetrics: (m) => console.log(m.timeToMapReadyMs) });
     */
    GeoLeaf.boot = function (options?: BootOptions) {
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
        // returning its promise would change the published signature, which is out of
        // scope here. So the rejection is HANDLED rather than propagated — a failed
        // boot is the loudest error this runtime can produce and must never degrade
        // into an unhandled rejection.
        //
        // ⚠️ The call site is unchanged: `startApp()` still fires at the same instant,
        // nothing is awaited, and the B1→B11 ordering is untouched. Only a rejection
        // handler is attached.
        const _startApp = () => {
            _app.startApp(options).catch((e: unknown) => {
                console.error("[GeoLeaf] Boot sequence failed:", e);
            });
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", _startApp);
        } else {
            _startApp();
        }
    };

    return { GeoLeaf, app: _app, registry: _registry };
}
