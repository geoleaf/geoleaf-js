/**
 * The profile loader's basemap check says what the basemap registry accepts — no less.
 *
 * `validateBasemaps` warned "url or style is required" for any entry carrying neither. The
 * registry has always accepted more: `tiles`, `type: "maplibre"`, and the four types whose
 * configuration lives in their own block — `image`, `hillshade`, `wmts`, `wms`. Those basemaps
 * display, so the warning told an integrator that something was missing from a basemap that
 * works. The `_reference` profile, which carries every type, is the witness.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateBasemaps } from "../../src/kernel/config/profile-loader-helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REFERENCE = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/_reference/config/core/basemaps.json"), "utf8")
) as { basemaps: Record<string, unknown> };

function warningsFor(basemaps: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    validateBasemaps(basemaps, (msg) => warnings.push(msg));
    return warnings;
}

describe("validateBasemaps — the shape the registry accepts", () => {
    it("warns about none of the `_reference` basemaps, every type included", () => {
        expect(Object.keys(REFERENCE.basemaps).length).toBeGreaterThan(5);
        expect(warningsFor(REFERENCE.basemaps)).toEqual([]);
    });

    it.each([
        ["tiles alone", { tiles: ["https://a.example/{z}/{x}/{y}.png"] }],
        ["a MapLibre basemap", { type: "maplibre" }],
        ["an image", { type: "image" }],
        ["a hillshade", { type: "hillshade" }],
        ["a WMTS layer", { type: "wmts" }],
        ["a WMS layer", { type: "wms" }],
    ])("accepts %s", (_name, entry) => {
        expect(warningsFor({ fond: entry })).toEqual([]);
    });

    it.each([
        ["an entry with nothing to draw", { label: "Fond" }],
        ["an empty tile list", { tiles: [] }],
        ["an unknown type", { type: "xyz-unknown" }],
        ["a null entry", null],
    ])("still warns about %s", (_name, entry) => {
        expect(warningsFor({ fond: entry })).toHaveLength(1);
    });
});
