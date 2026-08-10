/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public facade entry for the offline storage engine (`GeoLeaf.Storage`).
 *
 * @remarks
 * This is a **thin re-export** — the façade convention (one `geoleaf.*.ts` per
 * public surface) with no inline logic. The orchestration object and its
 * import-time side-effects (self-mount on `globalThis.GeoLeaf.Storage`,
 * `StorageContract.init`) live in `kernel/storage/facade.ts`.
 * Re-exporting evaluates that module, so the self-mount still runs at boot (B8,
 * pulled in by `globals.storage`).
 *
 * @see `kernel/storage/facade.ts`
 */
export { Storage } from "../kernel/storage/facade.js";
