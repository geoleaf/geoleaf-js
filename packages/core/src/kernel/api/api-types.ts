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

// ⚠️ `GeoLeafAPINamespace` is no longer imported since 17/08/2026: the TWO types of this
// file that referenced it are now standalone, and a comment `{@link}` does not count as a
// use for `no-unused-vars`. Comments NAME it by its path rather than by a link — a
// reference depending on an import no code uses breaks at the first cleanup.
import type { IControllerHealthStatus, IModuleAccessFn } from "../../contracts/api.contract.ts";

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
    /**
     * Hide this slot when `modules.<pluginName>.enabled` is explicitly `false`.
     *
     * 🛑 **OPT-IN, AND THAT IS THE POINT: the guard only applies to plugins whose
     * `entry.ts` already carries it.** Measured on 20/08/2026: of the six lazy-slot
     * plugins, **only three** wrap their registration in
     * `if (getXConfig().enabled !== false)` — `print`, `measure`, `editor`. The other
     * three (`table`, `geocoding`, `position-share`) register unconditionally, and that
     * is no oversight: their `enabled` does not mean "feature absent".
     *
     * ⚠️ **The counter-example that made this an opt-in rather than a uniform rule**:
     * `profiles/tourism` declares `position-share: { enabled: false, showButton: true }`.
     * For that plugin, `enabled` governs EMISSION, and the button IS the switch that
     * turns it on (PS-09). A uniform guard hid a button the profile explicitly asks for —
     * and removed the only way to activate the feature.
     *
     * The flag cannot be evaluated at declaration time: `registerLazyForAction` runs in
     * `init.js` **before** the profile loads. It is therefore read at RENDER time.
     */
    gateOnModuleEnabled?: boolean;
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
    // ⚠️ These four signatures were all `unknown`, which was looser than the controller
    // they describe: `controller.ts` declares `geoleafSetTheme(theme: string): boolean`
    // and `geoleafLoadConfig(input): Promise<unknown>`. The gap was not theoretical — it
    // made the two namespace implementations diverge, this one returning `unknown` where
    // its UMD twin (`globals.api.ts`) returned `boolean` and `Promise`. Narrowed onto
    // the runtime: it is the authority, not the most permissive view.
    geoleafInit(options: Record<string, unknown>): unknown;
    geoleafSetTheme(theme: string): boolean;
    geoleafLoadConfig(input: string | Record<string, unknown>): Promise<unknown>;
    geoleafCreateMap(id: string, options?: Record<string, unknown>): unknown;
    getHealthStatus(): IControllerHealthStatus & Record<string, unknown>;
}

/**
 * Shape of the global `GeoLeaf` object as the public API assembler reads it.
 *
 * Standalone (not extending `GeoLeafAPINamespace`, `contracts/api.contract.ts`) because it refines
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
 * Narrows the three members `boot-info` reads structurally, and keeps a permissive
 * index signature for the six it reaches by name only (`Labels`, `Storage`, `boot`,
 * `bootInfo`, `_LMRenderer`, `_LayerManagerControl`).
 *
 * 🛑 **STANDALONE, AND THAT IS NOT COSMETIC — it is what makes the PUBLIC export
 * possible** (decided 17/08/2026). This type extended `GeoLeafAPINamespace`, which lives
 * in `contracts/api.contract.ts` — a module the `exports` map **does not publish**: of
 * the 8 declared `./contracts/*` subpaths, `api.contract.js` is not one. Exporting
 * `BootInfoNamespace` while keeping the `extends` would have emitted a public
 * declaration referencing a type **the consumer cannot resolve** — exactly the `TS2882`
 * class closed by the CSS-stub work.
 *
 * ⚠️ **And the arbitration said "remove the unused `extends`"**: the word is too broad.
 * What was unused are the parent's three named members (`_APIController`, `API`,
 * `CONSTANTS`); **its index signature, however, SERVES** — six of the nine members read
 * by `boot-info.ts` only pass through it. It is therefore reproduced here, not deleted.
 */
export interface BootInfoNamespace {
    /** Reached by name only — see the note above. */
    [key: string]: unknown;
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
