/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * IDecoder — contract for all data decoders used by plugin-realtime-layer.
 *
 * Each decoder receives the raw payload from a realtime source and returns
 * a normalised array of {@link DecodedUpdate} objects consumed by layer-updater.
 */

/**
 * Normalised update for a single GeoJSON feature.
 * Produced by every decoder implementation.
 */
export interface DecodedUpdate {
    /** Feature identifier — maps to `data.realtime.idField` on the layer config. */
    id: string;
    /** Properties to set or merge onto the feature. May be partial for merge mode. */
    properties?: Record<string, unknown>;
    /** Optional geometry — absent for property-only updates (e.g. GTFS-RT). */
    geometry?: GeoJSONGeometry;
    /** Operation hint. Defaults to `"upsert"` when absent. */
    action?: "upsert" | "delete";
}

/** Minimal GeoJSON geometry type used by this module (no external @types/geojson dep). */
export type GeoJSONGeometry =
    | { type: "Point"; coordinates: [number, number] | [number, number, number] }
    | { type: "LineString"; coordinates: Array<[number, number]> }
    | { type: "Polygon"; coordinates: Array<Array<[number, number]>> }
    | { type: string; coordinates: unknown };

/**
 * Interface that every decoder must implement.
 * Custom decoders registered via `GeoLeaf.RealtimeLayer.registerDecoder()` must satisfy this contract.
 */
export interface IDecoder {
    /**
     * Decode raw data received from the source into an array of feature updates.
     *
     * @param data - Raw payload. Type depends on the source:
     *   - `polling` with `"gtfs-rt"`: `ArrayBuffer`
     *   - `polling` with `"json"`, `websocket`, `sse`: `string` or parsed `object`
     * @returns Array of decoded updates to apply to the target layer.
     */
    decode(data: unknown): DecodedUpdate[];
}
