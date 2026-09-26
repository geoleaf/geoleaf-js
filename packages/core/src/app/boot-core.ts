/*!
 * GeoLeaf Core – App / Boot core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Preset-parameterised boot sequence (presets build, S3).
 *
 * `bootWithPreset()` is the former body of `boot.ts#startApp`, generalised over a
 * {@link PresetManifest} instead of hard-wiring the shipped one. It is the single runtime
 * entry every bundle entry calls: an entry embarks its capabilities by importing their
 * `install.ts` (through its manifest), then boots with that manifest.
 *
 * The sequence is UNCHANGED — this is a move, not a rewrite:
 *
 * ```
 *   loadConfig()                        → baseCfg (pre-merge)
 *   Pass 1  registerPresetDeclarations  (declaration + facade globals, ungated)
 *   Pass 2  registerPresetModules       (every lifecycle module, each wrapping its gate)
 *   loadActiveProfileResources()        → effectiveCfg (profile merged in)
 *   beforeBoot hook                     (auth gate; throwing aborts)
 *   registry.init(adapter, effectiveCfg, { onModuleError })
 * ```
 *
 * Everything that belongs to **module-eval** — the `?perf=1` latch, the kernel module
 * registrations, `GeoLeaf._registry`, the `GeoLeaf.boot()` facade — lives in
 * `boot-install.ts#installBoot()` (S4). This module owns the *sequence* only, and receives
 * its collaborators through {@link BootContext} rather than reaching for globals: that is
 * what makes the boot directly testable without standing up the whole `GeoLeaf.*` namespace.
 *
 * ⛔ **Do not move Pass 2 below `loadActiveProfileResources()`.** That ordering is
 * load-bearing — it is the zone an earlier sprint had to revert — and the reason has not
 * gone away: a module de-registered at Pass 2 is a module the topo-sort never sees, so a
 * capability gated late in its own lifecycle would vanish rather than stay inert.
 *
 * ⚠ What HAS changed (socle-init 9.2) is what Pass 2 reads: **nothing**. It used to evaluate
 * each gate against `toCapConfig(baseCfg)` — the pre-merge config — which is why a profile
 * could not switch a capability on: at that instant its key did not exist yet, and
 * `enableWhenAbsent ?? false` answered for it. Pass 2 now registers every module and lets
 * each one evaluate its own gate inside `init()`, which runs on `effectiveCfg` below. The
 * pass did not move; a condition was removed from it.
 *
 * That this is safe rests on a property worth naming, because it is not obvious from here:
 * `loadActiveProfileResources()` returns the **same config object**, enriched under
 * `profiles.<id>` — never a replacement (`kernel/config/profile.ts`, all three return
 * paths). So `effectiveCfg ⊇ baseCfg`, and reading the gate later can only ever see more.
 */

import { MaplibreAdapter } from "../adapters/maplibre/maplibre-adapter.js";
import { CapabilityRegistry } from "../kernel/api/capability-registry.js";
import {
    getProfileLoadReport,
    resetProfileLoadReport,
    type ProfileLoadReport,
} from "../kernel/config/profile-load-report.js";
import {
    abortBoot,
    beginBoot,
    failBoot,
    noteModuleFailure,
    noteProfileFailures,
    pauseWatchdog,
    resumeWatchdog,
    setBootPhase,
} from "./boot-failure.js";
import { hideBootVeil, releaseThemelessReveal } from "./init-reveal.js";
import { resetAppReady } from "../kernel/shared/app-ready.js";
import { wasDestroyed } from "../kernel/map/facade.js";
import type { IMapAdapter } from "../contracts/map-adapter.contract.js";
import { registerPresetDeclarations, registerPresetModules } from "../presets/apply-preset.js";
import { PROFILE_STORAGE_KEY, SELECTED_PROFILE_STORAGE_KEY } from "../kernel/shared/index.js";
import type { ModuleInitFailure } from "../contracts/core-module.contract.js";
import type { PresetManifest } from "../contracts/preset.contract.js";
import type { ModuleRegistry } from "./module-registry.js";
import type { AppNamespace, BootOptions } from "./app-types.js";
import { asFn, member, perfWindow } from "./app-types.js";
import { asObject } from "../utils/general/type-guards.js";
import type { IGeoLeafConfig } from "../contracts/config.contract.js";

/**
 * Collaborators `bootWithPreset` needs, injected rather than read off globals.
 * `boot.ts` assembles this bag once, at module-eval.
 */
interface BootContext {
    /** The global `GeoLeaf` namespace (already populated by the B1→B11 chain). */
    GeoLeaf: GeoLeafGlobal;
    /** The `GeoLeaf._app` namespace (logger, profiles path, double-boot guard). */
    app: AppNamespace;
    /** The kernel module registry — the sole runtime orchestrator. */
    registry: ModuleRegistry;
}

/** Minimal logger surface consumed by {@link _resolveSelectedProfile}. */
interface ProfileResolutionLog {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

/** Profile ids reach a fetch path — a forged one must never get through. */
const PROFILE_ID_RE = /^[a-zA-Z0-9_-]{1,50}$/;

/**
 * Resolves which profile to boot, in three ranks:
 *
 *   1. `sessionStorage['gl-selected-profile']` — **one-shot** (read then removed).
 *      The pre-existing contract: `e2e/08-realtime` and `e2e/16-flatgeobuf` write it to
 *      force a profile for a single load without leaving a durable preference behind.
 *      Stays on top so that contract keeps holding.
 *   2. `localStorage['gl-profile']` — **durable**, the `profile-switcher` capability's
 *      persistence. Not consumed: it is the user's standing choice.
 *   3. `null` → `data.activeProfile` from the JSON, applied downstream by `loadConfig`.
 *
 * Both stores are user-writable, hence the same format guard on each.
 *
 * NB — this is a self-contained lookup, not a boot STEP: unlike the B1→B11 sequence
 * (whose value is its ordering, and whose extraction was reverted twice), it carries no
 * position constraint. Its result is a value, assigned where it is needed.
 *
 * @returns The profile id to load, or `null` to fall back to the configured default.
 */
function _resolveSelectedProfile(AppLog: ProfileResolutionLog): string | null {
    const isValid = (v: string | null): boolean => !!v && PROFILE_ID_RE.test(v);

    try {
        const raw = sessionStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
        sessionStorage.removeItem(SELECTED_PROFILE_STORAGE_KEY);
        if (isValid(raw)) {
            AppLog.log("Profile selected from sessionStorage:", raw);
            return raw;
        }
        if (raw) {
            AppLog.warn("sessionStorage profile rejected (invalid format):", raw.substring(0, 20));
        }
    } catch (e) {
        AppLog.warn("Unable to read sessionStorage:", e);
    }

    try {
        const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (isValid(stored)) {
            AppLog.log("Profile restored from localStorage:", stored);
            return stored;
        }
        if (stored) {
            AppLog.warn("localStorage profile rejected (invalid format):", stored.substring(0, 20));
        }
    } catch (e) {
        // Storage access throws in private browsing on some engines — fall through to
        // the JSON default rather than taking the boot down with us.
        AppLog.warn("Unable to read localStorage:", e);
    }

    return null;
}

/**
 * Resolves WHERE the configuration comes from — three ranks.
 *
 * ⚠️ NOT to be confused with {@link _resolveSelectedProfile}, which also has three ranks.
 * That one answers WHICH profile is selected; this one answers WHERE the configuration is.
 * Two questions, two resolutions, and the shared wording has already caused one confusion —
 * hence this note.
 *
 *   Rank 1 — an object handed over in memory (`options.config`).
 *   Rank 2 — an explicit URL (`options.configUrl`).
 *   Rank 3 — UNCHANGED: a path derived from the host page's URL.
 *
 * 🛑 Rank 3 keeps the standalone demo working byte for byte. What changes is its STATUS,
 * not its behaviour: `_app.getProfilesBasePath` stops being the mechanism and becomes the
 * default. It is still called, still returns the same string, and `app-namespace.test.js`
 * stays green without a single edit — that is the acceptance criterion for this rank.
 *
 * Why rank 1 matters: an application embedding this map already holds its configuration.
 * Rank 3 makes it request a path derived from the host page, which a single-page router may
 * answer with its own HTML document in HTTP 200 — JSON was expected, HTML arrives, and
 * nothing on the wire says anything is wrong.
 *
 * @param options - The boot options, when the caller passed any.
 * @param profilesPath - The base path resolved from the host page (rank 3).
 * @param AppLog - Logger, used to NAME an option that loses a collision.
 * @returns Either `{ config }` or `{ url }`, ready to spread into `loadConfig`.
 */
function _resolveConfigSource(
    options: BootOptions | undefined,
    profilesPath: string,
    AppLog: AppNamespace["AppLog"]
): { config: Record<string, unknown> } | { url: string } {
    const inlineConfig =
        options?.config && typeof options.config === "object" ? options.config : undefined;
    const explicitUrl =
        typeof options?.configUrl === "string" && options.configUrl.length > 0
            ? options.configUrl
            : undefined;

    if (inlineConfig && explicitUrl) {
        // Warn rather than throw. Throwing at the boot of a published core would turn a
        // caller's redundancy into an outage; and the option that loses is NAMED, because
        // an option silently dropped is the very defect this path exists to remove.
        AppLog.warn(
            "[GeoLeaf.boot] `config` and `configUrl` were both provided — `config` wins, " +
                "`configUrl` is ignored."
        );
    }

    // An empty object is a VALID inline configuration, exactly as `Config.init` treats it.
    // `boot()` and `loadConfig()` must never diverge on the same value: two boot paths
    // behaving differently on one input is the risk this whole sprint exists to avoid.
    return inlineConfig
        ? { config: inlineConfig }
        : { url: explicitUrl ?? profilesPath + "geoleaf.config.json" };
}

/** The message of whatever was thrown: a failure detail carries text, never the object. */
function _errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Reveals a profile without a default theme, once `registry.init()` has returned — every
 * module has run its `init()`, so every capability has subscribed to `geoleaf:app:ready`. Never
 * from inside `UIModule.init()` (see `setupReveal`). Not on a map the host destroyed meanwhile:
 * that boot is over.
 *
 * @param adapter - The boot's map adapter, checked against `wasDestroyed`.
 */
function _revealAfterRegistry(adapter: IMapAdapter): void {
    if (!wasDestroyed(adapter)) releaseThemelessReveal();
}

/** Set once {@link _abortDestroyedBoot} has run for the current boot. */
let _destroyedBootAborted = false;

/**
 * Ends a boot whose map the host destroyed: the same exit as a refused `beforeBoot` hook —
 * `geoleaf:boot:aborted` (reason `"destroyed"`), no failure screen, the veil hidden. Idempotent:
 * a second failing module finds the boot already aborted.
 */
function _abortDestroyedBoot(AppLog: AppNamespace["AppLog"]): void {
    if (_destroyedBootAborted) return;
    _destroyedBootAborted = true;
    AppLog.info("[Registry] the map was destroyed during the boot — boot aborted");
    abortBoot();
    document.dispatchEvent(
        new CustomEvent("geoleaf:boot:aborted", {
            detail: { reason: "destroyed" },
            bubbles: false,
            cancelable: false,
        })
    );
    hideBootVeil();
}

/**
 * What a module that throws does to the boot — decided by what depends on it.
 *
 * The interface chain is fatal: without `ui` the application is never revealed, so the boot
 * fails and names the module. Any other module is isolated: the registry skips the modules that
 * depend on it, and the rest of the application starts without them. Before either: when the
 * host destroyed the boot's map, the boot is aborted rather than failed, whatever the module.
 *
 * @param failure - The module that failed, as the registry reports it.
 * @param AppLog - The boot logger: the raw error, stack included, goes to the console.
 * @param adapter - The boot's map adapter, checked against `wasDestroyed`.
 * @returns `"abort"` for the interface chain or a destroyed map, `"continue"` otherwise.
 */
function _onModuleError(
    failure: ModuleInitFailure,
    AppLog: AppNamespace["AppLog"],
    adapter: IMapAdapter
): "continue" | "abort" {
    AppLog.warn(`[Registry] module '${failure.id}' failed in init():`, failure.error);
    // The host destroyed the boot's map while the boot was running: the module failed on a
    // map that is gone. Not a failed boot — the host ended it. Measured before this branch:
    // `ui` threw "map is not ready", the boot failed, and its screen stayed up over the map
    // the host had recreated.
    if (wasDestroyed(adapter)) {
        _abortDestroyedBoot(AppLog);
        return "abort";
    }
    const message = _errorMessage(failure.error);
    if (failure.id === "ui" || failure.skipped.includes("ui")) {
        failBoot({ reason: "module", phase: "registry", message, module: failure.id });
        return "abort";
    }
    noteModuleFailure({ module: failure.id, message, skipped: failure.skipped });
    return "continue";
}

/**
 * Loads the configuration, composes the preset's capabilities and hands over to the
 * `ModuleRegistry`. Resolves once every module's `init()` has run, or once the boot has
 * failed — never with a throw.
 *
 * A failure is never silent: the configuration, the profile and the registry each report
 * theirs through `app/boot-failure.ts` (`geoleaf:boot:failed`, and the failure screen in the
 * `#gl-loader` veil unless a host cancels the event), and a watchdog reports a boot that stops
 * progressing. Declared profile resources that failed while a map can still show hold the
 * reveal on a screen that names them. A module that throws is judged by what depends on it: in
 * the interface chain (`ui`, or a module `ui` depends on) the boot fails and names it; anywhere
 * else it is isolated — `geoleaf:module:failed`, the modules that depend on it skipped, and the
 * reveal held on a screen that names it.
 *
 * The reveal — and `geoleaf:app:ready` — always follows the last module's `init()`: a themed
 * profile reveals when `theme-engine` has applied its theme; a profile without any theme is
 * revealed here, once `registry.init()` has returned.
 *
 * Returns early — before any signal — when the namespace is unusable, when
 * `GeoLeaf.loadConfig` is missing, or on a second boot call. A `beforeBoot` hook that rejects
 * aborts the boot: `geoleaf:boot:aborted`, and the veil is hidden for the host. So does a host
 * that destroys the boot's map while the boot runs: a module failing on that map aborts the
 * boot the same way, with `reason: "destroyed"`, instead of failing it.
 *
 * @param preset - The active preset manifest (the capabilities this bundle embarks).
 * @param ctx - The boot collaborators (see {@link BootContext}).
 * @param options - Caller options. `config` / `configUrl` decide where the configuration
 *   comes from (see {@link _resolveConfigSource}); absent, the historical path is used.
 *   `watchdogMs` sets the watchdog (default 45 s, `0` disables it).
 */
/* eslint-disable max-lines-per-function -- boot sequence: ordering IS the contract
   `bootWithPreset` is ~170 linear lines whose VALUE is the order of its steps (B1→B11,
   documented in CDC §6). Splitting it into helpers would not reduce the coupling, it
   would hide it: each extracted function would still have to be called at exactly one
   position, and the constraint would move from "read the function" to "read the call
   site and hope". The extraction has been reverted twice for that reason.
   Audited and kept: `max-lines-per-function` is `warn` (eslint.config.mjs), so
   this suppresses no CI error — it exists to hold the repo's "0 warning" invariant.
   Lifting it means splitting the boot sequence, which is a sprint, not a cleanup. */

export async function bootWithPreset(
    preset: PresetManifest,
    ctx: BootContext,
    options?: BootOptions
): Promise<void> {
    const { GeoLeaf, app: _app, registry: _registry } = ctx;
    const AppLog = _app.AppLog;
    // R4.1.1 — Perf marks, active when window.__GEOLEAF_PERF__ === true
    const _pm = (name: string) =>
        perfWindow().__GEOLEAF_PERF__ ? performance?.mark?.(name) : undefined;

    if (!GeoLeaf) {
        AppLog.error(
            "GeoLeaf global not found. The core bundle must be loaded before GeoLeaf.boot()."
        );
        return;
    }

    if (typeof GeoLeaf.loadConfig !== "function") {
        AppLog.error("GeoLeaf.loadConfig() not found. Check that the core bundle is complete.");
        return;
    }

    AppLog.info("Starting application...");

    // Double-boot guard: if the app has already started, ignore subsequent calls.
    if (_app._appStarted) {
        AppLog.warn("[GeoLeaf.boot] Application already started — second boot call ignored.");
        return;
    }
    _app._appStarted = true;

    // From here on the boot is under watch: a failure is SIGNALLED (`boot-failure.ts`), and a
    // boot that stops progressing is reported by the watchdog — never a spinner that turns
    // forever. After the double-boot guard, so a refused second call cannot reset the first.
    beginBoot(options, GeoLeaf._version);
    _destroyedBootAborted = false;
    // Nothing is ready until THIS boot reveals — a capability initialised before then waits.
    resetAppReady();

    // perf 5 — start bound of `geoleaf:startup-total`. UNCONDITIONAL on purpose, and it
    // must stay that way: the matching `geoleaf:initApp:ready` mark and the `measure()`
    // that consumes both live in `init-reveal.ts` and are unconditional too. Only
    // the granular `geoleaf:boot:*` marks below sit behind the `__GEOLEAF_PERF__` opt-in.
    // This mark was lost at `e5d29034` (orchestration moved into `module.init()`); the
    // `measure()` kept referencing it from inside a `try {}`, so it threw on every boot and
    // `geoleaf:startup-total` was NEVER recorded — silently, for a month. Placed after the
    // double-boot guard so a rejected second call cannot move the start bound.
    if (typeof performance !== "undefined" && performance.mark) {
        performance.mark("geoleaf:initApp:start");
    }

    // Listen for app ready event to show boot toast
    // (after UI is ready — GeoLeaf.UI.notify may not be available yet)
    document.addEventListener(
        "geoleaf:app:ready",
        function _onAppReady() {
            const bootInfoShow = asFn(member(GeoLeaf.bootInfo, "show"));
            if (bootInfoShow) {
                bootInfoShow.call(GeoLeaf.bootInfo, GeoLeaf);
            }
        },
        { once: true }
    );

    const selectedProfile = _resolveSelectedProfile(AppLog);

    const profilesPath = _app.getProfilesBasePath();

    const configSource = _resolveConfigSource(options, profilesPath, AppLog);

    // perf 5.4: wrap loadConfig (callback) in a Promise to enable chaining
    setBootPhase("config");
    _pm("geoleaf:boot:loadConfig:start");
    const loadConfig = asFn(GeoLeaf.loadConfig);
    const configPromise = new Promise((resolve, reject) => {
        const pending = loadConfig?.call(GeoLeaf, {
            ...configSource,
            profileId: selectedProfile,
            autoEvent: true,
            onLoaded: resolve,
            onError: reject,
        });
        // `GeoLeaf.loadConfig` returns its loading promise. A configuration that fails
        // validation rejects it WITHOUT calling `onError`: that rejection used to be dropped,
        // and the boot waited forever for a callback that never came.
        if (pending instanceof Promise) pending.then(undefined, reject);
    });

    let cfg;
    try {
        cfg = await configPromise;
        AppLog.log("Config loaded via GeoLeaf.loadConfig:", cfg || {});
    } catch (err) {
        AppLog.error("Error loading config via GeoLeaf.loadConfig:", err);
        failBoot({ reason: "config", phase: "config", message: _errorMessage(err) });
        return;
    }
    _pm("geoleaf:boot:loadConfig:end");

    const baseCfg = (cfg || {}) as Record<string, unknown>;

    // PWA (S14 Phase A): SW registration + install prompt are driven by the `pwa`
    // capability (PwaLifecycle from shared.module #7, gated on `modules.pwa.enabled`).
    // No eager init here — the former top-level `pwa.*` config moved to `modules.pwa.*`.

    // ── Capability composition (presets build, S2) ───────────────────────────
    // Every in-core capability is anchored by its self-sufficient
    // `capabilities/<cap>/install.ts` and composed here by a single 2-pass loop over the
    // active preset manifest — the dispersed per-capability register / gate blocks that
    // used to live here are gone (S2 Lot 8 closed the migration: 17/17).
    //   Pass 1 — declaration (introspection + gate) + facade globals (`registerGlobals`).
    //   Pass 2 — the gated lifecycle module of every installer that owns one.
    registerPresetDeclarations(
        preset,
        CapabilityRegistry,
        GeoLeaf as unknown as Record<string, unknown>
    );

    // Pass 2 registers every capability module; each one carries its own gate, evaluated
    // inside its `init()` — i.e. below, once `effectiveCfg` holds the profile (socle-init 9.2).
    // This pass no longer reads any config: it used to be handed `toCapConfig(baseCfg)`, and
    // baseCfg is pre-merge, which is exactly why a profile could not switch a capability on.
    if (!_registry.isInitialized()) {
        registerPresetModules(preset, CapabilityRegistry, _registry);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Load profile resources BEFORE registry.init so modules receive ───────
    // the complete merged config (profile JSON included) at init() time.
    let effectiveCfg: Record<string, unknown> = baseCfg;
    const loadActiveProfileResources = asFn(member(GeoLeaf.Config, "loadActiveProfileResources"));
    if (loadActiveProfileResources) {
        setBootPhase("profile");
        // A clean report even when the loader is not the kernel's: the boot must never read
        // the record of a load it did not start.
        resetProfileLoadReport();
        try {
            _pm("geoleaf:boot:profileResources:start");
            const profileCfg = await loadActiveProfileResources.call(GeoLeaf.Config);
            _pm("geoleaf:boot:profileResources:end");
            effectiveCfg = asObject(profileCfg) || baseCfg;
        } catch (err) {
            // It used to continue on the base configuration: a map without its profile, and
            // not a word about it.
            AppLog.warn("Error loading profile resources:", err);
            failBoot({ reason: "profile", phase: "profile", message: _errorMessage(err) });
            return;
        }
        const report: ProfileLoadReport = getProfileLoadReport();
        if (report.fatal) {
            const cause = report.failures[0];
            failBoot({
                reason: "profile",
                phase: "profile",
                message: cause
                    ? `${cause.resource}: ${cause.message}`
                    : "The active profile could not be loaded.",
            });
            return;
        }
        // Declared resources that failed while a map can still show: the reveal is held on a
        // screen that names them — unless a host cancelled `geoleaf:profile:failed`.
        if (report.failures.length > 0) {
            noteProfileFailures(report.failures, { hold: !report.prevented });
        }
        AppLog.info("Active profile resources loaded.");
    }

    // ── beforeBoot hook (A.5.1): auth gate before map creation ──────────────
    // Receives the merged profile config. Throwing aborts boot.
    if (typeof GeoLeaf._beforeBootCallback === "function") {
        setBootPhase("before-boot");
        // PAUSED, not stretched: an authentication gate waits on a human, and no duration is
        // long enough for that. The watchdog resumes, for a full period, once the hook returns.
        pauseWatchdog();
        try {
            await (
                GeoLeaf._beforeBootCallback as (ctx: {
                    config: Readonly<Record<string, unknown>>;
                }) => Promise<void> | void
            )({ config: effectiveCfg as Readonly<Record<string, unknown>> });
        } catch (err) {
            AppLog.warn("[beforeBoot] Auth hook rejected — boot aborted:", err);
            abortBoot();
            document.dispatchEvent(
                new CustomEvent("geoleaf:boot:aborted", {
                    detail: { reason: err },
                    bubbles: false,
                    cancelable: false,
                })
            );
            // The host refused the boot and owns what comes next: the veil used to stay up
            // forever, over whatever the host draws.
            hideBootVeil();
            return;
        }
        resumeWatchdog();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── registry.init() is the sole runtime orchestrator. ────────────────────
    // Modules receive the complete merged config; CoreMapModule.init() creates
    // the map, UIModule.init() wires UI + features and arms the reveal. `geoleaf:app:ready`
    // fires AFTER every module's init(): from theme-engine's `geoleaf:theme:applied` on a
    // themed profile, from the release just below the call otherwise.
    setBootPhase("registry");
    const _adapter = new MaplibreAdapter();

    try {
        _pm("geoleaf:boot:registry:start");
        await _registry.init(_adapter, effectiveCfg as unknown as IGeoLeafConfig, {
            onModuleError: (failure) => _onModuleError(failure, AppLog, _adapter),
        });
        _pm("geoleaf:boot:registry:end");
        AppLog.log(
            "[Registry] Modules initialized:",
            _registry.getAll().map((m) => m.id)
        );
        _revealAfterRegistry(_adapter);
    } catch (err) {
        // Two roads lead here. A module of the interface chain threw: `_onModuleError` has
        // already failed the boot and named it, so the call below is ignored. Or the registry
        // refused the graph before any module ran — a dependency cycle, or a dependency that is
        // not registered.
        AppLog.warn("[Registry] init() failed:", err);
        if (wasDestroyed(_adapter)) {
            _abortDestroyedBoot(AppLog);
            return;
        }
        failBoot({ reason: "module", phase: "registry", message: _errorMessage(err) });
    }
    // ─────────────────────────────────────────────────────────────────────────
}
/* eslint-enable max-lines-per-function */
