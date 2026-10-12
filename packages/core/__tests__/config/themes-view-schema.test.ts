/**
 * `themes[].view` is read by the code, so the themes schema declares it.
 *
 * A theme entry is CLOSED: before this key existed, a theme declaring where it frames the map
 * failed validation. The schema admits the two forms the reader takes (`readThemeView`,
 * `kernel/config/view-extent.ts`) — `bounds`, or `center` with `zoom` — and refuses a view that
 * is neither, so that a view which frames nothing is caught when the profile is validated
 * rather than noticed on screen.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const themesSchema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/themes.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true }).compile(
    themesSchema
);

const BOUNDS = [
    [43.2, 1.2],
    [43.6, 1.6],
];
const themes = (view: unknown) => ({ themes: [{ id: "north", view }] });

describe("themes — `themes[].view`", () => {
    it("is accepted as `bounds`", () => {
        expect(validate(themes({ bounds: BOUNDS }))).toBe(true);
    });

    it("is accepted as `center` with `zoom`", () => {
        expect(validate(themes({ center: [43.7, 1.7], zoom: 11 }))).toBe(true);
    });

    it("is accepted with both forms and a comment", () => {
        expect(
            validate(themes({ _comment: "north", bounds: BOUNDS, center: [43.7, 1.7], zoom: 11 }))
        ).toBe(true);
    });

    it("leaves a theme without a view valid", () => {
        expect(validate({ themes: [{ id: "general" }] })).toBe(true);
    });

    it.each([
        ["an empty view", {}],
        ["a centre without its zoom", { center: [43.7, 1.7] }],
        ["a zoom without its centre", { zoom: 11 }],
        ["a negative zoom", { center: [43.7, 1.7], zoom: -1 }],
        ["one corner", { bounds: [[43.2, 1.2]] }],
        [
            "a corner of three values",
            {
                bounds: [
                    [43.2, 1.2, 0],
                    [43.6, 1.6],
                ],
            },
        ],
        [
            "bounds written as an object",
            { bounds: { north: 43.6, south: 43.2, east: 1.6, west: 1.2 } },
        ],
        ["a key the reader does not take", { bounds: BOUNDS, padding: [50, 50] }],
        ["a navigation limit, which stays the profile's", { bounds: BOUNDS, positionFixed: true }],
    ])("refuses %s", (_label, view) => {
        expect(validate(themes(view))).toBe(false);
    });

    it("still refuses a key a theme entry does not declare", () => {
        expect(validate({ themes: [{ id: "north", bounds: BOUNDS }] })).toBe(false);
    });
});
