/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Table - Panel Module
 * Builds the bottom-sheet drawer for the table.
 */

import { Log } from "@geoleaf/host-runtime";
import { createSVGIcon } from "@geoleaf/host-runtime";
import { _g } from "./table-state.js";
import { events as _events } from "./utils/events.js";
import { TableContract } from "./table-seam.js";
import { tLabel as getLabel } from "@geoleaf/host-runtime";
import { createResizeHandle } from "./panel-resize.js";
import type { TableConfig, TableLayerData, TableMap, TableVisibilityManager } from "./types.js";
import type { EventCleanup } from "./event-cleanups.js";

/** Public surface of the table panel object (`GeoLeaf` table panel singleton). */
interface TablePanelApi {
    _eventCleanups: EventCleanup[];
    create(map: TableMap, config: TableConfig): HTMLElement;
    updateToolbarButtons(selectedCount: number): void;
    refreshLayerSelector(): void;
    destroy(): void;
    [key: string]: unknown;
}

const _TablePanel = {} as TablePanelApi;
_TablePanel._eventCleanups = [];

/**
 * Creates the main table container (bottom-sheet), or returns the existing one.
 *
 * Idempotent: a second call finds `.gl-table-panel` already in the document and returns it
 * rather than mounting a duplicate.
 *
 * @param _map - Unused. The panel is a DOM overlay and never talks to the map directly; the
 *   parameter stays because the plugin's mount contract passes it to every panel factory.
 * @param config - Table configuration.
 * @returns The table container element.
 */
_TablePanel.create = function (_map: TableMap, config: TableConfig) {
    // Return the existing container if already present
    let container = document.querySelector(".gl-table-panel") as HTMLElement | null;
    if (container) {
        return container;
    }

    // Create the main container
    container = document.createElement("div");
    container.className = "gl-table-panel";
    container.id = "gl-rp-pane-table"; // B1: aria-controls target for desktop panel table tab
    (container as HTMLElement).style.height = config.defaultHeight || "40%";

    // Add the resize handle when resizable
    if (config.resizable) {
        const resizeHandle = createResizeHandle(container, config, _TablePanel._eventCleanups);
        container.appendChild(resizeHandle);
    }

    // Create the toolbar (header)
    const toolbar = createToolbar(config);
    container.appendChild(toolbar);

    // Create the scrollable table wrapper
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "gl-table-panel__wrapper";
    container.appendChild(tableWrapper);

    // Create the empty table (filled later by the renderer)
    const table = document.createElement("table");
    table.className = "gl-table-panel__table";
    tableWrapper.appendChild(table);

    // Append to the body
    document.body.appendChild(container);

    // Force a reflow so the initial hidden transform is committed before the first
    // `.gl-is-visible` toggle. Built lazily on first click, this lets the very first
    // open animate (transition from the committed hidden state) rather than jump.
    void container.offsetHeight;

    Log.info("[TablePanel] Panel created successfully");
    return container;
};

/**
 * Creates the table toolbar — layer selector plus the row of table actions.
 *
 * @param config - Table configuration; supplies the selectable layers.
 * @returns The toolbar element, not yet mounted.
 * @private
 */
function createToolbar(config: TableConfig) {
    const toolbar = document.createElement("div");
    toolbar.className = "gl-table-panel__toolbar";

    // Layer selector
    const layerSelect = createLayerSelector();
    toolbar.appendChild(layerSelect);

    // Search field
    const searchInput = createSearchInput();
    toolbar.appendChild(searchInput);

    // Zoom-to-selection button
    const zoomButton = createButton(getLabel("ui.table.zoomToSelection"), "zoom", () => {
        TableContract.zoomToSelection();
    });
    zoomButton.disabled = true;
    zoomButton.setAttribute("data-table-btn", "zoom");
    toolbar.appendChild(zoomButton);

    // Highlight button
    const highlightButton = createButton(getLabel("ui.table.highlight"), "highlight", () => {
        const isActive = highlightButton.classList.toggle("gl-is-active");
        TableContract.highlightSelection(isActive);
    });
    highlightButton.disabled = true;
    highlightButton.setAttribute("data-table-btn", "highlight");
    toolbar.appendChild(highlightButton);

    // Export buttons (when enabled)
    if (config.enableExportButton) {
        const formats: string[] = config.exportFormats ?? ["geojson", "csv", "kml", "gpx", "excel"];
        toolbar.appendChild(
            createExportDropdown(
                getLabel("ui.table.exportSelection"),
                "export",
                formats,
                (fmt) => TableContract.exportSelection(fmt),
                true
            )
        );
        toolbar.appendChild(
            createExportDropdown(
                getLabel("ui.table.exportLayer"),
                "export-layer",
                formats,
                (fmt) => TableContract.exportLayerAll(fmt),
                false
            )
        );
    }

    // Spacer to push the toggle button to the right
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    toolbar.appendChild(spacer);

    // Toggle button (hide/show the table)
    const toggleBtn = createToggleButton();
    toolbar.appendChild(toggleBtn);

    return toolbar;
}

/**
 * Creates the layer selector.
 * @returns {HTMLElement}
 * @private
 */
function createLayerSelector() {
    const wrapper = document.createElement("div");
    wrapper.className = "gl-table-panel__layer-selector";

    const select = document.createElement("select");
    select.id = "geoleaf-table-layer-selector";
    select.name = "geoleaf-table-layer-selector";
    select.className = "gl-table-panel__select";
    select.setAttribute("data-table-layer-select", "");
    // The toolbar shows no visible text next to the control, so `aria-label` is the
    // only naming route available — `id`/`name` are NOT accessible names, which is why
    // axe reported `select-name` (critical) here with all six alternatives unsatisfied.
    // The placeholder option is not a name either: it is the current value, and it is
    // replaced as soon as a layer is picked.
    select.setAttribute("aria-label", getLabel("aria.table.layerSelect"));

    // Option by default
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = getLabel("ui.table.layer_placeholder");
    select.appendChild(defaultOption);

    // Deferred population: the GeoJSON layers are not yet available when the panel
    // is created. refreshLayerSelector() is called via the geoleaf:geojson:layers-loaded
    // event once async loading has completed.

    // Change event - with cleanup tracking
    const changeHandler = (e: Event) => {
        const layerId = (e.target as HTMLSelectElement)?.value ?? "";
        TableContract.setLayer(layerId);
    };

    const events = _events;
    if (events) {
        _TablePanel._eventCleanups.push(
            events.on(select, "change", changeHandler, false, "TablePanel.layerSelect")
        );
    } else {
        select.addEventListener("change", changeHandler);
    }

    wrapper.appendChild(select);
    return wrapper;
}

function _isLayerVisible(
    layerId: string,
    layerData: TableLayerData,
    VisibilityManager: TableVisibilityManager | undefined
): boolean {
    if (VisibilityManager && typeof VisibilityManager.getVisibilityState === "function") {
        const visState = VisibilityManager.getVisibilityState(layerId);
        return visState?.current === true;
    }
    if (layerData._visibility) return layerData._visibility.current === true;
    return true;
}

function _isTableLayer(layerData: TableLayerData): boolean {
    return !!layerData?.config?.table?.enabled;
}

/**
 * Populates the selector with the available layers.
 * @param {HTMLSelectElement} select - Select element
 * @private
 */
function populateLayerSelector(select: HTMLSelectElement) {
    const geojson = _g.GeoLeaf.GeoJSON;
    const allLayers = geojson?.getAllLayers?.() ?? [];
    if (allLayers.length === 0) {
        Log.warn("[TablePanel] Module GeoJSON non disponible ou aucune layer");
        return;
    }

    const VisibilityManager = _g.GeoLeaf._LayerVisibilityManager;

    // Collect existing option values to avoid duplicates
    const existingValues = new Set<string>();
    for (const opt of [...select.options].slice(1)) {
        existingValues.add(opt.value);
    }

    let addedCount = 0;
    for (const entry of allLayers) {
        const layerId = entry.id;
        if (!layerId) continue;
        const layerData = (geojson?.getLayerById?.(layerId) ?? entry) as TableLayerData;
        if (!_isTableLayer(layerData)) continue;
        if (!_isLayerVisible(layerId, layerData, VisibilityManager)) continue;
        if (existingValues.has(layerId)) continue;

        const option = document.createElement("option");
        option.value = layerId;
        option.textContent = layerData.label || layerData.config?.title || layerId;
        select.appendChild(option);
        addedCount++;
    }

    if (addedCount > 0) {
        Log.info("[TablePanel] Layer selector populated:", addedCount, "layers added");
    }
}

/**
 * Creates the field de recherche
 * @returns {HTMLElement}
 * @private
 */
function createSearchInput() {
    const wrapper = document.createElement("div");
    wrapper.className = "gl-table-panel__search";

    const input = document.createElement("input");
    input.type = "text";
    input.id = "geoleaf-table-search-input";
    input.name = "geoleaf-table-search-input";
    input.placeholder = getLabel("placeholder.search.input");
    input.className = "gl-table-panel__search-input";
    input.setAttribute("data-table-search", "");

    // Debounce the search to avoid too-frequent calls
    let timeout: ReturnType<typeof setTimeout> | undefined;
    input.addEventListener("input", (e: Event) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const searchText = ((e.target as HTMLInputElement)?.value ?? "").trim().toLowerCase();
            filterTableRows(searchText);
        }, 300);
    });

    wrapper.appendChild(input);
    return wrapper;
}

/**
 * Filters the table rows based on the search text.
 * @param {string} searchText - Text to search for
 * @private
 */
function filterTableRows(searchText: string) {
    const table = document.querySelector(".gl-table-panel__table tbody");
    if (!table) return;

    const rows = table.querySelectorAll("tr");
    rows.forEach((row: Element) => {
        const rowEl = row as HTMLElement;
        if (!searchText) {
            rowEl.style.display = "";
            return;
        }

        const cells = row.querySelectorAll("td");
        let match = false;

        cells.forEach((cell: Element) => {
            const text = (cell.textContent ?? "").toLowerCase();
            if (text.includes(searchText)) {
                match = true;
            }
        });

        rowEl.style.display = match ? "" : "none";
    });
}

/**
 * Creates a generic button.
 * @param {string} label - Button label
 * @param {string} icon - Icon class (optional)
 * @param {Function} onClick - Click callback
 * @returns {HTMLElement}
 * @private
 */
function createButton(
    label: string,
    icon: string | null | undefined,
    onClick: EventListener
): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "gl-table-panel__btn";
    button.textContent = label;

    if (icon) {
        button.classList.add("gl-table-panel__btn--" + icon);
    }

    if (onClick) {
        if (_events) {
            _TablePanel._eventCleanups.push(
                _events.on(button, "click", onClick, false, "TablePanel.button")
            );
        } else {
            button.addEventListener("click", onClick);
        }
    }

    return button;
}

const _FORMAT_LABELS: Record<string, string> = {
    geojson: "GeoJSON",
    csv: "CSV",
    kml: "KML",
    gpx: "GPX",
    excel: "Excel (.xlsx)",
};

let _docExportListenerBound = false;

function _closeAllExportDropdowns(): void {
    document.querySelectorAll(".gl-table-export-group.gl-is-open").forEach((el) => {
        el.classList.remove("gl-is-open");
        const dd = (el as HTMLElement).querySelector<HTMLElement>(".gl-table-export-dropdown");
        if (dd) {
            dd.style.top = "";
            dd.style.left = "";
        }
    });
}

/**
 * Creates a dropdown export button group.
 * @param label - Button label
 * @param dataAttr - data-table-btn value (empty string = no attribute = always enabled)
 * @param formats - Allowed format keys to display
 * @param onFormat - Callback called with the chosen format string
 * @param requiresSelection - When true, button is disabled until rows are selected
 */
function createExportDropdown(
    label: string,
    dataAttr: string,
    formats: string[],
    onFormat: (fmt: string) => void,
    requiresSelection: boolean
): HTMLElement {
    if (!_docExportListenerBound) {
        document.addEventListener("click", _closeAllExportDropdowns);
        _docExportListenerBound = true;
    }

    const group = document.createElement("div");
    group.className = "gl-table-export-group";

    const trigger = document.createElement("button");
    trigger.className = "gl-table-panel__btn gl-table-panel__btn--export-trigger";
    trigger.textContent = label + " ▾";
    if (requiresSelection) {
        trigger.disabled = true;
        trigger.dataset["tableBtn"] = dataAttr;
    }

    const dropdown = document.createElement("div");
    dropdown.className = "gl-table-export-dropdown";

    for (const fmt of formats) {
        const item = document.createElement("button");
        item.className = "gl-table-export-dropdown__item";
        item.textContent = _FORMAT_LABELS[fmt] ?? fmt.toUpperCase();
        const itemClick = (e: Event) => {
            e.stopPropagation();
            _closeAllExportDropdowns();
            if (fmt === "excel") {
                trigger.classList.add("gl-is-loading");
                setTimeout(() => trigger.classList.remove("gl-is-loading"), 8000);
            }
            onFormat(fmt);
        };
        if (_events) {
            _TablePanel._eventCleanups.push(
                _events.on(item, "click", itemClick, false, "TablePanel.exportItem")
            );
        } else {
            item.addEventListener("click", itemClick);
        }
        dropdown.appendChild(item);
    }

    const triggerClick = (e: Event) => {
        e.stopPropagation();
        const wasOpen = group.classList.contains("gl-is-open");
        _closeAllExportDropdowns();
        if (!wasOpen) {
            // .gl-table-panel has transform → it is the containing block for position:fixed children.
            // We must offset relative to the panel, not the viewport.
            const panelEl = trigger.closest<HTMLElement>(".gl-table-panel");
            const panelRect = panelEl?.getBoundingClientRect() ?? { top: 0, left: 0 };
            const rect = trigger.getBoundingClientRect();
            dropdown.style.top = `${rect.bottom - panelRect.top + 4}px`;
            dropdown.style.left = `${rect.left - panelRect.left}px`;
            group.classList.add("gl-is-open");
        }
    };

    if (_events) {
        _TablePanel._eventCleanups.push(
            _events.on(trigger, "click", triggerClick, false, "TablePanel.exportTrigger")
        );
    } else {
        trigger.addEventListener("click", triggerClick);
    }

    group.appendChild(trigger);
    group.appendChild(dropdown);
    return group;
}

/**
 * Creates the toggle button that hides the table (integrated in the toolbar).
 * @returns {HTMLElement}
 * @private
 */
function createToggleButton() {
    const button = document.createElement("button");
    button.className = "gl-table-panel__toggle-btn";
    button.title = getLabel("aria.table.hide");
    button.setAttribute("aria-label", getLabel("aria.table.hide"));
    const icon = document.createElement("span");
    icon.className = "gl-table-panel__toggle-btn__icon";
    // SAFE: static hardcoded SVG, no user data
    const rightSvg = createSVGIcon(16, 16, "M9 6l6 6-6 6", {
        stroke: "currentColor",
        strokeWidth: "6",
        fill: "none",
    });
    icon.appendChild(rightSvg);
    button.appendChild(icon);
    // Close (hide) the table; hide() resets the trigger buttons' active state.
    const clickHandler = () => {
        TableContract.toggle();
    };
    const events = _events;
    if (events) {
        _TablePanel._eventCleanups.push(
            events.on(button, "click", clickHandler, false, "TablePanel.toggleBtn")
        );
    } else {
        button.addEventListener("click", clickHandler);
    }
    return button;
}

/**
 * Updates the toolbar buttons state based on the selection.
 * @param {number} selectedCount - Number of selected entities
 */
_TablePanel.updateToolbarButtons = function (selectedCount: number) {
    const hasSelection = selectedCount > 0;

    const zoomBtn = document.querySelector("[data-table-btn='zoom']") as HTMLButtonElement | null;
    const highlightBtn = document.querySelector(
        "[data-table-btn='highlight']"
    ) as HTMLButtonElement | null;
    const exportBtn = document.querySelector(
        "[data-table-btn='export']"
    ) as HTMLButtonElement | null;

    if (zoomBtn) zoomBtn.disabled = !hasSelection;
    if (highlightBtn) {
        highlightBtn.disabled = !hasSelection;
        // When nothing is selected any more, disable the highlight
        if (!hasSelection && highlightBtn.classList.contains("gl-is-active")) {
            highlightBtn.classList.remove("gl-is-active");
            TableContract.highlightSelection(false);
        }
    }
    if (exportBtn) {
        exportBtn.disabled = !hasSelection;
        if (!hasSelection) {
            exportBtn.closest(".gl-table-export-group")?.classList.remove("gl-is-open");
        }
    }
};

/**
 * Refreshes the layer selector (useful after loading new layers).
 */
_TablePanel.refreshLayerSelector = function () {
    const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement | null;
    if (!select) return;

    // Sauvegarder the value currentle
    const currentValue = select.value;

    // Empty options (except the first)
    // Loop on the option itself, not on the count: the guard that ends the loop is the same
    // one the compiler needs, and it cannot spin on a length that disagrees (qualite Q5).
    for (let opt = select.options[1]; opt; opt = select.options[1]) {
        opt.remove();
    }

    // Re-peupler
    populateLayerSelector(select);

    // Check whether the current value is still available
    const optionValues = new Set(Array.from(select.options, (o: HTMLOptionElement) => o.value));
    if (currentValue && optionValues.has(currentValue)) {
        select.value = currentValue;
    } else if (currentValue && !optionValues.has(currentValue)) {
        // The active layer has been removed (hidden): switch to the first available
        const firstAvailable = select.options[1];
        if (firstAvailable) {
            select.value = firstAvailable.value;
            TableContract.setLayer(firstAvailable.value);
        } else {
            // No visible layer: empty the table
            select.value = "";
            TableContract.setLayer("");
        }
    }

    // Update the placeholder when no layer is visible
    const defaultOption = select.options[0];
    if (defaultOption) {
        defaultOption.textContent =
            select.options.length > 1 ? "Select a layer..." : "No visible layer";
    }

    Log.info(
        "[TablePanel] Layer selector refreshed,",
        select.options.length - 1,
        "layers disponibles"
    );
};

/**
 * Cleanup all event listners
 */
_TablePanel.destroy = function () {
    if (_TablePanel._eventCleanups && _TablePanel._eventCleanups.length > 0) {
        _TablePanel._eventCleanups.forEach((cleanup: EventCleanup) => {
            if (typeof cleanup === "function") cleanup();
        });
        _TablePanel._eventCleanups = [];
        Log.info("[TablePanel] Event listeners cleaned up");
    }
};

const TablePanel = _TablePanel;
export { TablePanel };
