/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter panel — state reader (S5, F2).
 *
 * Reads the mapping-driven panel DOM into the engine's `ActiveField[]` input, one
 * entry per constrained field (empty controls are omitted). Scoped per field group
 * (`[data-gl-filter-id]`) so several fields of the same kind coexist. Reuses the
 * existing DOM hooks (tree checkboxes, tag badges, proximity data-attributes).
 */

import type { FilterConfig, FilterFieldDescriptor } from "../types.js";
import type { ActiveField } from "../engine/types.js";
import { kmToMetres } from "../units.js";

/** Reads the panel DOM into the engine's active-field list. */
export function readActiveFilter(panelEl: HTMLElement | null, config: FilterConfig): ActiveField[] {
    const active: ActiveField[] = [];
    for (const field of config.fields ?? []) {
        if (field.kind === "proximity") {
            // Proximity is driven by the toolbar (no panel group since S5); read the
            // toolbar wrapper directly, whether or not the panel is mounted.
            const af = _readProximity(field);
            if (af) active.push(af);
            continue;
        }
        if (!panelEl) continue;
        const group = panelEl.querySelector<HTMLElement>(`[data-gl-filter-id="${field.id}"]`);
        if (!group) continue;
        const af = _readField(group, field);
        if (af) active.push(af);
    }
    return active;
}

function _readField(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    switch (field.kind) {
        case "text":
            return _readText(group, field);
        case "taxonomy":
            return _readTaxonomy(group, field);
        case "tag":
            return _readTag(group, field);
        case "range":
            return _readRange(group, field);
        case "boolean":
            return _readBoolean(group, field);
        // `proximity` is read from the toolbar wrapper in readActiveFilter (no panel group).
        default:
            return null;
    }
}

function _readText(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    const input = group.querySelector<HTMLInputElement>("input[type='text']");
    const text = input?.value.trim() ?? "";
    return text ? { descriptor: field, text: text.toLowerCase() } : null;
}

function _readTaxonomy(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    const values: string[] = [];
    group
        .querySelectorAll<HTMLInputElement>("input.gl-filter-tree__checkbox--category:checked")
        .forEach((el) => {
            if (el.value) values.push(el.value);
        });
    group
        .querySelectorAll<HTMLInputElement>("input.gl-filter-tree__checkbox--subcategory:checked")
        .forEach((el) => {
            const sub = el.getAttribute("data-gl-filter-subcategory-id");
            if (sub) values.push(sub);
        });
    return values.length ? { descriptor: field, values } : null;
}

function _readTag(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    const values: string[] = [];
    group.querySelectorAll(".gl-filter-panel__tag-badge.gl-is-selected").forEach((badge) => {
        const v = badge.getAttribute("data-tag-value");
        if (v) values.push(v);
    });
    return values.length ? { descriptor: field, values } : null;
}

function _readRange(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    const input = group.querySelector<HTMLInputElement>("input[type='range']");
    if (!input || input.value === "") return null;
    const val = Number(input.value);
    const min = input.min !== "" ? Number(input.min) : 0;
    if (Number.isNaN(val) || val <= min) return null;
    return { descriptor: field, range: { min: val } };
}

function _readBoolean(group: HTMLElement, field: FilterFieldDescriptor): ActiveField | null {
    const input = group.querySelector<HTMLInputElement>("input[type='checkbox']");
    return input?.checked ? { descriptor: field, bool: true } : null;
}

function _readProximity(field: FilterFieldDescriptor): ActiveField | null {
    const src = _activeToolbar();
    if (!src) return null;
    const lat = parseFloat(src.getAttribute("data-proximity-lat") ?? "");
    const lng = parseFloat(src.getAttribute("data-proximity-lng") ?? "");
    const radiusKm = parseFloat(src.getAttribute("data-proximity-radius") ?? "");
    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radiusKm)) return null;
    // The wrapper carries the radius in km (slider/config unit), but the engine
    // predicate compares against `haversine` **metres** (as the drawn circle uses
    // `km * 1000` metres) — convert here so features inside the circle actually pass.
    return {
        descriptor: field,
        proximity: { center: { lat, lng }, radius: kmToMetres(radiusKm) },
    };
}

/** The mobile proximity toolbar wrapper, when it carries an active proximity. */
function _activeToolbar(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    const toolbar = document.getElementById("gl-proximity-toolbar-wrapper");
    return toolbar?.getAttribute("data-proximity-active") === "true" ? toolbar : null;
}
