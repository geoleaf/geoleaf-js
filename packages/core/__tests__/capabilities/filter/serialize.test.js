/**
 * Unit tests — capabilities/filter/serialize.ts (S13).
 *
 * ActiveField[] ⇄ SerializedFilterState mapping: descriptor stripping, km/metre
 * radius conversion, unknown-id and empty-selection dropping.
 */
import { describe, expect, it } from "vitest";

const { serializeActiveFilter, deserializeActiveFilter } = await import(
    "../../../src/capabilities/filter/serialize.ts"
);

const CONFIG = {
    enabled: true,
    fields: [
        { id: "q", kind: "text" },
        { id: "cats", kind: "taxonomy", field: "fclass", taxonomyRef: "poi" },
        { id: "tags", kind: "tag", field: "attributes.tags" },
        { id: "surf", kind: "range", field: "surface" },
        { id: "pmr", kind: "boolean", field: "acc" },
        { id: "near", kind: "proximity" },
    ],
};
const byId = Object.fromEntries(CONFIG.fields.map((f) => [f.id, f]));

describe("serializeActiveFilter", () => {
    it("strips the descriptor to id+kind and converts proximity metres → km", () => {
        const active = [
            { descriptor: byId.q, text: "mus" },
            { descriptor: byId.cats, values: ["CULT", "MUSEE"] },
            { descriptor: byId.surf, range: { min: 30 } },
            { descriptor: byId.pmr, bool: true },
            {
                descriptor: byId.near,
                proximity: { center: { lat: 48.85, lng: 2.35 }, radius: 5000 },
            },
        ];
        expect(serializeActiveFilter(active).fields).toEqual([
            { id: "q", kind: "text", text: "mus" },
            { id: "cats", kind: "taxonomy", values: ["CULT", "MUSEE"] },
            { id: "surf", kind: "range", range: { min: 30 } },
            { id: "pmr", kind: "boolean", bool: true },
            {
                id: "near",
                kind: "proximity",
                proximity: { center: { lat: 48.85, lng: 2.35 }, radiusKm: 5 },
            },
        ]);
    });

    it("omits empty payloads (no values / falsy bool / no range bound)", () => {
        const active = [
            { descriptor: byId.cats, values: [] },
            { descriptor: byId.pmr, bool: false },
            { descriptor: byId.surf, range: {} },
        ];
        // Fields are still listed (constrained set upstream) but carry no payload.
        expect(serializeActiveFilter(active).fields).toEqual([
            { id: "cats", kind: "taxonomy" },
            { id: "pmr", kind: "boolean" },
            { id: "surf", kind: "range" },
        ]);
    });
});

describe("deserializeActiveFilter", () => {
    it("re-matches ids to live descriptors and restores km → metres", () => {
        const state = {
            fields: [
                { id: "q", kind: "text", text: "mus" },
                {
                    id: "near",
                    kind: "proximity",
                    proximity: { center: { lat: 1, lng: 2 }, radiusKm: 5 },
                },
            ],
        };
        const active = deserializeActiveFilter(state, CONFIG);
        const out = Object.fromEntries(active.map((a) => [a.descriptor.id, a]));
        expect(out.q.descriptor).toBe(byId.q);
        expect(out.q.text).toBe("mus");
        expect(out.near.proximity).toEqual({ center: { lat: 1, lng: 2 }, radius: 5000 });
    });

    it("drops unknown ids (config changed since the URL was produced)", () => {
        const state = { fields: [{ id: "ghost", kind: "text", text: "x" }] };
        expect(deserializeActiveFilter(state, CONFIG)).toEqual([]);
    });

    it("drops entries with no effective constraint", () => {
        const state = {
            fields: [
                { id: "cats", kind: "taxonomy", values: [] },
                { id: "pmr", kind: "boolean", bool: false },
            ],
        };
        expect(deserializeActiveFilter(state, CONFIG)).toEqual([]);
    });

    it("round-trips serialize → deserialize", () => {
        const active = [
            { descriptor: byId.q, text: "abc" },
            { descriptor: byId.tags, values: ["free"] },
            { descriptor: byId.surf, range: { min: 12 } },
        ];
        const back = deserializeActiveFilter(serializeActiveFilter(active), CONFIG);
        expect(back.map((a) => [a.descriptor.id, a.text ?? a.values ?? a.range])).toEqual([
            ["q", "abc"],
            ["tags", ["free"]],
            ["surf", { min: 12 }],
        ]);
    });
});
