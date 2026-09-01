/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Legend Symbols - Symbol rendering for legend and layer-manager
 *
 * Renders the point / line / polygon / star / icon symbols shown in the legend.
 * Split out of components.ts in KERNEL S8 (2 responsibilities in one file);
 * `components.ts` re-aggregates this with ui/widgets.ts into `_UIComponents`,
 * so every existing import path and the global namespace are unchanged.
 *
 * DEPENDENCIES:
 * - native DOM events
 * - Log (import ESM)
 *
 * EXPOSE:
 * - _LegendSymbols (consumed by ui/components.ts)
 */

import { Log } from "../../utils/log/index.js";
import { domCreate } from "../../utils/general/dom-helpers.js";

// ── Local structural types (ui/components) ───────────────────────────
// Symbol configs arrive as loosely-typed bags from taxonomy, legend and
// layer-manager callers. Narrow to the members read here.

/** Symbol / legend rendering config (point, line, polygon, star, icon). */
interface SymbolConfig {
    type?: string;
    symbol?: SymbolConfig;
    radius?: number;
    size?: number;
    count?: number;
    weight?: number;
    width?: number;
    color?: string;
    fillColor?: string;
    borderColor?: string;
    fillOpacity?: number;
    opacity?: number;
    outlineColor?: string;
    outlineWidth?: number;
    outlineOpacity?: number;
    style?: string;
    dashArray?: string;
    icon?: string;
    iconColor?: string;
    iconUrl?: string;
    hatch?: HatchConfig;
}

/** Hatch fill descriptor read by the legend polygon renderer. */
interface HatchConfig {
    enabled?: boolean;
    type?: string;
    spacingPx?: number;
    renderMode?: string;
    stroke?: { color?: string; opacity?: number; widthPx?: number };
    [key: string]: unknown;
}

function _appendCircleIconSvg(
    circleEl: Element,
    iconId: string,
    size: number,
    iconColor: string | undefined
): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.style.width = size * 0.85 + "px";
    svg.style.height = size * 0.85 + "px";
    svg.style.fill = iconColor || "currentColor";
    svg.style.stroke = iconColor || "currentColor";
    svg.style.color = "#ffffff";
    svg.style.pointerEvents = "none";
    svg.style.position = "absolute";
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + iconId);
    svg.appendChild(use);
    circleEl.appendChild(svg);
    if (Log) {
        const spriteExists = document.querySelector('svg[data-geoleaf-sprite="profile"]');
        if (!spriteExists) {
            svg.setAttribute("data-sprite-missing", "true");
            Log.warn("[UIComponents] Icon", "#" + iconId, "referenced but sprite not found in DOM");
        } else if (!spriteExists.querySelector("#" + iconId)) {
            svg.setAttribute("data-symbol-missing", "#" + iconId);
            Log.warn("[UIComponents] Symbol", "#" + iconId, "not found in SVG sprite");
        }
    }
}

function _buildLineSvgEl(
    config: SymbolConfig,
    width: number,
    color: string,
    dashArray: string | null,
    outlineColor: string | null,
    outlineWidth: number | null
): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 40 8");
    svg.style.width = "40px";
    const totalHeight = Math.max(width, 3) + (outlineWidth || 0) + 4;
    svg.style.height = totalHeight + "px";
    if (outlineColor && outlineWidth) {
        const outlineLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        outlineLine.setAttribute("x1", "0");
        outlineLine.setAttribute("y1", "4");
        outlineLine.setAttribute("x2", "40");
        outlineLine.setAttribute("y2", "4");
        outlineLine.setAttribute("stroke", outlineColor);
        outlineLine.setAttribute("stroke-width", (width + outlineWidth * 2) as unknown as string);
        outlineLine.setAttribute("stroke-linecap", "round");
        if (config.outlineOpacity !== undefined)
            outlineLine.setAttribute("stroke-opacity", config.outlineOpacity as unknown as string);
        svg.appendChild(outlineLine);
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "4");
    line.setAttribute("x2", "40");
    line.setAttribute("y2", "4");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", width as unknown as string);
    line.setAttribute("stroke-linecap", "round");
    if (dashArray) line.setAttribute("stroke-dasharray", dashArray);
    else if (config.style === "dashed") line.setAttribute("stroke-dasharray", "8,4");
    else if (config.style === "dotted") line.setAttribute("stroke-dasharray", "2,3");
    if (config.opacity !== undefined)
        line.setAttribute("stroke-opacity", config.opacity as unknown as string);
    svg.appendChild(line);
    return svg;
}

function _resolveHatchStyle(hatchCfg: HatchConfig): {
    color: string;
    opacity: number;
    widthPx: number;
} {
    const stroke = hatchCfg.stroke || {};
    return {
        color: stroke.color || "#000000",
        opacity: stroke.opacity !== undefined ? stroke.opacity : 1,
        widthPx: stroke.widthPx || 1,
    };
}

function _buildLegendHatchDefs(svg: SVGElement, config: SymbolConfig): string {
    const hatchCfg = config.hatch as HatchConfig;
    const type = hatchCfg.type || "diagonal";
    const spacing = hatchCfg.spacingPx || 10;
    const {
        color: hatchColor,
        opacity: hatchOpacity,
        widthPx: hatchWidth,
    } = _resolveHatchStyle(hatchCfg);
    // `substring(2, 11)` — same 9 characters the deprecated `substr(2, 9)` produced.
    // The id is generated and consumed here (returned, then referenced as `url(#…)`),
    // so its exact form is internal: nothing outside this function parses it.
    const patternId =
        "hatch-legend-" + Date.now() + "-" + Math.random().toString(36).substring(2, 11);
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pattern.setAttribute("id", patternId);
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("width", spacing as unknown as string);
    pattern.setAttribute("height", spacing as unknown as string);
    const ns = "http://www.w3.org/2000/svg";
    const mkLine = (
        x1: string | number,
        y1: string | number,
        x2: string | number,
        y2: string | number
    ) => {
        const l = document.createElementNS(ns, "line");
        l.setAttribute("x1", x1 as string);
        l.setAttribute("y1", y1 as string);
        l.setAttribute("x2", x2 as string);
        l.setAttribute("y2", y2 as string);
        l.setAttribute("stroke", hatchColor);
        l.setAttribute("stroke-width", String(hatchWidth));
        l.setAttribute("stroke-opacity", hatchOpacity as unknown as string);
        return l;
    };
    if (type === "diagonal") pattern.appendChild(mkLine("0", "0", spacing, spacing));
    else if (type === "dot") {
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", String(spacing / 2));
        c.setAttribute("cy", String(spacing / 2));
        c.setAttribute("r", String(Math.max(0.3, spacing * 0.07)));
        c.setAttribute("fill", hatchColor);
        c.setAttribute("fill-opacity", hatchOpacity as unknown as string);
        pattern.appendChild(c);
    } else if (type === "cross") {
        pattern.appendChild(mkLine("0", spacing / 2, spacing, spacing / 2));
        pattern.appendChild(mkLine(spacing / 2, "0", spacing / 2, spacing));
    } else if (type === "x") {
        pattern.appendChild(mkLine("0", "0", spacing, spacing));
        pattern.appendChild(mkLine(spacing, "0", "0", spacing));
    }
    defs.appendChild(pattern);
    svg.appendChild(defs);
    return patternId;
}

function _applyCircleIcon(circleEl: HTMLElement, config: SymbolConfig, size: number): void {
    const icon = config.icon as string;
    const iconId = icon.startsWith("#") ? icon.substring(1) : icon;
    if (!/^[a-zA-Z0-9_-]+$/.test(iconId)) {
        if (Log)
            Log.error(
                "[UIComponents] ID d'ic\u00f4ne invalide (caract\u00e8res non autoris\u00e9s):",
                config.icon
            );
        return;
    }
    _appendCircleIconSvg(circleEl, iconId, size, config.iconColor);
}

function _needsLineSvg(
    dashArray: string | null,
    width: number,
    outlineColor: string | null,
    outlineWidth: number | null
): boolean {
    return !!(dashArray || width > 5 || (outlineColor && outlineWidth));
}

function _applyLineDivStyle(lineEl: HTMLElement, color: string, style: string): void {
    if (style === "dashed") {
        lineEl.style.backgroundImage = `linear-gradient(to right, ${color} 50%, transparent 50%)`;
        lineEl.style.backgroundSize = "8px 100%";
    } else if (style === "dotted") {
        lineEl.style.backgroundImage = `linear-gradient(to right, ${color} 30%, transparent 30%)`;
        lineEl.style.backgroundSize = "4px 100%";
    }
}

function _resolvePolygonColors(config: SymbolConfig): { color: string; borderColor: string } {
    return {
        color: config.fillColor || config.color || "#3388ff",
        borderColor: config.borderColor || config.color || "#333",
    };
}

function _resolveFillOpacity(config: SymbolConfig): number {
    if (config.fillOpacity !== undefined) return config.fillOpacity;
    if (config.opacity !== undefined) return config.opacity;
    return 1;
}

function _buildPolygonSvgEl(
    config: SymbolConfig,
    borderColor: string,
    borderWidth: number,
    fillOpacity: number,
    hasHatch: boolean
): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 32 24");
    svg.style.width = "32px";
    svg.style.height = "24px";
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "1");
    rect.setAttribute("y", "1");
    rect.setAttribute("width", "30");
    rect.setAttribute("height", "22");
    rect.setAttribute("stroke", borderColor);
    rect.setAttribute("stroke-width", String(borderWidth));
    if (hasHatch) {
        const patternId = _buildLegendHatchDefs(svg, config);
        rect.setAttribute("fill", `url(#${patternId})`);
        if (fillOpacity !== 1) rect.setAttribute("fill-opacity", String(fillOpacity));
    } else {
        rect.setAttribute("fill", "none");
        if (config.dashArray) rect.setAttribute("stroke-dasharray", config.dashArray);
    }
    svg.appendChild(rect);
    return svg;
}

function _renderIconSymbol(
    container: HTMLElement,
    symbolConfig: SymbolConfig,
    renderCircleFn: (c: HTMLElement, cfg: SymbolConfig) => HTMLElement
): HTMLElement {
    if (symbolConfig.iconUrl) {
        const imgEl = domCreate("img", "gl-legend__icon-img", container);
        imgEl.src = symbolConfig.iconUrl;
        if (symbolConfig.size) {
            imgEl.style.width = symbolConfig.size + "px";
            imgEl.style.height = symbolConfig.size + "px";
        }
        return imgEl;
    }
    return renderCircleFn(container, symbolConfig);
}

/**
 * Applies an alpha to a hex fill colour so a swatch fill can be translucent without
 * dimming its (opaque) border. Non-hex inputs (named colours, rgba…) are returned
 * unchanged — the caller then keeps the original colour at full opacity.
 */
function _hexToRgba(color: string, alpha: number): string {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
    if (!hex) return color;
    // Doubling every character expands #abc to #aabbcc without a single indexed read —
    // the six reads here were the densest cluster of the file (qualite Q5).
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Legend symbol renderers.
 *
 * `renderSymbol` dispatches through `this`, so the five members must stay on the
 * same object — they do here, and again in the `_UIComponents` aggregate.
 *
 * @namespace _LegendSymbols
 * @private
 */
const _LegendSymbols = {
    /**
     * Renders a circle symbol (POI/marker)
     * @param {HTMLElement} container - Symbol container
     * @param {Object} config - Symbol configuration
     * @returns {HTMLElement} - Created element
     */
    renderCircleSymbol(container: HTMLElement, config: SymbolConfig) {
        const radius = config.radius !== undefined ? config.radius : 24;
        const size = radius * 2;
        const fillColor = config.fillColor || config.color || "#3388ff";
        const strokeColor = config.color || config.borderColor || "rgba(0,0,0,0.2)";
        const strokeWidth = config.weight || 1;
        const circleEl = domCreate("div", "gl-legend__circle", container);
        circleEl.style.width = size + "px";
        circleEl.style.height = size + "px";
        // fillOpacity applies to the FILL only (via rgba) so the border stays opaque —
        // a hollow marker (fillOpacity: 0) keeps its visible outline instead of vanishing
        // (the former `style.opacity` dimmed the whole swatch, border included).
        circleEl.style.backgroundColor =
            config.fillOpacity !== undefined
                ? _hexToRgba(fillColor, config.fillOpacity)
                : fillColor;
        circleEl.style.borderRadius = "50%";
        circleEl.style.border = strokeWidth + "px solid " + strokeColor;
        circleEl.style.position = "relative";
        circleEl.style.display = "flex";
        circleEl.style.alignItems = "center";
        circleEl.style.justifyContent = "center";
        if (config.icon) _applyCircleIcon(circleEl, config, size);
        return circleEl;
    },

    /**
     * Renders a line symbol
     * @param {HTMLElement} container - Symbol container
     * @param {Object} config - Symbol configuration
     * @returns {HTMLElement} - Created element
     */
    renderLineSymbol(container: HTMLElement, config: SymbolConfig) {
        const width = config.width || 3;
        const color = config.color || "#3388ff";
        const style = config.style || "solid";
        const dashArray = config.dashArray || null;
        const outlineColor = config.outlineColor || null;
        const outlineWidth = config.outlineWidth || null;
        if (_needsLineSvg(dashArray, width, outlineColor, outlineWidth)) {
            const svg = _buildLineSvgEl(
                config,
                width,
                color,
                dashArray,
                outlineColor,
                outlineWidth
            );
            container.appendChild(svg);
            return svg;
        }
        const lineEl = domCreate("div", "gl-legend__line", container);
        lineEl.style.width = "30px";
        lineEl.style.height = width + "px";
        lineEl.style.backgroundColor = color;
        _applyLineDivStyle(lineEl, color, style);
        if (config.opacity !== undefined)
            lineEl.style.opacity = config.opacity as unknown as string;
        return lineEl;
    },

    /**
     * Renders a polygon/fill symbol
     * @param {HTMLElement} container - Symbol container
     * @param {Object} config - Symbol configuration
     * @returns {HTMLElement} - Created element
     */
    renderPolygonSymbol(container: HTMLElement, config: SymbolConfig) {
        const { color, borderColor } = _resolvePolygonColors(config);
        const borderWidth = config.weight || 1;
        const hasHatch = !!(config.hatch && config.hatch.enabled);
        let fillOpacity = _resolveFillOpacity(config);
        if (hasHatch && config.hatch?.renderMode === "pattern_only") fillOpacity = 1.0;
        if (hasHatch || fillOpacity === 0) {
            const svg = _buildPolygonSvgEl(config, borderColor, borderWidth, fillOpacity, hasHatch);
            container.appendChild(svg);
            return svg;
        }
        const polygonEl = domCreate("div", "gl-legend__polygon", container);
        polygonEl.style.width = "24px";
        polygonEl.style.height = "16px";
        polygonEl.style.backgroundColor = color;
        polygonEl.style.border = borderWidth + "px solid " + borderColor;
        if (fillOpacity !== 1) polygonEl.style.opacity = String(fillOpacity);
        return polygonEl;
    },

    /**
     * Renders a star symbol (rating)
     * @param {HTMLElement} container - Symbol container
     * @param {Object} config - Symbol configuration
     * @returns {HTMLElement} - Created element
     */
    renderStarSymbol(container: HTMLElement, config: SymbolConfig) {
        const starContainer = domCreate("div", "gl-legend__stars", container);

        const count = config.count || 5;
        const color = config.color || "#f1c40f";
        const size = config.size || 12;

        for (let i = 0; i < count; i++) {
            const starEl = domCreate("span", "gl-legend__star", starContainer);
            starEl.textContent = "★";
            starEl.style.color = color;
            starEl.style.fontSize = size + "px";
        }

        return starContainer;
    },

    /**
     * Renders a symbol according to its type
     * @param {HTMLElement} container - Symbol container
     * @param {Object} config - Symbol configuration
     * @returns {HTMLElement} - Created element
     */
    renderSymbol(container: HTMLElement, config: SymbolConfig) {
        // Supports both the config.symbol shape and a direct config object
        const symbolConfig = config.symbol || config;
        const symbolType = symbolConfig.type || config.type || "circle";
        const circleFn = (c: HTMLElement, cfg: SymbolConfig) => this.renderCircleSymbol(c, cfg);
        const renderers: Record<string, () => HTMLElement | SVGElement> = {
            marker: () => this.renderCircleSymbol(container, symbolConfig),
            circle: () => this.renderCircleSymbol(container, symbolConfig),
            line: () => this.renderLineSymbol(container, symbolConfig),
            polygon: () => this.renderPolygonSymbol(container, symbolConfig),
            fill: () => this.renderPolygonSymbol(container, symbolConfig),
            star: () => this.renderStarSymbol(container, symbolConfig),
            icon: () => _renderIconSymbol(container, symbolConfig, circleFn),
        };

        return (
            renderers[symbolType] ?? (() => this.renderCircleSymbol(container, symbolConfig))
        )();
    },
};

// ── ESM Export ──
export { _LegendSymbols };

export type { SymbolConfig, HatchConfig };
