/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B8 — Storage initialization (core-side services).
 *
 * This runtime initialization module registers the storage-related services that
 * live in the core. The offline UI on top of them is a separate plugin
 * (`@geoleaf-plugins/offline-ui`). Imported as a side-effect by `globals.ts`.
 *
 * Registers (core only):
 *   - `_OfflineDetector` — detects online/offline state transitions
 *   - `_SWRegister` — Service Worker registration wrapper
 *   - `Storage` — the in-core offline façade (S14 Phase B), self-mounted at import
 *
 * The heavy offline **engine** (IndexedDB / cache / download / sync) is the
 * `offline` capability (`capabilities/offline/`), loaded on demand via a dynamic
 * `import()` — off the boot path. The residual UI plugin (`@geoleaf-plugins/offline-ui`)
 * only drives the façade through `StorageContract`.
 *
 * @see globals for the orchestrator and import order
 */
import { OfflineDetector } from "../kernel/storage/offline-detector.js";
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";
// Side-effect + reference: the façade self-mounts `GeoLeaf.Storage` (+ StorageContract.init)
// at import time — so it is present at boot, before the residual UI plugin (which wires the
// engine into it) evaluates. Importing the binding also pins the module against tree-shaking.
import { Storage } from "../api/geoleaf.storage.js";

/**
 * B8 — storage services kept in the core: `_OfflineDetector`, `_SWRegister`,
 * and the `Storage` namespace stub (enriched by the Storage plugin at load
 * time). Re-callable; bound to the `shared` module lifecycle.
 *
 * Registered under the `"shared"` id. A build that does not import this file
 * leaves `SharedModule.init()` with no registered setup, and it no-ops cleanly.
 */
export function setupStorage(): void {
    const _gl = ensureGeoLeaf();
    _gl._OfflineDetector = OfflineDetector;
    // API S4.3 — `_SWRegister` retirée : aucun lecteur (son membre `_SWRegister?` dans
    // l'interface locale de `kernel/storage/facade.ts` ne l'était pas davantage).
    // Re-affirm the façade mount (idempotent — it self-mounts at import already). The
    // engine (DB/CacheManager/Cache) is injected later via `Storage.wireModules(...)`.
    _gl.Storage = Storage as unknown as NonNullable<typeof _gl.Storage>;
}

// ── PHASE A — see the rationale in `globals.config.ts`. ──────────────────────────────────────
//
// (The id/name mismatch is gone with the indirection: this setup used to be registered under the
// `"shared"` id — not `"storage"` — because `SharedModule` drove it. Nothing to reconcile now.)
setupStorage();
