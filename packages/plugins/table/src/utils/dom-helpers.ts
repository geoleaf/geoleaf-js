/*!
 * @geoleaf-plugins/table — DOM creation helper (repatriated, pure)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Trimmed `$create` covering only the prop shapes the table renderer uses
 * (className, id, style, dataset, attributes, textContent, and direct element
 * properties such as `type` / `colSpan`). No `innerHTML` / `on*` handling —
 * listeners are wired separately through `./events.js`.
 * https://geoleaf.dev
 */

interface CreateElementProps {
    className?: string;
    id?: string;
    style?: Partial<CSSStyleDeclaration> | Record<string, string>;
    dataset?: Record<string, string>;
    attributes?: Record<string, string>;
    textContent?: string;
    [key: string]: unknown;
}

/** Creates a DOM element and applies declarative props. */
export function createElement(tag: string, props: CreateElementProps = {}): HTMLElement {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null) continue;
        if (key === "className") {
            element.className = String(value);
        } else if (key === "id") {
            element.id = String(value);
        } else if (key === "style" && typeof value === "object") {
            Object.assign(element.style, value);
        } else if (key === "dataset" && typeof value === "object") {
            for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
                element.dataset[dk] = String(dv);
            }
        } else if (key === "attributes" && typeof value === "object") {
            for (const [ak, av] of Object.entries(value as Record<string, string>)) {
                element.setAttribute(ak, String(av));
            }
        } else if (key === "textContent") {
            element.textContent = String(value);
        } else if (key in element) {
            (element as unknown as Record<string, unknown>)[key] = value;
        } else {
            element.setAttribute(key, String(value));
        }
    }
    return element;
}

export { createElement as $create };
