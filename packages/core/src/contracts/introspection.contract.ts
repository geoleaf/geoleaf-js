/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Module Introspection (public type boundary)
 *
 * Defines the read-only introspection API exposed on `GeoLeaf.Introspection`:
 * - `IModuleInfo` — stable metadata view of a registered module (id, deps, ui presence)
 * - `IModuleSchema` — enrichable schema: configSchema + capabilities (added in S2.1)
 * - `IIntrospectionAPI` — public methods consumed by studio / form-builder (P4):
 *   module queries (getModuleSchema, getActiveModules), capability queries
 *   (getCapabilitySchema, getAllCapabilities — added in S2.1) and the activation
 *   verdict (getCapabilityStatus — added in socle-init S9.4)
 */
"use strict";

import type {
    ICapabilityFieldSchema,
    ICapabilitySchema,
    ICapabilityStatus,
} from "./capability.contract.ts";

export type { ICapabilityFieldSchema, ICapabilitySchema, ICapabilityStatus };

// ─── IModuleInfo ──────────────────────────────────────────────────────────────

/**
 * Stable metadata view of a registered `ICoreModule`.
 *
 * Returned by `getActiveModules()` — a lightweight snapshot that does not
 * expose the mutable module internals.
 */
export interface IModuleInfo {
    /** Unique module identifier within the GeoLeaf instance. */
    readonly id: string;

    /** IDs of direct dependencies declared by the module. */
    readonly dependencies: readonly string[];

    /** `true` when the module declares a UI slot (toolbar icon or filter tab). */
    readonly hasUI: boolean;
}

// ─── IModuleSchema ────────────────────────────────────────────────────────────

/**
 * Enrichable schema for a module.
 *
 * Extends `IModuleInfo` with room for capability-specific metadata.
 * Fields are deliberately absent in S1.5 — `capability.contract.ts` (S2.1)
 * will add `config`, `capabilities`, and `metadata` once the Capability
 * contract is stabilised.
 *
 * Consumers should guard against `null` (module not registered) and treat
 * the returned object as extensible by future sprints.
 */
export interface IModuleSchema extends IModuleInfo {
    /**
     * JSON Schema description of the config block consumed by this module.
     * Keys match fields under the module's `modules.<id>` config path.
     * Used by studio / form-builder to generate config forms (Phase 4).
     */
    configSchema?: Record<string, ICapabilityFieldSchema>;

    /**
     * IDs of capabilities provided by this module (registered via
     * `CapabilityRegistry.register()`). Allows studio to list all features
     * a module exposes and their individual config schemas.
     * @example `['labels', 'legend']`
     */
    capabilities?: readonly string[];
}

// ─── IIntrospectionAPI ────────────────────────────────────────────────────────

/**
 * Read-only introspection surface exposed as `GeoLeaf.Introspection`.
 *
 * Consumed by studio and form-builder plugins (P4) to enumerate active modules
 * and read their declared schemas without coupling to the registry internals.
 *
 * @example
 * ```typescript
 * const modules = GeoLeaf.Introspection.getActiveModules();
 * for (const mod of modules) {
 *     const schema = GeoLeaf.Introspection.getModuleSchema(mod.id);
 *     if (schema) buildFormFor(schema);
 * }
 * ```
 */
export interface IIntrospectionAPI {
    /**
     * Returns the schema of a registered module, or `null` if no module
     * with the given id is registered.
     *
     * @param id - Module id (e.g. `'poi'`, `'route'`, `'search'`).
     */
    getModuleSchema(id: string): IModuleSchema | null;

    /**
     * Returns a read-only snapshot of all registered modules.
     *
     * The order matches the insertion order of `ModuleRegistry.register()`.
     * After `registry.init()`, this includes both built-in and lazily
     * registered plugin modules.
     */
    getActiveModules(): readonly IModuleInfo[];

    /**
     * Returns the introspectable schema of a registered capability, or `null`
     * if no capability with the given id has been declared.
     *
     * The returned schema never contains the `loader` field.
     *
     * @param id - Capability id (e.g. `'labels'`, `'route'`, `'cluster'`).
     */
    getCapabilitySchema(id: string): ICapabilitySchema | null;

    /**
     * Returns introspectable schemas for all registered capabilities.
     *
     * Order matches the order in which `registerCapability()` was called.
     * No `loader` field on any returned item.
     *
     * Consumed by studio / form-builder plugins to enumerate available features.
     */
    getAllCapabilities(): readonly ICapabilitySchema[];

    /**
     * Returns, for every declared capability, what switches it on and why.
     *
     * One question, one answer — distinct from both neighbours:
     *   - `getAllCapabilities()` returns what is **declared** (the schema);
     *   - `getActiveModules()` returns what is **running** (initialised modules);
     *   - this one returns the **config verdict**: embarked? enabled? through which gate?
     *
     * `enabled` is re-read on each call against `GeoLeaf.Config`, hence against the
     * profile-merged config as soon as the profile is loaded. Before `boot()` no config is
     * loaded and every gate answers its `enableWhenAbsent` — which is the exact answer to
     * "with what is configured right now", not a fallback value.
     *
     * Order matches registration order.
     */
    getCapabilityStatus(): readonly ICapabilityStatus[];
}
