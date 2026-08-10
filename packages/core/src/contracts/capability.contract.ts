/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Capability (public type boundary)
 *
 * Defines the contract for declaring optional GeoLeaf capabilities:
 * - `ICapabilityFieldSchema` — JSON Schema subset for a single config field
 * - `ICapabilityConfigGate` — how a capability is enabled/disabled by config
 * - `ICapabilitySchema` — introspectable view of a capability (no loader)
 * - `ICapabilityDeclaration` — what a module passes to `register()`
 * - `ICapabilityInstallFacts` — what an installer knows and a declaration cannot (S9.4)
 * - `ICapabilityStatus` — the activation verdict: embarked? enabled? by which gate? (S9.4)
 * - `ICapabilityRegistry` — the registry interface
 *
 * Design intent (S2.1): a unified declaration surface that generalises
 * `PluginRegistry.registerLazy()` (bundle-level) and `registerLayerLoader()`
 * (per-layer dispatch) into a single config-gated, schema-exposing contract.
 * Actual capability migrations happen in S2.4 (pilot) and Phase 3.
 *
 * Gate semantics:
 *   - No `gate`                    → always enabled (not yet config-gated)
 *   - gate present + key absent    → `enableWhenAbsent ?? false` (opt-in by default)
 *   - gate present + value `false` → disabled
 *   - gate present + any truthy    → enabled
 *
 * This matches the existing `modules.offline` / `modules.table` / `modules.geocoding`
 * pattern: presence of the config block activates the feature.
 */
"use strict";

// ─── ICapabilityFieldSchema ──────────────────────────────────────────────────

/**
 * JSON Schema subset describing a single configuration field.
 *
 * Used by capability declarations to expose their config shape to studio /
 * form-builder plugins (Phase 4). Intentionally minimal — only the subset
 * needed to generate a UI form.
 */
export interface ICapabilityFieldSchema {
    /** JSON primitive or structural type. */
    type: "string" | "number" | "boolean" | "object" | "array";

    /** Human-readable description of this field (shown in studio). */
    description?: string;

    /** Default value when the field is absent from config. */
    default?: unknown;

    /** Allowed values — renders as a select/radio in studio. */
    enum?: unknown[];

    /** Minimum numeric value (`type: "number"` only). */
    minimum?: number;

    /** Maximum numeric value (`type: "number"` only). */
    maximum?: number;

    /** Nested field schemas (`type: "object"` only). */
    properties?: Record<string, ICapabilityFieldSchema>;

    /** Schema for array items (`type: "array"` only). */
    items?: ICapabilityFieldSchema;
}

// ─── ICapabilityConfigGate ───────────────────────────────────────────────────

/**
 * Describes how a capability is enabled or disabled by the profile config.
 *
 * The registry evaluates `config.get(configPath)` at capability check time:
 * - Key absent in config → `enableWhenAbsent ?? false`
 * - Value strictly `false` → disabled
 * - Any other truthy value → enabled
 */
export interface ICapabilityConfigGate {
    /**
     * Dot-notation path read via `config.get()`.
     * @example `'modules.labels.enabled'`
     * @example `'modules.route.enabled'`
     */
    configPath: string;

    /**
     * Return value when `configPath` is absent from config.
     * Defaults to `false` (opt-in semantics — matching the existing modules pattern).
     * Set to `true` for capabilities that should be on unless explicitly disabled.
     */
    enableWhenAbsent?: boolean;
}

// ─── ICapabilitySchema ───────────────────────────────────────────────────────

/**
 * Introspectable view of a registered capability.
 *
 * Returned by `CapabilityRegistry.getSchema()` and `IIntrospectionAPI.getCapabilitySchema()`.
 * The `loader` field is intentionally absent — consumers only see the declaration
 * metadata, not the loading implementation.
 */
export interface ICapabilitySchema {
    /** Unique capability identifier (kebab-case). */
    readonly id: string;

    /** Human-readable label (used by studio UI). */
    readonly label?: string;

    /** Short description (shown in studio tooltip). */
    readonly description?: string;

    /** Config gate — how the capability is enabled/disabled by profile config. */
    readonly gate?: ICapabilityConfigGate;

    /**
     * JSON Schema description of the config block consumed by this capability.
     * Keys match the fields under the capability's config path.
     * Used by studio/form-builder to generate config forms.
     */
    readonly configSchema?: Record<string, ICapabilityFieldSchema>;

    /** IDs of other capabilities that must be enabled for this one to work. */
    readonly dependencies?: readonly string[];
}

// ─── ICapabilityDeclaration ──────────────────────────────────────────────────

/**
 * What a module or plugin passes to `CapabilityRegistry.register()`.
 *
 * Extends `ICapabilitySchema` with an optional `loader` for dynamic import.
 * The loader is called once by `ensureLoaded()` — subsequent calls are no-ops.
 *
 * The `loader` is for **plugins** — a capability whose runtime lives in a separate bundle
 * fetched on first use. In-core capabilities never declare one: they are embarked at build
 * time by their installer appearing in a preset manifest, and left out by omitting it. (The
 * old in-core `loader: () => import('../lazy/<cap>.js')` example was removed in S5 with
 * `src/lazy/` — those chunks were re-export shells over code that was eager anyway.)
 *
 * @example
 * ```typescript
 * GeoLeaf.plugins.registerCapability({
 *   id: 'table',
 *   label: 'Table',
 *   gate: { configPath: 'modules.table.enabled' },
 *   configSchema: {
 *     pageSize: { type: 'number', description: 'Rows per page', default: 25 },
 *   },
 *   loader: () => import('@geoleaf-plugins/table').then(() => void 0),
 * });
 * ```
 */
export interface ICapabilityDeclaration extends ICapabilitySchema {
    /**
     * Optional dynamic loader invoked on the first `ensureLoaded()` call.
     * Should import the capability's runtime bundle and register its handlers.
     * Called at most once — the registry tracks loaded state.
     */
    loader?: () => Promise<void>;
}

// ─── ICapabilityInstallFacts ─────────────────────────────────────────────────

/**
 * What an **installer** knows about its capability and a **declaration** cannot know.
 *
 * Travels through `ICapabilityRegistry.noteInstaller()` rather than as a field on the
 * declaration: `ICapabilityDeclaration` describes a capability, `CapabilityInstaller`
 * describes how a bundle embarks one, and those are two subjects. Merging them would put a
 * build-time fact on an object that the runtime channel
 * (`GeoLeaf.plugins.registerCapability`) also produces, where it has no meaning.
 */
export interface ICapabilityInstallFacts {
    /**
     * `true` when the installer declares a `createModule()` factory.
     *
     * ⚠️ A **structural** fact, never a runtime one: it says the capability contributes an
     * `ICoreModule` to the registry, not that this module is running — and the module's id is
     * not necessarily the capability's (`permalink` contributes `share`). For "is it
     * running?", the answer is `IIntrospectionAPI.getActiveModules()`.
     */
    readonly hasModule: boolean;
}

// ─── ICapabilityStatus ───────────────────────────────────────────────────────

/**
 * Activation verdict for one declared capability — "what is switched on, and why".
 *
 * Returned by `ICapabilityRegistry.getAllStatuses()` and, through it, by
 * `IIntrospectionAPI.getCapabilityStatus()`.
 */
export interface ICapabilityStatus {
    /** Capability id — the one carried by its declaration. */
    readonly id: string;

    /**
     * `true` when the declaration came from a **preset installer**, i.e. from the build.
     * `false` when it came from the runtime channel (`GeoLeaf.plugins.registerCapability`,
     * or a direct `CapabilityRegistry.register()`).
     *
     * ⚠️ This is NOT "present in the full manifest". Comparing against the shipped manifest
     * would mean importing it, which re-anchors all 21 installers in every entry's eager
     * closure — and would answer `true` for a capability a slim entry does not embark at all
     * (`packages/core/examples/minimal/entry.ts` composes 6 of them).
     */
    readonly embarked: boolean;

    /**
     * Verdict of {@link ICapabilityStatus.gate} against the config **at call time**.
     * Re-read on every call, never frozen: the profile's config arrives after the preset
     * passes have run, so a value captured at registration would be the pre-merge one.
     *
     * ⚠️ "Enabled", not "currently running".
     */
    readonly enabled: boolean;

    /**
     * The gate that produced {@link ICapabilityStatus.enabled}. Absent ⟹ ungated capability,
     * which is always enabled.
     *
     * This is the capability's **own** gate. An installer may gate its module on a sub-key
     * instead (`CapabilityInstaller.moduleGate`); that gate decides the module, not the
     * capability, and reporting it here would pair a cause with someone else's effect.
     */
    readonly gate?: ICapabilityConfigGate;

    /** See {@link ICapabilityInstallFacts.hasModule}. Always `false` for a runtime capability. */
    readonly hasModule: boolean;
}

// ─── ICapabilityRegistry ─────────────────────────────────────────────────────

/**
 * Registry of declared GeoLeaf capabilities.
 *
 * Consumed by:
 * - Module `init()` methods to register capabilities (via `GeoLeaf.plugins.registerCapability`)
 * - `GeoLeaf.Introspection` facade to expose schemas to studio / form-builder
 * - Future: `ModuleRegistry` to gate init order on capability activation
 */
export interface ICapabilityRegistry {
    /**
     * Registers a capability declaration.
     * Idempotent — calling with the same `id` twice is a no-op.
     */
    register(decl: ICapabilityDeclaration): void;

    /**
     * Returns `true` when the capability is enabled according to the profile config.
     * Evaluates the gate synchronously — does not trigger loading.
     *
     * @param id - Capability id.
     * @param config - Config reader (same shape as `IGeoLeafConfig`).
     */
    isEnabled(id: string, config: { get(key: string, defaultValue?: unknown): unknown }): boolean;

    /** Returns `true` when `ensureLoaded()` has completed for this capability. */
    isLoaded(id: string): boolean;

    /**
     * Ensures the capability's loader has been called.
     * No-op if already loaded or no loader was declared.
     * Safe to call multiple times — calls the loader exactly once.
     */
    ensureLoaded(id: string): Promise<void>;

    /**
     * Returns the introspectable schema for a capability, or `null` if not registered.
     * The returned object never contains the `loader` field.
     */
    getSchema(id: string): ICapabilitySchema | null;

    /**
     * Returns introspectable schemas for all registered capabilities.
     * Order matches registration order. No `loader` field on any item.
     */
    getAllSchemas(): readonly ICapabilitySchema[];

    /**
     * Records the build-time facts of the installer that carries `id`.
     *
     * Called by preset Pass 1 (`presets/apply-preset.ts`) and by nothing else: a capability
     * declared through the runtime channel has no installer, and that absence **is**
     * `embarked: false`.
     *
     * @param id - Capability id — the one already passed to `register()`.
     * @param facts - What the installer knows and the declaration does not.
     */
    noteInstaller(id: string, facts: ICapabilityInstallFacts): void;

    /**
     * Returns the activation status of every registered capability, in registration order.
     *
     * @param config - Dotted-path config reader. `GeoLeaf.Config` is one.
     */
    getAllStatuses(config: {
        get(key: string, defaultValue?: unknown): unknown;
    }): readonly ICapabilityStatus[];
}
