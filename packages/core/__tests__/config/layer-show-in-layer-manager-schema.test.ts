/**
 * A layer's `showInLayerManager` is declared by the profile schema, as a boolean.
 *
 * `layer-config` is CLOSED (`additionalProperties: false`): a key the runtime reads but the
 * schema does not declare makes every profile using it fail validation, and a key the schema
 * declares with the wrong type lets a profile carry `"false"` — a truthy string the runtime
 * would take for "list it".
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

describe("layer-config — `showInLayerManager`", () => {
    it("accepts a boolean", () => {
        expect(validate({ id: "snap", showInLayerManager: false })).toBe(true);
        expect(validate({ id: "snap", showInLayerManager: true })).toBe(true);
    });

    it("refuses anything else", () => {
        expect(validate({ id: "snap", showInLayerManager: "false" })).toBe(false);
        expect(validate({ id: "snap", showInLayerManager: 0 })).toBe(false);
    });
});

/**
 * The two root keys the FlatGeobuf plugin reads — and that the closed schema refused, so a
 * configuration copied from the plugin's README failed profile validation.
 *
 * Admitted for a layer of that plugin ONLY: no other loader reads them, and for a GeoJSON
 * layer visibility belongs to the themes and clustering to the `clustering` object.
 */
describe("layer-config — `defaultVisible` and `cluster`, the FlatGeobuf plugin's keys", () => {
    const fgb = (extra: Record<string, unknown>) => ({
        id: "zones",
        plugin: "flatgeobuf",
        data: { url: "data/zones.fgb" },
        ...extra,
    });

    it("accepts them, as booleans, on a layer of the plugin", () => {
        expect(validate(fgb({ defaultVisible: false }))).toBe(true);
        expect(validate(fgb({ cluster: true }))).toBe(true);
        expect(validate(fgb({ defaultVisible: true, cluster: false }))).toBe(true);
    });

    it("refuses anything but a boolean", () => {
        expect(validate(fgb({ defaultVisible: "false" }))).toBe(false);
        expect(validate(fgb({ cluster: { enabled: true } }))).toBe(false);
    });

    it("refuses them on a layer of another kind — nothing reads them there", () => {
        expect(validate({ id: "snap", defaultVisible: false })).toBe(false);
        expect(validate({ id: "snap", cluster: true })).toBe(false);
        expect(validate({ id: "snap", plugin: "other", defaultVisible: false })).toBe(false);
    });
});
