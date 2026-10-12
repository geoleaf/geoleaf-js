/**
 * @geoleaf-plugins/isochrone — the Valhalla normaliser
 *
 * 🛑 **No network here, ever.** The corpus is versioned; `scripts/capture-isochrone-fixtures.cjs`
 * is the only code that calls an engine, and it is run by hand.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeValhalla } from "../normalize-valhalla.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../fixtures");

/** A captured exchange: the question, the status it got, and the body. */
interface Capture {
    request: unknown;
    status: number;
    body: { features: { properties: Record<string, unknown>; geometry: unknown }[] };
}

/**
 * Reads one capture.
 *
 * @param name File name under `fixtures/`.
 * @returns The envelope the capture script wrote.
 */
function capture(name: string): Capture {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as Capture;
}

const NOMINAL = capture("valhalla-isochrone-nominal.json");
const OFF_NETWORK = capture("valhalla-isochrone-off-network.json");

/**
 * A square polygon feature.
 *
 * @param contour The duration the feature answers.
 * @param geometry Its geometry — a unit square by default.
 * @returns The feature.
 */
function feature(contour: unknown, geometry?: unknown): Record<string, unknown> {
    return {
        type: "Feature",
        properties: { contour, color: "#ff0000" },
        geometry: geometry ?? {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ],
        },
    };
}

describe("@geoleaf-plugins/isochrone — the captured answer", () => {
    it("is served from the largest zone to the smallest — the fact the normaliser exists for", () => {
        expect(NOMINAL.status).toBe(200);
        expect(NOMINAL.body.features.map((f) => f.properties["contour"])).toEqual([15, 10, 5]);
    });

    it("carries style properties of the engine on every feature", () => {
        for (const f of NOMINAL.body.features) {
            expect(Object.keys(f.properties).length).toBeGreaterThan(1);
        }
    });
});

describe("@geoleaf-plugins/isochrone — normalizeValhalla", () => {
    it("answers one zone per duration asked, in the order asked", () => {
        const contours = normalizeValhalla(NOMINAL.body, [5, 10, 15]);
        expect(contours?.map((c) => c.minutes)).toEqual([5, 10, 15]);
        expect(normalizeValhalla(NOMINAL.body, [15, 5])?.map((c) => c.minutes)).toEqual([15, 5]);
    });

    it("matches a zone to its duration by the feature's `contour`, never by its position", () => {
        const byContour = (minutes: number): unknown =>
            NOMINAL.body.features.find((f) => f.properties["contour"] === minutes)?.geometry;
        const contours = normalizeValhalla(NOMINAL.body, [5, 10, 15]);
        expect(contours?.[0]?.geometry).toEqual(byContour(5));
        expect(contours?.[2]?.geometry).toEqual(byContour(15));

        const shuffled = { features: [...NOMINAL.body.features].reverse() };
        expect(normalizeValhalla(shuffled, [5, 10, 15])).toEqual(contours);
    });

    it("keeps the duration and the geometry, and nothing the engine wrote beside them", () => {
        const contours = normalizeValhalla(NOMINAL.body, [5, 10, 15]) ?? [];
        expect(contours).toHaveLength(3);
        for (const contour of contours) {
            expect(Object.keys(contour).sort()).toEqual(["geometry", "minutes"]);
            expect(Object.keys(contour.geometry).sort()).toEqual(["coordinates", "type"]);
        }
    });

    it("copies the coordinates instead of keeping the engine's own arrays", () => {
        const contours = normalizeValhalla(NOMINAL.body, [5]) ?? [];
        const source = NOMINAL.body.features.find((f) => f.properties["contour"] === 5)
            ?.geometry as { coordinates: number[][][] };
        const copy = contours[0]?.geometry.coordinates as number[][][];
        expect(copy).toEqual(source.coordinates);
        expect(copy).not.toBe(source.coordinates);
        // Down to the positions: a copy sharing them would let a caller edit what it was given.
        expect(copy[0]?.[0]).not.toBe(source.coordinates[0]?.[0]);
    });

    it("keeps a zone the size of one grid cell like any other — it reads a shape, not an area", () => {
        expect(OFF_NETWORK.status).toBe(200);
        const contours = normalizeValhalla(OFF_NETWORK.body, [5, 10, 15]);
        expect(contours?.map((c) => c.minutes)).toEqual([5, 10, 15]);
        expect(contours?.every((c) => c.geometry.type === "Polygon")).toBe(true);
    });

    it("accepts a multi-polygon", () => {
        const square = [
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
            ],
        ];
        const body = {
            features: [feature(5, { type: "MultiPolygon", coordinates: [square, square] })],
        };
        expect(normalizeValhalla(body, [5])).toEqual([
            { minutes: 5, geometry: { type: "MultiPolygon", coordinates: [square, square] } },
        ]);
    });

    it("keeps the further numbers of a position, such as an altitude", () => {
        const geometry = { type: "Polygon", coordinates: [[[0, 0, 12]]] };
        expect(normalizeValhalla({ features: [feature(5, geometry)] }, [5])?.[0]?.geometry).toEqual(
            geometry
        );
    });

    it("ignores a zone that was not asked for", () => {
        const body = { features: [feature(5), feature(10)] };
        expect(normalizeValhalla(body, [10])?.map((c) => c.minutes)).toEqual([10]);
    });

    it("answers no zone, and not `null`, when none was asked", () => {
        expect(normalizeValhalla(NOMINAL.body, [])).toEqual([]);
    });
});

describe("@geoleaf-plugins/isochrone — all the zones asked for, or nothing", () => {
    it("answers null when a duration asked has no contour", () => {
        expect(normalizeValhalla(NOMINAL.body, [5, 10, 20])).toBeNull();
    });

    it.each([
        ["no body", null],
        ["a body that is not an object", "<html>"],
        ["a body without features", { type: "FeatureCollection" }],
        ["features that are not a list", { features: {} }],
        ["a null feature", { features: [null] }],
        ["a feature without properties", { features: [{ geometry: {} }] }],
    ])("answers null for %s", (_label, body) => {
        expect(normalizeValhalla(body, [5])).toBeNull();
    });

    it.each([
        ["a line", { type: "LineString", coordinates: [[0, 0]] }],
        ["no geometry", undefined],
        ["a null geometry", null],
        ["a polygon without coordinates", { type: "Polygon" }],
        ["a polygon with no ring", { type: "Polygon", coordinates: [] }],
        ["an empty ring", { type: "Polygon", coordinates: [[]] }],
        ["a ring that is not a list", { type: "Polygon", coordinates: ["ring"] }],
        ["a position of one number", { type: "Polygon", coordinates: [[[0]]] }],
        ["a position that is not a list", { type: "Polygon", coordinates: [["0,0"]] }],
        ["a position carrying a text", { type: "Polygon", coordinates: [[[0, "1"]]] }],
        ["a position that is not finite", { type: "Polygon", coordinates: [[[0, Number.NaN]]] }],
        ["a multi-polygon with no polygon", { type: "MultiPolygon", coordinates: [] }],
        ["a multi-polygon holding a bad polygon", { type: "MultiPolygon", coordinates: [[[]]] }],
    ])("answers null for %s", (_label, geometry) => {
        const body = { features: [{ properties: { contour: 5 }, geometry }] };
        expect(normalizeValhalla(body, [5])).toBeNull();
    });

    it("does not answer the zones it could read when one cannot be", () => {
        const body = {
            features: [feature(5), feature(10, { type: "Point", coordinates: [0, 0] })],
        };
        expect(normalizeValhalla(body, [5, 10])).toBeNull();
    });
});
