/*!
 * GeoLeaf Core – App / Shared Types
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Shared type definitions for the `app/` boot orchestration layer.
 *
 * The feature initializers (`init-features.ts`, `init-reveal.ts`,
 * `init-deferred-ui.ts`) all receive the same dependency-injection
 * "context bag" assembled by the caller of `CoreMapModule`/`SharedModule`/`UIModule`
 * (production: `ModuleRegistry`, see `boot-core.ts`). These interfaces type that bag
 * once, replacing the per-file `: any` parameter objects (roadmap_typage-strict S6).
 *
 * The shapes are intentionally permissive: the live `GeoLeaf` namespace is assembled
 * incrementally across the B1→B11 boot phases (see `global.d.ts`), and the active
 * profile config (`GeoLeafConfig`) tolerates extra keys. Nothing here changes the
 * boot sequence — these are annotations only.
 */

import type {
    GeoLeafConfig,
    PermalinkConfig,
} from "../kernel/config/geoleaf-config/config-types.js";
import type {
    GeoLeafBounds,
    GeoLeafPoint,
    IMapAdapter,
} from "../contracts/map-adapter.contract.js";
import type { IGeoLeafConfig } from "../contracts/config.contract.js";

/**
 * The `GeoLeaf._app` namespace as consumed by the boot initializers.
 * Members are wired in `app/app-namespace.ts`, `app/init.ts` and `app/boot.ts`.
 */
export interface AppNamespace {
    /** Production logger (`log`/`info`/`warn`/`error`). */
    AppLog: AppLogger;
    /** Displays a UI notification; returns `true` when shown. */
    showNotification: (message: string) => boolean;
    /** Resolves the relative base path to the `profiles/` folder. */
    getProfilesBasePath: () => string;
    /** Verifies that the plugins referenced by the config are loaded. */
    checkPlugins: (cfg: GeoLeafConfig) => void;
    /** Boot entry point — loads config then runs `ModuleRegistry.init()` (wired in boot-install.ts). */
    startApp: () => Promise<void>;
    /** Double-boot guard flag (wired in boot.ts). */
    _appStarted: boolean;
    /** Lazily-assigned boot members and the long tail. */
    [key: string]: unknown;
}

/** Production logging surface exposed on `GeoLeaf._app.AppLog`. */
interface AppLogger {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

/** Records a performance mark when the `__GEOLEAF_PERF__` opt-in flag is set. */
type PerfMark = (name: string) => void;

/**
 * `Window` augmented with the runtime perf opt-in flag.
 * Mirrors the `LoadingWindow` pattern used in `theme-applier/core.ts` — keeps the
 * `__GEOLEAF_PERF__` access typed without a project-wide `Window` augmentation.
 */
export interface PerfWindow extends Window {
    __GEOLEAF_PERF__?: boolean;
}

/** Reads the `window.__GEOLEAF_PERF__` perf opt-in flag in a typed way. */
export function perfWindow(): PerfWindow {
    return window as PerfWindow;
}

/** A callable extracted from an untyped namespace member. */
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Returns `value` typed as a callable when it is a function, else `undefined`.
 *
 * Replaces the `GeoLeaf.X.method()` calls that `: any` used to allow on the
 * loosely-typed (`unknown`) tail of the `GeoLeaf` namespace. The classic guard
 * `typeof obj.method === "function"` does not narrow a fresh `unknown` access, so
 * this helper performs the narrowing once at the call site — behavior-identical
 * to the original `typeof … === "function"` check.
 */
export function asFn(value: unknown): AnyFn | undefined {
    return typeof value === "function" ? (value as AnyFn) : undefined;
}

/**
 * Reads a member off a possibly-`undefined` namespace object as `unknown`.
 * Mirrors the `obj && obj.member` access pattern without an `any` cast.
 */
export function member(obj: unknown, key: string): unknown {
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * Dependency context shared by the feature-module initializers in
 * `init-features.ts`. Assembled by the caller and passed by value.
 */
export interface FeatureInitContext {
    /** The global `GeoLeaf` namespace. */
    GeoLeaf: GeoLeafGlobal;
    /** The active profile configuration. */
    cfg: GeoLeafConfig;
    /** The map adapter instance (engine-agnostic boundary). */
    map: IMapAdapter | null;
    /** Production logger. */
    AppLog: AppLogger;
}

/**
 * Context for `initGeoJSON`. The initializer reads the active profile via
 * `GeoLeaf.Config` rather than `cfg`, so `cfg` is part of the bag (passed by the
 * call site for symmetry) but not consumed; the `_app` namespace drives the
 * layers-loaded notification.
 */
export interface GeoJSONInitContext {
    GeoLeaf: GeoLeafGlobal;
    /** Passed for call-site symmetry; the initializer does not read it. */
    cfg: GeoLeafConfig;
    map: IMapAdapter | null;
    AppLog: AppLogger;
    _app: AppNamespace;
}

/** Option-builder context for the mobile toolbar (`_buildMobileToolbarOptions`). */
export interface MobileToolbarBuilderContext {
    GeoLeaf: GeoLeafGlobal;
    cfg: GeoLeafConfig;
    map: IMapAdapter | null;
    glMain: HTMLElement;
}

/** Option-builder context for the desktop panel (`_buildDesktopPanelOptions`). */
export interface DesktopPanelBuilderContext {
    GeoLeaf: GeoLeafGlobal;
    cfg: GeoLeafConfig;
    glMain: HTMLElement;
}

/** Dependency context for `setupDeferredUIPanels` (`init-deferred-ui.ts`). */
export interface DeferredUIDeps {
    GeoLeaf: GeoLeafGlobal;
    cfg: GeoLeafConfig;
    map: IMapAdapter | null;
    AppLog: AppLogger;
    _pm: PerfMark;
}

/** Dependency context for `setupReveal` (`init-reveal.ts`). */
export interface RevealDeps {
    GeoLeaf: GeoLeafGlobal;
    map: IMapAdapter | null;
    AppLog: AppLogger;
    /** Profile bounds used to re-fit the view at reveal (null in center+zoom mode). */
    profileBounds: GeoLeafBounds | null;
    /** Padding applied to the reveal-time `fitBounds`. */
    profilePadding: RevealPadding | null;
    /** Resolved permalink config (`cfg.ui.permalink` or `{}`). */
    permalinkCfg: PermalinkRuntimeConfig;
}

/**
 * Padding accepted by `map.fitBounds` at reveal time — either the normalized
 * object form built by `CoreMapModule` or the raw config value forwarded as-is.
 */
export type RevealPadding =
    | { top: number; bottom: number; left: number; right: number }
    | Record<string, unknown>;

/** Options object accepted by `IMapAdapter.fitBounds`. */
export interface FitBoundsOptions {
    padding?: GeoLeafPoint;
    animate?: boolean;
}

/**
 * Builds the `fitBounds` options object from the profile padding.
 *
 * `CoreMapModule` produces padding in MapLibre's `{ top, bottom, left, right }` object
 * form, which `MaplibreAdapter.fitBounds` accepts but the `IMapAdapter` contract
 * types narrowly as `GeoLeafPoint`. This isolates the single contract/impl bridge
 * cast (no `any`) — the runtime value is forwarded unchanged.
 */
export function buildFitBoundsOptions(padding: RevealPadding | null): FitBoundsOptions {
    return {
        // `FitBoundsOptions` est declare hors du depot : on ne peut pas l'elargir. Insertion
        // conditionnelle plutot qu'un `undefined` explicite.
        ...(padding != null && { padding: padding as unknown as GeoLeafPoint }),
        animate: false,
    };
}

/**
 * Bridges the DI contract type to the concrete profile config shape.
 *
 * Kernel modules receive `config` typed as the {@link IGeoLeafConfig} contract (the
 * engine-agnostic `init(adapter, config)` signature), but read profile-specific fields
 * typed on {@link GeoLeafConfig}. This isolates the single contract→impl bridge cast
 * (no `any`) shared by `CoreMapModule`, `UIModule` and `SharedModule` — the runtime
 * value is forwarded unchanged.
 */
export function asGeoLeafConfig(config: IGeoLeafConfig): GeoLeafConfig {
    return config as unknown as GeoLeafConfig;
}

/**
 * Runtime view of `cfg.ui.permalink`. Only `enabled` is read in `app/`; the rest
 * is consumed by `GeoLeaf.Permalink` and kept opaque here. `Partial` accepts the
 * empty object produced by the `|| {}` fallback in `CoreMapModule`.
 */
export type PermalinkRuntimeConfig = Partial<PermalinkConfig>;
