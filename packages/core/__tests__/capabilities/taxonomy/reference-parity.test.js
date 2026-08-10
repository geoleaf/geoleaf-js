/**
 * Parity guard — the shipped `_reference` profile's `modules.taxonomy` resolves the
 * icons the symbol-injector feeds to MapLibre, on the real config file (not a
 * fixture). Reads the profile from disk so a bad edit to it fails here.
 *
 * Also pins the TWO ID-SPACES on real data, which is where this capability breaks
 * silently: `resolvePoiIcon` fills the MapLibre atlas (id tinted when the category
 * declares an `iconColor`), while `resolveTitleIcon` fills a DOM `<use href="#…">`
 * and must stay RAW. Swap them and the map icons vanish with every test still green.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolvePoiIcon, resolveTitleIcon } from "../../../src/capabilities/taxonomy/resolver.ts";

// taxonomy → capabilities → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CONFIG = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/_reference/config/plugins/taxonomy.json"), "utf8")
);

const feature = (categoryId, subCategoryId) => ({
    layerId: "reference-points",
    properties: { categoryId, subCategoryId },
});

/** resolvePoiIcon on the `reference-points` layer (bound to the `poi-cat` taxonomy). */
const icon = (categoryId, subCategoryId) =>
    resolvePoiIcon(CONFIG, feature(categoryId, subCategoryId));

/** resolveTitleIcon for the same feature, on the popup surface. */
const titleIcon = (categoryId, subCategoryId) =>
    resolveTitleIcon(CONFIG, "reference-points", feature(categoryId, subCategoryId), "popup");

describe("_reference modules.taxonomy — map icons (atlas id-space)", () => {
    it("category activites → activity-generic, tinted (it declares iconColor)", () => {
        expect(icon("activites")).toMatchObject({
            useIcon: true,
            iconId: "activity-generic",
            symbolId: "ref-poi-cat-activity-generic--ffffff",
        });
    });

    it("subcategory randonnee → activity-mountain, tinted", () => {
        expect(icon("activites", "randonnee").symbolId).toBe(
            "ref-poi-cat-activity-mountain--ffffff"
        );
    });

    it("subcategory velo inherits its category's tint (it declares none of its own)", () => {
        expect(icon("activites", "velo").symbolId).toBe("ref-poi-cat-activity-vehicle--ffffff");
    });

    it("subcategory musee → culture-building, tinted from its category", () => {
        expect(icon("culture", "musee").symbolId).toBe("ref-poi-cat-culture-building--ffffff");
    });

    it("nature carries a non-white tint, so its id differs from every other", () => {
        expect(icon("nature").symbolId).toBe("ref-poi-cat-nature-forest--00695c");
    });

    it("symbolPrefix matches the sprite's symbol ids", () => {
        expect(CONFIG.icons.symbolPrefix).toBe("ref-poi-cat-");
    });
});

describe("_reference modules.taxonomy — title glyphs (DOM id-space)", () => {
    it("resolveTitleIcon returns the RAW id — a tinted one would point at no <symbol>", () => {
        expect(titleIcon("activites")).toBe("ref-poi-cat-activity-generic");
    });

    it("the two resolvers disagree on the same feature, and that is the point", () => {
        const f = feature("culture", "musee");
        const atlasId = resolvePoiIcon(CONFIG, f).symbolId;
        const domId = resolveTitleIcon(CONFIG, "reference-points", f, "popup");

        expect(atlasId).not.toBe(domId);
        expect(atlasId).toMatch(/--[0-9a-f]+$/);
        expect(domId).not.toMatch(/--/);
        // The DOM id is the atlas id with its tint suffix removed.
        expect(atlasId.split("--")[0]).toBe(domId);
    });
});
