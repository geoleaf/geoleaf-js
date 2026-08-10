/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Legend Control
 * Adapter-agnostic control for displaying a cartographic legend.
 *
 * DEPENDENCIES:
 * - GeoLeaf.Log (optional)
 * - LegendRenderer (static import from ./legend-renderer.js)
 *
 * EXPOSE:
 * - GeoLeaf._LegendControl
 */

import { Log } from "../../utils/log/index.js";
import { DOMSecurity } from "../../kernel/security/index.js";
import {
    ensureProfileSpriteInjectedSync,
    isProfileSpriteReady,
} from "../../utils/loaders/profile-sprite-loader.js";
import { LegendRenderer } from "./legend-renderer.js";
import type { LegendSection, LegendFooter } from "./legend-renderer.js";
import type { RenderGenHolder } from "./types.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { blockMapPropagation } from "../../utils/controls/propagation-blocker.js";
import { createCollapsibleToggle, applyToggleCollapsed } from "../../kernel/ui/index.js";

let _alreadyLogged = false;
let _spriteDetected = false;

/**
 * Ensures the SVG icon sprite is loaded with robust verification.
 * Fast-path: if sprite was already detected, invoke callback synchronously.
 */
async function ensureSpriteLoaded(callback?: (loaded: boolean) => void): Promise<void> {
    if (!_alreadyLogged) {
        Log?.debug("[Legend] Loading SVG sprite for icons...");
        _alreadyLogged = true;
    }

    await ensureProfileSpriteInjectedSync();

    if (isProfileSpriteReady()) {
        if (!_spriteDetected) {
            Log?.info("[Legend] SVG sprite detected and ready for use");
            _spriteDetected = true;
        }
        if (typeof callback === "function") callback(true);
        return;
    }

    // No sprite found after injection attempt — proceed without sprite icons
    Log?.debug("[Legend] No SVG sprite found — profile uses non-sprite icons");
    if (typeof callback === "function") callback(false);
}

interface LegendControlOptions {
    position?: string;
    title?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    sections?: LegendSection[];
    footer?: LegendFooter;
}

interface LegendAccordionEntry {
    layerId: string;
    label: string;
    collapsed?: boolean;
    order?: number;
    visible?: boolean;
    sections?: LegendSection[];
}

interface LegendControlInstance {
    _map: unknown;
    _container: HTMLElement | null;
    _bodyEl: HTMLElement;
    _glOptions: LegendControlOptions;
    _controlHandle: { remove(): void } | null;
    _cleanups: (() => void)[];
    addTo(map: unknown): LegendControlInstance;
    remove(): void;
    getContainer(): HTMLElement | null;
    _buildStructure(): void;
    _renderContent(): void;
    _toggleCollapsed(): void;
    updateMultiLayerContent(legendsArray: LegendAccordionEntry[]): void;
    show(): void;
    hide(): void;
}

function _buildLegendHeader(
    opts: LegendControlOptions,
    wrapper: HTMLElement,
    self: LegendControlInstance
): void {
    if (!opts.title) return;
    const header = domCreate("div", "gl-map-legend__header", wrapper);
    const titleEl = domCreate("h2", "gl-map-legend__title", header);
    titleEl.textContent = opts.title ?? "";
    if (opts.collapsible)
        createCollapsibleToggle(
            header,
            "gl-map-legend",
            () => self._toggleCollapsed(),
            self._cleanups
        );
}

function _renderLegendContent(bodyEl: HTMLElement, opts: LegendControlOptions): void {
    DOMSecurity.clearElementFast(bodyEl);
    if (!LegendRenderer) {
        if (Log) Log.error("[Legend] LegendRenderer not available");
        return;
    }
    ensureSpriteLoaded().catch((e: unknown) => Log?.error("[Legend] Sprite preload failed:", e));
    if (Array.isArray(opts.sections))
        opts.sections.forEach((section) => LegendRenderer.renderSection(bodyEl, section));
    if (opts.footer) LegendRenderer.renderFooter(bodyEl, opts.footer);
}

function _updateMultiLayerLegendContent(
    instance: LegendControlInstance,
    legendsArray: LegendAccordionEntry[]
): void {
    if (!instance._bodyEl) return;
    const gh = instance as LegendControlInstance & RenderGenHolder;
    gh._renderGen = (gh._renderGen ?? 0) + 1;
    const gen = gh._renderGen;
    DOMSecurity.clearElementFast(instance._bodyEl);
    if (!LegendRenderer || typeof LegendRenderer.renderAccordion !== "function") {
        if (Log) Log.error("[Legend] Renderer.renderAccordion not available");
        return;
    }
    ensureSpriteLoaded(function (spriteLoaded) {
        if (gh._renderGen !== gen) return;
        if (Log) Log.debug("[Legend] Sprite loaded:", spriteLoaded, "- Rendering accordions");
        if (Array.isArray(legendsArray))
            legendsArray.forEach((accordionData) =>
                LegendRenderer.renderAccordion(instance._bodyEl, accordionData)
            );
        if (!spriteLoaded) {
            setTimeout(function () {
                if (isProfileSpriteReady() && Log) {
                    Log.info("[Legend] Sprite loaded late - Re-rendering accordions");
                    instance.updateMultiLayerContent(legendsArray);
                }
            }, 1000);
        }
    }).catch((e: unknown) => Log?.error("[Legend] Sprite preload failed:", e));
}

function _doLegendBuildStructure(self: LegendControlInstance): void {
    const opts = self._glOptions;
    const wrapper = domCreate("div", "gl-map-legend__wrapper", self._container!);
    _buildLegendHeader(opts, wrapper, self);
    self._bodyEl = domCreate("div", "gl-map-legend__body", wrapper);
    if (opts.collapsed) self._container!.classList.add("gl-map-legend--collapsed");
    self._renderContent();
}

/**
 * Creates an adapter-agnostic legend control instance.
 *
 * The returned object exposes `addTo(map)` which delegates to
 * `map.addControl(container, position)` from the IMapAdapter contract.
 */
function createLegendControl(options: LegendControlOptions): LegendControlInstance | null {
    const instance: LegendControlInstance = {
        _map: null,
        _container: null,
        _bodyEl: null as unknown as HTMLElement,
        _glOptions: options,
        _controlHandle: null,
        _cleanups: [],

        addTo(map: unknown): LegendControlInstance {
            this._map = map;
            this._container = domCreate("div", "gl-map-legend");
            blockMapPropagation(this._container, this._cleanups);
            this._buildStructure();
            this._controlHandle = (
                map as { addControl: (c: HTMLElement, pos: string) => { remove(): void } }
            ).addControl(this._container, options.position || "bottomleft");
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

        getContainer(): HTMLElement | null {
            return this._container;
        },

        _buildStructure(): void {
            _doLegendBuildStructure(this);
        },

        _renderContent(): void {
            if (this._bodyEl) _renderLegendContent(this._bodyEl, this._glOptions);
        },

        _toggleCollapsed(): void {
            this._glOptions.collapsed = applyToggleCollapsed(this._container!, "gl-map-legend");
        },

        updateMultiLayerContent(legendsArray: LegendAccordionEntry[]): void {
            _updateMultiLayerLegendContent(this, legendsArray);
        },

        show(): void {
            if (this._container) this._container.style.display = "block";
        },

        hide(): void {
            if (this._container) this._container.style.display = "none";
        },
    };

    return instance;
}

const LegendControl = {
    create: createLegendControl,
};
export { LegendControl };
