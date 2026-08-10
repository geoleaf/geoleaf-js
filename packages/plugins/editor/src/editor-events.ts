/*!
 * @geoleaf-plugins/editor — Typed public-event dispatch
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Le point d'émission UNIQUE des neuf événements publics de l'éditeur, typé contre
 * `GeoLeafEventMap` — tâche 7.3.
 *
 * 🛑 **Ce module existe à cause d'un faux vert MESURÉ.** Le typage a d'abord été posé sur
 * le `_dispatch` local d'`events.ts`, et une mutation l'a pris en défaut : retirer un champ
 * de `GeoLeafEditorSyncFlushedDetail` laissait le typecheck VERT. Motif — **trois des neuf
 * émetteurs n'y passaient pas** et construisaient leur `CustomEvent` à la main
 * (`entry.ts` pour `feature-deleted`, `storage-queue-adapter.ts` pour `feature-sync-queued`,
 * `editor-sync-replay.ts` pour `feature-sync-flushed`). Pour ceux-là, le contrat était
 * décoratif : il décrivait une charge que rien n'obligeait à respecter.
 *
 * Un point d'émission unique est ce qui rend le typage OPPOSABLE plutôt qu'indicatif. Un
 * quatrième émetteur écrit à la main réintroduirait exactement le trou, ce que
 * `editor-events.guard.test.ts` empêche en refusant tout `new CustomEvent("geoleaf:editor:…")`
 * hors de ce fichier.
 *
 * ⚠️ Le canal reste un `CustomEvent` brut : appartenir à `GeoLeafEventMap` dit que la charge
 * est JSON-clonable, PAS qu'elle transite par le bus assainissant du core —
 * `dispatchGeoLeafEvent` n'est exporté à aucun plugin.
 */
import type { GeoLeafEventMap } from "@geoleaf/core";

/** Les neuf événements publics de l'éditeur, DÉRIVÉS de la map — jamais retapés. */
export type EditorEventName = Extract<keyof GeoLeafEventMap, `geoleaf:editor:${string}`>;

/**
 * Émet un événement public de l'éditeur.
 *
 * La clé contraint la charge : une divergence entre ce qu'on émet et ce que le contrat
 * promet à l'intégrateur devient une erreur de compilation. C'est ce qui a permis, à la
 * pose, de trouver que `feature-created` transporte une `Feature` GeoJSON complète et non
 * la forme de persistance — le compilateur a refusé la première rédaction du contrat.
 *
 * No-op hors DOM (rendu serveur, harnais unitaire sans `document`).
 *
 * @param eventName - Nom de l'événement, restreint aux clés `geoleaf:editor:*` de la map.
 * @param detail - Charge utile, typée par la clé.
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
