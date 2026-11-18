/**
 * A layer file may declare `inlineData`, and only as an EMPTY FeatureCollection: a layer "born
 * empty", created at boot without any request, whose features the host writes afterwards with
 * `Layers.setData`.
 *
 * The loader has read the key since it exists (`kernel/geojson/loader/profile.ts`), but
 * `layer-config` is CLOSED (`additionalProperties: false`) and did not declare it: a layer that
 * the code created was invalid against the schema, and the same file without the key was valid
 * but never created. The schema now admits the empty collection and nothing else — a profile is a
 * static document, and features frozen into it are what `dataFile` exists to avoid.
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

const bornEmpty = (inlineData: unknown): Record<string, unknown> => ({
    id: "l1",
    label: "L1",
    geometry: "point",
    data: { source: "app" },
    inlineData,
    styles: {
        default: "defaut.json",
        directory: "styles",
        available: [{ id: "defaut", label: "Default", file: "defaut.json" }],
    },
});

describe("layer-config — `inlineData`", () => {
    it("accepts a layer born empty", () => {
        const ok = validate(bornEmpty({ type: "FeatureCollection", features: [] }));
        expect(validate.errors).toBeNull();
        expect(ok).toBe(true);
    });

    it("refuses a value that is not a FeatureCollection", () => {
        expect(validate(bornEmpty(3))).toBe(false);
        expect(validate(bornEmpty({ type: "Feature", features: [] }))).toBe(false);
        expect(validate(bornEmpty({ type: "FeatureCollection" }))).toBe(false);
        expect(validate(bornEmpty({ type: "FeatureCollection", features: {} }))).toBe(false);
    });

    it("refuses features frozen into the profile", () => {
        const feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        };
        expect(validate(bornEmpty({ type: "FeatureCollection", features: [feature] }))).toBe(false);
    });

    it("refuses an unknown key inside the collection", () => {
        expect(validate(bornEmpty({ type: "FeatureCollection", features: [], extra: true }))).toBe(
            false
        );
    });
});
