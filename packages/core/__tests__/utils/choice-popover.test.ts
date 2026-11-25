/**
 * The shared disclosure behind the language and palette buttons.
 *
 * Before it, each capability carried its own copy: `role="menu"` without the menu keyboard
 * contract, no `aria-expanded`, the list appended at the end of the bar, and the desktop
 * geometry applied to the mobile bar. These cases hold the contract that replaced them.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
    closeChoicePopover,
    initChoiceButton,
    toggleChoicePopover,
} from "../../src/utils/controls/choice-popover.js";

function bar(): HTMLElement {
    document.body.innerHTML =
        '<div id="bar"><button id="a"></button><button id="z"></button></div>';
    const btn = document.getElementById("a") as HTMLElement;
    btn.dataset.variant = "mobile";
    initChoiceButton(btn);
    return btn;
}

function list(): HTMLElement {
    const l = document.createElement("div");
    l.innerHTML =
        '<button data-k="1"></button><button data-k="2" aria-current="true"></button><button data-k="3"></button>';
    return l;
}

afterEach(() => {
    closeChoicePopover();
    document.body.innerHTML = "";
});

describe("choice-popover — un bouton qui ouvre une courte liste de choix", () => {
    it("le bouton dit qu'il est fermé, et ne promet pas de menu", () => {
        const btn = bar();
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        expect(btn.hasAttribute("aria-haspopup")).toBe(false);
    });

    it("ouverte : juste APRÈS son bouton, `group`, reliée par aria-controls, variante copiée", () => {
        const btn = bar();
        toggleChoicePopover(btn, list);
        const l = btn.nextElementSibling;
        expect(l?.getAttribute("role")).toBe("group");
        expect(btn.getAttribute("aria-expanded")).toBe("true");
        expect(btn.getAttribute("aria-controls")).toBe(l?.id);
        expect(l?.getAttribute("data-variant")).toBe("mobile");
        expect(l?.querySelectorAll('[role="menuitem"]').length).toBe(0);
    });

    it("le focus va à l'entrée active", () => {
        const btn = bar();
        toggleChoicePopover(btn, list);
        expect(document.activeElement?.getAttribute("data-k")).toBe("2");
    });

    it("Échap ferme et rend le focus au bouton", () => {
        const btn = bar();
        toggleChoicePopover(btn, list);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(btn.nextElementSibling?.id).toBe("z");
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(btn);
    });

    it("un second clic sur le bouton referme", () => {
        const btn = bar();
        toggleChoicePopover(btn, list);
        toggleChoicePopover(btn, list);
        expect(document.querySelectorAll('[role="group"]').length).toBe(0);
        expect(btn.getAttribute("aria-expanded")).toBe("false");
    });

    it("une seule liste à la fois : en ouvrir une ferme l'autre", () => {
        const a = bar();
        const z = document.getElementById("z") as HTMLElement;
        initChoiceButton(z);
        toggleChoicePopover(a, list);
        toggleChoicePopover(z, list);
        expect(document.querySelectorAll('[role="group"]').length).toBe(1);
        expect(a.getAttribute("aria-expanded")).toBe("false");
        expect(z.getAttribute("aria-expanded")).toBe("true");
    });

    it("le focus qui quitte la liste et le bouton la ferme", () => {
        const btn = bar();
        const outside = document.createElement("button");
        document.body.appendChild(outside);
        toggleChoicePopover(btn, list);
        const l = btn.nextElementSibling;
        l?.dispatchEvent(new FocusEvent("focusout", { relatedTarget: outside, bubbles: true }));
        expect(document.querySelectorAll('[role="group"]').length).toBe(0);
    });
});
