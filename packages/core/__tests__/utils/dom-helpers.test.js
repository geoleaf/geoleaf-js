/**
 * Tests pour DomHelpers (utils/dom-helpers) — TEST-04
 */

const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const mockClearElement = vi.fn();
const mockSetSafeHTML = vi.fn((el, html) => {
    el.textContent = html;
});
vi.mock("../../src/kernel/security/dom-security", () => ({
    DOMSecurity: {
        clearElement: (...args) => mockClearElement(...args),
        setSafeHTML: (...args) => mockSetSafeHTML(...args),
    },
}));
import { DOMSecurity as domSecMock } from "../../src/kernel/security/dom-security";
import { createElement, appendChild, clearElement } from "../../src/utils/general/dom-helpers.js";

describe("utils/dom-helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("createElement", () => {
        it("throws when tag is empty string", () => {
            expect(() => createElement("")).toThrow(TypeError);
            expect(() => createElement("")).toThrow("[DomHelpers]");
        });

        it("throws when tag is not a string", () => {
            expect(() => createElement(null)).toThrow(TypeError);
        });

        it("creates element with className", () => {
            const el = createElement("div", { className: "my-class" });
            expect(el.className).toBe("my-class");
        });

        it("creates element with id", () => {
            const el = createElement("span", { id: "el-id" });
            expect(el.id).toBe("el-id");
        });

        it("creates element with style", () => {
            const el = createElement("div", { style: { color: "red" } });
            expect(el.style.color).toBe("red");
        });

        it("creates element with dataset attributes", () => {
            const el = createElement("div", { dataset: { layerId: "layer1" } });
            expect(el.dataset.layerId).toBe("layer1");
        });

        it("creates element with attributes", () => {
            const el = createElement("input", {
                attributes: { type: "text", placeholder: "Search" },
            });
            expect(el.getAttribute("type")).toBe("text");
            expect(el.getAttribute("placeholder")).toBe("Search");
        });

        it("creates element with textContent", () => {
            const el = createElement("p", { textContent: "Hello World" });
            expect(el.textContent).toBe("Hello World");
        });

        it("creates element with innerHTML (uses Log.warn, falls to textContent when no GeoLeaf.DOMSecurity)", () => {
            const el = createElement("div", { innerHTML: "<b>bold</b>" });
            expect(mockLog.warn).toHaveBeenCalled();
            // GeoLeaf.DOMSecurity not available → textContent fallback
            expect(el.textContent).toBe("<b>bold</b>");
        });

        it("creates element with event listener via addEventListener (no GeoLeaf.Utils.events)", () => {
            const clickHandler = vi.fn();
            const el = createElement("button", { onClick: clickHandler });
            el.click();
            expect(clickHandler).toHaveBeenCalled();
        });

        it("creates element with aria attribute", () => {
            const el = createElement("button", { ariaLabel: "Close" });
            expect(el.getAttribute("aria-label")).toBe("Close");
        });

        it("creates element with DOM property (title)", () => {
            const el = createElement("div", { title: "My Title" });
            expect(el.title).toBe("My Title");
        });

        it("creates element with unknown attribute via setAttribute", () => {
            const el = createElement("div", { "data-custom-thing": "value" });
            expect(el.getAttribute("data-custom-thing")).toBe("value");
        });

        it("creates element with children (string, number)", () => {
            const el = createElement("div", {}, "Hello", " ", 42);
            expect(el.textContent).toBe("Hello 42");
        });

        // B.18 — this used to assert `$create` WAS an alias of createElement. The alias is
        // gone: its last core consumer left `capabilities/`, no plugin ever imported it
        // (each has its own local factory), and it was never on the public surface. The
        // contract it pinned is inverted rather than dropped — two names for one factory is
        // the discoverability problem B.18 removed, so the useful assertion is now that the
        // second name cannot come back unnoticed.
        it("no longer exports a `$create` alias — one factory, one name", async () => {
            const mod = await import("../../src/utils/general/dom-helpers.js");
            expect(mod.$create).toBeUndefined();
            expect(typeof mod.createElement).toBe("function");
            expect(typeof mod.domCreate).toBe("function");
        });

        it("uses GeoLeaf.Utils.events when available for event listeners", () => {
            const onMock = vi.fn(() => 42);
            const offMock = vi.fn(() => true);
            global.GeoLeaf = {
                Utils: { events: { on: onMock, off: offMock } },
            };
            const cleanups = [];
            const handler = vi.fn();
            const el = createElement("button", {
                onClick: handler,
                _eventContext: "test-ctx",
                _cleanupArray: cleanups,
            });
            expect(onMock).toHaveBeenCalledWith(el, "click", handler, false, "test-ctx");
            expect(cleanups.length).toBe(1);
            cleanups[0](); // invoke cleanup
            expect(offMock).toHaveBeenCalledWith(42);
            delete global.GeoLeaf;
        });

        it("uses GeoLeaf.DOMSecurity.setSafeHTML when available for innerHTML", () => {
            const setSafeHTMLMock = vi.fn();
            global.GeoLeaf = { DOMSecurity: { setSafeHTML: setSafeHTMLMock } };
            const el = createElement("div", { innerHTML: "<b>safe</b>" });
            expect(setSafeHTMLMock).toHaveBeenCalledWith(el, "<b>safe</b>");
            delete global.GeoLeaf;
        });
    });

    describe("appendChild", () => {
        it("appends string children as text nodes", () => {
            const parent = document.createElement("div");
            appendChild(parent, "Hello");
            expect(parent.textContent).toBe("Hello");
        });

        it("appends number children as text nodes", () => {
            const parent = document.createElement("div");
            appendChild(parent, 42);
            expect(parent.textContent).toBe("42");
        });

        it("appends Node children", () => {
            const parent = document.createElement("div");
            const child = document.createElement("span");
            appendChild(parent, child);
            expect(parent.firstChild).toBe(child);
        });

        it("appends array of children recursively", () => {
            const parent = document.createElement("div");
            const child = document.createElement("b");
            appendChild(parent, [child, "text"]);
            expect(parent.children.length).toBe(1);
            expect(parent.textContent).toBe("text");
        });

        it("skips null and false children", () => {
            const parent = document.createElement("div");
            appendChild(parent, null, false, undefined, "visible");
            expect(parent.textContent).toBe("visible");
        });

        it("appends boolean true as text (not null/false)", () => {
            const parent = document.createElement("div");
            appendChild(parent, true);
            // true is not null/false/array/string/number/Node → falls to textContent
            expect(parent.textContent).toBe("true");
        });

        it("returns parent element", () => {
            const parent = document.createElement("div");
            const result = appendChild(parent, "x");
            expect(result).toBe(parent);
        });
    });

    describe("clearElement", () => {
        it("returns element when null passed", () => {
            const result = clearElement(null);
            expect(result).toBeNull();
        });

        it("returns undefined when undefined passed", () => {
            const result = clearElement(undefined);
            expect(result).toBeUndefined();
        });

        it("uses DOMSecurity.clearElement when available", () => {
            const el = document.createElement("div");
            el.appendChild(document.createTextNode("child"));
            clearElement(el);
            expect(mockClearElement).toHaveBeenCalledWith(el);
        });

        it("falls back to manual removal when DOMSecurity.clearElement not available", () => {
            // Temporarily remove clearElement from the DOMSecurity mock to exercise the fallback
            const savedClearElement = domSecMock.clearElement;
            delete domSecMock.clearElement;
            try {
                const el = document.createElement("div");
                el.appendChild(document.createTextNode("to remove"));
                clearElement(el);
                expect(el.childNodes.length).toBe(0);
            } finally {
                domSecMock.clearElement = savedClearElement;
            }
        });
    });
});
