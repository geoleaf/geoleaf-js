/**
 * `terrain.activation`, its two thresholds and `hillshade.onlyWithTerrain` are read by the code,
 * so the basemaps schema declares them.
 *
 * The `terrain` block is CLOSED, and the schema does one thing more than list the keys: it
 * refuses those that have no role in the activation mode a basemap chose. `pitch`, `bearing` and
 * `default3D: true` describe a terrain put on by the SELECTION of its basemap; a profile that
 * keeps them next to `activation: "pitch"` says the camera will be tilted, on a map nothing will
 * ever tilt for it. The two thresholds are refused the other way round.
 *
 * What the schema CANNOT say is that one threshold is lower than the other: that is checked at
 * start-up, and the terrain tests hold it.
 */

import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
const validate = new Ajv({ allErrors: true, allowUnionTypes: true, strict: true }).compile(
    readJson("profiles/schemas/basemaps.schema.json") as object
);

const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const basemaps = (entry: Record<string, unknown>) => ({
    basemaps: { fond: { id: "fond", url: "https://tiles.example.com/{z}/{x}/{y}.png", ...entry } },
});
const withTerrain = (terrain: Record<string, unknown>) =>
    basemaps({ terrain: { enabled: true, demUrl: DEM, ...terrain } });

describe("basemaps — `terrain.activation` et ses seuils", () => {
    it.each([
        ["le mode seul", { activation: "pitch" }],
        [
            "le mode et ses deux seuils",
            { activation: "pitch", activateFromPitch: 20, deactivateBelowPitch: 8 },
        ],
        ["un seuil de retrait à zéro", { activation: "pitch", deactivateBelowPitch: 0 }],
        ["`default3D: false`, qui ne dit rien de faux", { activation: "pitch", default3D: false }],
    ])("accepte un relief qui suit l'inclinaison : %s", (_label, terrain) => {
        expect(validate(withTerrain(terrain))).toBe(true);
    });

    it.each([
        ["sans `activation`", { default3D: true, pitch: 60, bearing: 30 }],
        ['`activation: "basemap"` écrit', { activation: "basemap", default3D: true, pitch: 60 }],
    ])("laisse valide le relief posé à la sélection : %s", (_label, terrain) => {
        expect(validate(withTerrain(terrain))).toBe(true);
    });

    // A key without a role is a profile that says one thing and does another.
    it.each([
        ["`pitch`", { pitch: 60 }],
        ["`pitch: 0`, le contournement d'avant", { pitch: 0 }],
        ["`bearing`", { bearing: 30 }],
        ["`default3D: true`", { default3D: true }],
    ])('refuse, avec `activation: "pitch"`, %s', (_label, extra) => {
        expect(validate(withTerrain({ activation: "pitch", ...extra }))).toBe(false);
    });

    it.each([
        ["`activateFromPitch` sans le mode", { default3D: true, activateFromPitch: 12 }],
        ["`deactivateBelowPitch` sans le mode", { default3D: true, deactivateBelowPitch: 6 }],
        ['un seuil avec `activation: "basemap"`', { activation: "basemap", activateFromPitch: 12 }],
    ])("refuse %s", (_label, terrain) => {
        expect(validate(withTerrain(terrain))).toBe(false);
    });

    it.each([
        ["un mode inconnu", { activation: "zoom" }],
        ["un seuil de pose à zéro", { activation: "pitch", activateFromPitch: 0 }],
        ["un seuil de pose négatif", { activation: "pitch", activateFromPitch: -5 }],
        ["un seuil de pose au-delà de 85°", { activation: "pitch", activateFromPitch: 90 }],
        ["un seuil de retrait négatif", { activation: "pitch", deactivateBelowPitch: -1 }],
        ["un seuil qui n'est pas un nombre", { activation: "pitch", activateFromPitch: "12" }],
    ])("refuse %s", (_label, terrain) => {
        expect(validate(withTerrain(terrain))).toBe(false);
    });
});

describe("basemaps — `hillshade.onlyWithTerrain`", () => {
    const hillshade = { overlay: true, onlyWithTerrain: true, demUrl: DEM };

    it("accepte une surcouche qui suit le relief", () => {
        expect(
            validate(
                basemaps({
                    terrain: { enabled: true, demUrl: DEM, activation: "pitch" },
                    hillshade,
                })
            )
        ).toBe(true);
    });

    it("refuse une valeur qui n'est pas un booléen", () => {
        expect(validate(basemaps({ hillshade: { ...hillshade, onlyWithTerrain: "yes" } }))).toBe(
            false
        );
    });
});

describe("basemaps — les profils du dépôt qui portent le mode", () => {
    it.each([
        ["tourism", "satellite"],
        ["_reference", "terrain-on-tilt"],
    ])("%s › %s est valide et suit l'inclinaison", (profile, key) => {
        const file = readJson(`profiles/${profile}/config/core/basemaps.json`) as {
            basemaps: Record<string, { terrain?: { activation?: string } }>;
        };
        expect(validate(file), JSON.stringify(validate.errors)).toBe(true);
        expect(file.basemaps[key]?.terrain?.activation).toBe("pitch");
    });
});
