/**
 * @geoleaf-plugins/routing — normalisation against the captured corpus
 *
 * These assertions are what "the model is frozen AGAINST a corpus" means. They run the two
 * normalisers over real provider answers to the SAME three-waypoint trip, and check the
 * properties that a model frozen before the corpus would have got wrong — each of which was
 * measured on these very files, not assumed.
 *
 * 🛑 **No network here, ever.** The corpus is versioned; `scripts/capture-route-fixtures.cjs` is
 * the only code in the repository that talks to a provider, and nothing runs it automatically.
 * A test hitting a public instance is subject to a fair-use quota and makes the run
 * non-reproducible: its red would say "the internet moved", which nobody can act on.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeOsrm } from "../normalize-osrm.js";
import { normalizeValhalla } from "../normalize-valhalla.js";
import { decodePolyline } from "../polyline.js";
import type { RouteResult } from "../model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../fixtures");

/**
 * Reads one fixture.
 *
 * @param name File name under `fixtures/`.
 * @returns The parsed body.
 */
function fixture(name: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

const osrm = normalizeOsrm(fixture("osrm-reunion-3-waypoints.json"));
const valhalla = normalizeValhalla(fixture("valhalla-reunion-3-waypoints.json"));

/** The two normalised results, so every property below is asserted on BOTH. */
const CASES: readonly (readonly [string, RouteResult | null])[] = [
    ["osrm", osrm],
    ["valhalla", valhalla],
];

describe("corpus", () => {
    it("is not empty — anti-vacuous-suite", () => {
        // Every assertion below iterates CASES. A corpus that failed to load would make the
        // whole file pass by iterating nothing, which is the failure mode this repo names most
        // often. Assert the count first.
        expect(fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))).toHaveLength(2);
        expect(CASES).toHaveLength(2);
    });
});

describe.each(CASES)("normalisation — %s", (name, route) => {
    it("yields a route at all", () => {
        expect(route).not.toBeNull();
    });

    it("carries one leg per consecutive waypoint pair", () => {
        // Three waypoints were requested, so two legs. One leg would make the sum invariant
        // below vacuously true, which is why the corpus uses three points and not two.
        expect(route!.legs).toHaveLength(2);
    });

    it("has a total that EQUALS the sum of its legs", () => {
        const sum = route!.legs.reduce((a, l) => a + l.distance, 0);
        // Tolerance, not equality: Valhalla answers kilometres with three decimals, so the
        // conversion to metres lands on a float. 1 metre over an 80 km trip is ~0.001 %, far
        // under anything a consumer can act on — and far over what a lost leg would cost.
        expect(Math.abs(sum - route!.distance)).toBeLessThan(1);
    });

    it("has a duration that equals the sum of its legs", () => {
        const sum = route!.legs.reduce((a, l) => a + l.duration, 0);
        expect(Math.abs(sum - route!.duration)).toBeLessThan(1);
    });

    it("has NO empty leg — every leg carries manoeuvres", () => {
        for (const leg of route!.legs) expect(leg.steps.length).toBeGreaterThan(0);
    });

    it("reports distances in METRES, not in the provider's own unit", () => {
        // The trip is ~80 km. Valhalla answers `80.778` (kilometres); a normaliser that forgot
        // the conversion would report 80, and every downstream threshold — "recompute beyond
        // 50 m off route" — would silently become nonsense. The window is wide on purpose: it
        // is testing the ORDER OF MAGNITUDE, not the routing engine's choice of road.
        expect(route!.distance).toBeGreaterThan(50_000);
        expect(route!.distance).toBeLessThan(150_000);
    });

    it("names itself, so a diagnostic can say which engine answered", () => {
        expect(route!.provider).toBe(name);
    });

    it("carries a geometry that decodes AT PRECISION 5 to Réunion", () => {
        // 🛑 The assertion that would have caught the most expensive defect of this sprint.
        // OSRM encodes at 1e5 and Valhalla at 1e6; decoded at the wrong factor, Valhalla's
        // route reads latitude −208, which is not a wrong place but an impossible one. The
        // model pins precision 5, so BOTH must decode there.
        const points = decodePolyline(route!.geometry, 5);
        expect(points.length).toBeGreaterThan(100);
        for (const [lon, lat] of [points[0], points[points.length - 1]]) {
            expect(lat).toBeGreaterThan(-21.5);
            expect(lat).toBeLessThan(-20.5);
            expect(lon).toBeGreaterThan(55.0);
            expect(lon).toBeLessThan(56.0);
        }
    });

    it("carries waypoints in [longitude, latitude] order", () => {
        // Réunion sits at lon ~55, lat ~−21. Swapped, the first value would be negative and the
        // second above 55 — a check that only works because the island is nowhere near the
        // equator, and that is precisely why the corpus is not near it either.
        expect(route!.waypoints.length).toBeGreaterThanOrEqual(2);
        for (const wp of route!.waypoints) {
            const [lon, lat] = wp.coordinates;
            expect(lon).toBeGreaterThan(0);
            expect(lat).toBeLessThan(0);
        }
    });
});

describe("the two providers describe the SAME journey", () => {
    it("agree on the total distance within 5 %", () => {
        // Not equality: two engines pick different roads. But an agreement this close is what
        // makes the shared model credible — two results that disagreed by an order of magnitude
        // would mean one of the normalisers is converting something the other is not.
        const spread = Math.abs(osrm!.distance - valhalla!.distance);
        expect(spread / osrm!.distance).toBeLessThan(0.05);
    });

    it("agree on the number of legs", () => {
        expect(osrm!.legs.length).toBe(valhalla!.legs.length);
    });
});

describe("what the corpus proves about the PROVIDERS, not about us", () => {
    it("valhalla carries a localised narrative on every manoeuvre", () => {
        const steps = valhalla!.legs.flatMap((l) => l.steps);
        expect(
            steps.every((s) => typeof s.instruction === "string" && s.instruction.length > 0)
        ).toBe(true);
        // The reason this engine is first rank, in the corpus rather than in a claim.
        expect(steps.some((s) => /gauche|droite|Continuez|Tournez/.test(s.instruction!))).toBe(
            true
        );
    });

    it("osrm carries NONE — and that is a property of the provider", () => {
        // ⚠️ This is not a bug to fix later. The public OSRM instance emits no instruction text
        // at all. A guidance runtime that renders `step.instruction!` is correct against one
        // provider and blank against the other, and this assertion is here so that anyone
        // planning to rely on it finds out now rather than in a browser.
        const steps = osrm!.legs.flatMap((l) => l.steps);
        expect(steps.every((s) => s.instruction === undefined)).toBe(true);
    });

    it("both use the OSRM manoeuvre vocabulary once normalised", () => {
        const vocab = new Set(
            [...osrm!.legs, ...valhalla!.legs].flatMap((l) => l.steps.map((s) => s.maneuver))
        );
        expect(vocab.size).toBeGreaterThan(1);
        for (const v of vocab) expect(typeof v).toBe("string");
        // Both journeys start by departing and end by arriving, whatever the engine.
        expect(osrm!.legs[0].steps[0].maneuver).toBe("depart");
        expect(valhalla!.legs[0].steps[0].maneuver).toBe("depart");
    });
});

describe("a response that carries no route is answered with null, never with an empty shape", () => {
    it("osrm — a non-Ok code", () => {
        expect(normalizeOsrm({ code: "NoRoute", routes: [] })).toBeNull();
    });

    it("valhalla — a non-zero status", () => {
        expect(normalizeValhalla({ trip: { status: 171, legs: [] } })).toBeNull();
    });

    it("either — something that is not a response at all", () => {
        // An empty `RouteResult` would be indistinguishable from a zero-length route; `null` is
        // an ordinary answer, and the caller decides what to tell the user.
        expect(normalizeOsrm(null)).toBeNull();
        expect(normalizeValhalla("nonsense")).toBeNull();
    });
});
