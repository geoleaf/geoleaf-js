/**
 * json-decoder.test.ts — tests for JsonDecoder
 */
import { describe, it, expect } from "vitest";
import { JsonDecoder } from "../decoders/json-decoder.js";

describe("JsonDecoder", () => {
    const decoder = new JsonDecoder();

    // ── FeatureCollection ────────────────────────────────────────────────────

    it("decodes a FeatureCollection", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", id: "f1", properties: { name: "A" }, geometry: null },
                { type: "Feature", id: "f2", properties: { name: "B" }, geometry: null },
            ],
        };
        const updates = decoder.decode(fc);
        expect(updates).toHaveLength(2);
        expect(updates[0].id).toBe("f1");
        expect(updates[0].properties?.name).toBe("A");
        expect(updates[1].id).toBe("f2");
    });

    it("decodes a FeatureCollection with numeric id", () => {
        const fc = {
            type: "FeatureCollection",
            features: [{ type: "Feature", id: 42, properties: {}, geometry: null }],
        };
        const updates = decoder.decode(fc);
        expect(updates[0].id).toBe("42");
    });

    it("decodes a FeatureCollection with empty features array", () => {
        const fc = { type: "FeatureCollection", features: [] };
        expect(decoder.decode(fc)).toHaveLength(0);
    });

    // ── Feature array ────────────────────────────────────────────────────────

    it("decodes an array of features", () => {
        const features = [
            { type: "Feature", id: "a", properties: { x: 1 }, geometry: null },
            { type: "Feature", id: "b", properties: { x: 2 }, geometry: null },
        ];
        const updates = decoder.decode(features);
        expect(updates).toHaveLength(2);
        expect(updates[0].id).toBe("a");
        expect(updates[1].id).toBe("b");
    });

    // ── Single feature ───────────────────────────────────────────────────────

    it("decodes a single Feature object", () => {
        const feature = { type: "Feature", id: "solo", properties: { val: 99 }, geometry: null };
        const updates = decoder.decode(feature);
        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe("solo");
        expect(updates[0].properties?.val).toBe(99);
    });

    // ── String input ─────────────────────────────────────────────────────────

    it("parses a JSON string input (FeatureCollection)", () => {
        const json = JSON.stringify({
            type: "FeatureCollection",
            features: [{ type: "Feature", id: "str1", properties: {}, geometry: null }],
        });
        const updates = decoder.decode(json);
        expect(updates[0].id).toBe("str1");
    });

    it("returns empty array for invalid JSON string", () => {
        expect(decoder.decode("not-json")).toHaveLength(0);
    });

    // ── ID fallback ──────────────────────────────────────────────────────────

    it("falls back to properties.id when feature.id is absent", () => {
        const feature = { type: "Feature", properties: { id: "prop-id" }, geometry: null };
        const updates = decoder.decode(feature);
        expect(updates[0].id).toBe("prop-id");
    });

    it("falls back to properties._id as second choice", () => {
        const feature = { type: "Feature", properties: { _id: "underscore-id" }, geometry: null };
        const updates = decoder.decode(feature);
        expect(updates[0].id).toBe("underscore-id");
    });

    it("produces empty id when no id field exists", () => {
        const feature = { type: "Feature", properties: {}, geometry: null };
        const updates = decoder.decode(feature);
        expect(updates[0].id).toBe("");
    });

    // ── Geometry passthrough ─────────────────────────────────────────────────

    it("passes through Point geometry", () => {
        const feature = {
            type: "Feature",
            id: "g1",
            properties: {},
            geometry: { type: "Point", coordinates: [2.3, 48.8] },
        };
        const updates = decoder.decode(feature);
        expect(updates[0].geometry?.type).toBe("Point");
    });

    // ── Edge cases ───────────────────────────────────────────────────────────

    it("returns empty array for null input", () => {
        expect(decoder.decode(null)).toHaveLength(0);
    });

    it("returns empty array for unknown object", () => {
        expect(decoder.decode({ foo: "bar" })).toHaveLength(0);
    });

    it("returns empty array for undefined", () => {
        expect(decoder.decode(undefined)).toHaveLength(0);
    });

    it("action is always 'upsert'", () => {
        const feature = { type: "Feature", id: "x", properties: {}, geometry: null };
        expect(decoder.decode(feature)[0].action).toBe("upsert");
    });
});
