/*!
 * GeoLeaf Storage - Cache Control DOM
 * DOM construction methods for CacheControl.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";
import { buildZoneSelectionSection } from "./cache-control-zone.js";

import type { CacheControlState } from "./cache-control-types.js";

// ─── DOM construction ────────────────────────────────────────────────

/** Builds the top-level DOM structure (header, body, toggle). */
export function buildStructure(self: CacheControlState): void {
    // Main wrapper
    const container = self._container!;
    const wrapper = createElement("div", "gl-cache-control__wrapper", container);

    // Header: title + collapse button
    const header = createElement("div", "gl-cache-control__header", wrapper);

    const titleEl = createElement("div", "gl-cache-control__title", header);
    const iconSpan = document.createElement("span");
    iconSpan.className = "gl-cache-control__icon";
    iconSpan.textContent = "\u{1F4BE}";
    const textNode = document.createTextNode(" Offline Cache");
    titleEl.appendChild(iconSpan);
    titleEl.appendChild(textNode);

    // Prevent header click events from propagating to the map
    header.addEventListener("click", (e) => e.stopPropagation());

    // Toggle button
    if (self.options.collapsible) {
        const toggleBtn = createElement("button", "gl-cache-control__toggle", header);
        self._toggleBtn = toggleBtn;
        toggleBtn.type = "button";
        toggleBtn.setAttribute("aria-label", "Toggle cache");
        toggleBtn.textContent = "\u27F1";

        toggleBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            self._toggleCollapsed();
        });
    }

    self._bodyEl = createElement("div", "gl-cache-control__body", wrapper);

    if (self.options.collapsed && container) {
        container.classList.add("gl-cache-control--collapsed");
    }

    // Build the content
    buildContent(self);

    // Update initial status
    setTimeout(() => {
        self._updateStatus().catch((error: unknown) => {
            if (Log) Log.error("[CacheControl] Error updating initial status:", error);
        });
    }, 100);

    // Attach event listeners
    self._attachEventListeners();
}

/** Builds the cache content (status rows, layer section, sync section, actions, progress). */
function buildContent(self: CacheControlState): void {
    const bodyEl = self._bodyEl!;
    const statusSection = createElement("div", "gl-cache-status", bodyEl);

    // Header with toggle button
    const statusHeader = createElement("div", "gl-cache-status__header", statusSection);

    const statusTitle = createElement("div", "gl-cache-status__title", statusHeader);
    const statusIcon = document.createElement("span");
    statusIcon.className = "gl-cache-status__icon";
    statusIcon.textContent = "\u{1F4CA}";
    const statusLabel = document.createElement("span");
    statusLabel.className = "gl-cache-status__label";
    statusLabel.textContent = "STATUT";
    statusTitle.appendChild(statusIcon);
    statusTitle.appendChild(statusLabel);

    const statusToggleBtn = createElement("button", "gl-cache-status__toggle", statusHeader);
    self._statusToggleBtn = statusToggleBtn;
    statusToggleBtn.type = "button";
    statusToggleBtn.textContent = "\u25BC";
    statusToggleBtn.setAttribute("aria-label", "Toggle status");

    // Collapsible content container
    const statusInfo = createElement("div", "gl-cache-status__info", statusSection);
    statusInfo.style.display = "block"; // Open by default

    // Status rows
    const rows = [
        { key: "Profile:", id: "gl-cache-profile", value: "-" },
        { key: "State:", id: "gl-cache-state", value: "Not downloaded" },
        { key: "Size:", id: "gl-cache-size", value: "0 MB" },
        { key: "Quota:", id: "gl-cache-quota", value: "0 MB available" },
    ];

    interface StatusRow {
        key: string;
        id: string;
        value: string;
    }
    rows.forEach((row: StatusRow) => {
        const rowEl = createElement("div", "gl-cache-status__row", statusInfo);
        const keyEl = createElement("span", "gl-cache-status__key", rowEl);
        keyEl.textContent = row.key;
        const valueEl = createElement("span", "gl-cache-status__value", rowEl);
        valueEl.id = row.id;
        valueEl.textContent = row.value;
    });

    if (bodyEl) {
        buildLayerSelectionSection(self, bodyEl);
        buildZoneSelectionSection(self, bodyEl);
    }

    const warningSection = createElement("div", "gl-cache-warning", bodyEl);
    warningSection.id = "gl-cache-warning";
    warningSection.style.display = "none";

    const actionsSection = createElement("div", "gl-cache-actions", bodyEl);

    const downloadBtn = createElement(
        "button",
        "gl-btn gl-btn--primary gl-cache-btn",
        actionsSection
    );
    self._downloadBtn = downloadBtn;
    downloadBtn.id = "gl-cache-download";
    downloadBtn.title = "Download profile for offline use";
    const dlIcon = document.createElement("span");
    dlIcon.className = "gl-btn__icon";
    dlIcon.textContent = "\u2B07\uFE0F";
    const dlText = document.createElement("span");
    dlText.className = "gl-btn__text";
    dlText.textContent = "Download profile";
    downloadBtn.appendChild(dlIcon);
    downloadBtn.appendChild(dlText);

    const clearBtn = createElement(
        "button",
        "gl-btn gl-btn--secondary gl-cache-btn",
        actionsSection
    );
    self._clearBtn = clearBtn;
    clearBtn.id = "gl-cache-clear";
    clearBtn.title = "Clear the profile cache";
    clearBtn.disabled = true;
    const clearIcon = document.createElement("span");
    clearIcon.className = "gl-btn__icon";
    clearIcon.textContent = "\u{1F5D1}\uFE0F";
    const clearText = document.createElement("span");
    clearText.className = "gl-btn__text";
    clearText.textContent = "Clear cache";
    clearBtn.appendChild(clearIcon);
    clearBtn.appendChild(clearText);

    const progressEl = createElement("div", "gl-cache-progress", bodyEl);
    self._progressEl = progressEl;
    progressEl.id = "gl-cache-progress";
    progressEl.style.display = "none";

    const progressBar = createElement("div", "gl-cache-progress__bar", progressEl);
    const progressFill = createElement("div", "gl-cache-progress__fill", progressBar);
    self._progressFill = progressFill;
    progressFill.id = "gl-cache-progress-fill";

    const progressText = createElement("div", "gl-cache-progress__text", progressEl);
    self._progressText = progressText;
    progressText.id = "gl-cache-progress-text";
    progressText.textContent = "Downloading...";

    const stopBtn = createElement("button", "gl-btn gl-btn--danger gl-cache-btn-stop", progressEl);
    self._stopBtn = stopBtn;
    stopBtn.id = "gl-cache-stop";
    stopBtn.title = "Stop download";
    const stopIcon = document.createElement("span");
    stopIcon.className = "gl-btn__icon";
    stopIcon.textContent = "\u23F9\uFE0F";
    const stopText = document.createElement("span");
    stopText.className = "gl-btn__text";
    stopText.textContent = "Stop";
    stopBtn.appendChild(stopIcon);
    stopBtn.appendChild(stopText);
}

/** Builds the layer selection section (CONFIG accordion). */
function buildLayerSelectionSection(self: CacheControlState, parentEl: HTMLElement): void {
    const layersSection = createElement("div", "gl-cache-layers", parentEl);

    // Header with CONFIG title and toggle button
    const layersHeader = createElement("div", "gl-cache-layers__header", layersSection);

    const headerTitle = createElement("div", "gl-cache-layers__title", layersHeader);
    const layerIcon = document.createElement("span");
    layerIcon.className = "gl-cache-layers__icon";
    layerIcon.textContent = "\u2699\uFE0F";
    const layerLabel = document.createElement("span");
    layerLabel.className = "gl-cache-layers__label";
    layerLabel.textContent = "CONFIG";
    headerTitle.appendChild(layerIcon);
    headerTitle.appendChild(layerLabel);

    const layersToggleBtn = createElement("button", "gl-cache-layers__toggle", layersHeader);
    self._layersToggleBtn = layersToggleBtn;
    layersToggleBtn.type = "button";
    layersToggleBtn.textContent = "\u25BC";
    layersToggleBtn.setAttribute("aria-label", "Toggle configuration");

    // Collapsible content container
    self._layersContent = createElement("div", "gl-cache-layers__content", layersSection);
    self._layersContent.style.display = "block"; // Open by default

    // Placeholder - will be populated by _populateLayerSelection
    const loading = createElement("div", "gl-cache-layers__loading", self._layersContent);
    loading.textContent = "Loading layers...";
}
