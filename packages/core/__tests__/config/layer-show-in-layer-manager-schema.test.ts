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
