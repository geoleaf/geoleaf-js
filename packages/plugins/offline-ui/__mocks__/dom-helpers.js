/**
 * Shim mock for @core/utils/dom-helpers
 * Provides a functional $create (createElement) without loading core's full dependency chain.
 */
"use strict";

function createElement(tag, props, ...children) {
    if (!tag || typeof tag !== "string") throw new TypeError("createElement: tag must be a string");
    const el = document.createElement(tag);
    if (!props) return el;

    const {
        className,
        id,
        style,
        dataset,
        attributes,
        textContent,
        innerHTML,
        _eventContext: _ec,
        _cleanupArray: _ca,
        ...rest
    } = props;

    if (className) el.className = String(className);
    if (id) el.id = String(id);
    if (style && typeof style === "object") Object.assign(el.style, style);
    if (dataset && typeof dataset === "object") {
        for (const [k, v] of Object.entries(dataset)) el.dataset[k] = v;
    }
    if (attributes && typeof attributes === "object") {
        for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, String(v));
    }

    for (const [key, value] of Object.entries(rest)) {
        if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === "type" || key === "href" || key === "title" || key === "src") {
            el[key] = value;
        } else if (key in el) {
            el[key] = value;
        } else {
            el.setAttribute(key, String(value));
        }
    }

    if (textContent !== undefined) {
        el.textContent = String(textContent);
    } else if (innerHTML !== undefined) {
        el.textContent = String(innerHTML); // sanitized: use textContent in tests
    } else {
        for (const child of children) {
            if (child instanceof Node) el.appendChild(child);
            else if (child != null) el.appendChild(document.createTextNode(String(child)));
        }
    }
    return el;
}

// CSSOM-faithful shim of core's applyCssText: writes each declaration through
// style.setProperty (CSP-safe path) so callers like ExportLogic / SyncManager
// behave as in production. Mirrors packages/core/.../general/dom-helpers.ts.
function applyCssText(el, css) {
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

function applyDeferredStyles(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const nodes = root.querySelectorAll("[data-gl-style]");
    for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        applyCssText(el, el.getAttribute("data-gl-style") || "");
        el.removeAttribute("data-gl-style");
    }
}

const appendChild = (parent, ...children) => {
    for (const child of children) {
        if (child instanceof Node) parent.appendChild(child);
        else if (child != null) parent.appendChild(document.createTextNode(String(child)));
    }
};

const clearElement = (el) => {
    el.innerHTML = "";
};

export {
    createElement as $create,
    createElement,
    appendChild,
    clearElement,
    applyCssText,
    applyDeferredStyles,
};
