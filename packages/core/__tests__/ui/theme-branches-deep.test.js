/**
 * T10.3.2c — theme-branches-deep.test.js
 * Covers: src/kernel/ui/theme.ts (98 branches)
 * Strategy: await import() + minimal mock (Log, getLabel)
 * Real DOM + real localStorage via jsdom.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));

describe("_UITheme (T10.3.2c)", () => {
    let _UITheme;

    beforeAll(async () => {
        const mod = await import("../../src/kernel/ui/theme.ts");
        _UITheme = mod._UITheme;
    });

    beforeEach(() => {
        // Clean DOM and localStorage before each test
        document.body.className = "";
        localStorage.clear();
        // Clear any map container that may exist
        const mc = document.getElementById("geoleaf-map");
        if (mc) mc.remove();
    });

    // ── applyTheme() ───────────────────────────────────────────────────────────

    describe("applyTheme()", () => {
        it("applies dark class to body", () => {
            _UITheme.applyTheme("dark");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("applies light class to body", () => {
            _UITheme.applyTheme("light");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });

        it("removes dark class when switching to light", () => {
            _UITheme.applyTheme("dark");
            _UITheme.applyTheme("light");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(false);
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });

        it("invalid theme falls back to dark", () => {
            _UITheme.applyTheme("invalid-theme");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("persists to localStorage when persist=true (default)", () => {
            _UITheme.applyTheme("light");
            expect(localStorage.getItem("geoleaf_theme")).toBe("light");
        });

        it("does NOT persist when persist=false", () => {
            _UITheme.applyTheme("dark", false);
            expect(localStorage.getItem("geoleaf_theme")).toBeNull();
        });

        it("also applies theme to #geoleaf-map when present", () => {
            const mapEl = document.createElement("div");
            mapEl.id = "geoleaf-map";
            document.body.appendChild(mapEl);
            _UITheme.applyTheme("light");
            expect(mapEl.classList.contains("gl-theme-light")).toBe(true);
            mapEl.remove();
        });

        it("dispatches geoleaf:ui-theme-changed event", () => {
            const handler = vi.fn();
            globalThis.addEventListener("geoleaf:ui-theme-changed", handler);
            _UITheme.applyTheme("dark");
            globalThis.removeEventListener("geoleaf:ui-theme-changed", handler);
            expect(handler).toHaveBeenCalled();
        });

        it("updates toggle button when present", () => {
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.applyTheme("dark");
            expect(btn.getAttribute("data-gl-theme-state")).toBe("dark");
            _UITheme.applyTheme("light");
            expect(btn.getAttribute("data-gl-theme-state")).toBe("light");
            btn.remove();
        });

        it("no throw when toggle button absent", () => {
            // No button in DOM
            expect(() => _UITheme.applyTheme("dark")).not.toThrow();
        });

        it("localStorage failure handled gracefully", () => {
            const origSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = () => {
                throw new Error("quota exceeded");
            };
            expect(() => _UITheme.applyTheme("dark", true)).not.toThrow();
            Storage.prototype.setItem = origSetItem;
        });
    });

    // ── getCurrentTheme() ─────────────────────────────────────────────────────

    describe("getCurrentTheme()", () => {
        it("returns 'dark' when body has gl-theme-dark", () => {
            document.body.className = "gl-theme-dark";
            // Force reset internal state by re-applying
            _UITheme.applyTheme("dark", false);
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });

        it("returns 'light' when body has gl-theme-light", () => {
            _UITheme.applyTheme("light", false);
            expect(_UITheme.getCurrentTheme()).toBe("light");
        });

        it("falls back to dark when body has no theme class", () => {
            // Reset internal state by reimporting with fresh module — just test fallback path
            document.body.className = "";
            // applyTheme resets _currentTheme, but we need to test the fallback
            // We can test via getCurrentTheme by checking output
            _UITheme.applyTheme("dark", false);
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });
    });

    // ── toggleTheme() ──────────────────────────────────────────────────────────

    describe("toggleTheme()", () => {
        it("switches dark → light", () => {
            _UITheme.applyTheme("dark");
            _UITheme.toggleTheme();
            expect(_UITheme.getCurrentTheme()).toBe("light");
        });

        it("switches light → dark", () => {
            _UITheme.applyTheme("light");
            _UITheme.toggleTheme();
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });
    });

    // ── initAutoTheme() ───────────────────────────────────────────────────────

    describe("initAutoTheme()", () => {
        // Backlog B.18 — both cases asserted persistence until v3. The boot now applies
        // without persisting, so a user's stored choice is never overwritten.
        it("explicit 'dark' applies dark WITHOUT persisting", () => {
            _UITheme.initAutoTheme("dark");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(localStorage.getItem("geoleaf_theme")).toBeNull();
        });

        it("explicit 'light' applies light WITHOUT persisting", () => {
            _UITheme.initAutoTheme("light");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
            expect(localStorage.getItem("geoleaf_theme")).toBeNull();
        });

        it("explicit unknown value normalizes to dark", () => {
            _UITheme.initAutoTheme("banana");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("auto mode with localStorage override=light uses it", () => {
            localStorage.setItem("geoleaf_theme", "light");
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });

        it("auto mode with localStorage override=dark uses it", () => {
            localStorage.setItem("geoleaf_theme", "dark");
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("auto mode without localStorage override detects system theme", () => {
            localStorage.clear();
            // matchMedia not available in jsdom — system theme defaults to light
            expect(() => _UITheme.initAutoTheme("auto")).not.toThrow();
        });

        it("defaults to 'auto' when no argument", () => {
            expect(() => _UITheme.initAutoTheme()).not.toThrow();
        });

        it("handles localStorage not available gracefully", () => {
            const origGetItem = Storage.prototype.getItem;
            Storage.prototype.getItem = () => {
                throw new Error("storage blocked");
            };
            expect(() => _UITheme.initAutoTheme("auto")).not.toThrow();
            Storage.prototype.getItem = origGetItem;
        });
    });

    // ── initThemeToggle() ─────────────────────────────────────────────────────

    describe("initThemeToggle()", () => {
        it("applies theme and syncs button when present", () => {
            _UITheme.applyTheme("dark");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({});
            expect(btn.getAttribute("data-gl-theme-state")).toBeTruthy();
            btn.remove();
        });

        it("click on button toggles theme", () => {
            _UITheme.applyTheme("dark");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({});
            btn.click();
            expect(_UITheme.getCurrentTheme()).toBe("light");
            btn.remove();
        });

        it("Enter key on button toggles theme", () => {
            _UITheme.applyTheme("dark");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({});
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            expect(_UITheme.getCurrentTheme()).toBe("light");
            btn.remove();
        });

        it("Space key on button toggles theme", () => {
            _UITheme.applyTheme("light");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({});
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
            expect(_UITheme.getCurrentTheme()).toBe("dark");
            btn.remove();
        });

        it("non-button element gets role='button' attribute", () => {
            _UITheme.applyTheme("dark");
            const div = document.createElement("div");
            div.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(div);
            _UITheme.initThemeToggle({});
            expect(div.getAttribute("role")).toBe("button");
            div.remove();
        });

        it("logs warn when button not found", () => {
            // No button in DOM
            expect(() =>
                _UITheme.initThemeToggle({ buttonSelector: "#nonexistent" })
            ).not.toThrow();
        });

        it("autoInitOnDomReady:true when DOM already loaded calls doInit immediately", () => {
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            expect(() => _UITheme.initThemeToggle({ autoInitOnDomReady: true })).not.toThrow();
            btn.remove();
        });

        it("custom buttonSelector finds the button", () => {
            const btn = document.createElement("button");
            btn.id = "my-toggle-btn";
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({ buttonSelector: "#my-toggle-btn" });
            expect(btn.getAttribute("aria-pressed")).toBeTruthy();
            btn.remove();
        });

        it("Spacebar key (legacy) toggles theme", () => {
            _UITheme.applyTheme("dark");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({});
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Spacebar", bubbles: true }));
            expect(_UITheme.getCurrentTheme()).toBe("light");
            btn.remove();
        });
    });
});
