/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier — MIT License
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Runtime seam to the POI offline sync handler (S14 Phase B).
 *
 * Before B2 the offline `sync-manager` imported addpoi's `POISyncHandler` through a
 * build-time Rollup path rewrite (`../poi/sync-handler.js` → plugin-addpoi). That coupling
 * cannot survive the engine moving in-core (B3, `no-plugin-in-core`). Instead, addpoi now
 * **registers** its handler on the in-core `GeoLeaf.Sync` seam
 * (`registerHandler("poi", POISyncHandler)`), and consumers read it back here at call time.
 *
 * 🛑 **The handler's shape is NO LONGER declared here.** It was, and its core
 * twin (`kernel/shared/sync-handler-seam.ts`) declared it too: two declarations
 * of one contract, which **lied in concert** about
 * `restoreBackup(backupId: string)` while `sync_backups` is an `autoIncrement`
 * store. The typecheck came out green on both sides for a call that never found
 * anything — the duplicate's own failure mode: the two copies do not diverge
 * loudly, they agree and go wrong together.
 *
 * ⚠️ **The account above correctly describes the 02/08 state and is not
 * rewritten** — that is what gives it its value. But its subject no longer
 * exists: `restoreBackup` and the `sync_backups` store are removed, with the
 * whole backup chain.
 *
 * The import is `type`-only, through the published subpath with no `import`
 * condition: it is **erased at build**, this package gains no runtime dependency
 * on the core, and the bundle does not move.
 */
import type { SyncHandler } from "@geoleaf/core/contracts/sync.contract.js";

interface GeoLeafSyncGlobal {
    GeoLeaf?: { Sync?: { getHandler?(id: string): SyncHandler | undefined } };
}

/**
 * Runtime accessor for the POI offline sync handler, whichever plugin registered it.
 *
 * ⚠️ It named one registrant until the 19/08/2026, and that plugin is gone while the seam
 * still has a registrant. The seam is keyed by handler id precisely so it never needs to
 * know: documenting it by its current filler is what made it look dead.
 *
 * @returns the handler, or `undefined` when no plugin has registered one.
 */
export function getPoiSyncHandler(): SyncHandler | undefined {
    const g = globalThis as unknown as GeoLeafSyncGlobal;
    return g.GeoLeaf?.Sync?.getHandler?.("poi");
}
