/*!
 * GeoLeaf Core – Introspection / Public Facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Introspection` facade — lets studio plugins and form-builders
 * enumerate active modules and read their declared schemas without coupling to
 * the internal `ModuleRegistry`.
 *
 * Available after `GeoLeaf.boot()` completes (registry is fully initialised).
 * Safe to call before boot — returns `null` / empty array as graceful fallback.
 *
 * @remarks
 * **Thin re-export** — no inline logic (pattern A, ARCHITECTURE.md §"Façades
 * publiques"; enforced by `scripts/check-facade-purity.cjs`). The `_registry` seam and
 * the `CapabilityRegistry` delegation live in
 * `kernel/introspection/facade.ts`.
 *
 * @example
 * ```ts
 * const modules = GeoLeaf.Introspection.getActiveModules();
 * // [{ id: 'poi', dependencies: ['shared'], hasUI: true }, ...]
 *
 * const schema = GeoLeaf.Introspection.getModuleSchema('poi');
 * // { id: 'poi', dependencies: ['shared'], hasUI: true }
 *
 * const missing = GeoLeaf.Introspection.getModuleSchema('unknown');
 * // null
 * ```
 *
 * @see `kernel/introspection/facade.ts` — implementation
 */
export { Introspection } from "../kernel/introspection/facade.js";
