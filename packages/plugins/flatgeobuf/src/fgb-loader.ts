/*!
 * GeoLeaf FlatGeobuf Plugin — Full-file Loader
 *
 * Fetches a FlatGeobuf file from a URL and deserializes it to a GeoJSON FeatureCollection
 * via the flatgeobuf async iterator API.
 *
 * Security:
 *   - URL validated via validateUrl() before any network request.
 *   - maxFeatures limit enforced (default 100 000) to prevent memory exhaustion.
 *   - AbortSignal propagated to both fetch() and the deserialization loop.
 *   - FlatBuffers deserialization is binary-read-only (no eval, no code execution).
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { deserialize } from "flatgeobuf/lib/mjs/geojson.js";
import type { Feature } from "geojson";
import type { FgbLoadOptions, FgbLoadResult } from "./types.js";
import { validateLoadPreconditions, collectFeatures } from "./internal.js";

/**
 * Loads a FlatGeobuf file from `url` and returns a GeoJSON FeatureCollection.
 *
 * The entire file is streamed and deserialized via `flatgeobuf.deserialize()`.
 * The response body (ReadableStream) is fed directly to the deserializer —
 * no full file buffering in memory.
 *
 * @param url - Remote URL of the .fgb file.
 * @param options - Load options (maxFeatures, signal, onHeader).
 * @returns The deserialized FeatureCollection with header metadata.
 * @throws Error if the URL is invalid, aborted, or the fetch fails.
 */
export async function loadFgb(url: string, options: FgbLoadOptions = {}): Promise<FgbLoadResult> {
    const safeUrl = validateLoadPreconditions(url, options.signal);

    const response = await fetch(safeUrl, { signal: options.signal ?? null });
    if (!response.ok) {
        throw new Error(`[GeoLeaf.FlatGeobuf] HTTP ${response.status} from "${safeUrl}"`);
    }

    const iter = deserialize(response.body as ReadableStream) as AsyncIterable<Feature>;
    return collectFeatures(iter, options);
}
