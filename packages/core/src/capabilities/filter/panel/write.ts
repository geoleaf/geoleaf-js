/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter panel — control writer (S13).
 *
 * The inverse of `panel/state.ts::readActiveFilter`: reflects a serialised filter
 * state onto the mounted panel controls (text inputs, taxonomy tree checkboxes, tag
 * badges, range slider, boolean checkbox). Replaces the former permalink
 * **ghost-injection** (hidden fake inputs) with a direct write on the real controls.
 * Iterates over `config.fields` (trusted ids) rather than the serialised ids
 * (URL-sourced) so no untrusted value ever reaches a CSS selector; a taxonomy
 * `subValues` is compared with the attributes read off the checkboxes, never
 * interpolated into a selector.
 *
 * For a taxonomy, a state carrying `subValues` is restored exactly. A flat one — no
 * sub-category checked, an earlier version, a permalink — cannot tell apart two
 * checkboxes carrying the same id (a sub-category listed under two categories, or a
 * sub-category and a category sharing an id) and checks all of them, as it always did.
 */

import { normalizeSubValues } from "../serialize.js";
import type {
    FilterConfig,
    SerializedFilterField,
    SerializedFilterState,
    TaxonomySubValue,
} from "../types.js";

/**
 * Writes `state` onto the panel controls. The panel is assumed freshly rendered
 * (permalink restore) — fields absent from `state` are left cleared.
 */
export function writePanelControls(
    panel: HTMLElement | null,
    state: SerializedFilterState,
    config: FilterConfig
): void {
    if (!panel) return;
    const byId = new Map((state.fields ?? []).map((f) => [f.id, f]));
    for (const descriptor of config.fields ?? []) {
        const group = panel.querySelector<HTMLElement>(`[data-gl-filter-id="${descriptor.id}"]`);
        if (!group) continue;
        const sf = byId.get(descriptor.id);
        switch (descriptor.kind) {
            case "text":
                _writeText(group, sf);
                break;
            case "taxonomy":
                _writeTaxonomy(group, sf);
                break;
            case "tag":
                _writeTag(group, sf);
                break;
            case "range":
                _writeRange(group, sf);
                break;
            case "boolean":
                _writeBoolean(group, sf);
                break;
            // `proximity` is toolbar-driven (not in the panel) — restored via the engine.
            default:
                break;
        }
    }
}

function _writeText(group: HTMLElement, sf: SerializedFilterField | undefined): void {
    const input = group.querySelector<HTMLInputElement>("input[type='text']");
    if (input) input.value = sf?.text ?? "";
}

function _writeTaxonomy(group: HTMLElement, sf: SerializedFilterField | undefined): void {
    const values = new Set(sf?.values ?? []);
    // Without a usable `subValues`, `values` decides alone, as it always did. With it, a
    // sub-category also needs its (category, sub-category) pair listed, and a category is
    // read from `values` minus `subValues` (counted with multiplicity), so a sub-category id
    // equal to a category id does not check that category. Categories that have
    // sub-categories are re-derived by the tri-state either way.
    const subValues = normalizeSubValues(sf?.subValues);
    const pairs = subValues.length ? _pairsByCategory(subValues) : null;
    const categories = pairs ? _categoryIds(sf?.values ?? [], subValues) : values;
    group
        .querySelectorAll<HTMLInputElement>("input.gl-filter-tree__checkbox--category")
        .forEach((el) => {
            el.checked = categories.has(el.value);
        });
    group
        .querySelectorAll<HTMLInputElement>("input.gl-filter-tree__checkbox--subcategory")
        .forEach((el) => {
            const sub = el.getAttribute("data-gl-filter-subcategory-id");
            const category = el.getAttribute("data-gl-filter-category-id") ?? "";
            el.checked =
                sub != null &&
                values.has(sub) &&
                (pairs === null || pairs.get(category)?.has(sub) === true);
        });
    _recomputeTristate(group);
}

/** Category id → the sub-category ids `subValues` lists under it. */
function _pairsByCategory(subValues: TaxonomySubValue[]): Map<string, Set<string>> {
    const pairs = new Map<string, Set<string>>();
    for (const { value, category } of subValues) {
        const subs = pairs.get(category) ?? new Set<string>();
        subs.add(value);
        pairs.set(category, subs);
    }
    return pairs;
}

/** The checked category ids of a taxonomy state: `values` minus one occurrence per `subValues` entry. */
function _categoryIds(values: readonly string[], subValues: TaxonomySubValue[]): Set<string> {
    const left = new Map<string, number>();
    for (const v of values) left.set(v, (left.get(v) ?? 0) + 1);
    for (const { value } of subValues) {
        const n = left.get(value) ?? 0;
        if (n > 1) left.set(value, n - 1);
        else left.delete(value);
    }
    return new Set(left.keys());
}

/** Restores the parent category tri-state (checked / indeterminate) after a write. */
function _recomputeTristate(group: HTMLElement): void {
    group.querySelectorAll(".gl-filter-tree__item--category").forEach((item) => {
        const parent = item.querySelector<HTMLInputElement>(".gl-filter-tree__checkbox--category");
        const subs = Array.from(
            item.querySelectorAll<HTMLInputElement>(".gl-filter-tree__checkbox--subcategory")
        );
        if (!parent || subs.length === 0) return;
        const checked = subs.filter((s) => s.checked).length;
        parent.checked = checked === subs.length;
        parent.indeterminate = checked > 0 && checked < subs.length;
    });
}

function _writeTag(group: HTMLElement, sf: SerializedFilterField | undefined): void {
    const values = new Set(sf?.values ?? []);
    group.querySelectorAll<HTMLElement>(".gl-filter-panel__tag-badge").forEach((badge) => {
        const v = badge.getAttribute("data-tag-value");
        badge.classList.toggle("gl-is-selected", v != null && values.has(v));
    });
}

function _writeRange(group: HTMLElement, sf: SerializedFilterField | undefined): void {
    const input = group.querySelector<HTMLInputElement>("input[type='range']");
    if (!input) return;
    const min = sf?.range?.min;
    input.value = typeof min === "number" ? String(min) : input.min || "0";
    const label = group.querySelector(".gl-filter-panel__range-value");
    if (label) label.textContent = input.value;
}

function _writeBoolean(group: HTMLElement, sf: SerializedFilterField | undefined): void {
    const input = group.querySelector<HTMLInputElement>("input[type='checkbox']");
    if (input) input.checked = sf?.bool === true;
}

/** Clears every control of the panel back to its unconstrained state (reset). */
export function resetPanelControls(panel: HTMLElement | null): void {
    if (!panel) return;
    panel
        .querySelectorAll<HTMLInputElement>("input[type='checkbox'], input[type='radio']")
        .forEach((el) => {
            el.checked = false;
            el.indeterminate = false;
        });
    panel.querySelectorAll<HTMLInputElement>("input[type='text']").forEach((el) => {
        el.value = "";
    });
    panel.querySelectorAll<HTMLInputElement>("input[type='range']").forEach((el) => {
        el.value = el.min || "0";
    });
    panel.querySelectorAll(".gl-filter-panel__tag-badge.gl-is-selected").forEach((el) => {
        el.classList.remove("gl-is-selected");
    });
}
