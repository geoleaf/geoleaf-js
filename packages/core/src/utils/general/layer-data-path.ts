/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Derives a layer's data-file path from its RAW configuration.
 *
 * 🛑 This exists because the derivation had two callers and only one implementation, and the
 * caller without it was silently broken. A layer configuration on disk declares its data as
 * `data: { directory, file }` — measured: **46 of the 48 layer configs in this repository,
 * and 0 carry a top-level `dataFile`**. `dataFile` is the NORMALISED form, produced by
 * `kernel/config/profile-loader.ts` when it hydrates a profile.
 *
 * The offline cache path never goes through that normalisation: `CacheStorage.loadProfileConfig`
 * fetches `profile.json` raw and `ResourceEnumerator` refetches each layer config raw, so it saw
 * the on-disk shape while reading the normalised key. The data file was therefore never
 * enumerated, and never cached — the layer that a user asked to take offline came back empty.
 *
 * ⚠️ Deriving it a second time inside the enumerator would have closed the bug and opened the
 * defect this fix exists to remove: two places deciding the same thing, free to drift. One
 * function, two callers.
 */

/** The two shapes a layer configuration can carry its data reference in. */
interface LayerDataShape {
    /** Normalised form, produced by the profile loader: `"<directory>/<file>"`. */
    dataFile?: unknown;
    /** Raw on-disk form. */
    data?: { directory?: unknown; file?: unknown } | unknown;
}

/** Directory assumed when a layer declares a data file without saying where it lives. */
const DEFAULT_DATA_DIRECTORY = "data";

/**
 * Resolves the data path a layer configuration declares, in either shape.
 *
 * Accepts the normalised `dataFile` as-is when present — a caller that already ran the profile
 * loader must not see its value rebuilt underneath it — and derives it from `data.file`
 * otherwise.
 *
 * @param config - A layer configuration, raw from disk or normalised by the profile loader.
 * @returns The path relative to the layer directory (e.g. `"data/sites.geojson"`), or `null`
 *   when the layer declares no data file at all — which is legitimate: a tile layer or a layer
 *   with a direct `url` has none.
 * @example
 * layerDataPath({ data: { directory: "data", file: "sites.geojson" } }); // "data/sites.geojson"
 * layerDataPath({ data: { file: "sites.geojson" } });                    // "data/sites.geojson"
 * layerDataPath({ dataFile: "raw/sites.geojson" });                      // "raw/sites.geojson"
 * layerDataPath({ type: "tile" });                                       // null
 */
export function layerDataPath(config: LayerDataShape | null | undefined): string | null {
    if (!config || typeof config !== "object") return null;

    // The normalised key wins when it is already there — re-deriving it would discard a
    // `../`-escaping path the loader deliberately preserved.
    if (typeof config.dataFile === "string" && config.dataFile) return config.dataFile;

    const data = config.data as { directory?: unknown; file?: unknown } | undefined;
    if (!data || typeof data !== "object") return null;
    if (typeof data.file !== "string" || !data.file) return null;

    const directory =
        typeof data.directory === "string" && data.directory
            ? data.directory
            : DEFAULT_DATA_DIRECTORY;
    return `${directory}/${data.file}`;
}
