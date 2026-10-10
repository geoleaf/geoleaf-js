/**
 * `mixed` is a geometry a VECTOR-TILE layer may declare, and no other.
 *
 * A tile source-layer can hold points, lines and polygons at once; declared `mixed`, the layer
 * builds a fill, a line and a circle sub-layer over it, each confined to what it draws. The value
 * was reachable through `GeoLeaf.Layers.create()` only: both enumerations of the layer schema
 * refused it, so a profile could not say what the adapter knows how to render.
 *
 * Outside tiles the word means nothing — it names no geometry family, so the legend, the editor
 * and the offline selector have nothing to read from it. The schema therefore admits it on a
 * layer that declares a tile source, and refuses it everywhere else.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const layerSchema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/layer-config.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(layerSchema);

const TILES = { tilesUrl: "https://tiles.example/{z}/{x}/{y}.pbf", layerName: "network" };

describe("layer-config — `mixed`, the geometry of a vector-tile layer", () => {
    it("is accepted on a layer that declares a tile source, in either spelling", () => {
        expect(validate({ id: "net", geometry: "mixed", data: { vectorTiles: TILES } })).toBe(true);
        expect(validate({ id: "net", geometryType: "mixed", data: { vectorTiles: TILES } })).toBe(
            true
        );
    });

    it("is refused on a layer with no tile source — nothing reads it there", () => {
        expect(validate({ id: "net", geometry: "mixed" })).toBe(false);
        expect(validate({ id: "net", geometryType: "mixed" })).toBe(false);
        expect(validate({ id: "net", geometry: "mixed", data: { file: "net.geojson" } })).toBe(
            false
        );
    });

    it("is refused on a tile block that names no URL — such a layer falls back to GeoJSON", () => {
        expect(
            validate({ id: "net", geometry: "mixed", data: { vectorTiles: { enabled: true } } })
        ).toBe(false);
    });

    it("leaves every other geometry as it was, with or without tiles", () => {
        expect(validate({ id: "net", geometry: "polygon" })).toBe(true);
        expect(validate({ id: "net", geometry: "polygon", data: { vectorTiles: TILES } })).toBe(
            true
        );
        expect(validate({ id: "net", geometry: "hexagon", data: { vectorTiles: TILES } })).toBe(
            false
        );
    });

    // The two GeoJSON-flavoured spellings the code's family table knows stay out of the profile
    // vocabulary: a profile says `line` or `polyline`.
    it.each(["linestring", "multilinestring"])("still refuses `%s`", (kind) => {
        expect(validate({ id: "net", geometry: kind })).toBe(false);
        expect(validate({ id: "net", geometry: kind, data: { vectorTiles: TILES } })).toBe(false);
    });
});
