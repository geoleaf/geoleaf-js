/*!
 * GeoLeaf Core – Introspection / Public Facade implementation
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Implementation of the read-only `GeoLeaf.Introspection` surface: lets Studio plugins
 * and form builders enumerate active modules and capabilities, and read their declared
 * schemas, without coupling to the internal registries.
 *
 * Split rationale (S13.1): moved out of `modules/geoleaf.introspection.ts`, which is a
 * public facade and must carry no logic (ARCHITECTURE.md §"Façades publiques"). The
 * `_registry` lookup below is that logic.
 *
 * ## Three seams, deliberately kept different
 *
 * The five methods are not homogeneous, and that is intentional — the S13.1 move was
 * iso-behaviour and did not unify them:
 *
 *  - **module queries** go through the late-bound `_registry` lookup, so they degrade
 *    to `null` / `[]` before boot completes (`app/boot-install.ts` writes it);
 *  - **capability queries** delegate straight to `CapabilityRegistry`, which is
 *    populated at declaration time and needs no pre-boot tolerance;
 *  - **the status query** (`getCapabilityStatus`, socle-init S9.4) delegates to
 *    `CapabilityRegistry` like the pair above, but hands it a late-bound config reader.
 *    It does not unify the first two seams — it composes a third, because "is it switched
 *    on?" is the only question here that needs both a registry and a config.
 *
 * Routing the capability pair through a `_registry`-like seam would be an internal API
 * redesign wearing a facade conformation's clothes, and the 12 capability tests depend
 * on the direct delegation (they call `CapabilityRegistry._reset()` then read back
 * through `Introspection`).
 *
 * ⚠️ This module holds the `kernel/ → app/` import that the S13.4 boundary study
 * records. It was not introduced here: it moved verbatim from the facade. The study's
 * conclusion is that `CapabilityRegistry` is misplaced rather than the boundary porous
 * — relocating it is deferred to S14, which rules on directory placement.
 *
 * No top-level side effect: the global mount belongs to `globals/globals.api.ts`.
 */

import type {
    ICapabilitySchema,
    ICapabilityStatus,
    IIntrospectionAPI,
    IModuleInfo,
    IModuleSchema,
} from "../../contracts/introspection.contract.js";
import { CapabilityRegistry } from "../api/capability-registry.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";

/** Narrow view of the internal `_registry` for introspection calls. */
interface RegistryLike {
    getModuleSchema(id: string): IModuleSchema | null;
    getActiveModules(): readonly IModuleInfo[];
}

/** Dotted-path config reader — the shape `evaluateGate()` expects. */
interface CapConfigReader {
    get(key: string, defaultValue?: unknown): unknown;
}

/**
 * "Nothing is configured" — the pre-boot degradation, symmetrical to the `?? []` below.
 * Every gate then answers its own `enableWhenAbsent`, which is the truthful verdict rather
 * than a fallback: before boot, no key is set.
 */
const _NO_CONFIG: CapConfigReader = { get: (_key, defaultValue) => defaultValue };

function _registry(): RegistryLike | undefined {
    return (ensureGeoLeaf() as { _registry?: RegistryLike })._registry;
}

/**
 * Reads the config namespace **on every call**, never captured.
 *
 * `loadActiveProfileResources()` enriches the config object in place, so a reader captured
 * once would keep answering the pre-merge verdict — the very lie socle-init 9.2 removed from
 * the module gate.
 */
function _config(): CapConfigReader {
    return (ensureGeoLeaf() as { Config?: CapConfigReader }).Config ?? _NO_CONFIG;
}

/**
 * The `GeoLeaf.Introspection` façade — reading what is registered, at runtime.
 *
 * Reports capabilities, plugins and their config schemas as the registry actually holds them,
 * rather than as a profile declared them. That difference is the point: it answers "what is
 * mounted", not "what was asked for".
 */
export const Introspection: IIntrospectionAPI = {
    getModuleSchema(id: string): IModuleSchema | null {
        return _registry()?.getModuleSchema(id) ?? null;
    },

    getActiveModules(): readonly IModuleInfo[] {
        return _registry()?.getActiveModules() ?? [];
    },

    getCapabilitySchema(id: string): ICapabilitySchema | null {
        return CapabilityRegistry.getSchema(id);
    },

    getAllCapabilities(): readonly ICapabilitySchema[] {
        return CapabilityRegistry.getAllSchemas();
    },

    getCapabilityStatus(): readonly ICapabilityStatus[] {
        return CapabilityRegistry.getAllStatuses(_config());
    },
};
