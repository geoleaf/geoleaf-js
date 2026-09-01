/*!
 * GeoLeaf Storage — Offline-engine readiness gate
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { StorageContract } from "../shared/storage-contract.js";
import { coreConfigGet } from "@geoleaf/host-runtime";

/**
 * Gates a UI action on the in-core offline engine being ready to drive.
 *
 * The engine is loaded on demand (dynamic `import()`), at boot, only when
 * `modules.offline.enabled` AND its `modules.pwa` dependency are both on. This
 * helper resolves that three-state reality for the UI **without ever hanging**:
 *
 * - already initialised (IndexedDB open) → resolves `true` immediately;
 * - enabled but still loading → awaits `StorageContract.whenReady()`, then `true`;
 * - disabled (or `pwa` off) → resolves `false` at once, so the caller informs the
 *   user or no-ops instead of awaiting a promise that will never settle.
 *
 * Mirrors the exact gate of `OfflineLifecycle` (`offline.enabled ∧ pwa.enabled`)
 * so it waits only when the engine is actually going to load.
 *
 * @returns {Promise<boolean>} whether the engine is ready to be driven.
 */
export async function ensureEngineReady(): Promise<boolean> {
    if (StorageContract.isAvailable()) return true;
    // Explicit `<boolean>`: without it, TS infers the LITERAL TYPE `false` from
    // the default value, and judges `=== true` impossible (TS2367). The
    // comparison was thus flagged dead while the config can be `true` at
    // runtime.
    const offlineOn = coreConfigGet<boolean>("modules.offline.enabled", false) === true;
    const pwaOn = coreConfigGet<boolean>("modules.pwa.enabled", false) === true;
    if (!offlineOn || !pwaOn) return false;
    await StorageContract.whenReady();
    return true;
}
