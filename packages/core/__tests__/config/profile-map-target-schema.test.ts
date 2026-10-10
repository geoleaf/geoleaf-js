/**
 * The `map` block of a profile names its container, and a schema default says what the code does.
 *
 * Two confrontations the profile schemas failed, both found by sweeping the documented defaults:
 *
 * - `map.target` and its alias `map.id` are READ by the boot (`cfgMap.target || cfgMap.id`,
 *   `app/boot-modules/core-map-lifecycle.ts`) and were documented, while the `map` block is
 *   CLOSED (`additionalProperties: false`) and did not declare them: a profile carrying one
 *   failed validation.
 * - `data.enableProfilePoiMapping` defaulted to `false` in the schema and to `true` in the code
 *   (`ProfileManager.isProfilePoiMappingEnabled`). No schema default is applied at run time, so
 *   the code is what a user gets — and what the schema must say.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ProfileManager } from "../../src/kernel/config/profile.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (name: string) =>
    JSON.parse(readFileSync(resolve(ROOT, `profiles/schemas/${name}.schema.json`), "utf8"));

const profileSchema = read("profile");
const validateProfile = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(profileSchema);

describe("profile — `map.target` and `map.id`, the container the boot reads", () => {
    it("accepts `target`, the id of the container element", () => {
        expect(validateProfile({ id: "p", map: { target: "carte" } })).toBe(true);
    });

    it("accepts `id`, its alias", () => {
        expect(validateProfile({ id: "p", map: { id: "carte" } })).toBe(true);
    });

    it("refuses anything but a string", () => {
        expect(validateProfile({ id: "p", map: { target: 12 } })).toBe(false);
        expect(validateProfile({ id: "p", map: { id: ["carte"] } })).toBe(false);
    });

    it("the block stays closed — `mapOptions` is not a profile key, nothing reads it", () => {
        expect(validateProfile({ id: "p", map: { mapOptions: { antialias: true } } })).toBe(false);
    });
});

describe("geoleaf-config — `data.enableProfilePoiMapping` defaults to what the code applies", () => {
    it("the schema's default is the code's", () => {
        const declared = read("geoleaf-config").properties.data.properties.enableProfilePoiMapping;
        // No `data` block at all: the code's own default.
        const applied = (
            ProfileManager as unknown as { isProfilePoiMappingEnabled(): boolean }
        ).isProfilePoiMappingEnabled.call({ _config: {} });
        expect(applied).toBe(true);
        expect(declared.default).toBe(applied);
    });
});
