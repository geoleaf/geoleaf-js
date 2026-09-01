/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layers — public API surface of the `GeoLeaf.Layers` kernel seam.

 * This file used to live under `capabilities/layers/`, where it was the ONLY
 * file: no `<id>-capability.ts`, no `install.ts`, absent from the INSTALLER
 * manifest. The 18 real capabilities have all three. Its own header already said
 * it — "kernel seam". So it was not a badly-tooled capability, but kernel filed in
 * the wrong place.
 *
 * It is here because its three runtime imports all come from `kernel/geojson/`: it
 * promotes the per-layer store (`GeoJSONShared.state.layers` + `GeoJSONCore`) to
 * public surface. Its sole consumer is the `api/geoleaf.layers.ts` facade.
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
 * 🛑 REFUSAL UPHELD — `geoleaf:layer:updated` is NOT emitted, and it is not an
 * oversight. A public event with no listener is a promise that can no longer be
 * taken back: it enters the contract, gets typed, gets documented, and must be
 * maintained for nobody.
 *
 * ⚠️ **REOPENING CONDITION, verifiable — it is what makes this refusal falsifiable
 * rather than definitive**: a **SUBSCRIBER** exists in source, in this repo OR in
 * a manifest read by `scripts/verify-consumer-contract.cjs`.
 *
 * 🔻 **AND THE CONDITION IS NOW OBSERVABLE — it was not when written
 * (17/08/2026).** The manifest did declare a `requested_events` block, accepted by
 * `KNOWN_TOP_LEVEL`, but **no `CC` rule read its content**: the refutation could
 * arrive with nothing seeing it. A refusal whose reopening condition is
 * unobservable is not refutable — it is an opinion. `CC-13` now reads that block
 * and yields one **NOTE** per entry.
 *
 * 📌 **REQUESTED ≠ SUBSCRIBED, and the state changed without the refusal moving.**
 * Measured on 17/08/2026: downstream **requests** `geoleaf:layer:updated`
 * (manifest, `requested_events`). The refusal **holds** — the condition requires a
 * subscriber, and a request is not one. But "nobody asked for it" can no longer be
 * said: what is missing is an `on("geoleaf:layer:updated", …)` in real code, not a
 * wish in a contract.
 *
 * ⚠️ **`grep -rn "layer:updated"` is no longer the right measure**: it only sees
 * this repo, and half the condition lives downstream. The oracle is now **`CC-13`**,
 * which reads both sides — but which **SKIPS on the public clone**
 * (`GEOLEAF_CONSUMERS` undefined): a green there says nothing about this
 * condition.
 *
 * ⚠️ This refusal cited "filter/search, **addpoi**" as consumers to come. `addpoi`
 * **no longer exists** — merged into `editor`. A refusal note naming a vanished
 * consumer goes stale without ever turning red: whoever re-reads it concludes
 * either that the listener is coming, or that the refusal is void, and both are
 * false. Hence the rewrite as a measurable condition rather than a list of names —
 * a CONDITIONED refusal, never a definitive one.
 *
 * ⚠️ And WHEN it fires would remain to be said, which the question "should it be
 * written?" masks: on `setData`? on `patchFeature`, which deliberately bypasses
 * this funnel? both? at what granularity? An event whose trigger is not decided is
 * worse than no event.
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
