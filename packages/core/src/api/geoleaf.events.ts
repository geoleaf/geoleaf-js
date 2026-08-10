/*!
 * GeoLeaf Core – Events / Public Facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public facade entry for the GeoLeaf event subscription API — exposed as
 * `GeoLeaf.Events` (canonical) and `GeoLeaf.events` (legacy alias).
 *
 * @remarks
 * **Thin re-export** — one `geoleaf.*.ts` per public surface, with no inline logic
 * (pattern A, ARCHITECTURE.md §"Façades publiques"; enforced by
 * `scripts/check-facade-purity.cjs`). The `on`/`off`/`once` implementation and the full
 * event reference live in `kernel/events/facade.ts`; the internal
 * dispatcher lives in `kernel/events/event-bus.ts`.
 *
 * @see `kernel/events/facade.ts` — implementation and event reference
 */
export { Events } from "../kernel/events/facade.js";
