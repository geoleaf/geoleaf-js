/**
 * `hillshade.overlay` and `hillshade.beforeLayer` are read by the code, so the basemaps schema
 * declares them.
 *
 * The `hillshade` block is CLOSED: before these keys existed, a basemap asking for its relief
 * shading as an overlay failed validation. The block is accepted on every basemap type — the
 * shading is the basemap on `type: "hillshade"`, an overlay of it elsewhere — and stays closed to
 * anything the reader does not take.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const basemapsSchema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/basemaps.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true }).compile(
    basemapsSchema
);

const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const basemaps = (entry: Record<string, unknown>) => ({
    basemaps: { fond: { id: "fond", ...entry } },
});

describe("basemaps — `hillshade.overlay` et `hillshade.beforeLayer`", () => {
    it.each([
        ["un fond vectoriel", { type: "maplibre", style: "https://styles.example.com/s.json" }],
        ["un fond en tuiles", { url: "https://tiles.example.com/{z}/{x}/{y}.png" }],
        ["un fond WMTS", { type: "wmts", wmts: { getCapabilitiesUrl: "https://w.example.com" } }],
        ["un fond WMS", { type: "wms", wms: { url: "https://w.example.com", layers: "plan" } }],
    ])("accepte la surcouche sur %s", (_label, entry) => {
        const hillshade = { overlay: true, demUrl: DEM, exaggeration: 0.45 };
        expect(validate(basemaps({ ...entry, hillshade }))).toBe(true);
    });

    it("accepte `beforeLayer` avec la surcouche", () => {
        const hillshade = { overlay: true, beforeLayer: "waterway_tunnel", demUrl: DEM };
        expect(
            validate(basemaps({ type: "maplibre", style: "https://s.example.com", hillshade }))
        ).toBe(true);
    });

    it("laisse valide un bloc sans les deux clés", () => {
        expect(validate(basemaps({ type: "hillshade", hillshade: { demUrl: DEM } }))).toBe(true);
    });

    it.each([
        ["`overlay` qui n'est pas un booléen", { overlay: "yes", demUrl: DEM }],
        ["`beforeLayer` qui n'est pas une chaîne", { overlay: true, beforeLayer: 3, demUrl: DEM }],
        ["une clé que le lecteur ne prend pas", { overlay: true, opacity: 0.5, demUrl: DEM }],
    ])("refuse %s", (_label, hillshade) => {
        expect(
            validate(basemaps({ type: "maplibre", style: "https://s.example.com", hillshade }))
        ).toBe(false);
    });
});
