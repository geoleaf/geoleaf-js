/**
 * @geoleaf-plugins/routing — what a normaliser does with a response it did not expect
 *
 * A provider is a third party. It answers what it answers, and the shapes below are not
 * hypothetical: an unnamed way, a manoeuvre without a direction, an imperial unit setting, a
 * manoeuvre type outside the published table. Each of these has ONE right answer, and picking
 * the wrong one produces a route that renders — which is why they are pinned rather than left
 * to the defensive operators that implement them.
 */
import { describe, it, expect } from "vitest";
import { normalizeOsrm } from "../normalize-osrm.js";
import { normalizeValhalla } from "../normalize-valhalla.js";

/** A minimal OSRM response with one leg and one step. */
function osrmWith(step: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        code: "Ok",
        routes: [
            {
                distance: 10,
                duration: 5,
                geometry: "",
                legs: [{ distance: 10, duration: 5, steps: [step] }],
            },
        ],
        waypoints: [{ location: [55.4, -20.9] }],
        ...extra,
    };
}

describe("OSRM — degraded responses", () => {
    it('keeps an unnamed way as `""`, never as a fabricated label', () => {
        // "Unnamed road" would put a string nobody wrote in front of a user, in a language
        // nobody chose. The empty name is a FACT about the map.
        const r = normalizeOsrm(
            osrmWith({ distance: 10, duration: 5, maneuver: { type: "turn" } })
        );
        expect(r!.legs[0].steps[0].name).toBe("");
    });

    it("omits `modifier` entirely when the manoeuvre carries no direction", () => {
        // Absent, not `""`. A consumer rendering `modifier` would otherwise draw a blank arrow.
        const r = normalizeOsrm(
            osrmWith({ distance: 10, duration: 5, maneuver: { type: "depart" } })
        );
        expect("modifier" in r!.legs[0].steps[0]).toBe(false);
    });

    it("falls back to [0, 0] on a manoeuvre without a usable location", () => {
        const r = normalizeOsrm(osrmWith({ maneuver: { type: "turn", location: [55.4] } }));
        expect(r!.legs[0].steps[0].location).toEqual([0, 0]);
    });

    it("drops an empty waypoint name rather than carrying it", () => {
        const r = normalizeOsrm(
            osrmWith(
                { maneuver: { type: "turn" } },
                { waypoints: [{ name: "", location: [55.4, -20.9] }] }
            )
        );
        expect("name" in r!.waypoints[0]).toBe(false);
    });

    it("keeps a waypoint name when the provider gives one", () => {
        const r = normalizeOsrm(
            osrmWith(
                { maneuver: { type: "turn" } },
                { waypoints: [{ name: "Rue X", location: [55.4, -20.9] }] }
            )
        );
        expect(r!.waypoints[0].name).toBe("Rue X");
    });

    it("answers null on a route with no legs at all", () => {
        expect(normalizeOsrm({ code: "Ok", routes: [{ legs: [] }] })).toBeNull();
    });
});

describe("Valhalla — degraded responses", () => {
    /** A minimal Valhalla response with one leg and one manoeuvre. */
    function valhallaWith(maneuver: Record<string, unknown>, units = "kilometers") {
        return {
            trip: {
                status: 0,
                units,
                summary: { length: 1, time: 60 },
                legs: [{ summary: { length: 1, time: 60 }, shape: "", maneuvers: [maneuver] }],
                locations: [{ lat: -20.9, lon: 55.4 }],
            },
        };
    }

    it("converts MILES to metres when the response is not metric", () => {
        // ⚠️ The unit lives in the response, not in the request we think we sent. A server that
        // ignores `units` and answers miles would otherwise be read as kilometres — a 60 % error
        // that looks entirely plausible.
        const r = normalizeValhalla(valhallaWith({ type: 10, length: 1, time: 60 }, "miles"));
        expect(r!.distance).toBeCloseTo(1609.344, 2);
    });

    it("takes the FIRST street name, never a join of all of them", () => {
        // A way can carry several names. "A1 / E15 / Route du Nord" is not a street name.
        const r = normalizeValhalla(valhallaWith({ type: 10, street_names: ["A1", "E15"] }));
        expect(r!.legs[0].steps[0].name).toBe("A1");
    });

    it('keeps a manoeuvre without street names as `""`', () => {
        const r = normalizeValhalla(valhallaWith({ type: 10 }));
        expect(r!.legs[0].steps[0].name).toBe("");
    });

    it("omits `instruction` when the server sent no narrative", () => {
        // Asking without a language is legitimate. Carrying `""` would make a mute step look
        // like a step whose instruction is blank.
        const r = normalizeValhalla(valhallaWith({ type: 10 }));
        expect("instruction" in r!.legs[0].steps[0]).toBe(false);
    });

    it("maps an unknown manoeuvre type to `continue` rather than to nothing", () => {
        // Valhalla may publish a type this table does not know. `continue/straight` renders as
        // "keep going", which is the only wrong-but-harmless answer available — an empty
        // manoeuvre would render as no arrow at all, which reads as "no instruction here".
        const r = normalizeValhalla(valhallaWith({ type: 999 }));
        expect(r!.legs[0].steps[0].maneuver).toBe("continue");
        expect(r!.legs[0].steps[0].modifier).toBe("straight");
    });

    it("swaps {lat, lon} into [lon, lat]", () => {
        const r = normalizeValhalla(valhallaWith({ type: 10 }));
        expect(r!.waypoints[0].coordinates).toEqual([55.4, -20.9]);
    });

    it("survives a leg with no shape at all", () => {
        const r = normalizeValhalla(valhallaWith({ type: 10 }));
        expect(r!.geometry).toBe("");
    });
});
