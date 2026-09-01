/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description HTML escaping and safe DOM element creation.
 */

// ── Types ──

export interface SafeElementOptions {
    className?: string;
    id?: string;
    textContent?: string;
    attributes?: Record<string, string>;
    children?: Element[];
}

// ── HTML Escaping ──

/**
 * Escape dangerous HTML characters to prevent XSS.
 *
 * @security Escapes `&`, `<`, `>` via a text node's HTML serialization — safe for HTML
 * TEXT / element-content contexts. It does NOT escape the quotes `"` and `'`; for an
 * attribute-value context use {@link escapeAttribute}, which escapes all five. (An earlier
 * version of this line claimed the quotes were escaped — they are not.)
 * @param str - The string to escape. Null or undefined returns `""`.
 * @returns The HTML-escaped string, safe for use in DOM text contexts.
 */
export function escapeHtml(str: string | null | undefined): string {
    if (str === null || str === undefined) {
        return "";
    }

    if (typeof str !== "string") {
        str = String(str);
    }

    const div = document.createElement("div");

    div.textContent = str;

    return div.innerHTML;
}

/**
 * Escape HTML attributes for safe use in attribute values.
 *
 * @security Sanitizes arbitrary strings against attribute injection by escaping &, ', ", <, >.
 * @param str - The string to escape. Null or undefined returns `""`.
 * @returns The escaped string, safe for use in HTML attribute values.
 */
export function escapeAttribute(str: string | null | undefined): string {
    if (str === null || str === undefined) {
        return "";
    }

    if (typeof str !== "string") {
        str = String(str);
    }

    return str
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ── Safe DOM Creation ──

/**
 * Create a DOM element safely with automatic content escaping.
 *
 * @param tagName - The HTML tag name to create (e.g. `"div"`, `"span"`).
 * @param options - Optional element properties: className, id, textContent, attributes, children.
 * @returns The created DOM element with safely escaped content.
 */
export function createSafeElement(tagName: string, options: SafeElementOptions = {}): Element {
    const element = document.createElement(tagName);

    if (options.className) element.className = options.className;

    if (options.id) element.id = options.id;

    if (options.textContent) {
        element.textContent = options.textContent;
    }

    if (options.attributes) {
        Object.keys(options.attributes).forEach((key) => {
            element.setAttribute(key, escapeAttribute(options.attributes![key]));
        });
    }

    if (options.children && Array.isArray(options.children)) {
        options.children.forEach((child) => {
            if (child instanceof Element) element.appendChild(child);
        });
    }

    return element;
}
