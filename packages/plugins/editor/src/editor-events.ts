/*!
 * @geoleaf-plugins/editor — Typed public-event dispatch
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The SINGLE emission point of the editor's nine public events, typed against
 * `GeoLeafEventMap`.
 *
 * 🛑 **This module exists because of a MEASURED false green.** Typing was first
 * set on `events.ts`'s local `_dispatch`, and a mutation caught it out:
 * removing a field from `GeoLeafEditorSyncFlushedDetail` left the typecheck
 * GREEN. Motive — **three of the nine emitters did not go through it** and
 * built their `CustomEvent` by hand (`entry.ts` for `feature-deleted`,
 * `storage-queue-adapter.ts` for `feature-sync-queued`,
 * `editor-sync-replay.ts` for `feature-sync-flushed`). For those, the contract
 * was decorative: it described a payload nothing forced to respect.
 *
 * A single emission point is what makes the typing ENFORCEABLE rather than
 * indicative. A fourth hand-written emitter would reintroduce exactly the
 * hole, which `editor-events.guard.test.ts` prevents by refusing any
 * `new CustomEvent("geoleaf:editor:…")` outside this file.
 *
 * ⚠️ The channel stays a raw `CustomEvent`: belonging to `GeoLeafEventMap` says
 * the payload is JSON-clonable, NOT that it goes through the core's sanitising
 * bus — `dispatchGeoLeafEvent` is exported to no plugin.
 */
import type { GeoLeafEventMap } from "@geoleaf/core";

/** The editor's nine public events, DERIVED from the map — never retyped. */
export type EditorEventName = Extract<keyof GeoLeafEventMap, `geoleaf:editor:${string}`>;

/**
 * Emits a public editor event.
 *
 * The key constrains the payload: a divergence between what we emit and what
 * the contract promises the integrator becomes a compile error. That is what
 * allowed finding, when first added, that `feature-created` carries a complete
 * GeoJSON `Feature` and not the persistence shape — the compiler refused the
 * contract's first draft.
 *
 * No-op outside the DOM (server rendering, unit harness without `document`).
 *
 * @param eventName - Event name, restricted to the map's `geoleaf:editor:*` keys.
 * @param detail - Payload, typed by the key.
 *
 * @example
 * ```ts
 * dispatchEditorEvent("geoleaf:editor:feature-deleted", { featureId: "f1", layerId: "sites" });
 * ```
 */
export function dispatchEditorEvent<K extends EditorEventName>(
    eventName: K,
    detail: GeoLeafEventMap[K]
): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail }));
}
