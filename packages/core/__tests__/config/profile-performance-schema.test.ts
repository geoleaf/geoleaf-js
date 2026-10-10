/**
 * `performance.themeBatchSize` is read by the code, so the profile schema declares it.
 *
 * The theme applier reveals a theme's layers in batches, and reads the size of a batch from
 * the active profile (`profileConfig.performance.themeBatchSize`, `theme-applier/core.ts`),
 * falling back to 6. The profile root is CLOSED and did not declare `performance`: a profile
 * setting the one key the code reads there failed validation.
 *
 * Three other keys were once documented under `performance` — `maxConcurrentLayers`,
 * `layerLoadDelay`, `fitBoundsOnThemeChange`. No code reads them, and the block is closed so
 * that they stay refused.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const profileSchema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/profile.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true }).compile(
    profileSchema
);

const profile = (performance: unknown) => ({ id: "p", performance });

describe("profile — `performance.themeBatchSize`", () => {
    it("is accepted as a positive integer", () => {
        expect(validate(profile({ themeBatchSize: 4 }))).toBe(true);
        expect(validate(profile({ themeBatchSize: 1 }))).toBe(true);
    });

    it("is refused when it cannot size a batch", () => {
        // 0 falls back to the default in the code, a fraction or a negative step never ends
        // the loop that slices the layers: none of them is a size.
        expect(validate(profile({ themeBatchSize: 0 }))).toBe(false);
        expect(validate(profile({ themeBatchSize: -2 }))).toBe(false);
        expect(validate(profile({ themeBatchSize: 1.5 }))).toBe(false);
        expect(validate(profile({ themeBatchSize: "4" }))).toBe(false);
    });

    it.each(["maxConcurrentLayers", "layerLoadDelay", "fitBoundsOnThemeChange"])(
        "still refuses `%s`, which no code reads",
        (key) => {
            expect(validate(profile({ [key]: 1 }))).toBe(false);
        }
    );

    it("leaves a profile without the block valid", () => {
        expect(validate({ id: "p" })).toBe(true);
    });
});
