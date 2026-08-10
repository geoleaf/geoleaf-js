/**
 * Shim mock for @core/utils/dom-security
 * Provides stub implementations used in unit tests.
 */
"use strict";

const DOMSecurity = {
    createSVGIcon: vi.fn((width, height, _path, _opts) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        return svg;
    }),
    setSafeHTML: vi.fn((el, html) => {
        el.textContent = html;
    }),
    clearElementFast: vi.fn((el) => {
        while (el.firstChild) el.removeChild(el.firstChild);
    }),
    sanitizeText: vi.fn((text) => String(text)),
    sanitizeURL: vi.fn((url) => String(url)),
};

export { DOMSecurity };
