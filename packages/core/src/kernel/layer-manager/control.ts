/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Control for LayerManager
 * Adapter-agnostic custom control for the layer manager panel.
 *
 * DEPENDENCIES:
 * - GeoLeaf.Log (optional)
 * - GeoLeaf._LayerManagerRenderer (for renderSections)
 *
 * EXPOSE:
 * - GeoLeaf._LayerManagerControl
 */

import { Log } from "../../utils/log/index.js";
import { LMRenderer } from "./renderer.js";
import type { LMSection, LMControlOptions, LMControlInstance } from "./layer-manager-helpers.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import {
    createCollapsibleToggle,
    applyToggleCollapsed,
} from "../../kernel/ui/collapsible-toggle.js";
import { emitLayerManagerPanel } from "./panel-seam.js";

function _buildLMHeader(opts: LMControlOptions, mainWrapper: HTMLElement): HTMLElement {
    const headerWrapper = domCreate("div", "gl-layer-manager__header-wrapper", mainWrapper);
    const header = domCreate("div", "gl-layer-manager__header", headerWrapper);
    const titleEl = domCreate("div", "gl-layer-manager__title", header);
    titleEl.textContent = opts.title || "Legend";
    return header;
}

function _buildLMBody(
    instance: LMControlInstance,
    opts: LMControlOptions,
    mainWrapper: HTMLElement
): void {
    const bodyWrapper = domCreate("div", "gl-layer-manager__body-wrapper", mainWrapper);
    instance._bodyEl = domCreate("div", "gl-layer-manager__body", bodyWrapper);
    const initialCollapsed = opts.collapsed ?? opts.collapsedByDefault ?? false;
    if (initialCollapsed) {
        instance._container!.classList.add("gl-layer-manager--collapsed");
        opts.collapsed = true;
    }
    if (LMRenderer) LMRenderer.renderSections(instance._bodyEl, opts.sections ?? []);
    else if (Log) Log.error("[LayerManager] _LayerManagerRenderer unavailable");
}

/**
 * Creates an adapter-agnostic layer manager control instance.
 *
 * The returned object exposes `addTo(map)` which delegates to
 * `map.addControl(container, position)` from the IMapAdapter contract.
 */
function createLayerManagerControl(options: LMControlOptions): LMControlInstance | null {
    const instance: LMControlInstance = {
        _map: null,
        _container: null,
        _bodyEl: null,
        _glOptions: options as LMControlInstance["_glOptions"],
        _controlHandle: null,
        _cleanups: [],

        addTo(map: unknown): LMControlInstance {
            this._map = map;
            this._container = domCreate("div", "gl-layer-manager");
            blockMapPropagation(this._container, this._cleanups);
            this._buildStructure();
            this._controlHandle = (
                map as { addControl: (c: HTMLElement, pos: string) => { remove(): void } }
            ).addControl(this._container, options.position || "bottomright");
            return this;
        },

        remove(): void {
            for (const fn of this._cleanups) fn();
            this._cleanups = [];
            this._controlHandle?.remove();
            this._controlHandle = null;
            this._map = null;
            this._container = null;
        },

        _buildStructure(): void {
            const opts = this._glOptions;
            const mainWrapper = domCreate(
                "div",
                "gl-layer-manager__main-wrapper",
                this._container!
            );
            const header = _buildLMHeader(opts, mainWrapper);
            if (opts.collapsible)
                createCollapsibleToggle(
                    header,
                    "gl-layer-manager",
                    () => this._toggleCollapsed(),
                    this._cleanups
                );
            _buildLMBody(this, opts, mainWrapper);
            // Announce the built panel so capabilities (e.g. profile-switcher) can insert
            // their controls at the top — no static kernel → capability import. Dispatched
            // synchronously, so subscribers insert within this same tick.
            const headerWrapper = header.parentElement;
            if (headerWrapper) {
                emitLayerManagerPanel({
                    container: this._container!,
                    mainWrapper,
                    headerWrapper: headerWrapper as HTMLElement,
                });
            }
        },

        _renderSections(sections: LMSection[]): void {
            if (LMRenderer) LMRenderer.renderSections(this._bodyEl, sections);
            else if (Log) Log.error("[LayerManager] _LayerManagerRenderer unavailable");
        },

        updateSections(sections: LMSection[]): void {
            this._glOptions.sections = Array.isArray(sections) ? sections : [];
            this._renderSections(this._glOptions.sections);
        },

        refresh(): void {
            if (LMRenderer && typeof LMRenderer.syncToggles === "function")
                LMRenderer.syncToggles();
            else if (this._glOptions?.sections) this._renderSections(this._glOptions.sections);
        },

        _toggleCollapsed(): void {
            this._glOptions.collapsed = applyToggleCollapsed(this._container!, "gl-layer-manager");
        },
    };

    return instance;
}

const LMControl = {
    create: createLayerManagerControl,
};
export { LMControl };
