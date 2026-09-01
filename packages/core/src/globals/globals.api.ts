/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B11 — public facades, API controller, and PluginRegistry.
 *
 * This runtime initialization module is imported **last** by `globals.ts`.
 * It assembles the complete `GeoLeaf` public API by:
 *   - Assigning all domain facades (`Core`, `Route`, `UI`, …)
 *   - Wiring the APIController sub-managers (`FactoryManager`, `ModuleManager`, …)
 *   - Registering `PluginRegistry` and `BootInfo`
 *   - Defining top-level shorthand methods (`init`, `loadConfig`, `setTheme`,
 *     `createMap`, `getMap`, `getAllMaps`, `getModule`, `getHealth`)
 *
 * ✅ **This module is the SINGLE writer of the eleven top-level methods** (socle-init 7.7).
 *
 * ⚠️ The note here read: « **UMD note:** public methods are assigned directly here (not via
 * `geoleaf-api.js`) to prevent Rollup DCE from eliminating them when
 * `propertyReadSideEffects:false`. » That premise was measured FALSE — the other
 * module was not eliminated, it ran LAST and won — and believing it is what let a duplicate look
 * inert for months. The duplicate was removed instead of arbitrating between the two.
 *
 * @see globals for the orchestrator and import order
 * @see kernel/api/geoleaf-api — now a re-export of the live namespace, nothing more
 * @see contracts/top-level-api.contract — what each of the eleven owes its caller
 */

// B11 : facades geoleaf.*.js + api/
// Note: api/ must be imported before geoleaf.api.js (controller sets up _APIController getter)
import { Log } from "../utils/log/index.js";
import { VERSION_FALLBACK } from "../utils/constants/constants.js";
import { APIController } from "../kernel/api/controller.js";
import { APIFactoryManager } from "../kernel/api/factory-manager.js";
import { APIInitializationManager } from "../kernel/api/initialization-manager.js";
import { APIModuleManager } from "../kernel/api/module-manager.js";
import { Baselayers } from "../api/geoleaf.baselayers.js";
import { Core } from "../api/geoleaf.core.js";
import { Helpers } from "../api/geoleaf.helpers.js";
import { LayerManager } from "../api/geoleaf.layer-manager.js";
// PWA + Sync (S2 Lot 7) / Permalink (Lot 6) / Filter (Lot 5) / Legend (Lot 4) /
// Taxonomy, FeatureInfo, Cluster (Lot 3): mounted by their capability installers
// (capabilities/<cap>/install.ts) — not from here.
import { Layers } from "../api/geoleaf.layers.js";
// Storage facade lives in the Storage plugin (Phase 7 — package separation)
import { UI } from "../api/geoleaf.ui.js";
import { Validators } from "../api/geoleaf.validators.js";
import { BootInfo } from "../kernel/api/boot-info.js";
import { PluginRegistry } from "../kernel/api/plugin-registry.js";
import { Events } from "../api/geoleaf.events.js";
import { Introspection } from "../api/geoleaf.introspection.js";
import { Capabilities } from "../api/geoleaf.capabilities.js";
// geoleaf.api.js is imported last in bundle-entry.js (requires _APIController to be set up first)
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";

/** Map factory surface read by the top-level `getMap` / `getAllMaps` shortcuts. */
interface MapFactoryLike {
    getMapInstance(targetId: string): unknown;
    getAllMapInstances(): unknown[];
}

/**
 * Narrow structural view of the runtime `_APIController` singleton, limited to the
 * members read by the shortcut methods below. The controller is registered on the
 * namespace (`unknown` long tail) at boot; this interface lets the facades call it
 * without `any`.
 */
interface APIControllerLike {
    geoleafInit(options: Record<string, unknown>): unknown;
    geoleafSetTheme(theme: string): boolean;
    geoleafLoadConfig(input: string | Record<string, unknown>): Promise<unknown>;
    geoleafCreateMap?(targetId: string, options?: Record<string, unknown>): unknown;
    managers?: { factory?: MapFactoryLike };
    moduleAccessFn?: ((name: string) => unknown) | null;
    getHealthStatus?(): unknown;
    /**
     * Required, not optional — and the difference is load-bearing (socle-init 7.7).
     *
     * `requireController()` refuses a controller whose `isInitialized` is falsy. Declaring the
     * field optional here would make `undefined` a legal shape, and every consumer would then be
     * refused on a technicality rather than on a real failed state. `GeoLeafApiController`
     * (`kernel/api/api-types.ts`) declares it required; this local shape mirrors that.
     */
    isInitialized: boolean;
}

type GeoLeafRuntime = ReturnType<typeof ensureGeoLeaf>;

/** B11 — assign every public facade reference + API sub-manager onto the namespace. */
function assignApiFacades(_gl: GeoLeafRuntime): void {
    // -- B11 assignments: facades + api -----------------------------------------
    if (!_gl.API) _gl.API = {};
    const api = _gl.API as Record<string, unknown>;
    api.Controller = APIController;
    api.FactoryManager = APIFactoryManager;
    api.InitializationManager = APIInitializationManager;
    api.ModuleManager = APIModuleManager;
    // Aliases expected by api/controller.js._getManagerClass() (Phase 7 key mismatch fix)
    api.APIModuleManager = APIModuleManager;
    api.APIInitializationManager = APIInitializationManager;
    api.APIFactoryManager = APIFactoryManager;
    // Top-level facade modules
    _gl.Baselayers = Baselayers;
    _gl.BaseLayers = Baselayers; // alias stabilized Phase 7
    _gl.Core = Core;
    _gl.Helpers = Helpers;
    _gl.LayerManager = LayerManager;
    _gl.Layers = Layers;
    // Storage: namespace ensured by globals.storage.js; facade methods injected by the Storage plugin at runtime
    _gl.Storage = _gl.Storage || {};
    // UI: geoleaf.ui.js built _g.GeoLeaf.UI directly via mutations — re-sync reference
    _gl.UI = UI || _gl.UI;
    // Validators: override B8 SchemaValidators with full public Validators facade
    _gl.Validators = Validators;
    _gl.plugins = PluginRegistry;
    _gl.bootInfo = BootInfo;
    _gl.events = Events;
    // Canonical casing. The root `index.d.ts` (since removed) declared
    // `GeoLeaf.Events` and docs/EVENTS_API.md
    // documents it in 18 examples, but nothing ever mounted it: `GeoLeaf.Events.on(...)`
    // type-checked and threw at runtime. Same ghost-API class as `_UIComponents.clearElement`
    // (S8) and the `ValidatorsAPI: void` declarations (S10) — the .d.ts asserted a surface the
    // bundle did not have. `events` (lowercase) is the shipped runtime name and stays as a
    // permanent alias, not deprecated: the repo already answers "two casings for one facade"
    // two lines up, with Baselayers/BaseLayers, and both are frozen by the two surface oracles
    // (boot-golden-master + bundle-boot-contract).
    _gl.Events = Events;
    _gl.Introspection = Introspection;
    // `GeoLeaf.Capabilities` — the channel through which a capability's absence
    // becomes a FACT observable by the host, instead of a log line it cannot
    // read.
    _gl.Capabilities = Capabilities;
    // Registers core as loaded
    const coreVersion = _gl._version;
    PluginRegistry.register("core", { ...(coreVersion !== undefined && { version: coreVersion }) });
}

/**
 * Lazy, VALIDATED access to the APIController — the guarantee 7.7 moved here.
 *
 * 🛑 **This is not defensive polish: without it, a failed boot HANGS in silence.**
 * `controller.ts` says so where it releases the parking lot — a controller that reports
 * `isInitialized: false` makes `geoleafLoadConfig()` resolve to `null`, so neither `onLoaded`
 * nor `onError` is ever called, so the promise `boot-core.ts` awaits never settles. What it
 * names as the thing that turns that silence into a loud failure is « the validated accessor »,
 * which lived in `kernel/api/geoleaf-api.ts` until socle-init 7.7 removed that module's
 * duplicate assignment. Removing it without porting this first would have converted a noisy
 * failure into a hung boot with no trace.
 *
 * ⚠️ The two thrown messages are asserted verbatim by `__tests__/api/top-level-api.test.ts`
 * — do not reword them without updating it, and read that file's header before deciding they are
 * only strings.
 *
 * ⚠️ The check is deferred INTO each method on purpose. A module-level throw made Rollup
 * statically conclude the failure was inevitable under `propertyReadSideEffects:false`, and dead-
 * code-eliminate the whole public API. Same reason the removed module gave.
 */
function requireController(): APIControllerLike {
    const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
    if (!ctrl) {
        if (Log)
            Log.error(
                "[GeoLeaf.API] APIController unavailable. API modules must be loaded before geoleaf.api.js"
            );
        throw new Error("APIController missing - verify that API modules are loaded");
    }
    if (!ctrl.isInitialized) {
        if (Log)
            Log.error(
                "[GeoLeaf.API] APIController in failed state. Checking state:",
                ctrl.getHealthStatus?.()
            );
        throw new Error("APIController in failed state");
    }
    return ctrl;
}

/**
 * B11 — define the top-level shorthand methods on the namespace.
 *
 * ✅ **Since socle-init 7.7 this is the SINGLE writer of the eleven.** `kernel/api/geoleaf-api.ts`
 * assigned the same names through an `Object.assign`, and won by evaluation order — a duplicate
 * that no gate could see, because gates compare NAMES and both spellings had the name. It cost two
 * production defects: `get BaseLayers()` overwriting a correct alias with `undefined` (an
 * `Object.assign` invokes the source's getters), and a `getMetrics` that worked attached and threw
 * detached. Guarded by `__tests__/guards/top-level-api-single-writer.guard.test.ts`, which was
 * written BEFORE the removal precisely so it could be seen red on intact code.
 *
 * ⚠️ The old note here long claimed that `api/geoleaf-api.js` is eliminated by Rollup's
 * DCE in the ESM build — hence the duplication. **That was measured false**, and
 * believing it is what let the duplication look inert for months.
 *
 * ## Three methods refuse a dead controller, eight do not — and that is the contract
 *
 * `init`, `setTheme` and `loadConfig` go through {@link requireController} and THROW. The other
 * eight return `null` / `[]` / `false`, which is what `GeoLeafTopLevelApi` specifies for them:
 * they are queries, and a query on an unbooted app has an answer. Do not "harmonise" the two
 * groups — the asymmetry is the contract, and both spellings already agreed on it.
 */
function defineApiMethods(_gl: GeoLeafRuntime): void {
    _gl.init = function (options: Record<string, unknown>) {
        try {
            return requireController().geoleafInit(options);
        } catch (error) {
            if (Log) Log.error("[GeoLeaf.init]", error);
            throw error;
        }
    };
    _gl.setTheme = function (theme: string) {
        try {
            return requireController().geoleafSetTheme(theme);
        } catch (error) {
            if (Log) Log.error("[GeoLeaf.setTheme]", error);
            throw error;
        }
    };
    _gl.loadConfig = function (input: unknown) {
        if (
            input === null ||
            input === undefined ||
            (typeof input !== "string" && typeof input !== "object")
        ) {
            throw new TypeError(
                `[GeoLeaf.loadConfig] Invalid input: expected string URL or config object, got ${typeof input}`
            );
        }
        try {
            return requireController().geoleafLoadConfig(input as string | Record<string, unknown>);
        } catch (error) {
            if (Log) Log.error("[GeoLeaf.loadConfig]", error);
            throw error;
        }
    };
    _gl.createMap = function (id: string, options?: Record<string, unknown>) {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        return ctrl && ctrl.geoleafCreateMap ? ctrl.geoleafCreateMap(id, options) : null;
    };
    _gl.getMap = function (id: string) {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        return ctrl && ctrl.managers && ctrl.managers.factory
            ? ctrl.managers.factory.getMapInstance(id)
            : null;
    };
    _gl.getAllMaps = function () {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        return ctrl && ctrl.managers && ctrl.managers.factory
            ? ctrl.managers.factory.getAllMapInstances()
            : [];
    };
    _gl.getModule = function (name: string) {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        return ctrl && ctrl.moduleAccessFn ? ctrl.moduleAccessFn(name) : null;
    };
    _gl.hasModule = function (name: string) {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        const mod = ctrl && ctrl.moduleAccessFn ? ctrl.moduleAccessFn(name) : null;
        return !!mod;
    };
    _gl.getNamespace = function (name: string) {
        const gl = ensureGeoLeaf();
        // Lookup by computed name: the cast is the honest form since the
        // `[key: string]: unknown` tail left `GeoLeafGlobal`. The result IS
        // unknown.
        return name ? (gl as unknown as Record<string, unknown>)[name] || null : null;
    };
    _gl.getHealth = function () {
        const ctrl = ensureGeoLeaf()._APIController as APIControllerLike | undefined;
        return ctrl && ctrl.getHealthStatus ? ctrl.getHealthStatus() : null;
    };
    _gl.getMetrics = function () {
        const gl = ensureGeoLeaf();
        return (gl.getHealth as () => unknown)();
    };
    // Alias version — mirrors the build-injected `_version` (set at B1); shared
    // dev/test fallback. ⚠️ "Also set by geoleaf-api.js for ESM — harmless
    // duplicate", it long said: the duplicate did exist, and it was NOT harmless —
    // it wrote unguarded and overwrote this one. The guard below is the correct
    // side, and it is now the only one.
    if (!_gl.version) {
        _gl.version = _gl._version ?? VERSION_FALLBACK;
    }
    // ⚠️ "geoleaf.api.js (ESM facade) also sets these", it long said — no longer
    // true, and that is the point: this module is the only writer, guarded by
    // TLA-01.
}

/**
 * B11 — the API **kernel** surface: the kernel facades, the APIController sub-managers,
 * PluginRegistry, BootInfo and the top-level shorthand methods. Every capability facade
 * that used to be assigned here now owns a `capabilities/<cap>/install.ts` (S2) — hence
 * the `Kernel` suffix. Re-callable; bound to the `api` module lifecycle (the registry id
 * stays `"api"`). Idempotent: namespace creation is conditional, the rest are reference
 * re-assignments / function (re)definitions.
 */
export function setupAPIKernel(): void {
    const _gl = ensureGeoLeaf();
    assignApiFacades(_gl);
    defineApiMethods(_gl);
}

// ── PHASE A — see the rationale in `globals.config.ts`. ──────────────────────────────────────
//
// Runs LAST by construction: `globals.ts` imports this file after core/config/geojson/ui/storage,
// and ESM evaluation order is depth-first and deterministic. That order IS the dependency —
// `setupAPIKernel()` reads facades posted upstream. It is also what let Lot 3 remove the stopgap
// from `kernel/api/controller.ts`: by the time anything reads `_APIController`, config and api
// are already posted.
setupAPIKernel();
