/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `offline` capability — presets build (S2 Lot 7).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to
 * embark Offline. Carries the layer-B write moved out of `globals.api.ts`.
 *
 * 🖐 **No `public-api.ts`, and the motive holds — but it was badly written until
 * 20/08/2026.** The sentence said "mounts no namespace": false to the letter,
 * `registerGlobals` writes `gl.Sync`. What is true, and is the real motive: the
 * mounted symbol comes from `api/geoleaf.sync.ts`, hence from the CORE's surface —
 * this capability **re-assigns a singleton it does not own**. `GeoLeaf.Storage`
 * likewise, carried by `kernel/storage/facade.ts`. Without a surface of its own, a
 * `public-api.ts` would be a mere shell, and a gate satisfied by a shell guards
 * nothing.
 *
 * ⚠️ The distinction is not cosmetic: "mounts nothing" is checked with one grep and
 * found false; "mounts what belongs to another" requires looking at where the symbol
 * comes from, and that is what decides.
 *
 * ⚠️ **What would reopen the question**: the day this capability exposes something
 * directly on `GeoLeaf.*`. That is what must be re-measured before concluding, not
 * the file's presence.
 *
 * **No `createModule`** — `OfflineLifecycle` is app-global and gates post-merge on
 * `modules.offline.enabled` AND `modules.pwa.enabled`. It runs as `shared.module` step #8,
 * expressed here as {@link CapabilityInstaller.sharedLifecycle} (S4). Until then
 * `shared.module.ts` imported the lifecycle statically — a kernel module hard-wired to an
 * optional capability, pinning Offline into every bundle's eager closure. The dependency is
 * now inverted: an entry without Offline contributes nothing, and the capability drops out.
 *
 * ⚠ **Position in the manifest is FREE.** It reads `modules.pwa.enabled` and will not start its
 * engine without it — that GATE is real and is what the dependency rests on. But the flag comes
 * from the **merged config bag** `SharedModule` passes in, not from a state `PwaLifecycle` posts,
 * so the *order* carries nothing. This line claimed « Position in the manifest is load-bearing:
 * Offline must come AFTER `pwa` (#7 → #8) » until 08/08/2026; socle-init 7.4 measured it false
 * (`__tests__/presets/shared-lifecycle-order.test.ts`, SLO-01..04 across the four config cells,
 * SLO-05 for the gate that does hold).
 *
 * **The engine is NOT imported here.** Those ~9 000 LOC are loaded on demand through the
 * DECLARATION's `loader` (`offline-capability.ts`, reached via
 * `CapabilityRegistry.ensureLoaded("offline")` from the lifecycle) — the only wired path.
 * ⚠ This file must therefore NEVER statically import the engine (`offline-engine-entry.js`,
 * `offline/{core,db,cache,poi-restore}`): that would drag them into the eager boot closure
 * and break both `frontier.guard.test.js` and the size budget. `lifecycle.js` (imported below)
 * reaches the engine only through that dynamic `import()`.
 *
 * ⚠ **`geoleaf.sync.ts` self-mounts `GeoLeaf.Sync` at import** (so a data plugin can register
 * its sync handler at its own eval, before the core boot completes). Its ONLY static importer
 * in the shipped bundle is this file. The import below is what keeps that module — and therefore
 * the self-mount — inside the closure; `registerGlobals` re-assigns the same singleton
 * (idempotent, and the surviving path for the golden master).
 */

import type {
    CapabilityInstaller,
    SharedLifecycleContext,
} from "../../contracts/preset.contract.js";
import { OFFLINE_CAPABILITY } from "./offline-capability.js";
import { Sync } from "../../api/geoleaf.sync.js";
import { OfflineLifecycle } from "./lifecycle.js";
import { asObject } from "../../utils/general/type-guards.js";

/** Self-sufficient installer for the Offline capability (IndexedDB engine, loaded on demand). */
export const OFFLINE_INSTALLER: CapabilityInstaller = {
    declaration: OFFLINE_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11). `Sync` is the
        // registry seam that a DATA plugin pushes its offline sync handler into; the engine
        // reads them back at replay time. The seam is keyed by handler id, so it never needs
        // to know which plugin registered — naming one here would only date the comment.
        gl.Sync = Sync;
    },

    // #8 — Offline capability lifecycle (S14 Phase B): when `modules.offline.enabled` AND
    // `modules.pwa.enabled`, load the engine on demand (dynamic `import()` via
    // `ensureLoaded("offline")`) then init it; else start the core-mode connectivity badge.
    // Post-merge; the detector toggle lives under `modules.pwa`. Moved verbatim out of
    // `shared.module.ts` (S4) — same call, same merged config, same position in the sequence.
    sharedLifecycle(ctx: SharedLifecycleContext): void {
        const { GeoLeaf, config } = ctx;
        const pwaCfg = asObject(config.modules?.pwa) ?? {};
        const offlineCfg = asObject(config.modules?.offline) ?? {};
        const detector = asObject(pwaCfg.offlineDetector) ?? {};
        const cacheCfg = asObject(offlineCfg.cache);
        OfflineLifecycle.init(
            { storage: GeoLeaf.Storage, offlineDetector: GeoLeaf._OfflineDetector },
            {
                enabled: offlineCfg.enabled === true,
                pwaEnabled: pwaCfg.enabled === true,
                ...(cacheCfg && { cache: cacheCfg }),
                offlineDetectorEnabled: detector.enabled === true,
                // Forwarded RAW: `parseDataOrigins` is the only place allowed to
                // decide what a valid declaration is. Normalising here would make a
                // second authority, and the second authority drifts.
                dataOrigins: offlineCfg.dataOrigins,
            }
        );
    },

    // Mirror of #8 — runs before pwa's teardown (reverse manifest order).
    //
    // ⚠ The FACT (reverse order) is real and is asserted by `s15-modules-storage-init.test.js`.
    // The CAUSALITY this comment used to give for it was not: it read « …, so the offline engine
    // releases the storage-ready contract before pwa unwinds the SW registration » until
    // 08/08/2026. `OfflineLifecycle._reset()` and `PwaLifecycle._reset()` do not read each other,
    // and SLO-06 measured the teardown invariant under both orders. Kept as-is because moving it
    // buys nothing — not because moving it would break anything.
    sharedTeardown(): void {
        OfflineLifecycle._reset();
    },
};
