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
import { dispatchGeoLeafEvent } from "../../events/event-bus.js";
import {
    buildThemeToggleBtn as _buildThemeToggleBtn,
    appendThemeToggleToTabs as _appendThemeToggleToTabs,
} from "./desktop-panel-theme.js";
import { emitDesktopTabsReady } from "./desktop-tabs-seam.js";
import { appendRegistryTabButtons as _appendRegistryTabButtons } from "./desktop-panel-slots.js";
import { resolveRovingIndex } from "../roving-tabindex.js";
import { registerLifecycleTeardown } from "../../shared/lifecycle.js";
import {
    getPanelPane,
    listPanelPanes,
    preparePane,
    registerPaneHost,
    type PanelPane,
} from "../panel-panes.js";

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

/**
 * One observer per registered pane whose element is not in the document yet.
 *
 * A list, and not two named fields like the built-ins above: how many panes are
 * registered is not known at authoring time. Every one of them is disconnected in
 * deactivatePanel — an observer left connected watches the body for the rest of the
 * session, which is the leak registerLifecycleTeardown was added to end.
 */
let _paneObservers: MutationObserver[] = [];

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

/**
 * Builds one vertical tab button, wired to the panel it belongs to.
 *
 * Extracted so a registered pane gets a tab byte-identical to a built-in one: the ARIA
 * wiring here is five attributes that have to agree with `buildContentDom`, and a second
 * hand-written copy would drift from this one without anything comparing them.
 *
 * @param panel - The side-panel root the click handler drives.
 * @param id - Pane identifier; yields `gl-rp-tab-<id>` and `aria-controls=gl-rp-pane-<id>`.
 * @param label - Visible text, already resolved in the interface language.
 * @param isFirst - Whether this tab is the keyboard entry point (B4: roving tabindex).
 * @returns The button, not yet mounted.
 */
function makeTabButton(
    panel: HTMLElement,
    id: string,
    label: string,
    isFirst: boolean
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gl-rp-tab";
    btn.id = "gl-rp-tab-" + id; // B2: tab id for aria-labelledby
    btn.dataset.glRpTab = id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", "gl-rp-pane-" + id);
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("tabindex", isFirst ? "0" : "-1"); // B4: roving tabindex
    btn.textContent = label;
    btn.addEventListener("click", () => handleTabClick(panel, id));
    return btn;
}

/**
 * Builds one tab panel.
 *
 * @param id - Pane identifier; yields `gl-rp-pane-<id>`.
 * @returns The pane element, not yet mounted.
 */
function makePane(id: string): HTMLElement {
    const pane = document.createElement("div");
    pane.className = "gl-rp-pane";
    pane.id = "gl-rp-pane-" + id;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", "gl-rp-tab-" + id); // B5
    pane.setAttribute("tabindex", "0"); // B5
    return pane;
}

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
        tabs.appendChild(makeTabButton(panel, def.id, def.label, i === 0));
    }
    // Registered panes come after the built-ins and before the theme separator, which
    // carries `margin-top: auto` and pushes the icon stack to the bottom of the strip.
    for (const pane of listPanelPanes()) {
        tabs.appendChild(makeTabButton(panel, pane.id, getLabel(pane.labelKey), false));
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
        content.appendChild(makePane(id));
    }
    for (const pane of listPanelPanes()) {
        content.appendChild(makePane(pane.id));
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
    // A registered pane counts: a profile may disable all three built-ins and still load a
    // plugin that owns one, and returning null there would drop its tab with no diagnostic.
    if (!show.filters && !show.layers && !show.legend && listPanelPanes().length === 0) {
        return null;
    }
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

/**
 * Closes every tab, and emits `geoleaf:panel:closed` **only if one was actually open**.
 *
 * 🛑 The emission lives HERE, not in `closePanel()` — because that is not the only
 * closing path. The three callers are `closePanel()`, the re-click on the active tab
 * (`handleTabClick`) and **`_activateTab` itself**, which closes before opening.
 * Emitting from `closePanel()` alone would have described a third of real closes.
 *
 * ⚠️ And the guard is necessary for the same reason: `openPanel()` goes through
 * `_activateTab`, hence through here. Without the "was a tab open?" test, every
 * programmatic `openPanel()` would start by announcing a close that did not happen.
 *
 * The identifier is read BEFORE cleanup: the open state has no dedicated variable,
 * it lives in the DOM (cf. `getOpenPanel`), so once the class is removed it is
 * unrecoverable.
 */
function _closeAllTabs(panel: HTMLElement): void {
    const closingTabId =
        panel
            .querySelector<HTMLElement>(".gl-rp-tab.gl-is-active")
            ?.getAttribute("data-gl-rp-tab") ?? null;
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
    if (closingTabId !== null) {
        dispatchGeoLeafEvent("geoleaf:panel:closed", { tabId: closingTabId });
    }
}

/**
 * Activates one tab, unconditionally — it never toggles.
 *
 * Extracted from `handleTabClick` so that the public `openPanel()` can reuse the activation
 * without inheriting the toggle. ⚠️ **Do not fold the toggle back in here**: an integrator
 * calling `openPanel(id)` twice must find the panel open both times, and a toggling
 * "open" is the old toggle defect reproduced on a public surface.
 *
 * @param panel - The side-panel root.
 * @param tabId - Tab to activate.
 * @returns `true` when the tab and its pane were found and activated, `false` otherwise.
 */
function _activateTab(panel: HTMLElement, tabId: string): boolean {
    const targetTab = panel.querySelector<HTMLElement>("[data-gl-rp-tab='" + tabId + "']");
    const targetPane = document.getElementById("gl-rp-pane-" + tabId);
    if (!targetTab || !targetPane) return false;
    // A registered pane may only have built its element just now — a plugin that constructs
    // its panel on first use is the normal case, not an edge one. `adoptPane` is idempotent,
    // and doing it here rather than leaving it to the observer is what stops the tab from
    // showing empty for the microtask the callback takes to fire.
    const registered = getPanelPane(tabId);
    if (registered && _isActive) {
        // The owner builds on demand — see `PanelPane.onOpen`. Without this the tab activates
        // on an empty pane, which is what a browser run showed before the hook existed.
        preparePane(tabId);
        adoptPane(registered);
    }
    _closeAllTabs(panel);
    targetTab.classList.add("gl-is-active");
    targetTab.setAttribute("aria-selected", "true");
    targetTab.setAttribute("tabindex", "0"); // B4: active tab in tab order
    targetPane.classList.add("gl-is-active");
    panel.classList.add("gl-has-active");
    // After `_closeAllTabs` above: a tab change therefore yields `closed(old)` THEN
    // `opened(new)`, in that order, and an opening from nothing yields only
    // `opened`.
    dispatchGeoLeafEvent("geoleaf:panel:opened", { tabId });
    return true;
}

/**
 * Click handler for a tab button — this one DOES toggle, by design: clicking the open tab
 * closes it. That behaviour belongs to the pointer interaction, not to the public API.
 */
function handleTabClick(panel: HTMLElement, tabId: string): void {
    const targetTab = panel.querySelector<HTMLElement>("[data-gl-rp-tab='" + tabId + "']");
    if (!targetTab || !document.getElementById("gl-rp-pane-" + tabId)) return;
    if (targetTab.classList.contains("gl-is-active")) {
        _closeAllTabs(panel);
        return;
    }
    _activateTab(panel, tabId);
}

// Move / Restore

/**
 * Moves a registered pane's element into its tab panel, now or as soon as it appears.
 *
 * ⚠️ The two branches are not a convenience. The built-in legend and filter panel already
 * needed this — both mount asynchronously, and both grew a hand-written observer here. A
 * plugin pane is worse: its bundle may not even have run yet. Registering a pane whose
 * element never arrives leaves an empty tab, which is a visible defect; adopting it late is
 * the only behaviour that is correct in both orders.
 *
 * @param pane - The registered pane to adopt.
 */
function adoptPane(pane: PanelPane): void {
    const target = document.getElementById("gl-rp-pane-" + pane.id);
    if (!target) return;
    const el = document.querySelector<HTMLElement>(pane.selector);
    if (el) {
        if (!target.contains(el)) storeAndMove(el, target);
        return;
    }
    const observer = new MutationObserver(() => {
        const found = document.querySelector<HTMLElement>(pane.selector);
        if (!found || target.contains(found)) return;
        storeAndMove(found, target);
        observer.disconnect();
        _paneObservers = _paneObservers.filter((o) => o !== observer);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    _paneObservers.push(observer);
}

function storeAndMove(node: HTMLElement, targetBody: HTMLElement): void {
    _restoreEntries.push({
        node,
        parent: node.parentElement as Element,
        nextSibling: node.nextSibling,
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
    const filterPanel = document.getElementById("gl-filter-panel");
    if (filterPanel) {
        storeAndMove(filterPanel, pFilters);
    } else {
        // The filter panel (in-core `filter` capability) mounts asynchronously on
        // `geoleaf:app:ready`, so watch the DOM and move it across as soon as it
        // appears (same pattern as the legend, which is built after a styles fetch).
        _filterObserver = new MutationObserver(() => {
            const el = document.getElementById("gl-filter-panel");
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
    for (const pane of listPanelPanes()) {
        adoptPane(pane);
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
    for (const observer of _paneObservers) {
        observer.disconnect();
    }
    _paneObservers = [];
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
    // Do NOT call activatePanel() here:
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
 * Opens a side-panel tab by id, **without toggling**.
 *
 * Calling it twice with the same id leaves the panel open — that is exactly what separates it
 * from a click on the tab, which closes an already-open tab. Use it to drive the panel from
 * host code (a menu entry, a deep link, a workflow step).
 *
 * @param tabId - Tab to open: `"filters"`, `"layers"` or `"legend"`, depending on what the
 *   profile enabled at `initDesktopPanel()`.
 * @returns `true` if the tab exists and is now open, `false` if the panel is not built, the
 *   desktop breakpoint is not active, or no such tab was declared.
 *
 * @example
 * ```js
 * GeoLeaf?.UI?.openPanel("layers"); // true
 * GeoLeaf?.UI?.openPanel("layers"); // true — still open, never a toggle
 * ```
 */
export function openPanel(tabId: string): boolean {
    if (!_panel || !_isActive) return false;
    return _activateTab(_panel, tabId);
}

/**
 * Closes whichever side-panel tab is open. A no-op when none is.
 *
 * @example
 * ```js
 * GeoLeaf?.UI?.closePanel();
 * GeoLeaf?.UI?.getOpenPanel(); // null
 * ```
 */
export function closePanel(): void {
    if (!_panel) return;
    _closeAllTabs(_panel);
}

/**
 * The id of the currently open tab, or `null` when the panel is closed or not built.
 *
 * ⚠️ The open state has no dedicated variable: it lives in the DOM, as the `gl-is-active`
 * class on the tab button. This reads it back rather than shadowing it, so the value cannot
 * drift from what the user sees.
 *
 * @example
 * ```js
 * GeoLeaf?.UI?.openPanel("legend");
 * GeoLeaf?.UI?.getOpenPanel(); // "legend"
 * ```
 */
export function getOpenPanel(): string | null {
    if (!_panel) return null;
    const active = _panel.querySelector<HTMLElement>(".gl-rp-tab.gl-is-active");
    return active?.getAttribute("data-gl-rp-tab") ?? null;
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

// Self-register the teardown so `Core.destroy()` actually tears the panel down. Mirrors
// `basemap-selector.ts` and `shared.ts`.
//
// 🛑 The defect was NOT in `destroyDesktopPanel` — it does disconnect its three
// `MutationObserver`s and restore the moved nodes. It was that **nobody called
// it**: it has been mounted on `GeoLeaf.UI` forever, and none of the
// `kernel/shared/lifecycle.ts` registrants triggered it. After `Core.destroy()`,
// `#gl-right-panel` stayed in the DOM, `_mql` kept its listener, and the three
// observers kept observing `document.body` — one more create/destroy cycle left
// three more.
//
// ⚠️ A test calling `destroyDesktopPanel()` directly comes out GREEN proving
// nothing: it exercises the function, not its caller. The proof is
// `__tests__/app/desktop-panel-teardown.test.js`, which goes through
// `Core.destroy()` — seen red 4/4 before this line.
registerLifecycleTeardown(destroyDesktopPanel);

/**
 * Adds a tab and a pane for every registered pane that has neither yet.
 *
 * Called when a pane registers, because bundle load order is not something either side
 * controls: a plugin whose script runs after `initDesktopPanel` would otherwise hold a
 * registration that nothing ever renders.
 */
function syncRegisteredPanes(): void {
    if (!_panel) return;
    const tabs = _panel.querySelector<HTMLElement>(".gl-rp-tabs");
    const content = _panel.querySelector<HTMLElement>(".gl-rp-content");
    if (!tabs || !content) return;
    for (const pane of listPanelPanes()) {
        if (_panel.querySelector("[data-gl-rp-tab='" + pane.id + "']")) continue;
        const btn = makeTabButton(_panel, pane.id, getLabel(pane.labelKey), false);
        // Before the separator, which carries `margin-top: auto`: appending past it would
        // drop the tab into the bottom icon stack, among buttons of a different shape.
        const separator = tabs.querySelector(".gl-rp-theme-separator");
        if (separator) tabs.insertBefore(btn, separator);
        else tabs.appendChild(btn);
        content.appendChild(makePane(pane.id));
        if (_isActive) adoptPane(pane);
    }
}

// The desktop panel offers itself as a pane host, at the HIGHEST priority.
//
// 🛑 Explicit, and not left to registration order. Above 1440px both hosts are live — the
// mobile pill is only hidden by CSS, it is still built — so which one answers decides whether
// the user gets a docked panel or a full-screen sheet over their map. Registration order looked
// like it settled that, and it does not: hosts register when their module is imported, and
// `globals.ui.ts` imports the mobile toolbar first. Measured at 1600px before this field
// existed: `openPane` answered true, `getOpenPanel()` answered null, and the sheet had opened.
registerPaneHost({
    id: "desktop-panel",
    priority: 0,
    isActive: () => _isActive && _panel !== null,
    open: (paneId) => openPanel(paneId),
    close: () => closePanel(),
    sync: () => syncRegisteredPanes(),
});
