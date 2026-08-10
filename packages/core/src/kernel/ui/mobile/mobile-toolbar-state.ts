/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Mobile toolbar: shared mutable state, types and constants.
 */

export const _g = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as { GeoLeaf?: GeoLeafGlobal };

import { getLabel } from "../../../utils/i18n/i18n.js";

/**
 * What the mobile toolbar needs to build itself: its host element, the map handles it drives,
 * and which controls to show.
 *
 * Every `show*` flag defaults to the profile's `ui` block; passing them here overrides it.
 * The map handle is optional so the toolbar can be built before the map exists — the zoom
 * controls simply stay inert until it arrives.
 */
export interface MobileToolbarOptions {
    glMain: HTMLElement;
    map?: {
        zoomIn: () => void;
        zoomOut: () => void;
        getContainer: () => HTMLElement;
        getZoom: () => number;
    } | null;
    getFilterActiveState?: () => boolean;
    onResetFilters?: () => void;
    sheetTitles?: Record<string, string>;
    showGeolocation?: boolean;
    showThemeSelector?: boolean;
    showFilterPanel?: boolean;
    showLayerManager?: boolean;
    showLegend?: boolean;
}

/**
 * Where a node came from, so it can be put back exactly there.
 *
 * The mobile toolbar **moves** existing panels into its sheets rather than cloning them —
 * one DOM node, one set of listeners. `nextSibling` is what makes the restore faithful:
 * re-appending to `parent` alone would silently reorder the panel among its siblings.
 */
export interface RestoreEntry {
    parent: HTMLElement;
    node: HTMLElement;
    nextSibling: Node | null;
}

/**
 * The default sheet titles, resolved through the active translation table.
 *
 * A function rather than a constant because the labels must be read **after** the language is
 * set — a module-level object would freeze the titles at import time.
 *
 * @returns Sheet key → translated title.
 */
export function getDefaultSheetTitles(): Record<string, string> {
    return {
        zoom: getLabel("sheet.title.zoom"),
        geoloc: getLabel("sheet.title.geoloc"),
        search: getLabel("sheet.title.search"),
        proximity: getLabel("sheet.title.proximity"),
        filters: getLabel("sheet.title.filters"),
        themes: getLabel("sheet.title.themes"),
        legend: getLabel("sheet.title.legend"),
        layers: getLabel("sheet.title.layers"),
    };
}

/** Shared mutable DOM and runtime state — populated during init by each sub-module. */
export const domState = {
    overlay: null as HTMLElement | null,
    toolbar: null as HTMLElement | null,
    filterGroup: null as HTMLElement | null,
    filterBtn: null as HTMLElement | null,
    resetBtn: null as HTMLElement | null,
    scrollEl: null as HTMLElement | null,
    navUp: null as HTMLElement | null,
    navDown: null as HTMLElement | null,
    panelTitle: null as HTMLElement | null,
    panelBody: null as HTMLElement | null,
    tooltipEl: null as HTMLElement | null,
    activeSheetId: null as string | null,
    options: null as MobileToolbarOptions | null,
    filterCheckInterval: null as number | null,
    proximityActive: false,
    // proximity bar
    proximityBar: null as HTMLElement | null,
    proximitySlider: null as HTMLInputElement | null,
    proximityValidateBtn: null as HTMLButtonElement | null,
    proximityInstruction: null as HTMLElement | null,
    proximityRadiusLabel: null as HTMLElement | null,
    // sheet restore
    restoreOnClose: [] as RestoreEntry[],
    lastFocusedElement: null as HTMLElement | null,
};
