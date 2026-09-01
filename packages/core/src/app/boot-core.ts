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
 *   registry.init(adapter, effectiveCfg)
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
import { registerPresetDeclarations, registerPresetModules } from "../presets/apply-preset.js";
import { PROFILE_STORAGE_KEY, SELECTED_PROFILE_STORAGE_KEY } from "../kernel/shared/index.js";
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

/**
 * Loads the configuration, composes the preset's capabilities and hands over to the
 * `ModuleRegistry`. Resolves once every module's `init()` has run (or has failed —
 * a registry failure is logged, not thrown, exactly as before).
 *
 * Returns early — without side effects — when the namespace is unusable, when
 * `GeoLeaf.loadConfig` is missing, on a second boot call, or when the `beforeBoot`
 * hook rejects.
 *
 * @param preset - The active preset manifest (the capabilities this bundle embarks).
 * @param ctx - The boot collaborators (see {@link BootContext}).
 * @param options - Caller options. `config` / `configUrl` decide where the configuration
 *   comes from (see {@link _resolveConfigSource}); absent, the historical path is used.
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
    _pm("geoleaf:boot:loadConfig:start");
    const loadConfig = asFn(GeoLeaf.loadConfig);
    const configPromise = new Promise((resolve, reject) => {
        loadConfig?.call(GeoLeaf, {
            ...configSource,
            profileId: selectedProfile,
            autoEvent: true,
            onLoaded: resolve,
            onError: reject,
        });
    });

    let cfg;
    try {
        cfg = await configPromise;
        AppLog.log("Config loaded via GeoLeaf.loadConfig:", cfg || {});
    } catch (err) {
        AppLog.error("Error loading config via GeoLeaf.loadConfig:", err);
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
        try {
            _pm("geoleaf:boot:profileResources:start");
            const profileCfg = await loadActiveProfileResources.call(GeoLeaf.Config);
            _pm("geoleaf:boot:profileResources:end");
            AppLog.info("Active profile resources loaded.");
            effectiveCfg = asObject(profileCfg) || baseCfg;
        } catch (err) {
            AppLog.warn("Error loading profile resources:", err);
        }
    }

    // ── beforeBoot hook (A.5.1): auth gate before map creation ──────────────
    // Receives the merged profile config. Throwing aborts boot.
    if (typeof GeoLeaf._beforeBootCallback === "function") {
        try {
            await (
                GeoLeaf._beforeBootCallback as (ctx: {
                    config: Readonly<Record<string, unknown>>;
                }) => Promise<void> | void
            )({ config: effectiveCfg as Readonly<Record<string, unknown>> });
        } catch (err) {
            AppLog.warn("[beforeBoot] Auth hook rejected — boot aborted:", err);
            document.dispatchEvent(
                new CustomEvent("geoleaf:boot:aborted", {
                    detail: { reason: err },
                    bubbles: false,
                    cancelable: false,
                })
            );
            return;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── registry.init() is the sole runtime orchestrator. ────────────────────
    // Modules receive the complete merged config; CoreMapModule.init() creates
    // the map, UIModule.init() wires UI + features + fires geoleaf:app:ready.
    const _adapter = new MaplibreAdapter();

    try {
        _pm("geoleaf:boot:registry:start");
        await _registry.init(_adapter, effectiveCfg as unknown as IGeoLeafConfig);
        _pm("geoleaf:boot:registry:end");
        AppLog.log(
            "[Registry] Modules initialized:",
            _registry.getAll().map((m) => m.id)
        );
    } catch (err) {
        AppLog.warn("[Registry] init() failed:", err);
    }
    // ─────────────────────────────────────────────────────────────────────────
}
/* eslint-enable max-lines-per-function */
