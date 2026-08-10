/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table — Shared event cleanup registry
 * Every teardown registered during a render lands here so it can be flushed before a
 * re-render or on destroy.
 *
 * Split out of `table-renderer-utils.ts` (STRUCT S8, N3).
 */

/**
 * Entry in the shared event cleanup registry: a teardown function, a numeric
 * listener id returned by the event-delegation manager, or `null` (returned by
 * `events.on` for an invalid target — skipped at flush time, kept for fidelity).
 */
export type EventCleanup = (() => void) | number | null;

/**
 * Shared event cleanup registry.
 * All cleanup functions/IDs registered during render are stored here so they can
 * be flushed before re-render or on destroy.
 */
export const _eventCleanups: EventCleanup[] = [];
