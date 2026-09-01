/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GtfsRtDecoder — decodes GTFS-Realtime protobuf payloads (TripUpdate feed)
 * into {@link DecodedUpdate} objects for property patching on a GeoLeaf layer.
 *
 * The GTFS-RT TripUpdate feed does NOT contain coordinates — only stop/trip
 * identifiers and delay values. The decoder therefore produces property-only
 * updates (no geometry). The target layer must already have the station
 * geometries loaded.
 *
 * `gtfs-realtime-bindings` is a CommonJS module: only a static DEFAULT import
 * survives both Rollup's commonjs interop (named exports of `module.exports =
 * $root` are not statically analysable) and Node's CJS/ESM interop. The
 * named form below is type-only, erased at compile time.
 */

import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { transit_realtime as TransitRealtime } from "gtfs-realtime-bindings";
import type { IDecoder, DecodedUpdate } from "./i-decoder.js";

const { transit_realtime } = gtfsRealtimeBindings;

/** Mapping hints provided via `data.realtime.mapping` in the layer config. */
interface GtfsRtMapping {
    /** GTFS-RT entity field used as the feature identifier (e.g. `"stop_id"`, `"trip_id"`). */
    idField?: string;
    /** GTFS-RT field carrying the delay in seconds. */
    delayField?: string;
    /** GeoLeaf layer ID to update (may differ from the config's own layer). */
    targetLayerId?: string;
}

/**
 * Extract the feature identifier from a TripUpdate per the configured `idField`,
 * falling back to the entity id when the chosen field is absent.
 */
function _extractEntityId(
    tu: TransitRealtime.ITripUpdate,
    fallbackId: string | null | undefined,
    idField: string
): string | null {
    if (idField === "stop_id") {
        const stopId = tu.stopTimeUpdate?.[0]?.stopId;
        if (stopId) return stopId;
    } else if (idField === "trip_id") {
        const tripId = tu.trip?.tripId;
        if (tripId) return tripId;
    }
    return fallbackId ?? null;
}

/** First stop-time delay in seconds; departure wins over arrival, else 0. */
function _extractDelay(tu: TransitRealtime.ITripUpdate): number {
    const first = tu.stopTimeUpdate?.[0];
    const departure = first?.departure?.delay;
    if (typeof departure === "number") return departure;
    const arrival = first?.arrival?.delay;
    if (typeof arrival === "number") return arrival;
    return 0;
}

/**
 * Decodes GTFS-Realtime protobuf payloads (TripUpdate feeds) into property patches.
 *
 * One of the two {@link IDecoder} implementations, selected by the layer's realtime config.
 * Unlike {@link JsonDecoder} it never carries geometry — a GTFS-RT feed patches properties on
 * features the layer already holds, so a vehicle absent from the base layer stays absent.
 */
export class GtfsRtDecoder implements IDecoder {
    private readonly _mapping: GtfsRtMapping;

    constructor(mapping: GtfsRtMapping = {}) {
        this._mapping = mapping;
    }

    decode(data: unknown): DecodedUpdate[] {
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
            return [];
        }
        // Honour the view window: a view may sit on a larger shared buffer
        // (e.g. protobufjs writer pool, WebSocket frame pool).
        const bytes =
            data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return this._decodeFeed(bytes);
    }

    private _decodeFeed(bytes: Uint8Array): DecodedUpdate[] {
        let entities: TransitRealtime.IFeedEntity[];
        try {
            entities = transit_realtime.FeedMessage.decode(bytes).entity ?? [];
        } catch (err) {
            console.warn("[realtime-layer][gtfs-rt] Failed to decode feed:", err);
            return [];
        }

        const idField = this._mapping.idField ?? "trip_id";
        const updates: DecodedUpdate[] = [];

        for (const entity of entities) {
            const tripUpdate = entity.tripUpdate;
            if (!tripUpdate) continue;

            const id = _extractEntityId(tripUpdate, entity.id, idField);
            if (!id) continue;

            updates.push({
                id,
                properties: { delay: _extractDelay(tripUpdate), _realtimeUpdatedAt: Date.now() },
                action: "upsert",
            });
        }

        return updates;
    }
}
