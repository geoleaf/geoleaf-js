/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description In-core registry seam for **offline sync handlers** (S14 Phase B).
 *
 * The offline engine (`capabilities/offline/sync`) replays queued operations by
 * iterating the handlers registered here — it never imports a plugin. Each
 * data plugin that owns an offline sync flow (e.g. `@geoleaf-plugins/editor` for POIs)
 * **pushes** its handler at its own `entry.ts` via `GeoLeaf.Sync.registerHandler(id, …)`.
 * This inverts the former build-time coupling (Rollup rewrote a relative import of the
 * engine's `sync-manager` into `addpoi`'s `POISyncHandler` — historical, that plugin has
 * since merged into `editor`), which would violate
 * `no-plugin-in-core` once the engine moves in-core (B3).
 *
 * Mirrors the {@link StorageContract} seam pattern: a tiny, dependency-free registry
 * that lives in the core and is read by both sides at runtime.
 */

import type { SyncHandler } from "../../contracts/sync.contract.js";

/**
 * Shape of an offline sync handler.
 *
 * ✅ **Declared ONCE, in `contracts/sync.contract.ts`.** It lived here AND in
 * `offline-ui/src/core/sync-seam.ts` — two declarations of the same contract,
 * which lied in concert about `restoreBackup(backupId: string)` — a member removed
 * from the contract along with the backup chain. The full motive is on the type,
 * not here: this file carries the REGISTRY, the contract carries the SHAPE.
 */
export type { SyncHandler };

/** Registered handlers, keyed by a stable id (e.g. `"poi"`). Insertion order preserved. */
const _handlers = new Map<string, SyncHandler>();

/** In-core registry of offline sync handlers. Read by the offline engine at replay time. */
export const SyncHandlerContract = {
    /**
     * Register (or replace) a sync handler under `id`. Called by data plugins at load
     * (e.g. editor: `registerHandler("poi", EditorSyncHandler)`). No-op for falsy inputs.
     */
    registerHandler(id: string, handler: SyncHandler): void {
        if (id && handler) _handlers.set(id, handler);
    },

    /** @returns the handler registered under `id`, or `undefined`. */
    getHandler(id: string): SyncHandler | undefined {
        return _handlers.get(id);
    },

    /** Test seam: clear all registered handlers. */
    _reset(): void {
        _handlers.clear();
    },
};
