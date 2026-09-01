/**
 * @geoleaf-plugins/routing — itinerary composition
 *
 * The four operations, and the one property that makes them safe: nothing about a waypoint's
 * position is STORED, so nothing about it can go out of step.
 */
import { describe, it, expect, vi } from "vitest";

let _cfg: Record<string, unknown> = {};
vi.mock("@geoleaf/host-runtime", () => ({ coreConfigGet: () => _cfg }));

const {
    addWaypoint,
    removeWaypoint,
    moveWaypoint,
    clearWaypoints,
    isRoutable,
    maxWaypoints,
    roleAt,
    DEFAULT_MAX_WAYPOINTS,
} = await import("../composition.js");

/** A waypoint with a recognisable name. */
const wp = (name: string) => ({ coordinates: [55.4, -20.9] as [number, number], name });
const names = (r: { ok: boolean } & Record<string, unknown>) =>
    (r as { waypoints: { name?: string }[] }).waypoints.map((w) => w.name);

describe("add", () => {
    it("appends at the end", () => {
        const r = addWaypoint([wp("a")], wp("b"), 10);
        expect(r.ok).toBe(true);
        expect(names(r)).toEqual(["a", "b"]);
    });

    it("refuses at the cap, and the refusal CARRIES the limit", () => {
        // A message that says "too many stops" without saying how many is a message the reader
        // cannot act on. The number is configured, so it has to travel with the refusal.
        const r = addWaypoint([wp("a"), wp("b")], wp("c"), 2);
        expect(r).toEqual({ ok: false, reason: "cap-reached", limit: 2 });
    });

    it("never mutates the list it was given", () => {
        const before = [wp("a")];
        addWaypoint(before, wp("b"), 10);
        expect(before).toHaveLength(1);
    });
});

describe("remove", () => {
    it("removes at the index and closes the gap", () => {
        const r = removeWaypoint([wp("a"), wp("b"), wp("c")], 1);
        expect(names(r)).toEqual(["a", "c"]);
    });

    it("refuses an index the list does not have", () => {
        for (const i of [-1, 3, 1.5, NaN]) {
            expect(removeWaypoint([wp("a"), wp("b"), wp("c")], i)).toEqual({
                ok: false,
                reason: "no-such-index",
            });
        }
    });

    it("ALLOWS going down to one waypoint, and to none", () => {
        // Refusing would trap someone replacing their origin: they would have to add the new one
        // first, which the cap may forbid.
        expect(names(removeWaypoint([wp("a"), wp("b")], 0))).toEqual(["b"]);
        expect(names(removeWaypoint([wp("a")], 0))).toEqual([]);
    });
});

describe("move — what a drag-and-drop performs", () => {
    it("moves forward", () => {
        expect(names(moveWaypoint([wp("a"), wp("b"), wp("c")], 0, 2))).toEqual(["b", "c", "a"]);
    });

    it("moves backward", () => {
        expect(names(moveWaypoint([wp("a"), wp("b"), wp("c")], 2, 0))).toEqual(["c", "a", "b"]);
    });

    it("refuses a move that goes nowhere, rather than answering an unchanged list", () => {
        // A caller that redraws on `ok` would otherwise repaint on every drag that ends where it
        // started.
        expect(moveWaypoint([wp("a"), wp("b")], 1, 1)).toEqual({ ok: false, reason: "no-op" });
    });

    it("refuses an index outside the list, on either side", () => {
        expect(moveWaypoint([wp("a"), wp("b")], 0, 5).ok).toBe(false);
        expect(moveWaypoint([wp("a"), wp("b")], 5, 0).ok).toBe(false);
    });
});

describe("the number and the role are DERIVED, so a reorder cannot desynchronise them", () => {
    it("assigns roles from the position alone", () => {
        expect([0, 1, 2, 3].map((i) => roleAt(i, 4))).toEqual([
            "origin",
            "via",
            "via",
            "destination",
        ]);
    });

    it("keeps the destination the LAST one after a move", () => {
        // 🛑 The assertion that pins the whole design. A stored role would survive this move and
        // the itinerary would carry two destinations, or none — and nothing would say so.
        const moved = moveWaypoint([wp("a"), wp("b"), wp("c")], 2, 0);
        const list = (moved as { waypoints: unknown[] }).waypoints;
        expect(roleAt(list.length - 1, list.length)).toBe("destination");
        expect(names(moved)[list.length - 1]).toBe("b");
    });

    it("calls a two-point itinerary origin-then-destination, with no via", () => {
        expect([0, 1].map((i) => roleAt(i, 2))).toEqual(["origin", "destination"]);
    });
});

describe("cap and routability", () => {
    it("uses the configured cap", () => {
        _cfg = { maxWaypoints: 4 };
        expect(maxWaypoints()).toBe(4);
    });

    it("refuses a cap below 2 — no itinerary can be described with fewer", () => {
        for (const bad of [1, 0, -3, NaN, "many"]) {
            _cfg = { maxWaypoints: bad };
            expect(maxWaypoints()).toBe(DEFAULT_MAX_WAYPOINTS);
        }
    });

    it("floors a fractional cap rather than rejecting it", () => {
        _cfg = { maxWaypoints: 5.9 };
        expect(maxWaypoints()).toBe(5);
    });

    it("is routable from two waypoints up", () => {
        _cfg = {};
        expect(isRoutable([])).toBe(false);
        expect(isRoutable([wp("a")])).toBe(false);
        expect(isRoutable([wp("a"), wp("b")])).toBe(true);
    });

    it("clears to an empty list, and never refuses", () => {
        expect(clearWaypoints()).toEqual({ ok: true, waypoints: [] });
    });
});
