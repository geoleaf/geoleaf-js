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

import { Log } from "../../utils/log/index.js";

import type {
    ICapabilityConfigGate,
    ICapabilityDeclaration,
    ICapabilityInstallFacts,
    ICapabilityRegistry,
    ICapabilitySchema,
    ICapabilityStatus,
} from "../../contracts/capability.contract.ts";
import { Capabilities, declareUnavailable } from "./unavailable-capabilities.js";

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

/**
 * Confronts a capability's config block with the schema that capability declares, and returns
 * the keys the schema does not know about.
 *
 * ## Why this exists
 *
 * `configSchema` is declared by twenty in-core capabilities and reads like a validation
 * contract. It was not one: nothing in the runtime ever compared a declared schema with the
 * values it received, so a profile key outside the schema — a typo, a renamed option, a key
 * copied from another capability — was silently ignored. The declaration had every appearance
 * of a validation chain without being one, which is worse than having none: a reader trusts it.
 *
 * The surrounding machinery reinforced the illusion. A documentation guard already compares
 * each capability's `## Configuration` table with its `configSchema`, in both directions — but
 * that guards **documentation against declaration**, never **declaration against the value
 * actually received**.
 *
 * ## What it does NOT do, deliberately
 *
 * It never throws and never changes what is enabled. An unknown key is a diagnostic, not a
 * failure: this package is published, and turning a silently-ignored key into a boot failure
 * would break integrators whose profiles are working today. Types are not checked either —
 * only the presence of a key the schema does not declare. Type checking would need a decision
 * about coercion (a numeric string, an array where an object is expected) that no caller has
 * asked for yet, and a half-checked type reads as a full one.
 *
 * ## What it refuses to guess
 *
 * The config block is the parent of the gate path, which is `modules.<id>` for every
 * declaration. A gate aimed at a **sub-key** — the shape a preset installer uses to gate a
 * module on one field of its capability's config — does not tell us where the block starts, so
 * such a declaration is skipped rather than confronted against a block that may not be its own.
 * Keys starting with `_` are comment conventions and are never reported.
 *
 * ## Why it is not exported
 *
 * `isEnabled` is its only caller, and no consumer has asked for the report on its own. An
 * exported helper that nothing outside imports would enter the published surface — where a
 * name, once there, cannot be taken back without a breaking change — and would read as an
 * offer that was never made. Its behaviour is covered through `isEnabled`, which is the
 * surface that actually exists.
 *
 * @param decl - The capability declaration, with its gate and its declared schema.
 * @param config - Dotted-path config reader (see {@link toCapConfig}).
 * @returns The config keys absent from the declared schema, in config order. Empty when the
 *          capability declares no schema, no gate, a sub-key gate, or no config block at all.
 */
function unknownConfigKeys(
    decl: ICapabilityDeclaration,
    config: { get(key: string, defaultValue?: unknown): unknown }
): string[] {
    if (!decl.configSchema || !decl.gate) return [];

    const parts = decl.gate.configPath.split(".");
    const block = parts.slice(0, -1).join(".");
    if (block !== `modules.${decl.id}`) return [];

    const value = config.get(block, undefined);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];

    const known = new Set(Object.keys(decl.configSchema));
    return Object.keys(value as Record<string, unknown>).filter(
        (key) => !known.has(key) && !key.startsWith("_")
    );
}

// ─── Private state ────────────────────────────────────────────────────────────

/** Registered declarations, keyed by capability id. Preserves insertion order. */
const _declarations = new Map<string, ICapabilityDeclaration>();

/** IDs of capabilities whose loader has completed (or that have no loader). */
const _loaded = new Set<string>();

/**
 * IDs whose config block has already been confronted with its schema.
 *
 * The gate is evaluated more than once per session — a capability can be asked about again
 * after a profile switch — and a diagnostic repeated on every read stops being read. Cleared
 * by `_reset()` along with the declarations, so a test that re-registers gets the report again
 * rather than inheriting the silence of the previous one.
 */
const _configConfronted = new Set<string>();

/**
 * Build-time facts of the preset installers, keyed by capability id.
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

        // The one point where a declaration meets the config it was written for. Reporting
        // here rather than at registration is what makes the report possible at all: at
        // registration there is no config to compare against.
        if (!_configConfronted.has(id)) {
            _configConfronted.add(id);
            const unknown = unknownConfigKeys(decl, config);
            if (unknown.length > 0) {
                Log.warn(
                    `[CapabilityRegistry] ${id}: ${unknown.length} config key(s) outside the ` +
                        `declared schema — ${unknown.join(", ")}. They are read by nothing and ` +
                        `have no effect. Check for a typo, or for an option that moved.`
                );
            }
        }

        return evaluateGate(decl.gate, config);
    },

    isLoaded(id: string): boolean {
        return _loaded.has(id);
    },

    async ensureLoaded(id: string): Promise<void> {
        if (_loaded.has(id)) return;
        const decl = _declarations.get(id);

        // 🛑 An id nobody declared used to resolve in silence AND be recorded as loaded, so
        // `isLoaded(id)` then affirmed the opposite of the truth. That is the one shape a
        // caller cannot recover from: it is not "no answer", it is a wrong answer. Both
        // halves are fixed here — the fact is declared, and the lie is not written.
        //
        // The live case is a REDUCED BUNDLE: `capabilities/offline/lifecycle.ts` calls
        // `ensureLoaded("offline")` from shared module #8 whenever the profile enables
        // `pwa` + `offline`. An entry that does not embark the offline capability loads
        // nothing, and `Storage.init()` then ran against an engine that was never there.
        if (!decl) {
            declareUnavailable(
                id,
                "no capability with this id is registered — the bundle does not embark it, " +
                    "or the plugin that provides it never loaded"
            );
            return;
        }

        if (decl.loader) await decl.loader();
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
        // The unavailable-facts bus is reset with the rest: a fact declared by one suite
        // would otherwise survive into the next and be REPLAYED to its subscribers, making
        // a listener assertion depend on suite order — i.e. intermittent, i.e. skipped.
        Capabilities._reset();
        // Must be cleared with the rest: install facts surviving a reset would make `embarked`
        // depend on suite execution order, i.e. intermittent — and an intermittent test ends up
        // skipped.
        _installFacts.clear();
        _configConfronted.clear();
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
