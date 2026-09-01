/*!
 * GeoLeaf Core - Layers (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Layers` facade — generic per-layer feature access & mutation,
 * promoted from the internal `GeoJSONCore` store. The single engine-agnostic
 * seam through which OUT-OF-CORE plugins and in-core capabilities (filter, search)
 * read/mutate a layer's features by `layerId` — with no notion of "POI". ⚠️ It listed two
 * plugins by name until the 19/08/2026, and BOTH had since disappeared or been renamed: a
 * seam documented by its callers ages exactly as fast as they do.
 * Universal kernel seam: mounted in Full AND Lite.
 *
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `getFeatures(id)` / `getFeatureById` / `getFeatureCount` | Read a layer's features |
 * | `listLayerIds()` / `hasLayer(id)` | Enumerate / test layers |
 * | `setData` / `clear` / `addFeature` / `removeFeature` | Base-dataset writes |
 * | `updateFeatureId` / `patchFeature` | Unit feature mutations |
 * | `setVisibleSubset` / `clearVisibleSubset` | Filtered display (base untouched) |
 * | `setFeatureState` | Ephemeral reactive paint (sync badge, hover/select) |
 * | `mergeFeatures` | Offline replay merge (dedup by id) |
 */
import { buildLayersPublicApi } from "../kernel/geojson/layers-public-api.js";

/** The object mounted on `GeoLeaf.Layers`. */
export const Layers = buildLayersPublicApi();
