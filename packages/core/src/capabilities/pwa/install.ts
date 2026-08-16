/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `pwa` capability — presets build (S2 Lot 7).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to
 * embark PWA. Carries the layer-B write moved out of `globals.api.ts` (`assignApiFacades`).
 *
 * **No `createModule`** — like `cluster`, PWA owns no `ICoreModule`: it is app-global, and
 * its `PwaLifecycle` (service-worker registration + install prompt) must run on the MERGED
 * config (`modules.pwa.enabled`, opt-in). It is therefore driven by `shared.module` step #7,
 * expressed here as {@link CapabilityInstaller.sharedLifecycle} (S4).
 *
 * Until S4, `shared.module.ts` reached the lifecycle by **importing it statically** — a kernel
 * module hard-wired to an optional capability, which pinned PWA into the eager closure of every
 * bundle regardless of its manifest. The dependency is now inverted: `SharedModule` receives the
 * entry's installers and calls whoever contributed. An entry without PWA has no contributor, and
 * PWA tree-shakes out.
 *
 * ⚠ **Position in the manifest is FREE** — and this line said the opposite until 08/08/2026.
 * It read: « Position in the manifest is load-bearing: PWA must come BEFORE `offline`, whose
 * lifecycle (#8) reads `modules.pwa.enabled` and will not start its engine without it. » The
 * second half is true and stays true; the *conclusion* does not follow from it. `offline` reads
 * that flag from the **merged config bag** `SharedModule` hands it, not from anything this
 * lifecycle posts — and the one effect PWA would produce first, the service-worker registration,
 * is deferred by `Helpers.lazyExecute` anyway, so it has not happened when #8 runs.
 *
 * Measured by `__tests__/presets/shared-lifecycle-order.test.ts` (socle-init 7.4): inverting the
 * two changes nothing observable, in all four `{pwa} × {offline}` config cells. What holds the
 * dependency is the GATE, and the gate is a condition — not a position.
 */

import type {
    CapabilityInstaller,
    SharedLifecycleContext,
} from "../../contracts/preset.contract.js";
import { PWA_CAPABILITY } from "./pwa-capability.js";
import { PWA } from "../../api/geoleaf.pwa.js";
import { PwaLifecycle } from "./lifecycle.js";
import type { PWAConfig } from "./pwa-manager.js";

/** Shape of the `modules.pwa` config branch this installer reads — derived, not redeclared. */
type PwaModuleConfig = Pick<PWAConfig, "enabled" | "installPrompt" | "offlineDetector">;

/** Self-sufficient installer for the PWA capability (service worker + install prompt). */
export const PWA_INSTALLER: CapabilityInstaller = {
    declaration: PWA_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11).
        gl.PWA = PWA;
    },

    // #7 — PWA capability (S14 Phase A): unified SW registration + install prompt, gated
    // opt-in on `modules.pwa.enabled` (pull-based, post-merge — `modules.pwa` is app-global).
    // Disabled → no SW registered; any residual SW is unregistered. Moved verbatim out of
    // `shared.module.ts` (S4) — same call, same merged config, same position in the sequence.
    sharedLifecycle(ctx: SharedLifecycleContext): void {
        PwaLifecycle.init(ctx.config.modules?.pwa as PwaModuleConfig | undefined);
    },

    // Mirror of #7 — resets the lifecycle's module-level state so a recreate() re-inits
    // from a clean slate instead of re-running over the previous cycle's state.
    sharedTeardown(): void {
        PwaLifecycle._reset();
    },
};
