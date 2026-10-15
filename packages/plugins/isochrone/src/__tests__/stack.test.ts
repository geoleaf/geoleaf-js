/**
 * @geoleaf-plugins/isochrone — the stack, without a map
 *
 * The rank rule, the palette rule and the order of the rows, held on the pure model alone.
 */
import { describe, expect, it } from "vitest";

import type { IsochroneLayer } from "../model.js";
import { changedRanks, LayerStack, pickColours } from "../stack.js";

/**
 * A zone with only what a test names set.
 *
 * @param id Its identifier.
 * @param extra Members to override.
 * @returns The zone.
 */
function zone(id: string, extra: Partial<IsochroneLayer> = {}): IsochroneLayer {
    return {
        id,
        origin: [55.45, -20.88],
        mode: "car",
        minutes: 10,
        color: "#3987e5",
        opacity: 0.25,
        visible: true,
        attribution: "© Test data",
        ...extra,
    };
}

/**
 * A stack holding zones, top first.
 *
 * @param ids Their identifiers.
 * @returns The stack.
 */
function stackOf(...ids: string[]): LayerStack {
    const stack = new LayerStack();
    stack.addOnTop(ids.map((id) => zone(id)));
    return stack;
}

describe("LayerStack — ranks", () => {
    it("ranks the top row highest, every rank strictly between the base and the base + 1", () => {
        const ranks = stackOf("a", "b", "c").ranks(50);
        expect(ranks.get("a")).toBeCloseTo(50.03);
        expect(ranks.get("b")).toBeCloseTo(50.02);
        expect(ranks.get("c")).toBeCloseTo(50.01);
    });

    it("keeps a full stack of 99 zones below the base + 1", () => {
        const stack = stackOf(...Array.from({ length: 99 }, (_, i) => `z${i}`));
        const ranks = [...stack.ranks(50).values()];
        expect(Math.max(...ranks)).toBeLessThan(51);
        expect(Math.min(...ranks)).toBeGreaterThan(50);
    });

    it("changes no rank already given when zones are added on top", () => {
        const stack = stackOf("a", "b");
        const before = stack.ranks(50);
        stack.addOnTop([zone("new1"), zone("new2")]);
        expect(changedRanks(before, stack.ranks(50))).toEqual([]);
        expect(stack.list().map((l) => l.id)).toEqual(["new1", "new2", "a", "b"]);
    });

    it("lists only the zones present on both sides whose rank moved, top first", () => {
        const stack = stackOf("a", "b", "c");
        const before = stack.ranks(50);
        stack.move("c", 0);
        expect(changedRanks(before, stack.ranks(50)).map((m) => m.id)).toEqual(["c", "a", "b"]);
    });

    it("re-ranks only the rows above a removed one", () => {
        const stack = stackOf("a", "b", "c", "d");
        const before = stack.ranks(50);
        stack.remove("c");
        expect(changedRanks(before, stack.ranks(50)).map((m) => m.id)).toEqual(["a", "b"]);
    });
});

describe("LayerStack — rows", () => {
    it("moves a zone to a row, the others keeping their order", () => {
        const stack = stackOf("a", "b", "c", "d");
        expect(stack.move("a", 2)).toBe(true);
        expect(stack.list().map((l) => l.id)).toEqual(["b", "c", "a", "d"]);
        expect(stack.move("d", 0)).toBe(true);
        expect(stack.list().map((l) => l.id)).toEqual(["d", "b", "c", "a"]);
    });

    it.each([[-1], [4], [1.5], [Number.NaN]])("refuses the row %s, and moves nothing", (row) => {
        const stack = stackOf("a", "b", "c", "d");
        expect(stack.move("a", row)).toBe(false);
        expect(stack.list().map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("answers false or null for an unknown id, and changes nothing", () => {
        const stack = stackOf("a");
        expect(stack.move("nope", 0)).toBe(false);
        expect(stack.update("nope", { visible: false })).toBeNull();
        expect(stack.remove("nope")).toBeNull();
        expect(stack.get("nope")).toBeNull();
        expect(stack.size).toBe(1);
    });

    it("updates a zone in place, keeping its row", () => {
        const stack = stackOf("a", "b");
        expect(stack.update("b", { color: "#000000", visible: false })).toMatchObject({
            id: "b",
            color: "#000000",
            visible: false,
        });
        expect(stack.list().map((l) => [l.id, l.visible])).toEqual([
            ["a", true],
            ["b", false],
        ]);
    });

    it("hands out copies: changing one changes nothing in the stack", () => {
        const stack = stackOf("a");
        const [copy] = stack.list();
        if (copy) (copy as { color: string }).color = "#000000";
        expect(stack.get("a")?.color).toBe("#3987e5");
    });

    it("empties, and answers what it held", () => {
        const stack = stackOf("a", "b");
        expect(stack.clear().map((l) => l.id)).toEqual(["a", "b"]);
        expect(stack.size).toBe(0);
    });
});

describe("pickColours", () => {
    const palette = ["#111111", "#222222", "#333333"];

    it("gives the first colours no zone wears", () => {
        expect(pickColours(["#111111"], palette, 2)).toEqual(["#222222", "#333333"]);
    });

    it("gives the one worn the fewest times once all are worn, the earliest on a tie", () => {
        expect(pickColours(palette, palette, 1)).toEqual(["#111111"]);
        expect(pickColours([...palette, "#111111"], palette, 2)).toEqual(["#222222", "#333333"]);
    });

    it("never gives one colour twice in a batch while another is free", () => {
        expect(pickColours([], palette, 4)).toEqual(["#111111", "#222222", "#333333", "#111111"]);
    });

    it("ignores a worn colour the palette does not have", () => {
        expect(pickColours(["#abcdef"], palette, 1)).toEqual(["#111111"]);
    });
});
