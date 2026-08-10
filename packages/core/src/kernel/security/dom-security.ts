/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf - DOM Security Module
 *
 * @description Secure wrappers for DOM manipulation without XSS vulnerabilities
 * @version 1.2.0
 *
 * USAGE:
 * - Replaces innerHTML with secure alternatives
 * - Utilise textContent pour data non-HTML
 * - Sanitize via GeoLeaf.Security pour HTML required
 * - Creates SVG securely
 */

// ⚠️ Imports the LEAF module, not this directory's own barrel. `DOMSecurity` is re-exported
// by `./index.js` (STRUCT S6), so importing `{ Security }` from there would close the cycle
// `index.ts → dom-security.ts → index.ts`. Only `sanitizeHTML` was ever used of the facade.
import { sanitizeHTML } from "./sanitizers.js";
import { Log } from "../../utils/log/index.js";

/**
 * Presentation options for an SVG icon built from path data.
 *
 * Every field maps to an SVG attribute set programmatically — the icon is never assembled as
 * a markup string, which is what keeps this path free of injection.
 */
export interface SVGIconOptions {
    viewBox?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string | number;
    strokeLinecap?: string;
    strokeLinejoin?: string;
}

/** @security Safe DOM text assignment; never interprets HTML — immune to XSS. */
function setTextContent(
    element: HTMLElement | null | undefined,
    text: string | number | null | undefined
): void {
    if (!element || !element.nodeType) {
        Log.warn("[DOMSecurity] Invalid element in setTextContent");
        return;
    }
    element.textContent = text != null ? String(text) : "";
}

/** @security Wraps innerHTML assignment through sanitizeHTML; fallback to textContent if unavailable. */
function setSafeHTML(element: HTMLElement, html: string, allowedTags?: string[]): void {
    if (!element || !element.nodeType) {
        Log.warn("[DOMSecurity] Invalid element in setSafeHTML");
        return;
    }
    if (typeof sanitizeHTML === "function") {
        sanitizeHTML(element, html, allowedTags ? { allowedTags } : {});
    } else {
        Log.warn("[DOMSecurity] sanitizeHTML unavailable, falling back to textContent");
        element.textContent = html ? String(html) : "";
    }
}

function clearElement(element: HTMLElement | null | undefined): void {
    if (!element || !element.nodeType) {
        Log.warn("[DOMSecurity] Invalid element in clearElement");
        return;
    }
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function clearElementFast(element: HTMLElement | null | undefined): void {
    if (!element || !element.nodeType) {
        Log.warn("[DOMSecurity] Invalid element in clearElementFast");
        return;
    }
    element.textContent = "";
}

function createSVGIcon(
    width: number,
    height: number,
    pathData: string,
    options: SVGIconOptions = {}
): SVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", options.viewBox ?? "0 0 24 24");
    svg.setAttribute("fill", options.fill ?? "none");
    svg.setAttribute("stroke", options.stroke ?? "currentColor");
    svg.setAttribute("stroke-width", String(options.strokeWidth ?? "2"));
    svg.setAttribute("stroke-linecap", options.strokeLinecap ?? "round");
    svg.setAttribute("stroke-linejoin", options.strokeLinejoin ?? "round");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);

    return svg;
}

const SVG_ICONS: Record<string, string> = {
    "chevron-down": "M6 9l6 6 6-6",
    "chevron-up": "M18 15l-6-6-6 6",
    "chevron-left": "M15 18l-6-6 6-6",
    "chevron-right": "M9 18l6-6-6-6",
    "arrow-left": "‹",
    "arrow-right": "›",
    close: "✕",
    check: "✓",
    star: "★",
    "star-empty": "☆",
    "triangle-right": "▶",
    "triangle-down": "▼",
    home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    marker: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z",
    "map-pin": "M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
    trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    copy: "M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z",
    sync: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
    // Single `d` concatenating the three sub-paths of the share glyph (box + up-arrow + stem).
    share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14",
};

function getIcon(name: string, size = 18, options: SVGIconOptions = {}): SVGElement | null {
    const pathData = SVG_ICONS[name];
    if (!pathData) {
        Log.warn(`[DOMSecurity] Icon '${name}' not found`);
        return null;
    }
    return createSVGIcon(size, size, pathData, options);
}

/**
 * DOM construction helpers that cannot be made to inject markup.
 *
 * The safe counterpart to `innerHTML`: text goes in as text, attributes are vetted, and SVG
 * icons are built from path data rather than parsed from a string. This is the surface the
 * security rule points at when it forbids reaching for `innerHTML` directly.
 */
export const DOMSecurity = {
    setTextContent,
    setSafeHTML,
    clearElement,
    clearElementFast,
    createSVGIcon,
    getIcon,
    SVG_ICONS,
};
