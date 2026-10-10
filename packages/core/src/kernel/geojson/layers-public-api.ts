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

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";
import { GeoJSONShared } from "./shared.js";
import { GeoJSONCore, applyLayerDiff } from "./core.js";
import { loadLayerDefinition } from "./loader/profile.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import { readFeaturePropId } from "./geojson-filter.js";
import { searchLayers } from "./layer-search.js";
import { focusFeature } from "./layer-focus.js";
import type { LayerDataDiff } from "../../contracts/map-adapter.contract.js";
import type { GeoLeafLayerUpdatedDetail } from "../../contracts/event-bus.contract.js";
import type {
    CreatedLayer,
    LayerDataApi,
    LayerDefinition,
    LayerFeatureState,
    LayerFocusOptions,
    LayerStyleInfo,
    VisibilitySource,
} from "../../contracts/layer-data.contract.js";

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

/** The centralized visibility state, as this seam reads and writes it. */
interface VisibilityStateReader {
    getVisibilityState?: (layerId: string) =>
        | {
              current?: boolean;
              logicalState?: boolean;
              userOverride?: boolean;
              source?: unknown;
          }
        | null
        | undefined;
    setVisibility?: (layerId: string, visible: boolean, source: VisibilitySource) => boolean;
}

/**
 * The four names a visibility source can take, as VALUES.
 *
 * ⚠️ A fourth structural copy of the union, and deliberately so. `VisibilitySource` is a
 * TYPE — `contracts/` is type-pure and cannot ship a runtime value — so a reader that must
 * reject anything else needs its own list. Widening it to `as VisibilitySource` instead
 * would let whatever the manager happens to hold through the public contract unchecked,
 * which is the one thing a narrowing read is for.
 */
const VISIBILITY_SOURCES: readonly VisibilitySource[] = ["user", "theme", "zoom", "system"];

/**
 * The layer manager, for the ONE call the write must chain.
 *
 * 🛑 `setVisibility` records the intent and stops there — it does not repaint. The
 * two existing public writes each chain this call for that reason, with the motive
 * written on the spot. A write that omits it moves the toggle and leaves the map as
 * it was, and nothing fails: the defect is visible only to whoever looks at the map.
 */
interface ZoomRepainter {
    updateLayerVisibilityByZoom?: () => void;
}

/**
 * Reads one flag out of the centralized visibility state.
 *
 * Returns `false` for a layer the store does not know, for one whose metadata has
 * never been initialised, and for a host where the visibility manager is not
 * mounted — rather than throwing or reporting `undefined`. That matches the
 * convention of the reads above (`getFeatures` yields `[]`, not an error) and
 * spares the caller from telling "off" apart from "not there yet" when neither
 * should paint anything.
 *
 * ⚠️ The manager is reached THROUGH THE GLOBAL, like the kernel's five other
 * readers of it, and not by static import — which was tried first and is why the
 * note is here. `visibility-manager.ts` logs at module scope, so importing it
 * dragged that side effect into the import chain of the `GeoLeaf.Layers` facade:
 * a read-only accessor would have made a facade noisier to load, and widened its
 * static closure for nothing.
 */
function visibilityFlag(
    layerId: string,
    field: "current" | "logicalState" | "userOverride"
): boolean {
    if (!GeoJSONShared.state.layers.has(layerId)) return false;
    const manager = getGeoLeaf()?._LayerVisibilityManager as VisibilityStateReader | undefined;
    return manager?.getVisibilityState?.(layerId)?.[field] === true;
}

/**
 * Reads the recorded visibility source — the body of
 * {@link LayerDataApi.getVisibilitySource}.
 *
 * Returns `null`, not a default source, for a layer the store does not know, for one whose
 * metadata has never been initialised, for a host without the visibility manager, and for a
 * value that is not one of the four names. `null` is the only honest answer there: unlike
 * the booleans above, where `false` means "nothing to paint", every source name asserts that
 * somebody decided something, and inventing `"system"` would be that assertion without the
 * fact behind it.
 */
function readVisibilitySource(layerId: string): VisibilitySource | null {
    if (!GeoJSONShared.state.layers.has(layerId)) return null;
    const manager = getGeoLeaf()?._LayerVisibilityManager as VisibilityStateReader | undefined;
    const raw = manager?.getVisibilityState?.(layerId)?.source;
    return VISIBILITY_SOURCES.find((s) => s === raw) ?? null;
}

/**
 * Reads which style a layer wears — the body of {@link LayerDataApi.getStyle}.
 *
 * 🛑 The normalisation IS the function. `currentStyle` is written by two hands: applying a
 * style assigns the flattened paint (no `id`, no `label`), the style selector restores the
 * full document over it. Reading the raw field yields whichever spoke last. Here, a missing
 * field simply becomes `null`, so both shapes answer the same way.
 *
 * ⚠️ `label` is polymorphic in the style-file format — a display name OR a map-label config
 * object. Only a string is a name; anything else is reported as `null` rather than cast, which
 * is how a label config ended up being read as a name once already.
 */
function readStyleInfo(layerId: string): LayerStyleInfo | null {
    const current = GeoJSONShared.getLayerById(layerId)?.currentStyle;
    if (!current) return null;
    return {
        id: typeof current.id === "string" ? current.id : null,
        label: typeof current.label === "string" ? current.label : null,
    };
}

/**
 * Sets a layer's visibility under a NAMED source — the body of
 * {@link LayerDataApi.setVisibility}, at module scope so the builder stays a list of
 * members.
 *
 * Two steps, and the second is not optional: the manager records the intent, then the
 * physical state is recomputed against the current zoom. Chaining them here rather
 * than asking the caller to is the whole point — a public route that leaves the map
 * stale would be a worse contract than none.
 */
function writeVisibility(layerId: string, visible: boolean, source: VisibilitySource): boolean {
    if (!GeoJSONShared.state.layers.has(layerId)) return false;
    const gl = getGeoLeaf();
    const changed =
        (gl?._LayerVisibilityManager as VisibilityStateReader | undefined)?.setVisibility?.(
            layerId,
            visible,
            source
        ) === true;
    // Unconditional, exactly as the existing writes do it: a refused intent can still
    // leave the painted state out of date with the current zoom.
    (gl?._GeoJSONLayerManager as ZoomRepainter | undefined)?.updateLayerVisibilityByZoom?.();
    return changed;
}

/**
 * Creates a layer from a caller-supplied definition — the body of
 * {@link LayerDataApi.create}, at module scope rather than inside the builder so
 * the builder stays a list of members.
 *
 * Both refusals THROW rather than resolve to `null`. `null` already carries a
 * meaning here — "the source did not resolve" — which is a property of the DATA
 * and is logged by the loader. A missing or colliding id is a property of the
 * CALL, and collapsing the two would let a typo read as an empty source.
 */
async function createLayer(def: LayerDefinition): Promise<CreatedLayer | null> {
    const id = def?.id;
    if (typeof id !== "string" || id === "") {
        throw new Error("[GeoLeaf.Layers] create() requires a definition with a string id.");
    }
    if (GeoJSONShared.state.layers.has(id)) {
        throw new Error(
            `[GeoLeaf.Layers] create() refuses "${id}": a layer with this id already exists. ` +
                "Use setData() to replace the features of an existing layer."
        );
    }
    return await loadLayerDefinition(def);
}

/**
 * Writes a layer's base features (adapter `setData` + in-memory state, via
 * `GeoJSONCore.updateLayerData`). Single funnel for every base-dataset mutation;
 * `patchFeature` (silent) bypasses it on purpose.
 */
function writeBase(layerId: string, features: StoreFeature[]): void {
    GeoJSONCore.updateLayerData(layerId, { type: "FeatureCollection", features });
}

/**
 * Says that a layer's store changed: `geoleaf:layer:updated`, once per mutation made through
 * this API, for a layer that exists.
 *
 * 🛑 THIS WAS A REFUSAL UNTIL 27/09/2026, AND ITS CONDITION IS WHAT LIFTED IT. A public event
 * with no listener is a promise that cannot be taken back, so the refusal held until a
 * SUBSCRIBER existed. Two exist now, in this repository: the open table (which kept its rows
 * until the next filter or visibility change) and the active filter (which did not re-judge a
 * new feature — hidden on its GPU path even when it passed, shown on its re-feed path even when
 * it failed). Both had been measured wrong for want of it.
 *
 * ⚠️ WHEN it fires is decided, and narrow: after `setData`, `clear`, `addFeature`,
 * `removeFeature` (when it removed something), `updateFeatureId`, `mergeFeatures`, and
 * `patchFeature` with `{ rerender: true }`. Not after a silent `patchFeature`, which changes
 * state only; not at a layer's load; not for a filter or a visible subset, which change what is
 * drawn and not what is held. The granularity is the call, not the feature: a merge of a
 * thousand features is one event.
 *
 * 🛑 TWO EMITTERS SINCE 3.15.0, AND EXACTLY ONE SPEAKS PER WRITE. A write of the WHOLE
 * collection — `setData`, `clear`, and the three unit mutations that fall back to one — is
 * announced by the funnel every such writer goes through (`GeoJSONShared.setLayerCollection`),
 * which is what covers a real-time layer's ticks, an OGC layer's auto-refresh and a host's own
 * `GeoJSONCore.updateLayerData`: they used to rewrite the store unannounced. This function
 * announces the DIFFS, which never reach that funnel.
 */
function announce(layerId: string): void {
    if (!GeoJSONShared.state.layers.has(layerId)) return;
    const detail: GeoLeafLayerUpdatedDetail = { layerId };
    dispatchGeoLeafEvent("geoleaf:layer:updated", detail);
}

/**
 * Writes a UNIT mutation: mutate the stored array in place, then tell the engine what
 * moved rather than handing it the result.
 *
 * 🛑 **The diff is built by the caller that already knows its own intention, and that
 * is the whole design.** Diffing two collections would be O(N) — the very copy this
 * path exists to remove — and it could not recover what was deliberately thrown away:
 * two collections cannot tell "this id changed" from "one removed, one added", and
 * producing a property update from them needs a deep per-feature comparison. Each of
 * the five unit methods, by contrast, already holds its diff for free.
 *
 * ⚠️ The array is mutated IN PLACE and handed on by reference. Callers must not rebuild
 * it: `[...features, f]` would restore the O(N) allocation while looking like a fix.
 */
function writeDiff(
    layerId: string,
    diff: LayerDataDiff,
    mutate: (features: StoreFeature[]) => StoreFeature[] | void
): void {
    const entry = GeoJSONShared.getLayerById(layerId);
    if (!entry) return;
    const features = (entry.features ??= []);
    applyLayerDiff(layerId, diff, mutate(features) ?? features);
}

/**
 * Bridges the store's feature declaration to the contract's.
 *
 * `GeoJSONFeature` (what the store holds) and `GeoJSON.Feature` (what the public seam
 * and `LayerDataDiff` speak) describe the SAME runtime object under two declarations:
 * the internal one narrows `geometry` to the union this kernel handles, the external one
 * is the full spec. Neither is assignable to the other, so a double cast is the only
 * bridge TypeScript accepts — and this is the one place that pays it, rather than each
 * call site paying it anonymously.
 *
 * ⚠️ A single `as` will not compile here, and reaching for one is how the narrowing gets
 * quietly widened instead.
 */
function toContractFeature(f: StoreFeature): GeoJSON.Feature {
    return f as unknown as GeoJSON.Feature;
}

/**
 * The id a diff must name — `properties.id`, the space `promoteId: "id"` promotes.
 *
 * ⚠️ **Not the caller's argument.** `matchId` deliberately accepts a top-level `id`
 * too, so `removeFeature(layerId, 42)` can find a feature whose `properties.id` is
 * `"PT-42"`. Forwarding the caller's argument into the diff would name an id the engine
 * has never heard of, and MapLibre skips an unknown id in silence — the store would drop
 * the feature while the map kept drawing it.
 */
function diffId(feature: StoreFeature): string | number | null {
    return readFeaturePropId(feature);
}

// ─── Unit mutations ─────────────────────────────────────────────────────────
//
// Module-level rather than inline in `buildLayersPublicApi`: each now carries the
// reasoning for its own diff, and the factory stays a list of one-line delegations —
// the façade/implementation split this repo applies to `geoleaf.*.ts`.

function addFeatureImpl(layerId: string, feature: GeoJSON.Feature): void {
    const added = feature as unknown as StoreFeature;
    writeDiff(layerId, { add: [feature] }, (features) => {
        features.push(added);
    });
}

function removeFeatureImpl(layerId: string, id: string | number): boolean {
    const features = rawFeatures(layerId);
    const index = features.findIndex((f) => matchId(f, id));
    if (index === -1) return false;
    const target = features[index];
    const targetId = target ? diffId(target) : null;
    // No promoted id ⇒ the engine cannot be told which feature to drop. Splice the store
    // and let `applyLayerDiff` re-feed the whole collection: an empty diff says so
    // explicitly rather than relying on the eligibility cache to notice.
    const diff: LayerDataDiff = targetId == null ? {} : { remove: [targetId] };
    writeDiff(layerId, diff, (list) => {
        list.splice(index, 1);
    });
    return true;
}

function updateFeatureIdImpl(
    layerId: string,
    oldId: string | number,
    newId: string | number
): boolean {
    const features = rawFeatures(layerId);
    const target = features.find((f) => matchId(f, oldId));
    if (!target) return false;
    const previousId = diffId(target);
    target.id = newId;
    (target.properties ??= {}).id = newId;
    // An id change is a removal then an addition — the order a diff is applied in, so one
    // round-trip expresses it exactly.
    // ⚠️ Full re-feed when `newId` is already taken: the diff would collapse the two
    // features into one in the source while the store keeps both. `setData` preserves
    // today's behaviour rather than inventing a new one.
    const collides = features.some((f) => f !== target && matchId(f, newId));
    if (previousId == null || collides) {
        // Rewrites the collection: the funnel announces it.
        writeBase(layerId, features);
        return false;
    }
    applyLayerDiff(layerId, { remove: [previousId], add: [toContractFeature(target)] }, features);
    return true;
}

function patchFeatureImpl(
    layerId: string,
    id: string | number,
    patch: Record<string, unknown>,
    opts?: { rerender?: boolean }
): boolean {
    const features = rawFeatures(layerId);
    const target = features.find((f) => matchId(f, id));
    if (!target) return false;
    // Bake into properties so the flag survives a source rebuild.
    target.properties = { ...(target.properties ?? {}), ...patch };
    // Silent by default (state only); rebuild + emit only when requested.
    if (!opts?.rerender) {
        // 🛑 The one writer that reaches neither `setLayerCollection` nor `applyLayerDiff`:
        // the search index would keep the properties as they were (`layer-search.ts`).
        const entry = GeoJSONShared.getLayerById(layerId);
        if (entry) entry._searchIndex = undefined;
        return false;
    }
    const targetId = diffId(target);
    if (targetId == null) {
        // Rewrites the collection: the funnel announces it.
        writeBase(layerId, features);
        return false;
    }
    // ⚠️ `update` only touches what the source already holds: a patch on an id the source
    // does not carry is skipped without a word. The one way that arises is right after the
    // filter's re-feed path published a SUBSET; the store keeps the patch either way, and
    // clearing the filter re-feeds from the store.
    const addOrUpdateProperties = Object.entries(patch).map(([key, value]) => ({ key, value }));
    applyLayerDiff(layerId, { update: [{ id: targetId, addOrUpdateProperties }] }, features);
    return true;
}

function mergeFeaturesImpl(layerId: string, features: readonly GeoJSON.Feature[]): boolean {
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
    // ⚠️ The store rebuild above stays O(N) and cannot not be: dedup-by-id is a property of
    // the WHOLE collection. What the diff removes is the other O(N) — re-serialising every
    // feature to the worker and re-indexing there — which, on a replay of a handful of edits
    // over a 30 000-feature layer, is the dominant cost.
    //
    // `{ add }` alone IS the upsert: `applySourceDiff` drops whatever already carries an
    // added id, on both sides of the worker boundary. Emitting the matching `remove` too
    // would be a second way of saying the same thing, and `mergeSourceDiffs` deletes those
    // entries again on coalescing.
    if (!incoming.every((f) => diffId(f) != null)) {
        // Mirrors the `upsert` branch that keeps id-less features: they cannot be
        // addressed, so the whole collection is re-fed — and the funnel announces it.
        writeBase(layerId, result);
        return false;
    }
    applyLayerDiff(layerId, { add: features }, result);
    return true;
}

/** The filter slot `hideFeatures` writes — never the panel's (`setLayerFilter`, `owner`). */
const HIDDEN_FILTER_OWNER = "hidden";

/**
 * A filter that keeps every feature but the listed ones, compared as strings — an id `42` and an
 * id `"42"` are the same feature to the store (`matchId`), and must be to the map.
 *
 * ⚠️ WHICH id depends on the source. A GeoJSON source promotes `properties.id`
 * (`promoteId: "id"`), and the engine's feature id is then `parseInt(properties.id)`: matching
 * `["id"]` there hid "12.5" and "12-A" with "12", and a cluster bubble whose cluster id was
 * listed — so `properties.id` ALONE, like the panel's own id filter (`geojson-filter.ts`). A
 * vector-tile source is not promoted: its feature id is the tile's own, the one the editor hides
 * by, and it is matched too.
 */
function hiddenFilter(ids: readonly (string | number)[], vectorTile: boolean): unknown {
    const listed = [...new Set(ids.map(String))];
    const byProperty = ["match", ["to-string", ["get", "id"]], listed, false, true];
    if (!vectorTile) return byProperty;
    return ["all", byProperty, ["match", ["to-string", ["id"]], listed, false, true]];
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
            return found ? toContractFeature(found) : null;
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

        search: searchLayers,

        focus(layerId: string, id: string | number, opts?: LayerFocusOptions): boolean {
            const found = rawFeatures(layerId).find((f) => matchId(f, id));
            return found ? focusFeature(layerId, found, opts) : false;
        },

        // ── visibility reads ──

        isVisible(layerId: string): boolean {
            return visibilityFlag(layerId, "current");
        },

        isEnabled(layerId: string): boolean {
            return visibilityFlag(layerId, "logicalState");
        },

        isUserOverridden(layerId: string): boolean {
            return visibilityFlag(layerId, "userOverride");
        },

        getVisibilitySource: readVisibilitySource,

        // ── style read ──

        getStyle: readStyleInfo,

        // ── visibility write ──

        setVisibility: writeVisibility,

        // ── layer creation ──

        create: createLayer,

        // ── base dataset write ──

        // A whole-collection write is announced by the funnel it goes through
        // (`GeoJSONShared.setLayerCollection`), not here.

        setData(layerId: string, features: GeoJSON.Feature[]): void {
            writeBase(layerId, features as unknown as StoreFeature[]);
        },

        clear(layerId: string): void {
            writeBase(layerId, []);
        },

        // ── unit mutations ──
        // Delegations: each implementation, with the reasoning for its diff, sits at module
        // level above. A DIFF is announced here, once; a mutation that fell back to rewriting
        // the whole collection was already announced by the funnel, and its implementation
        // says so by returning `false`.

        addFeature(layerId: string, feature: GeoJSON.Feature): void {
            addFeatureImpl(layerId, feature);
            announce(layerId);
        },

        removeFeature(layerId: string, id: string | number): boolean {
            const removed = removeFeatureImpl(layerId, id);
            if (removed) announce(layerId);
            return removed;
        },

        updateFeatureId(layerId: string, oldId: string | number, newId: string | number): void {
            if (updateFeatureIdImpl(layerId, oldId, newId)) announce(layerId);
        },

        patchFeature(
            layerId: string,
            id: string | number,
            patch: Record<string, unknown>,
            opts?: { rerender?: boolean }
        ): void {
            if (patchFeatureImpl(layerId, id, patch, opts)) announce(layerId);
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

        hideFeatures(layerId: string, ids: readonly (string | number)[] | null): void {
            const adapter = GeoJSONShared.state.adapter;
            if (typeof adapter?.setLayerFilter !== "function") return;
            const vectorTile = GeoJSONShared.state.layers.get(layerId)?.isVectorTile === true;
            adapter.setLayerFilter(
                layerId,
                ids && ids.length > 0 ? hiddenFilter(ids, vectorTile) : null,
                HIDDEN_FILTER_OWNER
            );
        },

        // ── reactive paint (adapter passthrough) ──

        setFeatureState(layerId: string, id: string | number, state: LayerFeatureState): void {
            const adapter = GeoJSONShared.state.adapter;
            adapter?.setFeatureState?.(layerId, id, state);
        },

        // ── offline replay merge (dedup by id) ──

        mergeFeatures(layerId: string, features: readonly GeoJSON.Feature[]): void {
            if (mergeFeaturesImpl(layerId, features)) announce(layerId);
        },
    };
}
