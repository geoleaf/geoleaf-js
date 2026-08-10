/*!
 * GeoLeaf Core – CapabilityRegistry
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Singleton registry of declared GeoLeaf capabilities.
 *
 * Generalises two pre-existing mechanisms:
 * - `PluginRegistry.registerLazy(name, resolver)` — bundle-level lazy loading
 * - `registerLayerLoader(pluginId, loader)` — per-layer plugin dispatch
 *
 * Each capability declares its id, optional config gate (evaluated against the
 * active profile config), optional JSON Schema for studio introspection, and an
 * optional dynamic loader called at most once.
 *
 * Gate semantics (see `ICapabilityConfigGate`):
 *   - No gate             → always enabled
 *   - gate + key absent   → `enableWhenAbsent ?? false`  (opt-in by default)
 *   - gate + value false  → disabled
 *   - gate + truthy value → enabled
 *
 * ## Why it lives in `kernel/api/` (KERNEL S14 — do not move back)
 *
 * It sat in `app/` until S14. That placement produced the **only** two inverse
 * `kernel/` → `app/` import edges in the kernel (`plugin-registry.ts` and
 * `introspection/facade.ts`) — the S13 boundary study found 27 imports in the correct
 * direction and these 2 against it, both on this one symbol. The verdict was
 * "misplaced symbol, not a porous boundary", so the `no-restricted-imports` rule was
 * held back until the move.
 *
 * `kernel/api/` is the right home because this registry **generalises
 * `PluginRegistry.registerLazy`**, which lives in this very directory — one of the two
 * former offenders. Moving it here turned that edge into an intra-directory import and
 * let the boundary rule be posted without an exception (`eslint.config.mjs`,
 * `KERNEL_APP_BOUNDARY`). `contracts/` was excluded (the `check-contracts-pure` gate
 * requires type-only) and `kernel/shared/` too (it hosts state and contracts, not
 * registries).
 *
 *
 * @example
 * ```typescript
 * // In a module's init():
 * CapabilityRegistry.register({
 *   id: 'table',
 *   gate: { configPath: 'modules.table.enabled' },
 *   loader: () => import('@geoleaf-plugins/table').then(() => void 0),
 * });
 *
 * // At runtime:
 * if (CapabilityRegistry.isEnabled('table', config)) {
 *   await CapabilityRegistry.ensureLoaded('table');
 * }
 * ```
 */
"use strict";

import type {
    ICapabilityConfigGate,
    ICapabilityDeclaration,
    ICapabilityInstallFacts,
    ICapabilityRegistry,
    ICapabilitySchema,
    ICapabilityStatus,
} from "../../contracts/capability.contract.ts";

// ─── Gate semantics (single source of truth) ──────────────────────────────────

/**
 * Evaluates a config gate — the ONE place the gate semantics live:
 *   - no gate            → enabled ;
 *   - key absent         → `enableWhenAbsent ?? false` (opt-in by default) ;
 *   - value `false`      → disabled ;
 *   - any other value    → enabled.
 *
 * Extracted from {@link CapabilityRegistry.isEnabled} (presets build, S2 Lot 6) so a
 * preset installer can gate its module on a **sub-key** of its capability's config
 * (`CapabilityInstaller.moduleGate` — e.g. `share` under `permalink`) with exactly the
 * same semantics, instead of an ad-hoc inline test in `boot.ts`.
 *
 * @param gate - the declared gate, or `undefined` for an ungated capability.
 * @param config - dotted-path config reader (see {@link toCapConfig}).
 */
export function evaluateGate(
    gate: ICapabilityConfigGate | undefined,
    config: { get(key: string, defaultValue?: unknown): unknown }
): boolean {
    if (!gate) return true;
    const val = config.get(gate.configPath, undefined);
    if (val === undefined) return gate.enableWhenAbsent ?? false;
    return val !== false;
}

// ─── Private state ────────────────────────────────────────────────────────────

/** Registered declarations, keyed by capability id. Preserves insertion order. */
const _declarations = new Map<string, ICapabilityDeclaration>();

/** IDs of capabilities whose loader has completed (or that have no loader). */
const _loaded = new Set<string>();

/**
 * Build-time facts of the preset installers, keyed by capability id (S9.4).
 *
 * Kept beside the declarations rather than merged into them: the runtime channel produces
 * declarations too, and it has no installer. **Absence from this map is the fact** that makes
 * `embarked: false` — it is not a missing value, it is the answer.
 */
const _installFacts = new Map<string, ICapabilityInstallFacts>();

// ─── CapabilityRegistry ───────────────────────────────────────────────────────

/**
 * Registry of in-core capabilities, keyed by name.
 *
 * Capabilities register themselves at boot; the registry is what {@link Introspection} reads
 * and what the config gates check a profile against. `_reset()` exists for tests only —
 * clearing it at runtime would leave mounted capabilities unreachable but still running.
 */
export const CapabilityRegistry: ICapabilityRegistry & { _reset(): void } = {
    register(decl: ICapabilityDeclaration): void {
        if (_declarations.has(decl.id)) return;
        _declarations.set(decl.id, decl);
    },

    isEnabled(id: string, config: { get(key: string, defaultValue?: unknown): unknown }): boolean {
        const decl = _declarations.get(id);
        if (!decl) return false;
        return evaluateGate(decl.gate, config);
    },

    isLoaded(id: string): boolean {
        return _loaded.has(id);
    },

    async ensureLoaded(id: string): Promise<void> {
        if (_loaded.has(id)) return;
        const decl = _declarations.get(id);
        if (decl?.loader) await decl.loader();
        _loaded.add(id);
    },

    getSchema(id: string): ICapabilitySchema | null {
        const decl = _declarations.get(id);
        if (!decl) return null;

        const { loader: _l, ...schema } = decl;
        return schema;
    },

    getAllSchemas(): readonly ICapabilitySchema[] {
        return [..._declarations.values()].map(({ loader: _l, ...schema }) => schema);
    },

    noteInstaller(id: string, facts: ICapabilityInstallFacts): void {
        _installFacts.set(id, facts);
    },

    getAllStatuses(config: {
        get(key: string, defaultValue?: unknown): unknown;
    }): readonly ICapabilityStatus[] {
        return [..._declarations.values()].map((decl) => {
            const facts = _installFacts.get(decl.id);
            return {
                id: decl.id,
                embarked: facts !== undefined,
                // Re-evaluated here, never stored: a frozen verdict would be the pre-merge one.
                enabled: evaluateGate(decl.gate, config),
                hasModule: facts?.hasModule ?? false,
                // Conditional spread: `exactOptionalPropertyTypes` rejects `gate: undefined` on
                // an optional field, and the distinction matters to the reader — an absent key
                // means "ungated", a present-but-undefined one would mean nothing at all.
                ...(decl.gate !== undefined && { gate: decl.gate }),
            };
        });
    },

    /** Resets internal state. For use in tests only. */
    _reset(): void {
        _declarations.clear();
        _loaded.clear();
        // Must be cleared with the rest: install facts surviving a reset would make `embarked`
        // depend on suite execution order, i.e. intermittent — and an intermittent test ends up
        // skipped.
        _installFacts.clear();
    },
};

/**
 * Adapts a plain (pre-merge) config object into the `{ get(path) }` shape expected
 * by {@link CapabilityRegistry.isEnabled}. The single reader every bundle entry uses
 * (via `bootWithPreset`), so the capability gate reads identically whatever set of
 * capabilities an entry composes — no inline gate, no duplicated dotted-path reducer.
 *
 * @param baseCfg - the raw config object (profile resources not yet merged).
 * @returns a config adapter resolving dotted keys (e.g. `modules.theme-selector.enabled`).
 */
export function toCapConfig(baseCfg: Record<string, unknown>): {
    get(key: string, defaultValue?: unknown): unknown;
} {
    return {
        get: (key: string, def: unknown = undefined): unknown => {
            const parts = key.split(".");
            return (
                parts.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], baseCfg) ?? def
            );
        },
    };
}
