/**
 * gtfs-rt-decoder.test.ts — covers the input guards, the decode-failure
 * fallback, and the protobuf success path. The success path round-trips a
 * real FeedMessage through gtfs-realtime-bindings (encode → decode), proving
 * the static ESM import and the v2 generated API.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import { GtfsRtDecoder } from "../decoders/gtfs-rt-decoder.js";

const { transit_realtime } = gtfsRealtimeBindings;

/** Encode a minimal valid GTFS-RT TripUpdate feed with the real bindings. */
function encodeFeed(entities: Record<string, unknown>[]): Uint8Array {
    const payload = {
        header: { gtfsRealtimeVersion: "2.0" },
        entity: entities,
    };
    const invalid = transit_realtime.FeedMessage.verify(payload);
    if (invalid) throw new Error(invalid);
    return transit_realtime.FeedMessage.encode(
        transit_realtime.FeedMessage.fromObject(payload)
    ).finish();
}

describe("GtfsRtDecoder", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns [] for non-binary input", () => {
        const dec = new GtfsRtDecoder();
        expect(dec.decode(null)).toEqual([]);
        expect(dec.decode("not binary")).toEqual([]);
        expect(dec.decode({ foo: 1 })).toEqual([]);
        expect(dec.decode(undefined)).toEqual([]);
    });

    it("accepts an ArrayBuffer and returns [] when the feed cannot be decoded", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const dec = new GtfsRtDecoder();
        const buf = new ArrayBuffer(8);
        expect(dec.decode(buf)).toEqual([]);
    });

    it("accepts a typed-array view (Uint8Array)", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const dec = new GtfsRtDecoder({ idField: "stop_id", delayField: "delay" });
        const view = new Uint8Array([0, 1, 2, 3, 4]);
        expect(dec.decode(view)).toEqual([]);
    });

    it("uses the default empty mapping when none is provided", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const dec = new GtfsRtDecoder();
        expect(dec.decode(new Uint8Array([9, 9]))).toEqual([]);
    });

    it("decodes a real TripUpdate feed (default trip_id mapping)", () => {
        const bytes = encodeFeed([
            {
                id: "entity-1",
                tripUpdate: {
                    trip: { tripId: "TRIP-42" },
                    stopTimeUpdate: [{ stopId: "STOP-7", departure: { delay: 120 } }],
                },
            },
        ]);

        const updates = new GtfsRtDecoder().decode(bytes);

        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe("TRIP-42");
        expect(updates[0].action).toBe("upsert");
        expect(updates[0].properties?.delay).toBe(120);
        expect(typeof updates[0].properties?._realtimeUpdatedAt).toBe("number");
    });

    it("maps on stop_id and falls back to the arrival delay", () => {
        const bytes = encodeFeed([
            {
                id: "entity-1",
                tripUpdate: {
                    trip: { tripId: "TRIP-42" },
                    stopTimeUpdate: [{ stopId: "STOP-7", arrival: { delay: -30 } }],
                },
            },
        ]);

        const updates = new GtfsRtDecoder({ idField: "stop_id" }).decode(bytes);

        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe("STOP-7");
        expect(updates[0].properties?.delay).toBe(-30);
    });

    it("skips entities without a tripUpdate", () => {
        const bytes = encodeFeed([
            { id: "vehicle-only" },
            {
                id: "entity-2",
                tripUpdate: { trip: { tripId: "TRIP-9" }, stopTimeUpdate: [] },
            },
        ]);

        const updates = new GtfsRtDecoder().decode(bytes);

        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe("TRIP-9");
        expect(updates[0].properties?.delay).toBe(0);
    });
});
