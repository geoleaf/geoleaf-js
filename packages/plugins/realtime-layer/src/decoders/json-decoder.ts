/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * JsonDecoder — decodes GeoJSON payloads (snapshot or delta) arriving from
 * polling HTTP, WebSocket, or SSE sources.
 *
 * Input can be:
 *  - A complete `FeatureCollection` → decoded as an array of upsert updates.
 *  - An array of GeoJSON `Feature` objects.
 *  - A single `Feature` object.
 *  - A raw string that will be JSON-parsed.
 */

import type { IDecoder, DecodedUpdate, GeoJSONGeometry } from "./i-decoder.js";

/** Raw GeoJSON feature shape expected from the source. */
interface RawFeature {
    type?: string;
    id?: string | number;
    properties?: Record<string, unknown> | null;
    geometry?: GeoJSONGeometry | null;
}

/** JSON payload shape accepted by this decoder. */
type JsonPayload =
    { type: "FeatureCollection"; features: RawFeature[] } | RawFeature[] | RawFeature | string;

/** Derive a stable string id from a feature (`id` → `properties.id` → `properties._id`). */
function _deriveId(feature: RawFeature): string {
    const raw = feature.id ?? feature.properties?.["id"] ?? feature.properties?.["_id"];
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "object") return JSON.stringify(raw);
    return String(raw);
}

/**
 * Decodes GeoJSON payloads — full snapshots or deltas — from any transport.
 *
 * The default {@link IDecoder}: it accepts what polling, WebSocket and SSE sources all
 * deliver. A snapshot replaces the layer's features; a delta patches the ones it names.
 */
export class JsonDecoder implements IDecoder {
    decode(data: unknown): DecodedUpdate[] {
        const parsed = this._parse(data);
        return this._toUpdates(parsed);
    }

    private _parse(data: unknown): JsonPayload {
        if (typeof data === "string") {
            try {
                return JSON.parse(data) as JsonPayload;
            } catch {
                return [];
            }
        }
        return data as JsonPayload;
    }

    private _toUpdates(payload: JsonPayload): DecodedUpdate[] {
        if (!payload) return [];

        // FeatureCollection
        if (
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            payload.type === "FeatureCollection"
        ) {
            const fc = payload as { type: "FeatureCollection"; features: RawFeature[] };
            return (fc.features ?? []).map((f) => this._featureToUpdate(f));
        }

        // Array of features
        if (Array.isArray(payload)) {
            return payload.map((f: RawFeature) => this._featureToUpdate(f));
        }

        // Single feature
        if (typeof payload === "object" && payload.type === "Feature") {
            return [this._featureToUpdate(payload)];
        }

        return [];
    }

    private _featureToUpdate(feature: RawFeature): DecodedUpdate {
        return {
            id: _deriveId(feature),
            properties: feature.properties ?? {},
            ...(feature.geometry != null && { geometry: feature.geometry }),
            action: "upsert",
        };
    }
}
