import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleFocusTrap } from "../../src/utils/controls/focus-trap.js";

/**
 * Builds a container holding the given focusable elements, mounted in the
 * document so `.focus()` actually moves `document.activeElement`.
 */
function mount(html) {
    document.body.innerHTML = `<div id="trap">${html}</div>`;
    return document.getElementById("trap");
}

/** A Tab keydown whose `preventDefault` is observable. */
function tab({ shift = false } = {}) {
    const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift });
    e.preventDefault = vi.fn();
    return e;
}

describe("handleFocusTrap", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("cycles from the last focusable back to the first on Tab", () => {
        const box = mount("<button id=a></button><button id=b></button>");
        const [a, b] = [box.querySelector("#a"), box.querySelector("#b")];
        b.focus();

        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(a);
    });

    it("cycles from the first focusable back to the last on Shift+Tab", () => {
        const box = mount("<button id=a></button><button id=b></button>");
        const [a, b] = [box.querySelector("#a"), box.querySelector("#b")];
        a.focus();

        const e = tab({ shift: true });
        handleFocusTrap(box, e);

        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(b);
    });

    it("an SVG `<use href>` is NOT a focusable — Tab from the last button still wraps", () => {
        // `[href]` matched the `<use href>` of a taxonomy glyph in the side panel's title. An SVG
        // element has no `offsetParent` property (`undefined`, not `null`), so the visibility
        // filter kept it, and it became the LAST focusable: Tab from Close was never wrapped,
        // and the tabulation left the panel on the delivered bundle.
        const box = mount(
            '<button id=a></button><button id=b></button><svg><use href="#glyph"></use></svg>'
        );
        const [a, b] = [box.querySelector("#a"), box.querySelector("#b")];
        b.focus();

        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(a);
    });

    it("a LOST focus (fallen to <body>) is brought back into the container", () => {
        // A focused control that disappears (hidden, disabled) drops the focus to <body>; the
        // next Tab then walked the page behind a modal. The trap takes it back — Tab to the
        // first focusable, Shift+Tab to the last.
        const box = mount("<button id=a></button><button id=b></button>");
        const [a, b] = [box.querySelector("#a"), box.querySelector("#b")];
        document.activeElement?.blur?.();
        expect(document.activeElement).toBe(document.body);

        const e = tab();
        handleFocusTrap(box, e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(a);

        a.blur();
        const s = tab({ shift: true });
        handleFocusTrap(box, s);
        expect(document.activeElement).toBe(b);
    });

    it("a focus held by ANOTHER element outside is left alone — the trap does not steal it", () => {
        // Two traps can coexist (the lightbox above the side panel). Only a lost focus is taken
        // back; a focus another surface owns is that surface's business.
        document.body.innerHTML =
            '<div id="trap"><button id=a></button></div><div id="other"><button id=o></button></div>';
        const box = document.getElementById("trap");
        const o = document.getElementById("o");
        o.focus();

        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(o);
    });

    it("leaves the native order alone in the middle of the cycle", () => {
        const box = mount("<button id=a></button><button id=b></button><button id=c></button>");
        const b = box.querySelector("#b");
        b.focus();

        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(b);
    });

    // Anchors, inputs, selects and textareas take focus as readily as buttons.
    // The lightbox copy of this trap listed only buttons, so Tab escaped it.
    it("counts links and form controls as focusable, not just buttons", () => {
        const box = mount(
            '<button id=a></button><input id=i><select id=s></select><a id=l href="#x"></a>'
        );
        const [a, l] = [box.querySelector("#a"), box.querySelector("#l")];
        l.focus();

        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(a);
    });

    // Calling focus() on a disabled control is a silent no-op, which would
    // strand the caret. The share modal used to include them.
    it("skips disabled controls", () => {
        const box = mount("<button id=a></button><button id=b disabled></button>");
        const a = box.querySelector("#a");
        a.focus();

        // `a` is both first and last once `b` is excluded, so Tab cycles onto itself.
        const e = tab();
        handleFocusTrap(box, e);

        expect(e.preventDefault).toHaveBeenCalled();
        expect(document.activeElement).toBe(a);
    });

    it("is a no-op on a container with no focusable node", () => {
        const box = mount("<p>nothing here</p>");
        const e = tab();

        expect(() => handleFocusTrap(box, e)).not.toThrow();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    // Callers hand over every keydown without pre-filtering, so a non-Tab key
    // must fall straight through — this is what lets the guard live inside.
    it("ignores keys other than Tab", () => {
        const box = mount("<button id=a></button><button id=b></button>");
        const b = box.querySelector("#b");
        b.focus();

        const e = new KeyboardEvent("keydown", { key: "a" });
        e.preventDefault = vi.fn();
        handleFocusTrap(box, e);

        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(b);
    });
});
