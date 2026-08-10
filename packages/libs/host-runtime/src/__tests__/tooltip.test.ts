// @vitest-environment happy-dom
/*!
 * @geoleaf/host-runtime — tooltip tests
 * © 2026 Mattieu Pottier — MIT License
 */
import { describe, it, expect, beforeEach } from "vitest";
import { wireTooltips, showTooltip, hideTooltip } from "../ui/tooltip.js";

let root: HTMLElement;
let tip: HTMLElement;
let btn: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    tip = document.createElement("div");
    btn = document.createElement("button");
    btn.dataset.tooltip = "Draw a line";
    btn.getBoundingClientRect = () =>
        ({ right: 200, top: 100, height: 40, width: 40, left: 160 }) as DOMRect;
    root.append(btn);
    document.body.append(root, tip);
});

describe("showTooltip", () => {
    it("writes the label as text, never as markup", () => {
        btn.dataset.tooltip = "<img src=x onerror=alert(1)>";
        showTooltip(tip, btn);

        expect(tip.textContent).toBe("<img src=x onerror=alert(1)>");
        expect(tip.querySelector("img")).toBeNull();
    });

    it("positions to the right of the button, vertically centred", () => {
        showTooltip(tip, btn);
        // right + 10 = 210 ; top + height/2 = 100 + 20 = 120
        expect(tip.style.left).toBe("210px");
        expect(tip.style.top).toBe("120px");
    });

    it("reveals via the visibility class", () => {
        showTooltip(tip, btn);
        expect(tip.classList.contains("gl-is-visible")).toBe(true);
    });

    it("is a no-op when the tooltip element is absent", () => {
        expect(() => showTooltip(null, btn)).not.toThrow();
    });

    it("is a no-op when the button carries no data-tooltip", () => {
        delete btn.dataset.tooltip;
        showTooltip(tip, btn);
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });
});

describe("hideTooltip", () => {
    it("removes the visibility class", () => {
        tip.classList.add("gl-is-visible");
        hideTooltip(tip);
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("is a no-op when the tooltip element is absent", () => {
        expect(() => hideTooltip(null)).not.toThrow();
    });
});

describe("wireTooltips", () => {
    it("shows on mouseenter and hides on mouseleave", () => {
        wireTooltips(
            () => root,
            () => tip
        );

        btn.dispatchEvent(new Event("mouseenter"));
        expect(tip.textContent).toBe("Draw a line");
        expect(tip.classList.contains("gl-is-visible")).toBe(true);

        btn.dispatchEvent(new Event("mouseleave"));
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("shows on focusin and hides on focusout — keyboard parity", () => {
        wireTooltips(
            () => root,
            () => tip
        );

        btn.dispatchEvent(new Event("focusin"));
        expect(tip.classList.contains("gl-is-visible")).toBe(true);

        btn.dispatchEvent(new Event("focusout"));
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("skips elements without data-tooltip", () => {
        const plain = document.createElement("button");
        root.append(plain);
        wireTooltips(
            () => root,
            () => tip
        );

        plain.dispatchEvent(new Event("mouseenter"));
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("is a no-op when the root is absent", () => {
        expect(() =>
            wireTooltips(
                () => null,
                () => tip
            )
        ).not.toThrow();
    });

    /**
     * The menus rebuild their DOM on destroy() + init(). Capturing the tooltip element
     * by value at wiring time would leave the handlers writing to a detached node.
     */
    it("resolves the tooltip element at event time, not at wiring time", () => {
        let current: HTMLElement | null = null;
        wireTooltips(
            () => root,
            () => current
        );

        current = tip;
        btn.dispatchEvent(new Event("mouseenter"));

        expect(tip.textContent).toBe("Draw a line");
        expect(tip.classList.contains("gl-is-visible")).toBe(true);
    });
});
