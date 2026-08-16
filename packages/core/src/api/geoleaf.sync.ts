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
 * `entry.ts` (e.g. addpoi: `GeoLeaf.Sync.registerHandler("poi", POISyncHandler)`); the
 * offline engine reads them back (`getHandler`/`getHandlers`) at replay time. This
 * inverts the former build-time coupling engine→addpoi so the engine can live in-core
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
    /** @returns every registered handler (registration order). */
    getHandlers(): SyncHandler[] {
        return SyncHandlerContract.getHandlers();
    },
};

// Self-mount at import (present at boot, before any plugin evaluates). No cast: `Sync` is
// declared on `GeoLeafGlobal` since B.25 — it used to land in the `unknown` tail, which is
// why this line carried an `as unknown as typeof _gl.Sync` that asserted nothing.
const _gl = ensureGeoLeaf();
_gl.Sync = Sync;
