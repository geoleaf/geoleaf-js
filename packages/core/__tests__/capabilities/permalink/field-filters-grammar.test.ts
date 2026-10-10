/**
 * The per-field filter grammar of a permalink — `gl_f.<descriptor id>=<value>`.
 *
 * The permalink ranged the filter by KIND, in four fixed slots (`gl_filter`, `gl_cats`,
 * `gl_tags`, `gl_rating`): two fields of the same kind shared one slot, a range kept its lower
 * bound only, and the sub-categories of a taxonomy field lost the category they were checked
 * under. One parameter per FIELD carries each of them.
 *
 * This file holds the grammar alone — pure functions, no URL, no filter capability: what one
 * field becomes, and what it is read back as. The kind is NOT in the URL: it comes from the
 * descriptor the entry is read for.
 */
import { describe, expect, it } from "vitest";

import {
    decodeFieldFilter,
    encodeFieldFilter,
    facetOfKind,
    sanitizeFieldFilters,
} from "../../../src/capabilities/permalink/permalink-field-filters.js";
import type { PermalinkFilterField } from "../../../src/capabilities/permalink/types.js";

/** Encodes fields into the entry map a URL carries. */
function entriesOf(...fields: PermalinkFilterField[]): Record<string, string> {
    return Object.fromEntries(fields.flatMap((f) => encodeFieldFilter(f)));
}

/** Round trip of one field, read back for a descriptor of the same id and kind. */
function roundTrip(field: PermalinkFilterField): PermalinkFilterField | null {
    return decodeFieldFilter({ id: field.id, kind: field.kind }, entriesOf(field));
}

describe("one entry per field", () => {
    it("a text field is its query, as typed", () => {
        expect(entriesOf({ id: "recherche", kind: "text", text: "parc, lac / forêt" })).toEqual({
            recherche: "parc, lac / forêt",
        });
    });

    it("a tag field is its values, comma-separated", () => {
        expect(entriesOf({ id: "tags", kind: "tag", values: ["gratuit", "famille"] })).toEqual({
            tags: "gratuit,famille",
        });
    });

    it("a range is `min..max`, and an open bound is simply absent", () => {
        const range = (r: { min?: number; max?: number }) =>
            entriesOf({ id: "altitude", kind: "range", range: r });
        expect(range({ min: 100, max: 500 })).toEqual({ altitude: "100..500" });
        expect(range({ min: 100 })).toEqual({ altitude: "100.." });
        expect(range({ max: 500 })).toEqual({ altitude: "..500" });
        expect(range({ min: -2.5, max: 0.5 })).toEqual({ altitude: "-2.5..0.5" });
    });

    it("a taxonomy field carries its values, and its sub-categories with their category", () => {
        expect(
            entriesOf({
                id: "categories",
                kind: "taxonomy",
                values: ["eau", "foret", "source", "pin"],
                subValues: [
                    { value: "source", category: "eau" },
                    { value: "pin", category: "foret" },
                ],
            })
        ).toEqual({
            categories: "eau,foret,source,pin",
            "categories.sub": "eau/source,foret/pin",
        });
    });

    it("writes nothing for a field that constrains nothing, nor for a kind it does not carry", () => {
        expect(entriesOf({ id: "q", kind: "text", text: "" })).toEqual({});
        expect(entriesOf({ id: "t", kind: "tag", values: [] })).toEqual({});
        expect(entriesOf({ id: "r", kind: "range", range: {} })).toEqual({});
        expect(entriesOf({ id: "b", kind: "boolean", bool: true })).toEqual({});
        expect(
            entriesOf({
                id: "p",
                kind: "proximity",
                proximity: { center: { lat: 1, lng: 2 }, radiusKm: 3 },
            })
        ).toEqual({});
    });
});

describe("read back for the descriptor it names", () => {
    it("🛑 two fields of the same kind keep each their own value", () => {
        const entries = entriesOf(
            { id: "altitude", kind: "range", range: { min: 100, max: 500 } },
            { id: "prix", kind: "range", range: { max: 20 } }
        );
        expect(decodeFieldFilter({ id: "altitude", kind: "range" }, entries)?.range).toEqual({
            min: 100,
            max: 500,
        });
        expect(decodeFieldFilter({ id: "prix", kind: "range" }, entries)?.range).toEqual({
            max: 20,
        });
    });

    it("🛑 a range comes back with both bounds, or the one it had", () => {
        const back = (r: { min?: number; max?: number }) =>
            roundTrip({ id: "altitude", kind: "range", range: r })?.range;
        expect(back({ min: 100, max: 500 })).toEqual({ min: 100, max: 500 });
        expect(back({ max: 500 })).toEqual({ max: 500 });
        expect(back({ min: -2.5 })).toEqual({ min: -2.5 });
    });

    it("🛑 the sub-categories come back paired with their category", () => {
        const field: PermalinkFilterField = {
            id: "categories",
            kind: "taxonomy",
            values: ["eau", "source", "source"],
            subValues: [
                { value: "source", category: "eau" },
                { value: "source", category: "foret" },
            ],
        };
        expect(roundTrip(field)).toEqual(field);
    });

    it("a value holding the grammar's own separators survives the round trip", () => {
        const tags: PermalinkFilterField = {
            id: "tags",
            kind: "tag",
            values: ["a,b", "c/d", "100%", "e..f"],
        };
        expect(roundTrip(tags)?.values).toEqual(["a,b", "c/d", "100%", "e..f"]);

        const taxonomy: PermalinkFilterField = {
            id: "c",
            kind: "taxonomy",
            values: ["a/b", "x,y"],
            subValues: [{ value: "x,y", category: "a/b" }],
        };
        expect(roundTrip(taxonomy)).toEqual(taxonomy);
    });

    it("an entry is read by the kind of its DESCRIPTOR — the URL does not name one", () => {
        const entries = { champ: "a,b" };
        expect(decodeFieldFilter({ id: "champ", kind: "text" }, entries)?.text).toBe("a,b");
        expect(decodeFieldFilter({ id: "champ", kind: "tag" }, entries)?.values).toEqual([
            "a",
            "b",
        ]);
        // Not an interval: nothing is applied, rather than a bound guessed.
        expect(decodeFieldFilter({ id: "champ", kind: "range" }, entries)).toBeNull();
    });

    it("no entry, or a kind the permalink does not carry: nothing", () => {
        expect(decodeFieldFilter({ id: "absent", kind: "text" }, {})).toBeNull();
        expect(decodeFieldFilter({ id: "b", kind: "boolean" }, { b: "1" })).toBeNull();
        expect(decodeFieldFilter({ id: "p", kind: "proximity" }, { p: "1,2,3" })).toBeNull();
    });

    it("🛑 refuses what is not a finite interval", () => {
        const read = (raw: string) =>
            decodeFieldFilter({ id: "r", kind: "range" }, { r: raw })?.range ?? null;
        expect(read("..")).toBeNull();
        expect(read("abc..def")).toBeNull();
        // One side unreadable: the entry is refused whole — a bound is never guessed.
        expect(read("1e400..2")).toBeNull();
        expect(read("1..x")).toBeNull();
        expect(read("Infinity..")).toBeNull();
        expect(read("10")).toBeNull();
        expect(read("1..2..3")).toBeNull();
    });

    it("ignores a sub-category pair that is not one", () => {
        const back = decodeFieldFilter(
            { id: "c", kind: "taxonomy" },
            { c: "eau,source", "c.sub": "eau/source,orpheline,/vide,cat/" }
        );
        expect(back?.subValues).toEqual([{ value: "source", category: "eau" }]);
    });

    it("caps what a forged link could carry", () => {
        const long = "x".repeat(5000);
        expect(decodeFieldFilter({ id: "q", kind: "text" }, { q: long })?.text).toHaveLength(200);
        const many = Array.from({ length: 500 }, (_, i) => `v${i}`).join(",");
        expect(decodeFieldFilter({ id: "t", kind: "tag" }, { t: many })?.values).toHaveLength(100);
    });
});

describe("what a link may carry at all", () => {
    it("keeps string entries, and nothing else", () => {
        expect(sanitizeFieldFilters({ a: "1", b: 2, c: null, d: ["x"], e: "" })).toEqual({
            a: "1",
        });
    });

    it("is undefined for what is not a map, or holds nothing usable", () => {
        for (const raw of [null, undefined, "a=1", 3, ["a"], {}, { a: 1 }]) {
            expect(sanitizeFieldFilters(raw)).toBeUndefined();
        }
    });

    it("🛑 never takes a key that would reach the prototype", () => {
        const forged = JSON.parse('{"__proto__":"x","constructor":"y","prototype":"z","ok":"1"}');
        const kept = sanitizeFieldFilters(forged);
        expect(kept).toEqual({ ok: "1" });
        expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
    });

    it("caps the number of entries, their keys and their values", () => {
        const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${i}`, "v"]));
        expect(Object.keys(sanitizeFieldFilters(many) ?? {})).toHaveLength(50);
        expect(sanitizeFieldFilters({ ["k".repeat(500)]: "v" })).toBeUndefined();
        const kept = sanitizeFieldFilters({ a: "v".repeat(10_000) });
        expect(kept?.["a"]?.length).toBeLessThanOrEqual(4000);
    });
});

describe("the facet that gates each kind", () => {
    it("maps the four kinds the permalink carries to the whitelist's own names", () => {
        expect(facetOfKind("text")).toBe("filter");
        expect(facetOfKind("taxonomy")).toBe("categories");
        expect(facetOfKind("tag")).toBe("tags");
        expect(facetOfKind("range")).toBe("rating");
    });

    it("has none for a kind the permalink does not carry", () => {
        expect(facetOfKind("boolean")).toBeNull();
        expect(facetOfKind("proximity")).toBeNull();
        expect(facetOfKind("toString")).toBeNull();
    });
});
