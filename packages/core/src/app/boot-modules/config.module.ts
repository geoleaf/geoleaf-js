/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ConfigModule — `ICoreModule` wrapper for the configuration subsystem.
 *
 * Represents: `GeoLeaf.Config`, `GeoLeaf.Helpers`, `GeoLeaf.Validators`,
 * `GeoLeaf.Renderers` (abstract + simple-text), `GeoLeaf.Data`.
 * Underlying globals: `globals.config.ts` (B3 + B4).
 *
 * Sprint 3: stub wrapper — initialization already performed as a side-effect
 * of the `globals.ts` import in the bundle entry point.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import { ProfileManager } from "../../kernel/config/profile.js";

/**
 * Represents the GeoLeaf configuration subsystem: helpers, validators,
 * renderers, data normalizers, and the Config singleton.
 *
 * Kept by Lot 6 (unlike `security`/`api`) for its teardown: four modules depend on it, and its
 * `destroy()` carries real work — even though its `init()` no longer does.
 */
export class ConfigModule implements ILifecycleModule {
    readonly id = "config" as const;
    // S6 Lot 6: the `security` edge is pruned with SecurityModule. It only ever ordered two
    // facade setups against each other — and that ordering now lives where it belongs, in the
    // ESM import chain of `globals.ts` (core before config).
    readonly dependencies = [] as const;

    init(): void {
        // Nothing to do at runtime — the Config facades are posted at IMPORT by phase A
        // (`globals.config.ts`). They HAVE to be: `boot-core.ts` calls `loadConfig()`, which
        // needs `GeoLeaf.Config.init`, before `registry.init()` reaches this module. The
        // `ICoreModule` contract requires both hooks, so this stays as an explicit no-op.
    }

    destroy(): void {
        // Clear the active-profile state so a recreate does not keep a stale profile. The
        // Config singleton wiring itself is a foundation reference (preserved) — it was posted
        // at import and is never removed, so there is nothing to re-arm.
        ProfileManager.reset();
    }
}
