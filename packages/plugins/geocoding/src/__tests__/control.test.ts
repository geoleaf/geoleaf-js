/**
 * Tests for control.ts — DOM widget: input, debounce, keyboard nav, destroy.
 *
 * Ported from the core suite (`__tests__/geocoding/geocoding-control.test.js`).
 * Plugin adaptations:
 *  - import path `../control.js`;
 *  - `mountGeocodingControl` returns a handle object `{ destroy, reveal }`
 *    (the core returned a bare `destroy` function), so call sites use
 *    `handle.destroy()`.
 * The DOM structure (pill-search + results list) and CSS classes are identical
 * to the core widget, so the selectors and assertions carry over unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountGeocodingControl } from "../control.js";

describe("mountGeocodingControl", () => {
    let container;
    let provider;
    let onSelect;
    let handle;

    const defaultConfig = {
        debounceMs: 0, // instant for tests
        minChars: 3,
        resultLimit: 5,
        placeholder: "Search…",
        position: "top-right",
    };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);

        provider = { search: vi.fn(async () => []) };
        onSelect = vi.fn();

        handle = mountGeocodingControl(container, provider, defaultConfig, onSelect);
    });

    afterEach(() => {
        handle.destroy();
        container.remove();
        vi.useRealTimers();
    });

    function getInput() {
        return container.querySelector(".gl-pill-search__input");
    }
    function getClearBtn() {
        return container.querySelector(".gl-pill-search__clear");
    }
    function getResultsList() {
        return container.querySelector(".gl-geocoding-results");
    }
    function getItems() {
        return container.querySelectorAll(".gl-geocoding-result-item");
    }

    // ── DOM construction ──────────────────────────────────────────────────────

    describe("DOM construction", () => {
        it("creates wrapper with correct class and role", () => {
            const wrapper = container.querySelector(".gl-geocoding-ctrl");
            expect(wrapper).not.toBeNull();
            expect(wrapper.getAttribute("role")).toBe("search");
            expect(wrapper.classList.contains("gl-geocoding-ctrl--top-right")).toBe(true);
        });

        it("creates search input with correct attributes", () => {
            const input = getInput();
            expect(input.type).toBe("search");
            expect(input.placeholder).toBe("Search…");
            expect(input.getAttribute("aria-autocomplete")).toBe("list");
        });

        it("creates clear button (initially hidden)", () => {
            const btn = getClearBtn();
            expect(btn).not.toBeNull();
            expect(btn.hidden).toBe(true);
        });

        it("creates results list (initially hidden)", () => {
            const list = getResultsList();
            expect(list).not.toBeNull();
            expect(list.hidden).toBe(true);
        });
    });

    // ── Input / search ────────────────────────────────────────────────────────

    describe("input behavior", () => {
        it("does not trigger search if query is shorter than minChars", async () => {
            const input = getInput();
            input.value = "ab";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));
            expect(provider.search).not.toHaveBeenCalled();
        });

        it("shows clear button when input has text", () => {
            const input = getInput();
            input.value = "hello";
            input.dispatchEvent(new Event("input"));
            expect(getClearBtn().hidden).toBe(false);
        });

        it("hides clear button when input is empty", () => {
            const input = getInput();
            input.value = "";
            input.dispatchEvent(new Event("input"));
            expect(getClearBtn().hidden).toBe(true);
        });

        it("triggers search for text >= minChars", async () => {
            const results = [{ label: "Paris", lat: 48.8, lng: 2.3 }];
            provider.search.mockResolvedValueOnce(results);

            const input = getInput();
            input.value = "Par";
            input.dispatchEvent(new Event("input"));

            // Wait for async search (debounceMs: 0)
            await new Promise((r) => setTimeout(r, 50));

            expect(provider.search).toHaveBeenCalledWith("Par", 5);
            expect(getItems()).toHaveLength(1);
            expect(getItems()[0].textContent).toBe("Paris");
        });

        it("uses textContent for result labels (not innerHTML)", async () => {
            provider.search.mockResolvedValueOnce([
                { label: "<script>xss</script>", lat: 0, lng: 0 },
            ]);

            const input = getInput();
            input.value = "xss";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));

            const item = getItems()[0];
            expect(item.textContent).toBe("<script>xss</script>");
            // innerHTML would contain the literal text, not executable script
            expect(item.children.length).toBe(0);
        });
    });

    // ── Clear button ──────────────────────────────────────────────────────────

    describe("clear button", () => {
        it("clears input and hides results on click", async () => {
            provider.search.mockResolvedValueOnce([{ label: "A", lat: 1, lng: 2 }]);

            const input = getInput();
            input.value = "abc";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));

            getClearBtn().click();

            expect(input.value).toBe("");
            expect(getResultsList().hidden).toBe(true);
            expect(getClearBtn().hidden).toBe(true);
        });
    });

    // ── Result selection ──────────────────────────────────────────────────────

    describe("result click selection", () => {
        it("calls onSelect and sets input value on result click", async () => {
            const result = { label: "Lyon", lat: 45.7, lng: 4.8 };
            provider.search.mockResolvedValueOnce([result]);

            const input = getInput();
            input.value = "Lyon";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));

            getItems()[0].click();

            expect(onSelect).toHaveBeenCalledWith(result);
            expect(input.value).toBe("Lyon");
            expect(getResultsList().hidden).toBe(true);
        });
    });

    // ── Keyboard navigation ───────────────────────────────────────────────────

    describe("keyboard navigation", () => {
        beforeEach(async () => {
            provider.search.mockResolvedValueOnce([
                { label: "A", lat: 1, lng: 1 },
                { label: "B", lat: 2, lng: 2 },
                { label: "C", lat: 3, lng: 3 },
            ]);

            const input = getInput();
            input.value = "ABC";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));
        });

        it("ArrowDown selects first result", () => {
            getInput().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            expect(getItems()[0].getAttribute("aria-selected")).toBe("true");
        });

        it("ArrowDown moves selection down", () => {
            const input = getInput();
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            expect(getItems()[0].getAttribute("aria-selected")).toBe("false");
            expect(getItems()[1].getAttribute("aria-selected")).toBe("true");
        });

        it("ArrowUp from no selection selects last item", () => {
            getInput().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
            expect(getItems()[2].getAttribute("aria-selected")).toBe("true");
        });

        it("ArrowDown does not exceed last item", () => {
            const input = getInput();
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            expect(getItems()[2].getAttribute("aria-selected")).toBe("true");
        });

        it("ArrowUp does not go below 0", () => {
            const input = getInput();
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
            expect(getItems()[0].getAttribute("aria-selected")).toBe("true");
        });

        it("Enter selects the highlighted item", () => {
            const input = getInput();
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
            expect(onSelect).toHaveBeenCalledWith({ label: "A", lat: 1, lng: 1 });
        });

        it("Escape clears input and results", () => {
            getInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(getInput().value).toBe("");
            expect(getResultsList().hidden).toBe(true);
        });
    });

    // ── Outside click ─────────────────────────────────────────────────────────

    describe("outside click", () => {
        it("hides results on click outside wrapper", async () => {
            provider.search.mockResolvedValueOnce([{ label: "A", lat: 1, lng: 1 }]);
            const input = getInput();
            input.value = "abc";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 50));

            expect(getResultsList().hidden).toBe(false);

            // Click outside
            document.dispatchEvent(new Event("click"));
            expect(getResultsList().hidden).toBe(true);
        });
    });

    // ── Event propagation ─────────────────────────────────────────────────────

    describe("event propagation", () => {
        it("stops mousedown propagation on wrapper", () => {
            const wrapper = container.querySelector(".gl-geocoding-ctrl");
            const event = new MouseEvent("mousedown", { bubbles: true });
            const spy = vi.fn();
            container.addEventListener("mousedown", spy);

            wrapper.dispatchEvent(event);
            expect(spy).not.toHaveBeenCalled();

            container.removeEventListener("mousedown", spy);
        });

        it("stops dblclick propagation on wrapper", () => {
            const wrapper = container.querySelector(".gl-geocoding-ctrl");
            const event = new MouseEvent("dblclick", { bubbles: true });
            const spy = vi.fn();
            container.addEventListener("dblclick", spy);

            wrapper.dispatchEvent(event);
            expect(spy).not.toHaveBeenCalled();

            container.removeEventListener("dblclick", spy);
        });
    });

    // ── Destroy ───────────────────────────────────────────────────────────────

    describe("destroy", () => {
        it("removes wrapper from DOM", () => {
            handle.destroy();
            expect(container.querySelector(".gl-geocoding-ctrl")).toBeNull();
            // Re-create so afterEach handle.destroy() doesn't fail
            handle = mountGeocodingControl(container, provider, defaultConfig, onSelect);
        });
    });

    // ── Reveal (mobile pill toggle) ───────────────────────────────────────────

    describe("reveal", () => {
        it("toggles the mobile-visible class and syncs the toolbar button", () => {
            const wrapper = container.querySelector(".gl-geocoding-ctrl");
            const button = document.createElement("button");

            handle.reveal(button);
            expect(wrapper.classList.contains("gl-geocoding-ctrl--mobile-visible")).toBe(true);
            expect(button.classList.contains("gl-map-toolbar__btn--active")).toBe(true);
            expect(button.getAttribute("aria-expanded")).toBe("true");

            handle.reveal(button);
            expect(wrapper.classList.contains("gl-geocoding-ctrl--mobile-visible")).toBe(false);
            expect(button.getAttribute("aria-expanded")).toBe("false");
        });
    });

    // ── Stale response handling ───────────────────────────────────────────────

    describe("stale response handling", () => {
        it("discards results if input changed during fetch", async () => {
            let fetchResolve;
            provider.search.mockImplementationOnce(
                () =>
                    new Promise((r) => {
                        fetchResolve = r;
                    })
            );

            const input = getInput();
            input.value = "Par";
            input.dispatchEvent(new Event("input"));
            await new Promise((r) => setTimeout(r, 10));

            // Change input while fetch is pending
            input.value = "Lyon";

            // Resolve the stale "Par" search
            fetchResolve([{ label: "Paris", lat: 48, lng: 2 }]);
            await new Promise((r) => setTimeout(r, 10));

            // Stale results should be discarded
            expect(getItems()).toHaveLength(0);
        });
    });

    // ── Default config values ─────────────────────────────────────────────────

    describe("config defaults", () => {
        // No `GeoLeaf.I18n` is mounted in this suite, so `t()` returns its hardcoded
        // French fallback by design. This asserts THAT — the offline/unbooted path —
        // and nothing about i18n resolution: it stayed green all through audit C-5,
        // when `en` silently served French. Key↔dictionary resolution is covered by
        // `i18n.test.ts`; dictionary shape by `npm run check-i18n-shape`.
        it("falls back to the French label when no host i18n is mounted", () => {
            const h2 = mountGeocodingControl(container, provider, {}, onSelect);
            const inputs = container.querySelectorAll(".gl-pill-search__input");
            // Second input from default config
            const lastInput = inputs[inputs.length - 1];
            expect(lastInput.placeholder).toContain("adresse");
            h2.destroy();
        });

        it("uses specified position class", () => {
            const h2 = mountGeocodingControl(
                container,
                provider,
                { position: "bottom-left" },
                onSelect
            );
            const wrappers = container.querySelectorAll(".gl-geocoding-ctrl");
            const lastWrapper = wrappers[wrappers.length - 1];
            expect(lastWrapper.classList.contains("gl-geocoding-ctrl--bottom-left")).toBe(true);
            h2.destroy();
        });
    });
});
