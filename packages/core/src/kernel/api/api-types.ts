/*!
 * GeoLeaf Core – API module shared types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Shared local type hub for the `api/` cluster (registry + boot-info).
 *
 * Holds the structural shapes used by `plugin-registry.ts` and `boot-info.ts`.
 * Cross-cluster contracts (controller / managers / global namespace) live in
 * `contracts/api.contract.ts` and are imported from there — this hub only
 * declares the types specific to plugin registration and boot reporting.
 */

import type {
    GeoLeafAPINamespace,
    IControllerHealthStatus,
    IModuleAccessFn,
} from "../../contracts/api.contract.ts";

// ─── Plugin registration ────────────────────────────────────────────────────────

/**
 * Optional metadata passed to `PluginRegistry.register`.
 * Every field is optional — callers may register with no metadata at all.
 */
export interface PluginMetadata {
    /** Semantic version string, or `null` when unknown. */
    version?: string | null;
    /** Names of plugins that must be loaded for this one to activate. */
    requires?: string[];
    /** Names of plugins that enhance this one when present. */
    optional?: string[];
    /** Human-readable label (defaults to the plugin name). */
    label?: string;
    /** Optional runtime health probe used by the console reports. */
    healthCheck?: (() => boolean) | null;
}

/**
 * A registered plugin entry stored in the registry map.
 * Normalised form of {@link PluginMetadata} (defaults applied at registration).
 */
export interface PluginEntry {
    name: string;
    version: string | null;
    loaded: boolean;
    loadedAt: number;
    requires: string[];
    optional: string[];
    label: string;
    healthCheck: (() => boolean) | null;
}

/** Async resolver registered for a lazy plugin — loads its bundle on demand. */
export type LazyResolver = () => Promise<void>;

/**
 * Async loader registered by a plugin to render declarative `plugin:` layers.
 * Receives the raw layer definition and resolves to the created layer id.
 */
export type PluginLayerLoader = (def: Record<string, unknown>) => Promise<string>;

// ─── Lazy UI descriptors ────────────────────────────────────────────────────────

/**
 * Toolbar/tab button descriptor declared by a lazy plugin.
 *
 * Distinct from `IModuleUISlot.mobileIcon`/`desktopTabButton` (core-module
 * contract): this variant carries an `action` field so the toolbar interceptor
 * can map a click to the owning lazy plugin before its bundle is downloaded.
 */
interface PluginUIDescriptor {
    icon: string;
    labelKey: string;
    profileKey?: string;
    action: string;
}

/** Optional UI descriptor pair passed to `registerLazyForAction`. */
export interface PluginLazyUI {
    mobileIcon?: PluginUIDescriptor;
    desktopTabButton?: PluginUIDescriptor;
}

/** A lazy-plugin UI slot stored by action name and surfaced to toolbar renderers. */
export interface LazyUISlotEntry extends PluginLazyUI {
    id: string;
    pluginName: string;
}

// ─── Public API assembler ───────────────────────────────────────────────────────

/** Factory-manager surface consumed by the public API assembler. */
interface ApiFactorySurface {
    getMapInstance(id: string): unknown;
    getAllMapInstances(): unknown[];
}

/**
 * Surface of `APIController` consumed by `geoleaf-api.ts`.
 *
 * Mirrors the runtime instance exposed on `GeoLeaf._APIController`. Methods
 * return `unknown` where the value flows straight back to integrators (maps,
 * configs) — callers narrow at the boundary.
 */
export interface GeoLeafApiController {
    isInitialized: boolean;
    moduleAccessFn?: IModuleAccessFn | null;
    managers?: { factory?: ApiFactorySurface };
    // ⚠️ API S4.2 — ces quatre signatures étaient toutes en `unknown`, et c'était plus lâche
    // que le contrôleur qu'elles décrivent : `controller.ts` déclare `geoleafSetTheme(theme:
    // string): boolean` et `geoleafLoadConfig(input): Promise<unknown>`. L'écart n'était pas
    // théorique — il faisait diverger les deux implémentations du namespace, celle-ci rendant
    // `unknown` là où sa jumelle UMD (`globals.api.ts`) rendait `boolean` et `Promise`.
    // Resserrées sur le runtime : c'est lui qui fait foi, pas la vue la plus permissive.
    geoleafInit(options: Record<string, unknown>): unknown;
    geoleafSetTheme(theme: string): boolean;
    geoleafLoadConfig(input: string | Record<string, unknown>): Promise<unknown>;
    geoleafCreateMap(id: string, options?: Record<string, unknown>): unknown;
    getHealthStatus(): IControllerHealthStatus & Record<string, unknown>;
}

/**
 * Shape of the global `GeoLeaf` object as the public API assembler reads it.
 *
 * Standalone (not extending {@link GeoLeafAPINamespace}) because it refines
 * `_APIController` to the concrete controller surface the assembler invokes,
 * which is incompatible with the contract's minimal `{ init(): boolean }` shape.
 * Keeps the permissive index signature for the long tail of namespace members.
 */
export interface GeoLeafApiNamespace {
    _APIController?: GeoLeafApiController | null;
    CONSTANTS?: Record<string, unknown>;
    version?: string;
    Baselayers?: unknown;
    [key: string]: unknown;
}

// ─── Boot info ──────────────────────────────────────────────────────────────────

/** Title + body shown in the startup boot report. */
export interface BootMessage {
    title: string;
    message: string;
}

/** Options for {@link showBootInfo}. */
export interface BootInfoOptions {
    /** Force display even when disabled via `debug.showBootInfo`. */
    force?: boolean;
    /** Display duration in ms (reserved — currently logged only). */
    duration?: number;
}

/**
 * Subset of the global `GeoLeaf` namespace consumed by boot-info.
 *
 * Reuses {@link GeoLeafAPINamespace} (permissive `[key: string]: unknown`) and
 * narrows the members boot-info actually reads.
 */
export interface BootInfoNamespace extends GeoLeafAPINamespace {
    _version?: string;
    plugins?: {
        getLoadedPlugins?: () => string[];
        [key: string]: unknown;
    };
    Config?: {
        get?: (key: string, def?: unknown) => unknown;
        [key: string]: unknown;
    };
}
