/**
 * @tests built-in/ui/roving-tabindex — index arithmetic for roving-tabindex widgets
 *
 * Extracted in KERNEL S8 from two identical inline blocks (mobile-toolbar-pill +
 * desktop-panel). Neither was covered: the logic lived inside untested `keydown`
 * handlers, so the gap was invisible until extraction surfaced it as a 0 % file.
 *
 * Pure function — no DOM, no globals.
 */
import { resolveRovingIndex } from "../../src/kernel/ui/roving-tabindex.js";

describe("resolveRovingIndex", () => {
    describe("forward navigation", () => {
        it.each([
            ["ArrowDown", 0, 4, 1],
            ["ArrowRight", 0, 4, 1],
            ["ArrowDown", 2, 4, 3],
        ])("%s from %i of %i → %i", (key, idx, count, expected) => {
            expect(resolveRovingIndex(key, idx, count)).toBe(expected);
        });

        it("wraps from the last item back to the first", () => {
            expect(resolveRovingIndex("ArrowDown", 3, 4)).toBe(0);
        });
    });

    describe("backward navigation", () => {
        it.each([
            ["ArrowUp", 3, 4, 2],
            ["ArrowLeft", 3, 4, 2],
            ["ArrowUp", 1, 4, 0],
        ])("%s from %i of %i → %i", (key, idx, count, expected) => {
            expect(resolveRovingIndex(key, idx, count)).toBe(expected);
        });

        it("wraps from the first item back to the last (no negative index)", () => {
            expect(resolveRovingIndex("ArrowUp", 0, 4)).toBe(3);
        });
    });

    describe("Home / End", () => {
        it("Home jumps to the first item", () => {
            expect(resolveRovingIndex("Home", 3, 4)).toBe(0);
        });

        it("End jumps to the last item", () => {
            expect(resolveRovingIndex("End", 0, 4)).toBe(3);
        });
    });

    describe("non-navigation keys", () => {
        it.each(["Enter", " ", "Tab", "Escape", "a", "Shift"])(
            "%s returns null so the caller skips preventDefault()",
            (key) => {
                expect(resolveRovingIndex(key, 1, 4)).toBeNull();
            }
        );
    });

    describe("degenerate inputs", () => {
        it("returns null when there is nothing to focus", () => {
            expect(resolveRovingIndex("ArrowDown", 0, 0)).toBeNull();
        });

        it("stays on the only item in a single-item widget", () => {
            expect(resolveRovingIndex("ArrowDown", 0, 1)).toBe(0);
            expect(resolveRovingIndex("ArrowUp", 0, 1)).toBe(0);
            expect(resolveRovingIndex("End", 0, 1)).toBe(0);
        });
    });
});
