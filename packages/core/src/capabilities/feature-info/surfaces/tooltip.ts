/*!
 * GeoLeaf Core (feature-info capability) — Tooltip surface (hover)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Manages a single lightweight tooltip `<div>` positioned at pixel coordinates
 * within the native map container. Tracks the highest-zIndex layer to ensure
 * only the topmost layer's tooltip is shown when layers overlap.
 * https://geoleaf.dev
 */
import { buildTooltipText } from "../render/popup-content.js";
import { resolveTitleIcon, svgUseIcon } from "../render/dom.js";
import { hasFields, resolveSurfaceFields } from "../convert.js";

interface NativeMapLike {
    getContainer?: () => HTMLElement;
}

interface AdapterLike {
    getNativeMap?: () => NativeMapLike | null;
}

interface GeoLeafHost {
    GeoLeaf?: { Core?: { getMap?: () => AdapterLike | null | undefined } };
}

/**
 * Reads the active map adapter via `GeoLeaf.Core.getMap()` — NOT the
 * unrelated `GeoLeaf.getMap()` (a different, no-fallback registry). This is
 * the canonical accessor used throughout core and every other plugin.
 */
function getContainer(): HTMLElement | null {
    const g = globalThis as unknown as GeoLeafHost;
    const nativeMap = g.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
    return nativeMap?.getContainer?.() ?? null;
}

let _el: HTMLDivElement | null = null;
let _activeZIndex = -Infinity;

function _getOrCreateEl(): HTMLDivElement | null {
    if (_el) return _el;
    const container = getContainer();
    if (!container) return null;
    const div = document.createElement("div");
    div.className = "gl-fi-tooltip";
    div.setAttribute("aria-live", "polite");
    div.style.display = "none";
    container.appendChild(div);
    _el = div;
    return _el;
}

/**
 * Shows the tooltip at pixel `point` (mode `"safe"`). `text` is the already-escaped
 * pipe-joined tooltip string. When `iconSymbolId` is set (the feature's category
 * glyph for this surface), it is prefixed as a DOM `<svg><use>` (via
 * `createElementNS`) before the escaped text span; without it the content is the
 * exact escaped-string `innerHTML` of the original (byte-identical).
 */
function showTooltip(
    text: string,
    iconSymbolId: string | null,
    point: { x: number; y: number },
    zIndex: number
): void {
    if (!text && !iconSymbolId) {
        hideTooltip(zIndex);
        return;
    }
    // Only the topmost layer wins when multiple layers are hovered simultaneously.
    if (zIndex < _activeZIndex) return;
    _activeZIndex = zIndex;

    const el = _getOrCreateEl();
    if (!el) return;

    if (iconSymbolId) {
        // DOM path — prefix the category glyph, then the escaped text span.
        el.replaceChildren();
        el.appendChild(svgUseIcon(iconSymbolId));
        if (text) {
            const span = document.createElement("span");
            // SAFE: `text` is escaped by buildTooltipText (mode "safe").
            span.innerHTML = text;
            el.appendChild(span);
        }
    } else {
        // SAFE text path — escaped string via innerHTML, byte-identical output.
        el.innerHTML = text;
    }

    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    el.style.display = "";
}

/** Hides the tooltip. Only acts when `zIndex` matches the currently active layer. */
function hideTooltip(zIndex: number): void {
    if (zIndex < _activeZIndex) return;
    _activeZIndex = -Infinity;
    if (_el) _el.style.display = "none";
}

/** Handles a `geoleaf:feature:hover` event and updates the tooltip surface. */
export function handleHover(detail: {
    layerId: string;
    properties: Record<string, unknown>;
    point: { x: number; y: number };
    zIndex: number;
    phase: "move" | "leave";
}): void {
    if (detail.phase === "leave") {
        hideTooltip(detail.zIndex);
        return;
    }

    // ⚠️ The former fallback showed the FIRST property of an undeclared layer —
    // a third spelling of the same implicit rule the popup and the side panel each
    // spelled differently. A layer that declares no tooltip now shows none.
    const fields = resolveSurfaceFields(detail.layerId, "tooltip");
    if (!hasFields(fields) || fields.length === 0) return;

    const text = buildTooltipText(fields, detail.properties);
    const icon = resolveTitleIcon(detail.layerId, detail.properties, "tooltip");
    showTooltip(text, icon, detail.point, detail.zIndex);
}

/** Removes the tooltip element from the DOM. Called on plugin destroy / reset. */
export function destroyTooltip(): void {
    if (_el) {
        _el.remove();
        _el = null;
    }
    _activeZIndex = -Infinity;
}
