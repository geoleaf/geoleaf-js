/**
 * The filter panel speaks the page's language, and says nothing it cannot back.
 *
 * ## The defects
 *
 * - The search field's submit and clear buttons announced « Rechercher » and « Effacer »,
 *   hard-coded, in every language — while the dictionaries carry `aria.search.*`. The
 *   category tree's expand arrow said « Déplier » the same way.
 * - Without the `taxonomy` capability, the category field rendered « No categories available
 *   on visible layers »: the layers DO carry categories, there is just nothing to read them.
 *   The wrong cause, said to the user. Without the capability, the field now keeps silent.
 *
 * The cases run in ENGLISH: in French, a hard-coded French label would equal the dictionary
 * and the guard could not turn red.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderFilterPanel } from "../../../src/capabilities/filter/panel/render.js";
import { resolveFieldOptions } from "../../../src/capabilities/filter/taxonomy-options.js";
import { getLabel, LANG_STORAGE_KEY } from "../../../src/utils/i18n/i18n.js";
import type { FilterConfig } from "../../../src/capabilities/filter/types.js";

const globalView = globalThis as unknown as { GeoLeaf?: unknown };

const CONFIG = {
    enabled: true,
    fields: [
        { id: "searchText", kind: "text", label: "Search" },
        { id: "cat", kind: "taxonomy", label: "Categories", taxonomyRef: "poi" },
    ],
} as unknown as FilterConfig;

beforeEach(() => {
    localStorage.setItem(LANG_STORAGE_KEY, "en");
});

afterEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
    delete globalView.GeoLeaf;
    document.body.innerHTML = "";
});

describe("panneau de filtre — libellés", () => {
    it("les boutons de la recherche suivent la langue", () => {
        const panel = renderFilterPanel(CONFIG, { cat: { categories: {} } });
        const search = panel.querySelector(".gl-filter-panel__search");
        const labels = [...(search?.querySelectorAll("button") ?? [])].map((b) =>
            b.getAttribute("aria-label")
        );
        expect(labels).toEqual(
            expect.arrayContaining([getLabel("aria.search.submit"), getLabel("aria.search.clear")])
        );
        expect(labels).not.toContain("Rechercher");
        expect(labels).not.toContain("Effacer");
    });

    it("la flèche de dépliage d'une catégorie suit la langue", () => {
        const panel = renderFilterPanel(CONFIG, {
            cat: {
                categories: {
                    parc: { label: "Parks", subcategories: { jardin: { label: "Garden" } } },
                } as never,
            },
        });
        const arrow = panel.querySelector(".gl-filter-tree__arrow");
        expect(arrow?.getAttribute("aria-label")).toBe(getLabel("ui.filter_panel.expand"));
        expect(arrow?.getAttribute("aria-label")).not.toBe("Déplier");
    });
});

describe("panneau de filtre — sans la capacité taxonomy", () => {
    it("le champ catégories se tait au lieu d'accuser les couches", () => {
        globalView.GeoLeaf = {};
        const panel = renderFilterPanel(CONFIG, resolveFieldOptions(CONFIG));
        expect(panel.querySelector('[data-gl-filter-id="cat"]')).toBeNull();
        expect(panel.querySelector(".gl-filter-panel__tree-empty")).toBeNull();
        expect(panel.querySelector('[data-gl-filter-id="searchText"]')).not.toBeNull();
    });

    it("avec la capacité mais sans catégorie, le message vide reste", () => {
        globalView.GeoLeaf = { Taxonomy: { isEnabled: () => true, getCategories: () => ({}) } };
        const panel = renderFilterPanel(CONFIG, resolveFieldOptions(CONFIG));
        expect(panel.querySelector(".gl-filter-panel__tree-empty")).not.toBeNull();
    });
});
