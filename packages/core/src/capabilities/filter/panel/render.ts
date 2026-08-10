/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter panel — mapping-driven renderer (S5, F2).
 *
 * Builds the side-panel DOM from the `modules.filter.fields[]` descriptors, one
 * control per kind, geometry-agnostic. Pure DOM construction, no `innerHTML`, through
 * the two `dom-helpers` factories: `domCreate` — canonical, ADR-10 — wherever a class
 * name is all the element needs, and `createElement` wherever its declarative props
 * bag (`id`, `type`, `attributes`, `dataset`, `textContent`) is. Reuses the existing
 * panel DOM hooks (`data-gl-filter-id`, `gl-filter-tree__checkbox--category/subcategory`,
 * `gl-filter-panel__tag-badge`) so permalink / mobile-toolbar keep working. The
 * interactive proximity binding (map click / GPS) and the live mount are wired in F3.
 */
"use strict";

import { createElement, domCreate } from "../../../utils/general/dom-helpers.js";
import { createPillSearchInput } from "../../../kernel/ui/index.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import type { FilterConfig, FilterFieldDescriptor } from "../types.js";

/** A category node for taxonomy option rendering (from `getCategories`). */
interface RenderCategoryNode {
    label?: string;
    subcategories?: Record<string, RenderCategoryNode>;
}

/** Resolved options for one field (taxonomy tree / tag & value lists). */
export interface FieldOptions {
    /** `taxonomy` — category → { label, subcategories }. */
    categories?: Record<string, RenderCategoryNode>;
    /** `tag` — flat option list (`{ value, label? }`). */
    values?: { value: string; label?: string }[];
}

/** Resolved options keyed by field id. */
export type OptionsByField = Record<string, FieldOptions>;

/**
 * Resolves the panel title ONCE.
 *
 * ⚠️ Both the region's `aria-label` and the visible `<h2>` must come from here. They used
 * to fall back separately — `"Filter"` for the accessible name, `"Filtrer"` for the
 * heading — so a profile without `title` announced one label and displayed another
 * (WCAG 2.5.3, Label in Name). One expression makes that drift impossible.
 */
function _title(config: FilterConfig): string {
    return config.title ?? getLabel("ui.filter_panel.title");
}

/** Builds the whole filter panel from the resolved config + options. */
export function renderFilterPanel(config: FilterConfig, options: OptionsByField = {}): HTMLElement {
    const panel = createElement("aside", {
        id: "gl-filter-panel",
        className: "gl-filter-panel",
        attributes: { role: "region", "aria-label": _title(config) },
    });
    panel.appendChild(_header(config));

    const body = domCreate("div", "gl-filter-panel__body");
    for (const field of config.fields ?? []) {
        const group = _renderField(field, options[field.id] ?? {});
        if (group) body.appendChild(group);
    }
    panel.appendChild(body);
    panel.appendChild(_footer(config));
    return panel;
}

function _header(config: FilterConfig): HTMLElement {
    const header = domCreate("div", "gl-filter-panel__header");
    header.appendChild(
        createElement("h2", {
            className: "gl-filter-panel__title",
            textContent: _title(config),
        })
    );
    header.appendChild(
        createElement("button", {
            type: "button",
            className: "gl-filter-panel__toggle-btn",
            attributes: {
                "data-gl-action": "filter-close",
                "aria-label": getLabel("ui.filter_panel.close"),
            },
        })
    );
    return header;
}

function _footer(config: FilterConfig): HTMLElement {
    const footer = domCreate("div", "gl-filter-panel__footer");
    footer.appendChild(
        createElement("button", {
            type: "button",
            className: "gl-filter-panel__action gl-filter-panel__action--apply",
            attributes: { "data-gl-action": "filter-apply" },
            textContent: config.actions?.applyLabel ?? getLabel("ui.filter_panel.apply"),
        })
    );
    footer.appendChild(
        createElement("button", {
            type: "button",
            className: "gl-filter-panel__action gl-filter-panel__action--reset",
            attributes: { "data-gl-action": "filter-reset" },
            textContent: config.actions?.resetLabel ?? getLabel("ui.filter_panel.reset"),
        })
    );
    return footer;
}

/** One field group `<div data-gl-filter-id data-gl-filter-kind>` + control. */
function _renderField(field: FilterFieldDescriptor, opts: FieldOptions): HTMLElement | null {
    const control = _control(field, opts);
    if (!control) return null;
    const group = createElement("div", {
        className: "gl-filter-panel__group",
        dataset: { glFilterId: field.id, glFilterKind: field.kind },
    });
    if (field.label) {
        group.appendChild(
            createElement("h3", {
                className: "gl-filter-panel__group-title",
                textContent: field.label,
            })
        );
    }
    group.appendChild(control);
    return group;
}

function _control(field: FilterFieldDescriptor, opts: FieldOptions): HTMLElement | null {
    switch (field.kind) {
        case "text":
            return _controlText(field);
        case "taxonomy":
            return _controlTaxonomy(opts);
        case "tag":
            return _controlTag(opts);
        case "range":
            return _controlRange(field);
        case "boolean":
            return _controlBoolean(field);
        // `proximity` is driven by the toolbar button (S5), not rendered in the panel.
        default:
            return null;
    }
}

function _controlText(field: FilterFieldDescriptor): HTMLElement {
    // Rich pill widget (magnifier / clear / Enter-Escape) — reuses the shared helper.
    // The root keeps `gl-filter-panel__search`; the input keeps `gl-pill-search__input`
    // (desktop active-tab indicator hook) and defaults to `type="text"` (state reader).
    // Typing bubbles a native `input` event to the panel (debounced auto-apply); clear /
    // submit fire no native `input`, so dispatch a bubbling `change` to re-apply.
    let root: HTMLElement | null = null;
    const reapply = (): void => {
        root?.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const handles = createPillSearchInput({
        placeholder: field.placeholder ?? "",
        ariaLabel: field.label ?? "Recherche",
        submitAriaLabel: "Rechercher",
        clearAriaLabel: "Effacer",
        extraClass: "gl-filter-panel__search",
        onSubmit: reapply,
        onClear: reapply,
    });
    root = handles.root;
    return root;
}

function _controlTaxonomy(opts: FieldOptions): HTMLElement {
    const wrap = domCreate("div", "gl-filter-panel__tree");
    const entries = Object.entries(opts.categories ?? {});
    if (entries.length === 0) {
        wrap.appendChild(
            createElement("p", {
                className: "gl-filter-panel__tree-empty",
                textContent: getLabel("ui.filter_panel.no_categories"),
            })
        );
        return wrap;
    }
    const root = domCreate("ul", "gl-filter-tree gl-filter-tree--root");
    for (const [catId, cat] of entries) root.appendChild(_categoryItem(catId, cat));
    _wireTaxonomyTree(root);
    wrap.appendChild(root);
    return wrap;
}

/** A category `<li>`: arrow (if any sub) + category checkbox + nested sub-category list. */
function _categoryItem(catId: string, cat: RenderCategoryNode): HTMLElement {
    const subEntries = Object.entries(cat.subcategories ?? {});
    const item = domCreate("li", "gl-filter-tree__item gl-filter-tree__item--category");
    const row = domCreate("div", "gl-filter-tree__row");
    row.appendChild(
        subEntries.length
            ? createElement("span", {
                  className: "gl-filter-tree__arrow",
                  textContent: "▶",
                  attributes: { role: "button", tabindex: "0", "aria-label": "Déplier" },
              })
            : domCreate("span", "gl-filter-tree__spacer")
    );
    const label = domCreate("label", "gl-filter-tree__label gl-filter-tree__label--category");
    const input = createElement("input", {
        type: "checkbox",
        className: "gl-filter-tree__checkbox gl-filter-tree__checkbox--category",
    }) as HTMLInputElement;
    input.value = catId;
    label.appendChild(input);
    label.appendChild(
        createElement("span", {
            className: "gl-filter-tree__text",
            textContent: cat.label ?? catId,
        })
    );
    row.appendChild(label);
    item.appendChild(row);
    if (subEntries.length) {
        const subList = domCreate("ul", "gl-filter-tree gl-filter-tree--subcategories");
        for (const [subId, sub] of subEntries)
            subList.appendChild(_subCategoryItem(catId, subId, sub));
        item.appendChild(subList);
    }
    return item;
}

/** A sub-category `<li>`: spacer + sub-category checkbox (carries its id + parent link). */
function _subCategoryItem(catId: string, subId: string, sub: RenderCategoryNode): HTMLElement {
    const item = domCreate("li", "gl-filter-tree__item gl-filter-tree__item--subcategory");
    const row = domCreate("div", "gl-filter-tree__row");
    row.appendChild(domCreate("span", "gl-filter-tree__spacer"));
    const label = domCreate("label", "gl-filter-tree__label gl-filter-tree__label--subcategory");
    label.appendChild(
        createElement("input", {
            type: "checkbox",
            className: "gl-filter-tree__checkbox gl-filter-tree__checkbox--subcategory",
            // `data-gl-filter-subcategory-id` = read by the state reader; the parent-category
            // link is kept for permalink restore.
            dataset: { glFilterSubcategoryId: subId, glFilterCategoryId: catId },
        })
    );
    label.appendChild(
        createElement("span", {
            className: "gl-filter-tree__text",
            textContent: sub.label ?? subId,
        })
    );
    row.appendChild(label);
    item.appendChild(row);
    return item;
}

/**
 * Wires the tree interactivity (delegated on the root `<ul>`): the expand/collapse
 * arrow, the parent→children checkbox cascade and the child→parent tri-state
 * (`indeterminate`). Change events bubble on to the panel, which auto-applies.
 */
function _wireTaxonomyTree(root: HTMLElement): void {
    const toggleArrow = (arrow: Element): void => {
        const item = arrow.closest(".gl-filter-tree__item--category");
        if (!item) return;
        arrow.textContent = item.classList.toggle("is-expanded") ? "▼" : "▶";
    };
    root.addEventListener("click", (e) => {
        const arrow = (e.target as HTMLElement | null)?.closest?.(".gl-filter-tree__arrow");
        if (arrow) toggleArrow(arrow);
    });
    root.addEventListener("keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key !== "Enter" && ke.key !== " ") return;
        const arrow = (ke.target as HTMLElement | null)?.closest?.(".gl-filter-tree__arrow");
        if (arrow) {
            ke.preventDefault();
            toggleArrow(arrow);
        }
    });
    root.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement | null;
        if (!target) return;
        if (target.classList.contains("gl-filter-tree__checkbox--category")) {
            const item = target.closest(".gl-filter-tree__item--category");
            item?.querySelectorAll<HTMLInputElement>(
                ".gl-filter-tree__checkbox--subcategory"
            ).forEach((sub) => {
                sub.checked = target.checked;
            });
            target.indeterminate = false;
        } else if (target.classList.contains("gl-filter-tree__checkbox--subcategory")) {
            const item = target.closest(".gl-filter-tree__item--category");
            const parent = item?.querySelector<HTMLInputElement>(
                ".gl-filter-tree__checkbox--category"
            );
            const subs = Array.from(
                item?.querySelectorAll<HTMLInputElement>(
                    ".gl-filter-tree__checkbox--subcategory"
                ) ?? []
            );
            if (parent) {
                const checked = subs.filter((s) => s.checked).length;
                parent.checked = subs.length > 0 && checked === subs.length;
                parent.indeterminate = checked > 0 && checked < subs.length;
            }
        }
    });
}

function _controlTag(opts: FieldOptions): HTMLElement | null {
    const values = opts.values ?? [];
    // No tag values resolved (the data carries none, or the field path doesn't match) →
    // skip the group entirely rather than render an empty "Tags" section.
    if (values.length === 0) return null;
    const container = domCreate("div", "gl-filter-panel__tags-container");
    for (const opt of values) {
        const badge = createElement("button", {
            type: "button",
            className: "gl-filter-panel__tag-badge",
            dataset: { tagValue: opt.value },
            textContent: opt.label ?? opt.value,
        });
        badge.addEventListener("click", () => {
            badge.classList.toggle("gl-is-selected");
            // Auto-apply on selection (parity with the legacy multi-tag selector): a
            // <button> fires no native change, so bubble one to the panel delegation.
            badge.dispatchEvent(new Event("change", { bubbles: true }));
        });
        container.appendChild(badge);
    }
    return container;
}

function _controlRange(field: FilterFieldDescriptor): HTMLElement {
    const wrap = domCreate("div", "gl-filter-panel__control gl-filter-panel__control--range");
    const input = createElement("input", {
        type: "range",
        className: "gl-filter-panel__range",
        attributes: {
            min: String(field.min ?? 0),
            max: String(field.max ?? 100),
            step: String(field.step ?? 1),
        },
    }) as HTMLInputElement;
    input.value = String(field.min ?? 0);
    const value = createElement("span", {
        className: "gl-filter-panel__range-value",
        textContent: String(field.min ?? 0),
    });
    input.addEventListener("input", () => {
        value.textContent = input.value;
    });
    wrap.appendChild(input);
    wrap.appendChild(value);
    return wrap;
}

function _controlBoolean(field: FilterFieldDescriptor): HTMLElement {
    const wrap = domCreate("label", "gl-filter-panel__control gl-filter-panel__control--boolean");
    wrap.appendChild(
        createElement("input", { type: "checkbox", className: "gl-filter-panel__checkbox" })
    );
    wrap.appendChild(createElement("span", { textContent: field.label ?? field.field ?? "" }));
    return wrap;
}
