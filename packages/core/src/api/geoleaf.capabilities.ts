/*!
 * GeoLeaf Core – Capabilities / Public Facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public `GeoLeaf.Capabilities` facade — how an integrator learns that a
 * capability it needed was not there, instead of reading a log line.
 *
 * Two members, and the shape is **frozen**: public API on a published major, which `I4`
 * forbids removing or deprecating.
 *
 * - `declareUnavailable(id, motif)` records the fact and notifies subscribers.
 * - `onUnavailable(cb)` subscribes, and **replays** what is already recorded — subscribing
 *   after `GeoLeaf.boot()` therefore loses nothing.
 *
 * @remarks
 * **Thin re-export** — no inline logic (pattern A, enforced by
 * `scripts/check-facade-purity.cjs`). The bus, and the measurement explaining why it is a
 * bus rather than a boot-time detector, live in `kernel/api/unavailable-capabilities.ts`.
 *
 * @example
 * ```ts
 * // The namespace is set at bundle IMPORT time, but `GeoLeaf` stays `| undefined` for the
 * // compiler: optional chaining is the copy-pastable form that type-checks.
 * const off = GeoLeaf?.Capabilities?.onUnavailable(({ id, motif }) => {
 *     console.warn(`no ${id}: ${motif}`);
 * });
 * off?.();
 * ```
 *
 * @see `kernel/api/unavailable-capabilities.ts` — implementation
 */
export { Capabilities } from "../kernel/api/unavailable-capabilities.js";
