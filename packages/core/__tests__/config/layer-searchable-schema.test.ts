/**
 * A layer's `searchable` is declared by the profile schema: an object whose `fields` is a
 * non-empty list of property names.
 *
 * `layer-config` is CLOSED (`additionalProperties: false`): a key the runtime reads but the
 * schema does not declare makes every profile using it fail validation. And the key is
 * `searchable`, never `search` — `geojson-filter.ts` still reads a `search.enabled` removed
 * from the schema long ago; declaring `search` again would silently switch the filtering of
 * line layers back on.
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

describe("layer-config — `searchable`", () => {
    it("accepts a list of fields, bare or dotted", () => {
        expect(validate({ id: "assets", searchable: { fields: ["ref"] } })).toBe(true);
        expect(validate({ id: "assets", searchable: { fields: ["ref", "properties.name"] } })).toBe(
            true
        );
    });

    it("refuses a block without fields, an empty list, or a field that is not a name", () => {
        expect(validate({ id: "assets", searchable: {} })).toBe(false);
        expect(validate({ id: "assets", searchable: { fields: [] } })).toBe(false);
        expect(validate({ id: "assets", searchable: { fields: [""] } })).toBe(false);
        expect(validate({ id: "assets", searchable: { fields: "ref" } })).toBe(false);
        expect(validate({ id: "assets", searchable: true })).toBe(false);
    });

    it("refuses an unknown key inside the block", () => {
        expect(validate({ id: "assets", searchable: { fields: ["ref"], fuzzy: true } })).toBe(
            false
        );
    });

    it("does not bring back `search`", () => {
        expect(validate({ id: "lines", search: { enabled: true } })).toBe(false);
    });
});
