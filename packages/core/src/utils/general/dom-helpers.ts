/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Helpers for creating and manipulating DOM elements
 *
 * @version 1.2.0
 * @requires GeoLeaf.Security (for sanitization)
 */

import { Log } from "../log/index.js";
// `dom-security.ts` joined `kernel/security/`. ⚠️ This site was EXTENSIONLESS
// (`"./dom-security"`), hence invisible to any grep on `dom-security.js` —
// including the sprint pre-flight's and the audit's, which therefore
// under-counted `utils/general/`'s cross-directory edges. Goes through the
// barrel: the documented form of cross-directory access, and it does not pin a
// file path.
import { DOMSecurity } from "../../kernel/security/index.js";

// `GeoLeafGlobal`, `GeoLeafUtilsEvents` and the ambient `GeoLeaf` binding are now
// declared canonically in `src/global.d.ts`.

/**
 * Properties accepted by the DOM element factory.
 *
 * ⚠️ The field is `style` (singular). An earlier, removed factory read `styles`, and both
 * interfaces carried an index signature — so a substitution type-checked and silently did
 * nothing. That divergence is why the other factory was deleted rather than aligned.
 */
export interface CreateElementProps {
    className?: string;
    id?: string;
    style?: Partial<CSSStyleDeclaration> | Record<string, string>;
    dataset?: Record<string, string>;
    attributes?: Record<string, string>;
    textContent?: string;
    innerHTML?: string;
    _eventContext?: string;
    _cleanupArray?: (() => void)[];
    [key: string]: unknown;
}

/**
 * Creates a DOM element with properties and children, declaratively
 */
function _applyDataset(element: HTMLElement, dataAttrs: Record<string, string> | undefined): void {
    if (!(dataAttrs && typeof dataAttrs === "object")) return;
    for (const [key, value] of Object.entries(dataAttrs)) element.dataset[key] = value;
}

function _applyAttributes(
    element: HTMLElement,
    attributes: Record<string, string> | undefined
): void {
    if (!(attributes && typeof attributes === "object")) return;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
}

function _applyBaseProps(element: HTMLElement, props: CreateElementProps): void {
    const { className, id, style, dataset: dataAttrs, attributes } = props;
    if (className) element.className = String(className);
    if (id) element.id = String(id);
    if (style && typeof style === "object") Object.assign(element.style, style);
    _applyDataset(element, dataAttrs);
    _applyAttributes(element, attributes);
}

function _applyOtherProp(
    element: HTMLElement,
    key: string,
    value: unknown,
    events: GeoLeafUtilsEvents | undefined,
    eventContext: string,
    cleanupArray: (() => void)[] | undefined
): void {
    if (key.startsWith("on") && typeof value === "function") {
        const event = key.substring(2).toLowerCase();
        if (events) {
            const id = events.on(element, event, value as EventListener, false, eventContext);
            if (
                cleanupArray &&
                Array.isArray(cleanupArray) &&
                typeof id === "number" &&
                events.off
            ) {
                cleanupArray.push(() => events.off!(id));
            }
        } else {
            element.addEventListener(event, value as EventListener);
        }
    } else if (key.startsWith("aria")) {
        element.setAttribute("aria-" + key.substring(4).toLowerCase(), String(value));
    } else if (key in element) {
        (element as unknown as Record<string, unknown>)[key] = value;
    } else {
        element.setAttribute(key, String(value));
    }
}

function _applyContent(
    element: HTMLElement,
    textContent: string | undefined,
    innerHTML: string | undefined,
    children: (Node | string | number | boolean | null | undefined)[]
): void {
    if (textContent !== undefined) {
        element.textContent = String(textContent);
        return;
    }
    if (innerHTML !== undefined) {
        if (Log?.warn) {
            Log.warn(
                "[DomHelpers] createElement with innerHTML — content sanitized via DOMSecurity",
                { tag: element.tagName, innerHTML: String(innerHTML).substring(0, 100) }
            );
        }
        const domSec = typeof GeoLeaf !== "undefined" ? GeoLeaf?.DOMSecurity : undefined;
        if (domSec?.setSafeHTML) {
            domSec.setSafeHTML(element, String(innerHTML));
        } else {
            element.textContent = String(innerHTML);
        }
        return;
    }
    appendChild(element, ...children);
}

/**
 * Declarative DOM element factory (props bag + variadic children).
 *
 * @remarks
 * {@link domCreate} is the canonical factory (ADR-10); use this one when you
 * need the props bag — `dataset`, `attributes`, `on*` handlers, or `innerHTML`
 * routed through `DOMSecurity.setSafeHTML`.
 *
 * ⚠️ Its props key is `style`, **not** `styles`, and `textContent` wins over
 * `innerHTML`. Both differ from the `helpers/dom-helpers.ts` variant removed at
 * KERNEL S10, and neither divergence is caught by type-checking — see ADR-10.
 */
export function createElement(
    tag: string,
    props: CreateElementProps = {},
    ...children: (Node | string | number | boolean | null | undefined)[]
): HTMLElement {
    if (typeof tag !== "string" || !tag.trim()) {
        throw new TypeError("[DomHelpers] createElement: tag must be a non-empty string");
    }
    const element = document.createElement(tag);
    const { textContent, innerHTML, _eventContext, _cleanupArray, ...otherProps } = props;
    _applyBaseProps(element, props);
    const events = typeof GeoLeaf !== "undefined" ? GeoLeaf.Utils?.events : undefined;
    const evCtx = _eventContext ? _eventContext : "DomHelpers.createElement";
    for (const [key, value] of Object.entries(otherProps)) {
        if (!["className", "id", "style", "dataset", "attributes"].includes(key)) {
            _applyOtherProp(element, key, value, events, evCtx, _cleanupArray);
        }
    }
    _applyContent(element, textContent, innerHTML, children);
    return element;
}

/**
 * Adds children to a parent element
 */
export function appendChild(
    parent: HTMLElement,
    ...children: (
        Node | string | number | boolean | null | undefined | (Node | string | number)[]
    )[]
): HTMLElement {
    for (const child of children) {
        if (child == null || child === false) continue;
        if (Array.isArray(child)) {
            appendChild(parent, ...child);
        } else if (typeof child === "string" || typeof child === "number") {
            parent.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            parent.appendChild(child);
        } else {
            parent.appendChild(document.createTextNode(String(child)));
        }
    }
    return parent;
}

/**
 * Empties an element of all its children
 */
export function clearElement(
    element: HTMLElement | null | undefined
): HTMLElement | null | undefined {
    if (!element) return element;
    if (DOMSecurity && typeof DOMSecurity.clearElement === "function") {
        DOMSecurity.clearElement(element);
        return element;
    }
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
    return element;
}

/**
 * DOM element creation helper — **the canonical factory** (ADR-10).
 *
 * Creates a DOM element, optionally sets its className, and optionally
 * appends it to a parent.
 *
 * @param tag - HTML tag name (e.g. `"div"`, `"span"`, `"button"`).
 * @param className - CSS class(es) to set on the element. Optional.
 * @param parent - Parent element to append to. Optional.
 * @returns The newly created element, typed from `tag`.
 *
 * @remarks
 * Preferred over {@link createElement} for new code: it returns the precise
 * `HTMLElementTagNameMap[K]` type and takes a `parent`. Reach for
 * `createElement` only when you need its declarative props bag (dataset,
 * attributes, `on*` handlers, sanitized `innerHTML`).
 *
 * @see the migration notes below for
 * pitfalls between the two factories.
 */

export function domCreate<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    parent?: HTMLElement
): HTMLElementTagNameMap[K];

export function domCreate(tag: string, className?: string, parent?: HTMLElement): HTMLElement;

export function domCreate(tag: string, className?: string, parent?: HTMLElement): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
}

/**
 * Apply a CSS declaration string to an element property-by-property through the
 * CSSOM (`style.setProperty`). Unlike `el.style.cssText = …`, the `style`
 * attribute, or `setAttribute("style", …)`, per-property CSSOM writes are NOT
 * subject to the CSP `style-src` directive — so this is the strict-CSP-safe way
 * to set dynamic inline styles (security roadmap B.5).
 *
 * Intended for simple, code-owned declaration strings (no data: URIs); values
 * are split on the first `:` and trailing `!important` is forwarded as priority.
 *
 * @param el - The target element.
 * @param css - A CSS declaration string, e.g. `"display:flex;gap:8px"`.
 */
export function applyCssText(el: HTMLElement, css: string): void {
    if (!el || !css) return;
    for (const decl of css.split(";")) {
        const sep = decl.indexOf(":");
        if (sep < 0) continue;
        const prop = decl.slice(0, sep).trim();
        if (!prop) continue;
        let value = decl.slice(sep + 1).trim();
        let priority = "";
        if (/!important$/i.test(value)) {
            priority = "important";
            value = value.replace(/!important$/i, "").trim();
        }
        el.style.setProperty(prop, value, priority);
    }
}

// The `$create` alias of `createElement` was removed at CAPACITÉS B.18, once its last
// consumer left `capabilities/`. It looked load-bearing for the plugins and was not:
// every `$create` under `packages/plugins/` resolves to a plugin-LOCAL factory
// (`plugins/table/src/utils/dom-helpers.ts`) or to a runtime wrapper over
// `GeoLeaf.Utils.createElement` (`plugins/offline-ui/src/utils/core-utils.ts`) — not one
// imported this symbol. It was never re-exported from `kernel-exports.ts` or the bundle
// entry either, so it was internal, and two names for one factory is exactly the
// discoverability problem B.18 set out to remove. Use `createElement` (props bag) or
// `domCreate` (canonical, ADR-10).
