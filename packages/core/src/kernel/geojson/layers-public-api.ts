/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layers — public API surface of the `GeoLeaf.Layers` kernel seam.

 * ARCHI S12.3 — ce fichier vivait sous `capabilities/layers/`, où il était le SEUL
 * fichier : pas de `<id>-capability.ts`, pas d'`install.ts`, absent du manifeste
 * INSTALLER. Les 18 vraies capacités ont les trois. Son propre en-tête le disait
 * déjà — « kernel seam ». Ce n'était donc pas une capacité mal outillée, mais du
 * kernel rangé au mauvais endroit.
 *
 * Il est ici parce que ses trois imports d'exécution viennent tous de
 * `kernel/geojson/` : il promeut le store par couche (`GeoJSONShared.state.layers`
 * + `GeoJSONCore`) en surface publique. Son unique consommateur est la façade
 * `api/geoleaf.layers.ts`.
 *
 * Promotion of the internal per-layer store (`GeoJSONShared.state.layers` +
 * `GeoJSONCore`): reads wrap the existing store; base-dataset writes go through
 * `GeoJSONCore.updateLayerData` (adapter `setData` + state); the visible subset
 * reuses `GeoJSONCore.filterFeatures` (GPU id-filter, base untouched); reactive
 * paint is an `adapter.setFeatureState` passthrough. Mounted on `GeoLeaf.Layers`
 * via `geoleaf.layers.ts` (universal — Full and Lite).
 *
 * The public surface speaks the standard `GeoJSON.Feature`; the store holds the
 * structurally-compatible internal {@link GeoJSONFeature}. The two are bridged
 * by deliberate boundary casts (no `any`).
 */
"use strict";

import { GeoJSONShared } from "./shared.js";
import { GeoJSONCore } from "./core.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { LayerDataApi, LayerFeatureState } from "../../contracts/layer-data.contract.js";

/** Internal feature shape held in `state.layers[].features`. */
type StoreFeature = GeoJSONFeature;

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Reads the raw stored features array for a layer (empty when unknown). */
function rawFeatures(layerId: string): StoreFeature[] {
    return GeoJSONShared.getLayerById(layerId)?.features ?? [];
}

/** Stable-id match — tests top-level `id` and `properties.id` (string-coerced). */
function matchId(f: StoreFeature, id: string | number): boolean {
    if (f.id != null && String(f.id) === String(id)) return true;
    const pid = f.properties?.id;
    return pid != null && String(pid) === String(id);
}

/**
 * Writes a layer's base features (adapter `setData` + in-memory state, via
 * `GeoJSONCore.updateLayerData`). Single funnel for every base-dataset mutation;
 * `patchFeature` (silent) bypasses it on purpose.
 *
 * 🛑 REFUS MAINTENU — `geoleaf:layer:updated` n'est PAS émis, et ce n'est pas un oubli.
 * Un événement public sans auditeur est une promesse qu'on ne peut plus reprendre : il entre
 * dans le contrat, il se type, il se documente, et il faut le maintenir pour personne.
 *
 * ⚠️ **CONDITION DE RÉOUVERTURE, vérifiable — c'est elle qui rend ce refus falsifiable plutôt
 * que définitif** : un abonné existe en source, dans ce dépôt OU dans un manifeste lu par
 * `scripts/verify-consumer-contract.cjs`. Le jour où c'est vrai, la gate du contrat inverse le
 * dira d'elle-même ; d'ici là, la mesure est `grep -rn "layer:updated"`, qui ne rend
 * aujourd'hui que ce commentaire.
 *
 * ⚠️ Ce refus citait « filter/search D3, **addpoi** D4 » comme consommateurs à venir.
 * `addpoi` **n'existe plus** — fusionné dans `editor` au Sprint 5. Une note de refus qui nomme
 * un consommateur disparu se périme sans jamais rougir : quiconque la relit conclut soit que
 * l'auditeur va arriver, soit que le refus est caduc, et les deux sont faux. D'où la
 * réécriture en condition mesurable plutôt qu'en liste de noms. Suivi au backlog **B.7** de
 * `roadmap_contrat-inverse-api-publique.md` comme refus CONDITIONNÉ.
 *
 * ⚠️ Et il restera à dire QUAND il part, ce que la question « faut-il l'écrire ? » masque :
 * par `setData` ? par `patchFeature`, qui contourne délibérément cet entonnoir ? les deux ?
 * avec quelle granularité ? Un événement dont le déclencheur n'est pas tranché est pire
 * qu'aucun événement.
 */
function writeBase(layerId: string, features: StoreFeature[]): void {
    GeoJSONCore.updateLayerData(layerId, { type: "FeatureCollection", features });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Builds the object mounted on `GeoLeaf.Layers`. */
export function buildLayersPublicApi(): LayerDataApi {
    return {
        // ── read (GeoJSONCore promotion) ──

        getFeatures(layerId: string): GeoJSON.Feature[] {
            return GeoJSONCore.getFeatures({ layerIds: [layerId] }) as unknown as GeoJSON.Feature[];
        },

        getFeatureById(layerId: string, id: string | number): GeoJSON.Feature | null {
            const found = rawFeatures(layerId).find((f) => matchId(f, id));
            return found ? (found as unknown as GeoJSON.Feature) : null;
        },

        getFeatureCount(layerId: string): number {
            return rawFeatures(layerId).length;
        },

        listLayerIds(): string[] {
            return [...GeoJSONShared.state.layers.keys()];
        },

        hasLayer(layerId: string): boolean {
            return GeoJSONShared.state.layers.has(layerId);
        },

        // ── base dataset write ──

        setData(layerId: string, features: GeoJSON.Feature[]): void {
            writeBase(layerId, features as unknown as StoreFeature[]);
        },

        clear(layerId: string): void {
            writeBase(layerId, []);
        },

        // ── unit mutations ──

        addFeature(layerId: string, feature: GeoJSON.Feature): void {
            writeBase(layerId, [...rawFeatures(layerId), feature as unknown as StoreFeature]);
        },

        removeFeature(layerId: string, id: string | number): boolean {
            const before = rawFeatures(layerId);
            const after = before.filter((f) => !matchId(f, id));
            if (after.length === before.length) return false;
            writeBase(layerId, after);
            return true;
        },

        updateFeatureId(layerId: string, oldId: string | number, newId: string | number): void {
            const features = rawFeatures(layerId);
            const target = features.find((f) => matchId(f, oldId));
            if (!target) return;
            target.id = newId;
            (target.properties ??= {}).id = newId;
            writeBase(layerId, features);
        },

        patchFeature(
            layerId: string,
            id: string | number,
            patch: Record<string, unknown>,
            opts?: { rerender?: boolean }
        ): void {
            const target = rawFeatures(layerId).find((f) => matchId(f, id));
            if (!target) return;
            // Bake into properties so the flag survives a source rebuild.
            target.properties = { ...(target.properties ?? {}), ...patch };
            // Silent by default (state only); rebuild + emit only when requested.
            if (opts?.rerender) writeBase(layerId, rawFeatures(layerId));
        },

        // ── filtered display WITHOUT mutating the base ──

        setVisibleSubset(layerId: string, predicate: (f: GeoJSON.Feature) => boolean): void {
            // Reuses the GeoJSONCore filter path (GPU id-match, JS fallback); the
            // base dataset is read, never mutated — the subset is re-derived here.
            GeoJSONCore.filterFeatures((f) => predicate(f as unknown as GeoJSON.Feature), {
                layerIds: layerId,
            });
        },

        clearVisibleSubset(layerId: string): void {
            GeoJSONCore.clearFeatureFilter({ layerIds: layerId });
        },

        // ── reactive paint (adapter passthrough) ──

        setFeatureState(layerId: string, id: string | number, state: LayerFeatureState): void {
            const adapter = GeoJSONShared.state.adapter;
            adapter?.setFeatureState?.(layerId, id, state);
        },

        // ── offline replay merge (dedup by id) ──

        mergeFeatures(layerId: string, features: readonly GeoJSON.Feature[]): void {
            const incoming = features as unknown as readonly StoreFeature[];
            const idIndex = new Map<string, number>();
            const result: StoreFeature[] = [];
            const upsert = (f: StoreFeature): void => {
                const raw = f.id ?? f.properties?.id;
                if (raw == null) {
                    result.push(f); // id-less features cannot be deduped — keep them
                    return;
                }
                const key = String(raw);
                const pos = idIndex.get(key);
                if (pos === undefined) {
                    idIndex.set(key, result.length);
                    result.push(f);
                } else {
                    result[pos] = f; // incoming overwrites the existing entry
                }
            };
            rawFeatures(layerId).forEach(upsert);
            incoming.forEach(upsert);
            writeBase(layerId, result);
        },
    };
}
