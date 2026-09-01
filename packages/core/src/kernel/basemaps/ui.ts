/*!
 * GeoLeaf Core – Baselayers / UI
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";

import { DOMSecurity } from "../security/dom-security.js";

import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

import { _baseLayers, setBaseLayer, getActiveKey } from "./registry.js";

import { _onActiveKeyChange } from "./basemaps-state.js";

import type { BaseLayerEntry, BaselayersInitOptions } from "./basemaps-types.js";

/**
 * Window-like host providing `document` and `addEventListener`/`removeEventListener`.
 * `document` is absent in non-browser test environments — every read guards on it.
 */
interface WindowLikeHost {
    document?: Document;
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
}

const _g: WindowLikeHost = (typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : {}) as unknown as WindowLikeHost;

/**
 * Config surface the basemap UI reads to decide whether to render controls.
 * Only `ui` (and, for the Config fallback, `basemaps`) is consulted; callers may
 * pass a wider options bag — the extra keys are ignored.
 */
export interface BasemapUIConfigInput {
    ui?: { showBaseLayerControls?: boolean; [key: string]: unknown };
    basemaps?: Record<string, unknown>;
}

let _uiBound = false;

let _resizeHandler: (() => void) | null = null;

let _clickHandler: ((evt: Event) => void) | null = null;

let _unsubscribeActiveKey: (() => void) | null = null;

// ---------------------------------------------------------

// UI refresh

// ---------------------------------------------------------

/**
 * Syncs every basemap button with the active key: toggles the two state classes
 * and `aria-pressed`. Idempotent — safe to call on each activation.
 *
 * The former `_updateActiveIndicator()` helper was dropped here: it wrote
 * `--indicator-left` / `--indicator-width` onto the panel, and no CSS rule in
 * the repo ever read them (no indicator pseudo-element exists). Both the writer
 * and the two custom properties were dead.
 */
export function refreshUI() {
    if (!_g.document) return;
    const elements = _g.document.querySelectorAll("[data-gl-baselayer]");
    const activeKey = getActiveKey();
    elements.forEach((el: Element) => {
        const key = el.getAttribute("data-gl-baselayer");
        if (!key) return;
        const isActive = key === activeKey;
        el.classList.toggle("gl-baselayer-active", isActive);
        el.classList.toggle("gl-is-active", isActive);
        el.setAttribute("aria-pressed", String(isActive));
    });
}

// ---------------------------------------------------------

// UI controls creation

// ---------------------------------------------------------

// UI controls creation (helpers)

// ---------------------------------------------------------

function _computeShowControls(uiCfg: BasemapUIConfigInput["ui"] | undefined): boolean {
    return uiCfg && uiCfg.showBaseLayerControls === false ? false : !!uiCfg;
}

function _createLeftPanel(doc: Document): HTMLElement {
    const panel = doc.createElement("div");
    panel.id = "gl-left-panel";
    panel.className = "gl-left-panel";
    const mapContainer = doc.getElementById("geoleaf-map") || doc.querySelector(".gl-map");
    (mapContainer || doc.body).appendChild(panel);
    return panel;
}

function _populateLeftPanel(doc: Document, leftPanel: HTMLElement): void {
    DOMSecurity.clearElementFast(leftPanel);
    Object.keys(_baseLayers).forEach((key) => {
        const def = _baseLayers[key] as BaseLayerEntry;
        const button = doc.createElement("button");
        // Styled through [data-gl-baselayer] alone — the same hook this module
        // queries and the tests assert on. The former `gl-baselayer-btn` class
        // was a second, redundant hook whose rules lost the cascade anyway.
        button.setAttribute("data-gl-baselayer", key);
        button.setAttribute("aria-label", def.label || key);
        button.textContent = def.label || key;
        leftPanel.appendChild(button);
    });
    leftPanel.style.display = "flex";
    Log.info(
        "[GeoLeaf.Baselayers] Controls created with",
        Object.keys(_baseLayers).length,
        "buttons"
    );
}

/**
 * Renders the basemap switcher controls.
 *
 * When no config is passed, the `ui` and `basemaps` blocks are read from the live
 * configuration — which is what lets the kernel call this without threading options through.
 * Whether anything is rendered at all depends on `ui.showBaseLayerControls`.
 *
 * A no-op when there is no `document` (SSR, Node).
 *
 * @param config - Explicit UI/basemaps config; omitted or null reads it from `GeoLeaf.Config`.
 */
export function createBaseLayerControlsUI(
    config?: BasemapUIConfigInput | BaselayersInitOptions | null
) {
    const doc = _g.document;
    if (!doc) return;
    let resolved = config as BasemapUIConfigInput | null | undefined;
    const geoleafConfig = getGeoLeaf()?.Config;
    if (!resolved && geoleafConfig?.get) {
        const uiSection = geoleafConfig.get("ui") as BasemapUIConfigInput["ui"];
        resolved = {
            ...(uiSection !== undefined && { ui: uiSection }),
            basemaps: (geoleafConfig.get("basemaps") as Record<string, unknown>) || {},
        };
    }
    const uiCfg = resolved?.ui;
    const showControls = _computeShowControls(uiCfg);
    Log.info(
        "[GeoLeaf.Baselayers] showBaseLayerControls =",
        showControls,
        "(config.ui.showBaseLayerControls =",
        uiCfg?.showBaseLayerControls ?? "N/A",
        ")"
    );
    let leftPanel = doc.getElementById("gl-left-panel");
    if (showControls) {
        if (!leftPanel) {
            leftPanel = _createLeftPanel(doc);
        }
        _populateLeftPanel(doc, leftPanel);
        setTimeout(refreshUI, 50);
    } else {
        leftPanel?.parentNode?.removeChild(leftPanel);
    }
}

// ---------------------------------------------------------

// DOM binding (once only)

// ---------------------------------------------------------

/**
 * Wires the basemap-switcher listeners, once per lifecycle.
 *
 * Binds three things: a delegated `click` on `[data-gl-baselayer]`, a debounced `resize`, and
 * a subscription to the active-key state. Guarded by a flag, so repeated calls are no-ops
 * until {@link destroyUI} clears it.
 *
 * ⚠️ The handlers are kept in refs rather than inlined **because** `destroyUI` resets that
 * flag: with anonymous listeners, a destroy/re-init cycle would re-add them and fire
 * `setBaseLayer` once per past cycle. The state subscription is what keeps a button
 * highlighted at boot — `setBaseLayer` defers until the map is idle, and that late
 * activation is silent, so nothing else would mark the control.
 */
export function bindUIOnce() {
    const doc = _g.document;
    if (_uiBound || !doc) return;
    _uiBound = true;
    // Kept in a ref so `destroyUI()` can detach it: `_uiBound` is reset there, so an
    // anonymous listener would be re-added — and fire `setBaseLayer` once per past cycle.
    _clickHandler = (evt: Event) => {
        const origin = evt.target as HTMLElement | null;
        const target = origin?.closest?.("[data-gl-baselayer]");
        if (!target) return;
        const key = target.getAttribute("data-gl-baselayer");
        if (!key) return;
        evt.preventDefault();
        setBaseLayer(key);
        refreshUI();
    };
    doc.addEventListener("click", _clickHandler);
    let resizeTimeout: ReturnType<typeof setTimeout>;
    _resizeHandler = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(refreshUI, 100);
    };
    _g.addEventListener("resize", _resizeHandler);
    // Re-sync whenever a basemap actually becomes active. Without this the boot
    // sequence leaves no button highlighted: `setBaseLayer` defers until the map
    // is idle, so the `refreshUI()` that init() runs right after this sees a null
    // active key, and the later activation is `silent` (no public event) — the
    // control stayed unmarked until the user clicked. Subscribing to the state
    // setter covers the sync raster, WMTS and vector paths alike.
    _unsubscribeActiveKey = _onActiveKeyChange(() => refreshUI());
}

// ---------------------------------------------------------

// Cleanup

// ---------------------------------------------------------

/**
 * Detaches everything {@link bindUIOnce} wired, and clears the bound flag so the UI can be
 * re-initialised.
 *
 * Exposed as `Baselayers.destroy`. Removes the click, resize and active-key listeners; the
 * rendered controls themselves are left in the DOM.
 */
export function destroyUI() {
    if (_resizeHandler) {
        _g.removeEventListener("resize", _resizeHandler);
        _resizeHandler = null;
    }
    if (_clickHandler) {
        _g.document?.removeEventListener("click", _clickHandler);
        _clickHandler = null;
    }
    if (_unsubscribeActiveKey) {
        _unsubscribeActiveKey();
        _unsubscribeActiveKey = null;
    }
    _uiBound = false;
}
