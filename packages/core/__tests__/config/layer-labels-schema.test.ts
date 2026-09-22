/**
 * A layer's `labels` block and a style file's `label` object are ONE shape, written twice.
 *
 * The runtime reads them as the same thing (`resolveLayerLabelConfig`): the style's object when it
 * has one, else the layer's block. The schemas cannot share one definition — `layer-config` is
 * compiled ALONE by a dozen tests, and a cross-file `$ref` would not resolve there — so
 * `layer-config` carries a copy. This file is what keeps the copy a copy: a key added to one side
 * only would let a profile validate what the runtime does not read the same way.
 *
 * ✅ Seen turning red by mutation on 22/09/2026: a key added to `labelConfig` alone fails the
 * parity case, and only it; the `labels` property removed from `layer-config` fails the parity
 * case and the two cases that accept a block — the two refusals hold, as they should.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file: string) =>
    JSON.parse(readFileSync(resolve(ROOT, "profiles/schemas", file), "utf8"));

const layerSchema = read("layer-config.schema.json");
const styleSchema = read("style.schema.json");
const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(layerSchema);

describe("layer-config — the `labels` block", () => {
    it("is the style file's `label` object, key for key", () => {
        expect(layerSchema.definitions.labelConfig).toEqual(styleSchema.properties.label.oneOf[1]);
        expect(layerSchema.properties.labels.$ref).toBe("#/definitions/labelConfig");
    });

    it("accepts a block that enables labels on a field", () => {
        expect(validate({ id: "parcels", labels: { enabled: true, field: "name" } })).toBe(true);
    });

    it("accepts the full style-file shape", () => {
        const labels = {
            enabled: true,
            visibleByDefault: true,
            field: "name",
            font: { sizePt: 11 },
            color: "#1a1a1a",
            opacity: 0.9,
            buffer: { enabled: true, color: "#ffffff", sizePx: 2 },
        };
        expect(validate({ id: "parcels", labels })).toBe(true);
    });

    it("requires `enabled`, as a style file does", () => {
        expect(validate({ id: "parcels", labels: { field: "name" } })).toBe(false);
    });

    it("refuses a key the renderer never reads", () => {
        expect(validate({ id: "parcels", labels: { enabled: true, property: "name" } })).toBe(
            false
        );
    });
});
