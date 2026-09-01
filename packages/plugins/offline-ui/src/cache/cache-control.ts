/*!
 * GeoLeaf Storage - Cache Control
 * Factory + IControl shell. DOM, events, and state logic are in sub-modules.
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "@geoleaf/host-runtime";
import { LayerSelectorCore } from "./layer-selector/core.js";
import "../cache/layer-selector/data-fetching.js";
import "../cache/layer-selector/row-rendering.js";
import { DownloadHandler } from "./download-handler.js";

// Shared contract — the interfaces live in ./cache-control-types so every
// sub-module imports them from a leaf, not from this assembler.
import type { CacheControlOptions, CacheControlState } from "./cache-control-types.js";

// Sub-modules
import { buildStructure } from "./cache-control-dom.js";
import {
    attachEventListeners,
    handleLayersToggle,
    handleStatusToggle,
    toggleCollapsed,
    cleanup,
} from "./cache-control-events.js";
import {
    updateStatus,
    updateProgress,
    updateClearProgress,
    handleStop,
    handleCancelled,
    populateLayerSelection,
} from "./cache-control-state.js";

/** MapLibre IControl interface for CacheControl */
interface IControl {
    onAdd(map: unknown): HTMLElement;
    onRemove(map: unknown): void;
}

// ─── Factory ─────────────────────────────────────────────────────────

function createCacheControl(options: CacheControlOptions = {}): IControl | null {
    const self: CacheControlState = {
        options: {
            position: options.position || "topright",
            collapsed: options.collapsed || false,
            collapsible: options.collapsible !== false,
        },
        _eventCleanups: [],
        _map: null,
        _container: null,
        _bodyEl: null,
        _toggleBtn: null,
        _layersContent: null,
        _layersToggleBtn: null,
        _statusToggleBtn: null,
        _downloadBtn: null,
        _clearBtn: null,
        _stopBtn: null,
        _progressEl: null,
        _progressFill: null,
        _progressText: null,

        // Bind sub-module functions to this state instance.
        // Command delegations (download/clear/sync) call the managers directly
        // from the assembler — cache-control-state no longer imports them.
        _buildStructure: () => buildStructure(self),
        _attachEventListeners: () => attachEventListeners(self),
        _updateStatus: () => updateStatus(self),
        _updateProgress: (p) => updateProgress(self, p),
        _updateClearProgress: (p) => updateClearProgress(self, p),
        _populateLayerSelection: () => populateLayerSelection(),
        _cleanup: () => cleanup(self),
        _handleDownload: () => DownloadHandler.handleDownload(),
        _handleClear: () => DownloadHandler.handleClear(),
        _handleStop: () => handleStop(self),
        _handleLayersToggle: () => handleLayersToggle(self),
        _handleStatusToggle: () => handleStatusToggle(self),
        _handleCancelled: () => handleCancelled(self),
        _toggleCollapsed: () => toggleCollapsed(self),
    };

    const ctrl: IControl = {
        onAdd(map: unknown): HTMLElement {
            self._map = map;
            self._container = document.createElement("div");
            self._container.className = "gl-cache-control";

            self._container.addEventListener("wheel", (e) => e.stopPropagation());

            self._buildStructure();

            if (LayerSelectorCore && self._layersContent) {
                LayerSelectorCore.init(self, self._layersContent);
            }

            if (
                DownloadHandler &&
                self._progressEl &&
                self._progressFill &&
                self._progressText &&
                self._downloadBtn &&
                self._clearBtn
            ) {
                DownloadHandler.init(self, {
                    progressEl: self._progressEl,
                    progressFill: self._progressFill,
                    progressText: self._progressText,
                    downloadBtn: self._downloadBtn,
                    clearBtn: self._clearBtn,
                });
            }

            setTimeout(() => {
                self._populateLayerSelection()
                    .then(() => self._updateStatus())
                    .catch((error: unknown) => {
                        if (Log)
                            Log.error("[CacheControl] Error populating layer selection:", error);
                    });
            }, 100);

            return self._container;
        },

        onRemove(_map: unknown): void {
            self._cleanup();
            self._map = null;
            self._container = null;
        },
    };

    return ctrl;
}

const CacheControl = {
    create: createCacheControl,
};

export { CacheControl };
