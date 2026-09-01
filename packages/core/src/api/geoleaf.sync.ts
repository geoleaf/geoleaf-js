/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description In-core public façade `GeoLeaf.Sync` (S14 Phase B) — thin delegate to the
 * {@link SyncHandlerContract} registry seam.
 *
 * Data plugins that own an offline sync flow register their handler here at their own
 * `entry.ts` (e.g. editor: `GeoLeaf.Sync.registerHandler("poi", EditorSyncHandler)`); the
 * offline engine reads them back (`getHandler`, one id at a time) at replay time. This
 * inverts the former build-time coupling engine→`addpoi` (historical: that plugin merged
 * into `editor` at the S5 — the name is kept because the coupling really was with it) so
 * the engine can live in-core
 * (B3) without breaching `no-plugin-in-core`.
 *
 * Self-mounts on `globalThis.GeoLeaf.Sync` at import so a plugin can register at its own
 * eval — before the core boot completes.
 */

import { SyncHandlerContract, type SyncHandler } from "../kernel/shared/sync-handler-seam.js";
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";

/** Public façade — mounted on `GeoLeaf.Sync`; all state lives in `SyncHandlerContract`. */
export const Sync = {
    /** Register (or replace) an offline sync handler under a stable id (e.g. `"poi"`). */
    registerHandler(id: string, handler: SyncHandler): void {
        SyncHandlerContract.registerHandler(id, handler);
    },
    /** @returns the handler registered under `id`, or `undefined`. */
    getHandler(id: string): SyncHandler | undefined {
        return SyncHandlerContract.getHandler(id);
    },
    // BREAKING (3.1.0, 25/08/2026, pre-adoption window of VERSIONING_POLICY.md): the
    // plural accessor `getHandlers()` was removed from this façade and from the seam. It was
    // introspection-only — the replay path resolves handlers one at a time via `getHandler` —
    // its ten call sites all lived under __tests__/ with the member as their own oracle, the
    // one measured consumer manifest never named it, and keeping it pinned a registration-
    // order promise nothing needed. Registration and by-id lookup are the whole contract.
};

// Self-mount at import (present at boot, before any plugin evaluates). No cast: `Sync` is
// declared on `GeoLeafGlobal` since B.25 — it used to land in the `unknown` tail, which is
// why this line carried an `as unknown as typeof _gl.Sync` that asserted nothing.
const _gl = ensureGeoLeaf();
_gl.Sync = Sync;
