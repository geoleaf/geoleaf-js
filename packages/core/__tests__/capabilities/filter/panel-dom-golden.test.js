/**
 * Golden-master DOM oracle for `renderFilterPanel` — CAPACITÉS B.18.
 *
 * ## Why this file exists
 *
 * `panel/render.ts` builds 35 elements. Before this file, a per-call-site mutation
 * sweep (className flipped to `gl-MUTANT` at each site, one mutant at a time, whole
 * `__tests__/capabilities/filter/` suite run per mutant) killed only **10 of 35**:
 * the existing suite pins the handful of hooks it drives (`--category`,
 * `--subcategory`, `__tag-badge`, `__arrow`, `--subcategories`, `__range-value`)
 * and nothing else. 25 sites could have had their class, their `dataset`, their
 * `attributes` or their `textContent` silently dropped without a single red.
 *
 * That is exactly the blast radius of the `$create` → `domCreate` / `createElement`
 * migration, whose whole contract is "strictly unchanged output". So the missing
 * oracle is not 25 hand-written assertions on individual class names — it is one
 * frozen serialization of the entire tree.
 *
 * ## What the serialization pins
 *
 * Per element, in document order and at its exact depth: tag, full class list,
 * the structural attributes (`id`, `type`, `role`, `aria-*`, `tabindex`,
 * `min`/`max`/`step`, `title`), every `data-*` key, the `value` property of
 * inputs, and the element's own text. Between them these cover every prop the two
 * factories can carry — which is what makes a wrong factory choice fail here.
 *
 * Depth and order are part of the string, so this also catches the migration's
 * subtlest trap: `domCreate(tag, cls, parent)` appends on creation, and combining
 * it with the pre-existing explicit `appendChild` would double-insert or reorder.
 *
 * ⚠️ Regenerating this golden to make it pass is the one way to defeat it. Any
 * diff here is a rendering change: prove it is intended, then update the array.
 *
 * The `gl-pill-search` subtree is deliberately opaque — it belongs to
 * `kernel/ui/pill-search.ts`, not to this renderer, and is already
 * covered by `panel.test.js` ("text search — pill widget").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { renderFilterPanel } = await import("../../../src/capabilities/filter/panel/render.ts");

/**
 * One config exercising every branch of `_control()`: the five rendered kinds, a
 * `taxonomy` with no options (empty-state `<p>`), and a `proximity` kind that must
 * render NO group at all (toolbar-driven — S5).
 */
const CONFIG = {
    enabled: true,
    title: "Filtrer",
    fields: [
        { id: "searchText", kind: "text", label: "Recherche", placeholder: "Rechercher…" },
        { id: "categories", kind: "taxonomy", label: "Catégories", field: "fclass" },
        { id: "tags", kind: "tag", label: "Tags", field: "attributes.tags" },
        {
            id: "surface",
            kind: "range",
            label: "Surface",
            field: "surface",
            min: 5,
            max: 80,
            step: 5,
        },
        { id: "pmr", kind: "boolean", label: "PMR", field: "accessible" },
        { id: "empty", kind: "taxonomy", label: "Vide", field: "none" },
        { id: "nope", kind: "proximity", label: "Autour", field: "geom" },
    ],
    actions: { applyLabel: "Appliquer", resetLabel: "Réinitialiser" },
};

/**
 * Options covering both label fallbacks: a category WITH sub-categories and one
 * WITHOUT (arrow vs spacer), a sub-category with no label (falls back to its id),
 * and a tag with no label (same fallback).
 */
const OPTIONS = {
    categories: {
        categories: {
            CULTURES: {
                label: "Culture",
                subcategories: { MUSEE: { label: "Musée" }, THEATRE: {} },
            },
            NATURE: {},
        },
    },
    tags: { values: [{ value: "free", label: "Gratuit" }, { value: "paid" }] },
    empty: { categories: {} },
};

/** Structural attributes worth pinning, in a stable order. */
const ATTRS = [
    "id",
    "type",
    "role",
    "aria-label",
    "aria-live",
    "tabindex",
    "min",
    "max",
    "step",
    "title",
];

/** Serializes one element and its subtree into indented `tag.class attr=… text=…` lines. */
function serialize(el, depth, out) {
    const cls = el.getAttribute("class");
    let line = "  ".repeat(depth) + el.tagName.toLowerCase();
    if (cls) line += "." + cls.trim().split(/\s+/).join(".");
    for (const a of ATTRS) {
        if (el.hasAttribute(a)) line += ` ${a}=${JSON.stringify(el.getAttribute(a))}`;
    }
    for (const k of Object.keys(el.dataset).sort()) {
        line += ` data:${k}=${JSON.stringify(el.dataset[k])}`;
    }
    if (el.tagName === "INPUT") line += ` value=${JSON.stringify(el.value)}`;
    if (el.classList.contains("gl-pill-search")) {
        out.push(line + " «opaque: owned by pill-search.ts»");
        return out;
    }
    const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join("");
    if (ownText) line += ` text=${JSON.stringify(ownText)}`;
    out.push(line);
    for (const child of el.children) serialize(child, depth + 1, out);
    return out;
}

const GOLDEN = [
    'aside.gl-filter-panel id="gl-filter-panel" role="region" aria-label="Filtrer"',
    "  div.gl-filter-panel__header",
    '    h2.gl-filter-panel__title text="Filtrer"',
    '    button.gl-filter-panel__toggle-btn type="button" aria-label="Fermer" data:glAction="filter-close"',
    "  div.gl-filter-panel__body",
    '    div.gl-filter-panel__group data:glFilterId="searchText" data:glFilterKind="text"',
    '      h3.gl-filter-panel__group-title text="Recherche"',
    '      div.gl-pill-search.gl-filter-panel__search role="search" aria-label="Recherche" «opaque: owned by pill-search.ts»',
    '    div.gl-filter-panel__group data:glFilterId="categories" data:glFilterKind="taxonomy"',
    '      h3.gl-filter-panel__group-title text="Catégories"',
    "      div.gl-filter-panel__tree",
    "        ul.gl-filter-tree.gl-filter-tree--root",
    "          li.gl-filter-tree__item.gl-filter-tree__item--category",
    "            div.gl-filter-tree__row",
    '              span.gl-filter-tree__arrow role="button" aria-label="Déplier" tabindex="0" text="▶"',
    "              label.gl-filter-tree__label.gl-filter-tree__label--category",
    '                input.gl-filter-tree__checkbox.gl-filter-tree__checkbox--category type="checkbox" value="CULTURES"',
    '                span.gl-filter-tree__text text="Culture"',
    "            ul.gl-filter-tree.gl-filter-tree--subcategories",
    "              li.gl-filter-tree__item.gl-filter-tree__item--subcategory",
    "                div.gl-filter-tree__row",
    "                  span.gl-filter-tree__spacer",
    "                  label.gl-filter-tree__label.gl-filter-tree__label--subcategory",
    '                    input.gl-filter-tree__checkbox.gl-filter-tree__checkbox--subcategory type="checkbox" data:glFilterCategoryId="CULTURES" data:glFilterSubcategoryId="MUSEE" value="on"',
    '                    span.gl-filter-tree__text text="Musée"',
    "              li.gl-filter-tree__item.gl-filter-tree__item--subcategory",
    "                div.gl-filter-tree__row",
    "                  span.gl-filter-tree__spacer",
    "                  label.gl-filter-tree__label.gl-filter-tree__label--subcategory",
    '                    input.gl-filter-tree__checkbox.gl-filter-tree__checkbox--subcategory type="checkbox" data:glFilterCategoryId="CULTURES" data:glFilterSubcategoryId="THEATRE" value="on"',
    '                    span.gl-filter-tree__text text="THEATRE"',
    "          li.gl-filter-tree__item.gl-filter-tree__item--category",
    "            div.gl-filter-tree__row",
    "              span.gl-filter-tree__spacer",
    "              label.gl-filter-tree__label.gl-filter-tree__label--category",
    '                input.gl-filter-tree__checkbox.gl-filter-tree__checkbox--category type="checkbox" value="NATURE"',
    '                span.gl-filter-tree__text text="NATURE"',
    '    div.gl-filter-panel__group data:glFilterId="tags" data:glFilterKind="tag"',
    '      h3.gl-filter-panel__group-title text="Tags"',
    "      div.gl-filter-panel__tags-container",
    '        button.gl-filter-panel__tag-badge type="button" data:tagValue="free" text="Gratuit"',
    '        button.gl-filter-panel__tag-badge type="button" data:tagValue="paid" text="paid"',
    '    div.gl-filter-panel__group data:glFilterId="surface" data:glFilterKind="range"',
    '      h3.gl-filter-panel__group-title text="Surface"',
    "      div.gl-filter-panel__control.gl-filter-panel__control--range",
    '        input.gl-filter-panel__range type="range" min="5" max="80" step="5" value="5"',
    '        span.gl-filter-panel__range-value text="5"',
    '    div.gl-filter-panel__group data:glFilterId="pmr" data:glFilterKind="boolean"',
    '      h3.gl-filter-panel__group-title text="PMR"',
    "      label.gl-filter-panel__control.gl-filter-panel__control--boolean",
    '        input.gl-filter-panel__checkbox type="checkbox" value="on"',
    '        span text="PMR"',
    '    div.gl-filter-panel__group data:glFilterId="empty" data:glFilterKind="taxonomy"',
    '      h3.gl-filter-panel__group-title text="Vide"',
    "      div.gl-filter-panel__tree",
    // B.38: was the literal "Aucune catégorie". The notice now comes from
    // `ui.filter_panel.no_categories`, which already existed and was translated in all six
    // dictionaries — the renderer just never asked for it. This line records the dictionary's
    // own wording; it is the fr value because `getLabel` falls back to fr when i18n has not
    // been initialised, which is the case in this suite.
    '        p.gl-filter-panel__tree-empty text="Aucune catégorie disponible sur les layers visibles"',
    "  div.gl-filter-panel__footer",
    '    button.gl-filter-panel__action.gl-filter-panel__action--apply type="button" data:glAction="filter-apply" text="Appliquer"',
    '    button.gl-filter-panel__action.gl-filter-panel__action--reset type="button" data:glAction="filter-reset" text="Réinitialiser"',
];

describe("renderFilterPanel — golden DOM (B.18)", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it("emits exactly the frozen tree: tag, classes, attributes, dataset, text, order and depth", () => {
        const lines = serialize(renderFilterPanel(CONFIG, OPTIONS), 0, []);
        expect(lines).toEqual(GOLDEN);
    });

    it("renders no group for a `proximity` field (toolbar-driven, S5)", () => {
        // Guards the golden itself: the absence above must be an absence, not a
        // serializer that silently skipped the node.
        const panel = renderFilterPanel(CONFIG, OPTIONS);
        expect(panel.querySelector('[data-gl-filter-id="nope"]')).toBeNull();
        expect(panel.querySelectorAll(".gl-filter-panel__group")).toHaveLength(6);
    });

    it("renders no group for a `tag` field whose options resolved empty", () => {
        const panel = renderFilterPanel(CONFIG, { ...OPTIONS, tags: { values: [] } });
        expect(panel.querySelector('[data-gl-filter-id="tags"]')).toBeNull();
    });

    /**
     * `docs/security/SECURITY_CONTRACT.md` lists the three label sites of this file as
     * `textContent` sinks and flags them "aucune assertion XSS". They are precisely the
     * sites B.18 moved onto `createElement`, whose props bag can ALSO carry `innerHTML`
     * — one key away from a live sink. This pins the choice.
     */
    it("puts category, sub-category and tag labels in as text, never as markup", () => {
        // A live `DOMSecurity` is what makes this case DISCRIMINATING. Without it,
        // `createElement`'s `innerHTML` branch degrades to `textContent` and swapping
        // the two props produces byte-identical DOM — the assertion below would pass
        // against an `innerHTML` sink. `setSafeHTML` is reached only by that branch,
        // so "never called" is what actually pins the prop choice.
        const setSafeHTML = vi.fn();
        globalThis.GeoLeaf = { DOMSecurity: { setSafeHTML } };

        const payload = '<img src=x onerror="alert(1)">';
        const panel = renderFilterPanel(CONFIG, {
            categories: {
                categories: { [payload]: { subcategories: { [payload]: {} } } },
            },
            tags: { values: [{ value: "v", label: payload }] },
        });

        const texts = [...panel.querySelectorAll(".gl-filter-tree__text")];
        expect(texts.map((t) => t.textContent)).toEqual([payload, payload]);
        expect(panel.querySelector(".gl-filter-panel__tag-badge").textContent).toBe(payload);
        // Nothing was parsed into the tree: no node, no handler attribute — and the
        // payload comes back out escaped, which is what proves it was text going in.
        expect(panel.querySelector("img")).toBeNull();
        expect(panel.querySelector("[onerror]")).toBeNull();
        expect(panel.innerHTML).toContain("&lt;img");
        // No label ever took the HTML path, sanitised or not.
        expect(setSafeHTML).not.toHaveBeenCalled();
    });
});
