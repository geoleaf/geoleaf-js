/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * desktop-panel.ts
 *
 * Right-hand side panel with collapsible vertical tabs (>= 1440px).
 * Tabs: Filtres / Couches / Légende (user-facing labels, hence French).
 * Elements are moved into the panel once the secondary modules have been imported.
 * Call activateDesktopPanel() from init.ts after Legend + LayerManager.
 */

import { getLabel } from "../../../utils/i18n/i18n.js";
import {
    buildThemeToggleBtn as _buildThemeToggleBtn,
    appendThemeToggleToTabs as _appendThemeToggleToTabs,
} from "./desktop-panel-theme.js";
import { emitDesktopTabsReady } from "./desktop-tabs-seam.js";
import { appendRegistryTabButtons as _appendRegistryTabButtons } from "./desktop-panel-slots.js";
import { resolveRovingIndex } from "../roving-tabindex.js";

interface DesktopPanelOptions {
    glMain: HTMLElement;
    titleFilters?: string;
    titleLayers?: string;
    titleLegend?: string;
    showFilters?: boolean;
    showLayers?: boolean;
    showLegend?: boolean;
    getFilterActiveState?: () => boolean;
}

interface RestoreEntry {
    node: HTMLElement;
    parent: Element;
    nextSibling: ChildNode | null;
}

const BREAKPOINT = "(min-width: 1440px)";

const PANEL_ID = "gl-right-panel";

let _panel: HTMLElement | null = null;

let _restoreEntries: RestoreEntry[] = [];

let _mql: MediaQueryList | null = null;

let _isActive = false;

let _legendObserver: MutationObserver | null = null;

let _filterObserver: MutationObserver | null = null;

let _getFilterActiveState: (() => boolean) | null = null;

let _mobileThemeToggle: HTMLButtonElement | null = null;

let _themeObserver: MutationObserver | null = null;

function _injectMobileThemeToggle(): void {
    const scroll =
        document.querySelector<HTMLElement>(".gl-map-toolbar__scroll") ??
        document.querySelector<HTMLElement>(".gl-map-toolbar");
    if (!scroll) return;
    if (scroll.querySelector("[data-variant='mobile-theme']")) return;
    const btn = _buildThemeToggleBtn("mobile");
    btn.classList.add("gl-map-toolbar__btn");
    scroll.appendChild(btn);
    _mobileThemeToggle = btn;
}

function _tryInjectMobile(): void {
    if (_mobileThemeToggle) return;
    _injectMobileThemeToggle();
    if (_mobileThemeToggle) {
        _themeObserver?.disconnect();
        _themeObserver = null;
    }
}

// DOM Builders

function buildTabsDom(
    panel: HTMLElement,
    titles: { filters: string; layers: string; legend: string },
    show: { filters: boolean; layers: boolean; legend: boolean }
): void {
    const tabs = document.createElement("div");
    tabs.className = "gl-rp-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", getLabel("aria.panel.nav"));
    const allDefs = [
        { id: "filters", label: titles.filters, visible: show.filters },
        { id: "layers", label: titles.layers, visible: show.layers },
        { id: "legend", label: titles.legend, visible: show.legend },
    ];
    const defs = allDefs.filter((d) => d.visible);
    for (const [i, def] of defs.entries()) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gl-rp-tab";
        btn.id = "gl-rp-tab-" + def.id; // B2: tab id for aria-labelledby
        btn.dataset.glRpTab = def.id;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-controls", "gl-rp-pane-" + def.id);
        btn.setAttribute("aria-selected", "false");
        btn.setAttribute("tabindex", i === 0 ? "0" : "-1"); // B4: roving tabindex
        btn.textContent = def.label;
        btn.addEventListener("click", () => handleTabClick(panel, def.id));
        tabs.appendChild(btn);
    }
    // B3: arrow key navigation (roving focus, no auto-select)
    tabs.addEventListener("keydown", (e: KeyboardEvent) => {
        const btns = Array.from(tabs.querySelectorAll<HTMLElement>("[role='tab']"));
        const idx = btns.indexOf(document.activeElement as HTMLElement);
        if (idx === -1) return;
        const next = resolveRovingIndex(e.key, idx, btns.length);
        if (next === null) return;
        e.preventDefault();
        btns[next]?.focus();
    });
    panel.appendChild(tabs);
    // Inject theme toggle at bottom of tab strip (above credential button if present)
    _appendThemeToggleToTabs(tabs);
    // Inject registry-declared desktop buttons (e.g. print) — above share
    _appendRegistryTabButtons(tabs);
    // Announce the tab strip so capabilities (e.g. share) inject their bottom buttons
    // via the seam — no static kernel→capability import. Dispatched synchronously, so
    // subscribers insert in this same tick (share stays between registry and theme toggle).
    emitDesktopTabsReady(tabs);
}

function buildContentDom(panel: HTMLElement): void {
    const content = document.createElement("div");
    content.className = "gl-rp-content";
    const ids = ["filters", "layers", "legend"];
    for (const id of ids) {
        const pane = document.createElement("div");
        pane.className = "gl-rp-pane";
        pane.id = "gl-rp-pane-" + id;
        pane.setAttribute("role", "tabpanel");
        pane.setAttribute("aria-labelledby", "gl-rp-tab-" + id); // B5
        pane.setAttribute("tabindex", "0"); // B5
        content.appendChild(pane);
    }
    // Content inserted BEFORE the tab strip (flex row order: content | tabs)
    panel.insertBefore(content, panel.firstChild);
}

function buildPanelDom(
    glMain: HTMLElement,
    titles: { filters: string; layers: string; legend: string },
    show: { filters: boolean; layers: boolean; legend: boolean }
): HTMLElement | null {
    // If no tabs are enabled, don't create the panel.
    if (!show.filters && !show.layers && !show.legend) return null;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", getLabel("aria.panel.lateral"));
    buildTabsDom(panel, titles, show);
    buildContentDom(panel);
    glMain.appendChild(panel);
    return panel;
}

// Tab Interaction

function _refreshFilterTabIndicator(): void {
    if (!_panel) return;
    const filterTab = _panel.querySelector<HTMLElement>("[data-gl-rp-tab='filters']");
    if (!filterTab) return;
    let active = _getFilterActiveState?.() ?? false;
    // Fallback: check filter panel DOM (search text, categories, tags)
    if (!active) {
        const panel = document.querySelector("#gl-filter-panel");
        if (panel) {
            const searchInput = panel.querySelector<HTMLInputElement>(
                "[data-gl-filter-id='searchText'] input.gl-pill-search__input"
            );
            const hasSearchText = !!searchInput && searchInput.value.trim().length > 0;
            active =
                hasSearchText ||
                panel.querySelectorAll(
                    ".gl-filter-tree__checkbox--category:checked, .gl-filter-tree__checkbox--subcategory:checked"
                ).length > 0 ||
                panel.querySelectorAll(".gl-filter-panel__tag-badge.gl-is-selected").length > 0;
        }
    }
    filterTab.classList.toggle("has-filters", active);
}

function _closeAllTabs(panel: HTMLElement): void {
    const allTabs = Array.from(panel.querySelectorAll<HTMLElement>(".gl-rp-tab"));
    allTabs.forEach((t) => {
        t.classList.remove("gl-is-active");
        t.setAttribute("aria-selected", "false");
        t.setAttribute("tabindex", "-1"); // B4: roving — reset all
    });
    // Keep first tab as keyboard entry point when none is active
    allTabs[0]?.setAttribute("tabindex", "0");
    panel
        .querySelectorAll<HTMLElement>(".gl-rp-pane")
        .forEach((p) => p.classList.remove("gl-is-active"));
    panel.classList.remove("gl-has-active");
}

function handleTabClick(panel: HTMLElement, tabId: string): void {
    const targetTab = panel.querySelector<HTMLElement>("[data-gl-rp-tab='" + tabId + "']");
    const targetPane = document.getElementById("gl-rp-pane-" + tabId);
    if (!targetTab || !targetPane) return;
    const isAlreadyActive = targetTab.classList.contains("gl-is-active");
    _closeAllTabs(panel);
    if (isAlreadyActive) return;
    targetTab.classList.add("gl-is-active");
    targetTab.setAttribute("aria-selected", "true");
    targetTab.setAttribute("tabindex", "0"); // B4: active tab in tab order
    targetPane.classList.add("gl-is-active");
    panel.classList.add("gl-has-active");
}

// Move / Restore

function storeAndMove(node: HTMLElement, targetBody: HTMLElement): void {
    _restoreEntries.push({
        node,
        parent: node.parentElement as Element,
        nextSibling: node.nextSibling as ChildNode | null,
    });
    targetBody.appendChild(node);
}

// Activate / Deactivate

function activatePanel(): void {
    if (_isActive) return;
    _isActive = true;
    const pFilters = document.getElementById("gl-rp-pane-filters");
    const pLayers = document.getElementById("gl-rp-pane-layers");
    const pLegend = document.getElementById("gl-rp-pane-legend");
    if (!pFilters || !pLayers || !pLegend) return;
    const filterPanel = document.getElementById("gl-filter-panel") as HTMLElement | null;
    if (filterPanel) {
        storeAndMove(filterPanel, pFilters);
    } else {
        // The filter panel (in-core `filter` capability) mounts asynchronously on
        // `geoleaf:app:ready`, so watch the DOM and move it across as soon as it
        // appears (same pattern as the legend, which is built after a styles fetch).
        _filterObserver = new MutationObserver(() => {
            const el = document.getElementById("gl-filter-panel") as HTMLElement | null;
            if (el && !pFilters.contains(el)) {
                storeAndMove(el, pFilters);
                _filterObserver!.disconnect();
                _filterObserver = null;
            }
        });
        _filterObserver.observe(document.body, { childList: true, subtree: true });
    }
    const layerManager = document.querySelector<HTMLElement>(".gl-layer-manager");
    if (layerManager) {
        storeAndMove(layerManager, pLayers);
    }
    const legend = document.querySelector<HTMLElement>(".gl-map-legend");
    if (legend) {
        storeAndMove(legend, pLegend);
    } else {
        // The legend is built asynchronously (styles fetch): watch the DOM and
        // move the element across once it appears.
        _legendObserver = new MutationObserver(() => {
            const el = document.querySelector<HTMLElement>(".gl-map-legend");
            if (el && !pLegend.contains(el)) {
                storeAndMove(el, pLegend);
                _legendObserver!.disconnect();
                _legendObserver = null;
            }
        });
        _legendObserver.observe(document.body, { childList: true, subtree: true });
    }
    // Inject theme toggle into mobile toolbar
    _tryInjectMobile();
    if (!_mobileThemeToggle) {
        _themeObserver = new MutationObserver(() => {
            _tryInjectMobile();
        });
        _themeObserver.observe(document.body, { childList: true, subtree: true });
    }
    document.body.classList.add("gl-right-panel-open");
}

function deactivatePanel(): void {
    if (!_isActive) return;
    _isActive = false;
    if (_legendObserver) {
        _legendObserver.disconnect();
        _legendObserver = null;
    }
    if (_filterObserver) {
        _filterObserver.disconnect();
        _filterObserver = null;
    }
    // Reversed copy rather than a descending index: the restore order is what matters, and a
    // copy is immune to the mutation of `_restoreEntries` that follows (qualite Q5).
    for (const { node, parent, nextSibling } of [..._restoreEntries].reverse()) {
        try {
            if (nextSibling && nextSibling.parentNode === parent) {
                parent.insertBefore(node, nextSibling);
            } else {
                parent.appendChild(node);
            }
        } catch {
            // noeud detache - ignorer
        }
    }
    _restoreEntries = [];
    if (_panel) {
        _panel.querySelectorAll<HTMLElement>(".gl-rp-tab").forEach((t) => {
            t.classList.remove("gl-is-active");
            t.setAttribute("aria-selected", "false");
        });
        _panel
            .querySelectorAll<HTMLElement>(".gl-rp-pane")
            .forEach((p) => p.classList.remove("gl-is-active"));
        _panel.classList.remove("gl-has-active");
        const filterTab = _panel.querySelector<HTMLElement>("[data-gl-rp-tab='filters']");
        filterTab?.classList.remove("has-filters");
    }
    document.removeEventListener("geoleaf:filters:applied", _refreshFilterTabIndicator);
    if (_themeObserver) {
        _themeObserver.disconnect();
        _themeObserver = null;
    }
    document.body.classList.remove("gl-right-panel-open");
}

// MediaQuery Listner

function onMQChange(e: MediaQueryListEvent): void {
    if (!_panel) return;
    if (e.matches) {
        activatePanel();
    } else {
        deactivatePanel();
    }
}

// Public API

/**
 * Builds the side panel DOM (>= 1440px).
 * Does NOT move any element in — call activateDesktopPanel() afterwards.
 */

export function initDesktopPanel(options: DesktopPanelOptions): void {
    const { glMain } = options;
    _getFilterActiveState = options.getFilterActiveState ?? null;
    if (document.getElementById(PANEL_ID)) return;
    const titles = {
        filters: options.titleFilters || "Filtres",
        layers: options.titleLayers || "Couches",
        legend: options.titleLegend || "Legende",
    };
    const show = {
        filters: options.showFilters !== false,
        layers: options.showLayers !== false,
        legend: options.showLegend !== false,
    };
    _panel = buildPanelDom(glMain, titles, show);
    _mql = window.matchMedia(BREAKPOINT);
    _mql.addEventListener("change", onMQChange);
    document.addEventListener("geoleaf:filters:applied", _refreshFilterTabIndicator);
    // NE PAS appeler activatePanel() ici :
    // the elements (legend, layer-manager) do not exist in the DOM yet.
    // init.ts calls activateDesktopPanel() after all secondary modules are loaded.
}

/**
 * Moves the elements (filters, layers, legend) into the panels.
 * A appeler APRES Legend.init(), LayerManager.init().
 */

export function activateDesktopPanel(): void {
    if (!_mql) return;
    if (_mql.matches) {
        activatePanel();
    }
}

/**
 * Destroys the side panel and restores the elements to their original place.
 */

export function destroyDesktopPanel(): void {
    deactivatePanel();
    if (_mql) {
        _mql.removeEventListener("change", onMQChange);
        _mql = null;
    }
    if (_panel && _panel.parentElement) {
        _panel.parentElement.removeChild(_panel);
    }
    _panel = null;
    _isActive = false;
    _restoreEntries = [];
    _mobileThemeToggle = null;
}
