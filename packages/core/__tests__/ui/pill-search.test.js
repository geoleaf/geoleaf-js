/**
 * Tests for the shared pill-shaped search helper (ui/pill-search.ts).
 *
 * Verifies DOM structure, callback wiring, keyboard handling
 * (Enter / Escape) and proper cleanup.
 */

import { createPillSearchInput } from "../../src/kernel/ui/pill-search.js";

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("createPillSearchInput()", () => {
    it("builds the expected DOM scaffold with shared CSS classes", () => {
        const { root, input, clearBtn, submitBtn } = createPillSearchInput({
            placeholder: "Recherche…",
            ariaLabel: "Recherche d’adresse",
            submitAriaLabel: "Valider la recherche",
            clearAriaLabel: "Effacer la recherche",
        });

        expect(root.classList.contains("gl-pill-search")).toBe(true);
        expect(root.getAttribute("role")).toBe("search");
        expect(root.getAttribute("aria-label")).toBe("Recherche d’adresse");

        expect(input.classList.contains("gl-pill-search__input")).toBe(true);
        expect(input.placeholder).toBe("Recherche…");
        expect(input.type).toBe("text");

        expect(clearBtn.classList.contains("gl-pill-search__clear")).toBe(true);
        // Source toggles visibility via the `hidden` property (not style.display);
        // jsdom mirrored hidden→display, happy-dom does not — assert the real API.
        expect(clearBtn.hidden).toBe(true);
        expect(submitBtn.classList.contains("gl-pill-search__submit")).toBe(true);

        // Children order: input, clear, submit
        expect(root.children[0]).toBe(input);
        expect(root.children[1]).toBe(clearBtn);
        expect(root.children[2]).toBe(submitBtn);
    });

    it("appends an extra class on the wrapper when extraClass is provided", () => {
        const { root } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            extraClass: "gl-foo gl-bar",
        });
        expect(root.classList.contains("gl-pill-search")).toBe(true);
        expect(root.classList.contains("gl-foo")).toBe(true);
        expect(root.classList.contains("gl-bar")).toBe(true);
    });

    it("inputType='search' is forwarded to the <input>", () => {
        const { input } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            inputType: "search",
        });
        expect(input.type).toBe("search");
    });

    it("reveals the clear button once the user types", () => {
        const { input, clearBtn } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
        });
        expect(clearBtn.hidden).toBe(true);
        input.value = "x";
        input.dispatchEvent(new Event("input"));
        expect(clearBtn.hidden).toBe(false);
    });

    it("invokes onInput on every keystroke", () => {
        const onInput = vi.fn();
        const { input } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onInput,
        });
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        expect(onInput).toHaveBeenCalledWith("abc");
    });

    it("submit button click invokes onSubmit with the current value", () => {
        const onSubmit = vi.fn();
        const { input, submitBtn } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onSubmit,
        });
        input.value = "hello";
        submitBtn.click();
        expect(onSubmit).toHaveBeenCalledWith("hello");
    });

    it("Enter key triggers onSubmit", () => {
        const onSubmit = vi.fn();
        const { input } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onSubmit,
        });
        input.value = "world";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(onSubmit).toHaveBeenCalledWith("world");
    });

    it("Escape clears a non-empty input and invokes onClear", () => {
        const onClear = vi.fn();
        const { input, clearBtn } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onClear,
        });
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        expect(clearBtn.hidden).toBe(false);

        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(input.value).toBe("");
        expect(clearBtn.hidden).toBe(true);
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("clear button click empties the input and invokes onClear", () => {
        const onClear = vi.fn();
        const { input, clearBtn } = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onClear,
        });
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        clearBtn.click();
        expect(input.value).toBe("");
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("destroy() detaches the wrapper and is idempotent", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const onSubmit = vi.fn();
        const handles = createPillSearchInput({
            placeholder: "p",
            ariaLabel: "a",
            submitAriaLabel: "s",
            clearAriaLabel: "c",
            onSubmit,
        });
        parent.appendChild(handles.root);

        expect(parent.contains(handles.root)).toBe(true);
        handles.destroy();
        expect(parent.contains(handles.root)).toBe(false);

        // After destroy, listeners are removed — onSubmit should not fire
        handles.submitBtn.click();
        expect(onSubmit).not.toHaveBeenCalled();

        // Calling destroy() a second time should be safe
        expect(() => handles.destroy()).not.toThrow();
    });
});
