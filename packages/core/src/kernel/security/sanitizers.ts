/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description HTML/SVG sanitization, stripping, dangerous-pattern detection and safe injection.
 */

import { Log } from "../../utils/log/index.js";
import { validateUrl } from "./validators.js";

// ── Types ──

/**
 * How aggressively to sanitise an HTML fragment.
 *
 * ⚠️ `stripAll` and `allowedTags` are not additive: `stripAll` removes every tag and wins
 * outright, so an `allowedTags` list passed alongside it is silently ineffective.
 */
export interface SanitizeHtmlOptions {
    /** Remove all tags, keeping text only. Overrides {@link SanitizeHtmlOptions.allowedTags}. */
    stripAll?: boolean;
    /** Tag names kept; everything else is stripped. Ignored when `stripAll` is set. */
    allowedTags?: string[];
}

// ── Dangerous Pattern Detection ──

/**
 * Check whether a string contains potentially dangerous HTML patterns (XSS vectors).
 *
 * @security Detects script, iframe, object, embed, base, form, meta, link, event handlers, and dangerous protocols.
 * @param str - The value to test. Non-string values return false.
 * @returns `true` if dangerous patterns are detected, `false` otherwise.
 */
export function containsDangerousHtml(str: unknown): boolean {
    if (typeof str !== "string") return false;

    const dangerousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
        /<applet/i,
        /<meta/i,
        /<link/i,
        /vbscript:/i,
        /data:text\/html/i,
        /<base/i,
        /<form/i,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(str));
}

// ── HTML Stripping ──

/**
 * Strip all HTML from a string, keeping only text content.
 *
 * @security Removes all HTML tags from untrusted strings, returning safe plain text.
 * @param html - The HTML string to strip. Non-string values return `""`.
 * @returns The plain text content without any HTML tags.
 */
export function stripHtml(html: string): string {
    if (typeof html !== "string") return "";

    const parser = new DOMParser();

    const doc = parser.parseFromString(html, "text/html");
    doc.body.querySelectorAll("script, style").forEach((el) => el.remove());
    return doc.body.textContent ?? doc.body.innerText ?? "";
}

// ── SVG Sanitization ──

/**
 * Parse and sanitize SVG content safely, removing scripts and event handlers.
 *
 * @security Strips script, foreignObject, on* handlers, and javascript: hrefs from external SVG content.
 * @param svgContent - The raw SVG string to sanitize. Null or undefined returns null.
 * @returns The sanitized `SVGElement`, or null if parsing fails or content is invalid.
 */
export function sanitizeSvgContent(svgContent: string | null | undefined): SVGElement | null {
    if (!svgContent || typeof svgContent !== "string") return null;

    try {
        const parser = new DOMParser();

        const doc = parser.parseFromString(svgContent, "image/svg+xml");

        const parserError = doc.querySelector("parsererror");

        if (parserError) {
            Log.warn("[Security] Error parsing SVG:", parserError.textContent ?? "");

            return null;
        }

        const svgEl = doc.documentElement;

        if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
            Log.warn("[Security] Invalid SVG content: root element is not SVG");

            return null;
        }

        // SMIL animation elements (<animate>, <set>, …) can mutate attributes at
        // runtime — e.g. <set attributeName="href" to="javascript:…"> on a parent
        // <a>, or begin/end event timing — so they are stripped entirely from
        // untrusted SVG (defense-in-depth, audit L3).
        const dangerousElements = [
            "script",
            "foreignObject",
            "use[href^='data:']",
            "animate",
            "animateMotion",
            "animateTransform",
            "animateColor",
            "set",
            "mpath",
        ];

        dangerousElements.forEach((selector) => {
            const elements = svgEl.querySelectorAll(selector);

            elements.forEach((el) => el.remove());
        });

        // Strip dangerous attributes from ALL elements including the root <svg>
        const allElements = [svgEl, ...Array.from(svgEl.querySelectorAll("*"))];

        allElements.forEach((el) => {
            Array.from(el.attributes).forEach((attr) => {
                if (attr.name.toLowerCase().startsWith("on")) {
                    el.removeAttribute(attr.name);
                }

                const isHref = attr.name === "href" || attr.name === "xlink:href";

                const val = (attr.value || "").toLowerCase().trim();

                const jsProto = "javascript" + ":";

                const isJsProtocol =
                    val.length >= jsProto.length && val.slice(0, jsProto.length) === jsProto;

                if (isHref && isJsProtocol) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        return svgEl as unknown as SVGElement;
    } catch (e) {
        Log.warn("[Security] SVG sanitization error:", (e as Error).message);

        return null;
    }
}

// ── Safe HTML Parsing ──

const DEFAULT_ALLOWED_TAGS = ["p", "br", "strong", "em", "span", "a", "ul", "ol", "li", "b", "i"];

/**
 * Parse HTML safely with a tag allowlist, converting disallowed elements to text nodes.
 *
 * @security Parses untrusted HTML, keeping only whitelisted tags; validates link hrefs via validateUrl.
 * @param html - The HTML string to parse. Non-string or empty values return an empty fragment.
 * @param allowedTags - Array of allowed tag names. Defaults to `["p","br","strong","em","span","a","ul","ol","li","b","i"]`.
 * @returns A `DocumentFragment` containing the sanitized DOM nodes.
 */
export function parseHtmlSafely(
    html: string,
    allowedTags: string[] = DEFAULT_ALLOWED_TAGS
): DocumentFragment {
    const fragment = document.createDocumentFragment();

    if (!html || typeof html !== "string") return fragment;

    try {
        const parser = new DOMParser();

        const doc = parser.parseFromString(html, "text/html");

        const cleanNode = (node: ChildNode): Text | HTMLElement | SVGElement | null => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.textContent ?? "");
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const tagName = (node as Element).tagName.toLowerCase();

            if (!allowedTags.includes(tagName)) {
                return document.createTextNode(node.textContent ?? "");
            }

            // SVG elements require createElementNS for correct rendering.
            const SVG_NS = "http://www.w3.org/2000/svg";
            const svgTags = [
                "svg",
                "path",
                "circle",
                "rect",
                "g",
                "use",
                "line",
                "polygon",
                "polyline",
                "ellipse",
                "defs",
                "clipPath",
            ];
            const isSvg = svgTags.includes(tagName);
            const cleanElement = isSvg
                ? document.createElementNS(SVG_NS, tagName)
                : document.createElement(tagName);

            if (tagName === "a" && (node as Element).hasAttribute("href")) {
                try {
                    const href = validateUrl((node as Element).getAttribute("href")!);
                    cleanElement.setAttribute("href", href);
                    cleanElement.setAttribute("rel", "noopener noreferrer");
                    cleanElement.setAttribute("target", "_blank");
                } catch {
                    // Invalid URL — ignore the link
                }
            }

            // @security Copy safe attributes for SVG elements (presentation only).
            if (isSvg) {
                const SVG_SAFE_ATTRS = [
                    "viewBox",
                    "width",
                    "height",
                    "fill",
                    "stroke",
                    "stroke-width",
                    "stroke-linecap",
                    "stroke-linejoin",
                    "d",
                    "cx",
                    "cy",
                    "r",
                    "rx",
                    "ry",
                    "x",
                    "y",
                    "x1",
                    "y1",
                    "x2",
                    "y2",
                    "points",
                    "transform",
                    "opacity",
                    "fill-opacity",
                    "stroke-opacity",
                    "fill-rule",
                    "clip-rule",
                    "xmlns",
                    "class",
                ];
                const el = node as Element;
                for (const attr of SVG_SAFE_ATTRS) {
                    if (el.hasAttribute(attr)) {
                        cleanElement.setAttribute(attr, el.getAttribute(attr)!);
                    }
                }
            }

            node.childNodes.forEach((child) => {
                const cleanChild = cleanNode(child);
                if (cleanChild) cleanElement.appendChild(cleanChild);
            });

            return cleanElement;
        };

        doc.body.childNodes.forEach((child) => {
            const cleanChild = cleanNode(child);

            if (cleanChild) fragment.appendChild(cleanChild);
        });
    } catch (e) {
        Log.warn("[Security] Error parsing safe HTML:", (e as Error).message);
    }

    return fragment;
}

// ── Safe HTML Injection ──

/** Clear element children without innerHTML (same contract as DOMSecurity.clearElement; avoids circular import). */
function clearElementContent(el: Element): void {
    const htmlEl = el as HTMLElement;

    if (!htmlEl?.firstChild) return;

    while (htmlEl.firstChild) {
        htmlEl.removeChild(htmlEl.firstChild);
    }
}

/**
 * Sanitize HTML content and inject into a DOM element safely.
 *
 * @security Sanitizes untrusted HTML via parseHtmlSafely before DOM injection; primary entry point.
 * @param element - The target DOM element to inject content into.
 * @param html - The HTML string to sanitize and inject. Null or undefined clears the element.
 * @param options - Optional: `{ stripAll: true }` to strip all tags; `{ allowedTags: [...] }` to customize.
 * @returns The element for chaining, or null if invalid.
 */
export function sanitizeHTML(
    element: Element,
    html: string | null | undefined,
    options: SanitizeHtmlOptions = {}
): Element | null {
    if (!element || typeof (element as HTMLElement).appendChild !== "function") return null;

    if (html == null) {
        clearElementContent(element);

        return element;
    }

    const str = typeof html === "string" ? html : String(html);

    if (options.stripAll) {
        (element as HTMLElement).textContent = stripHtml(str);

        return element;
    }

    const allowedTags = options.allowedTags ?? DEFAULT_ALLOWED_TAGS;

    const fragment = parseHtmlSafely(str, allowedTags);

    clearElementContent(element);

    element.appendChild(fragment);

    return element;
}
