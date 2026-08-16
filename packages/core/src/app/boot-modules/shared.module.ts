/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * SharedModule — `ICoreModule` wrapper for the shared inter-module state.
 *
 * S1.2: owns pre-map orchestration — i18n init (#1), plugin check (#4), then the
 * app-global capability lifecycles (#7 pwa → #8 offline).
 *
 * ⚠ **This kernel module must never import a capability.** Until S4 it statically
 * imported `PwaLifecycle` and `OfflineLifecycle`, which pinned both capabilities into
 * the eager closure of *every* bundle — no entry could ever drop them, whatever its
 * manifest said. That was the anchor blocking tree-shaking.
 *
 * The dependency is now **inverted**: the module receives the entry's
 * {@link CapabilityInstaller} list and calls each `sharedLifecycle?.()` in manifest order.
 * An entry that omits `pwa` contributes no lifecycle, imports no lifecycle, and the
 * capability drops out of its bundle. Reintroducing a `capabilities/*` import here would
 * silently undo that — do not.
 *
 * Order is the manifest's. ⚠ **It is NOT load-bearing between `pwa` and `offline`** — this line
 * said it was until 08/08/2026 (« Order is the manifest's, and it is load-bearing: `pwa` (#7)
 * must precede `offline` (#8), which reads `modules.pwa.enabled` »), and socle-init 7.4 measured
 * the opposite: `__tests__/presets/shared-lifecycle-order.test.ts` inverts the pair and observes
 * an identical set of effects, in all four config cells, plus the same under seeded permutations
 * of every `sharedLifecycle` contributor (SLO-08).
 *
 * What the deleted clause got right is the half that survives, and it is the reason the coupling
 * looks ordinal without being it: the config passed through is the **merged** one (`shared` runs
 * after the profile resources load), so these lifecycles gate post-merge. `offline` reads
 * `modules.pwa.enabled` out of THAT bag — a condition, available to it whatever its rank.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { initI18n } from "../../utils/i18n/i18n.js";
import { asGeoLeafConfig, type AppNamespace } from "../app-types.js";

/**
 * Represents the GeoLeaf shared state plus pre-map runtime setup.
 * Runs after `security` (sanitization) and `config` (profile data).
 */
export class SharedModule implements ILifecycleModule {
    readonly id = "shared" as const;
    // S6 Lot 6: `security` pruned with SecurityModule (facade-only, ordered by the ESM chain).
    readonly dependencies = ["config"] as const;

    /** The active entry's capability installers — the only source of app-global lifecycles. */
    private readonly _installers: readonly CapabilityInstaller[];

    /**
     * @param installers - the active entry's capability installers, in manifest order.
     *   Defaults to `[]` for direct-instantiation test seams that run no capability
     *   lifecycle (production always passes the entry's manifest via `startApp`/`ModuleRegistry`).
     */
    constructor(installers: readonly CapabilityInstaller[] = []) {
        this._installers = installers;
    }

    init(_adapter: IMapAdapter, config: IGeoLeafConfig): void {
        // (Phase A posts the storage facades at import — `globals.storage.ts`, registered under
        // the `shared` id. What follows needs the MERGED config, so it stays here.)
        const GeoLeaf = ensureGeoLeaf();
        const _app = (GeoLeaf._app ?? {}) as AppNamespace;
        const cfg = asGeoLeafConfig(config);

        // #1 — i18n init: load locale strings before any UI or notification uses them.
        initI18n();

        // #4 — Plugin check: warn about missing plugins referenced by the profile config.
        _app.checkPlugins(cfg);

        // #7/#8 — app-global capability lifecycles (pwa, then offline), in manifest order.
        // Each installer that declares one contributes it; the kernel knows none of them.
        for (const inst of this._installers) {
            inst.sharedLifecycle?.({ GeoLeaf, config: cfg });
        }
    }

    destroy(): void {
        // Mirror of init()'s #7/#8 loop, in reverse manifest order (offline, then pwa):
        // each contributed lifecycle resets its own module-level state. Without this the
        // next create() would re-run the lifecycle over stale state.
        for (let i = this._installers.length - 1; i >= 0; i--) {
            this._installers[i]?.sharedTeardown?.();
        }
    }
}
