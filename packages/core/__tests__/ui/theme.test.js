/**
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { _UITheme } from "../../src/kernel/ui/theme.js";
import { Log } from "../../src/utils/log/index.js";

describe("UI Theme", () => {
    beforeEach(() => {
        document.body.classList.remove("gl-theme-light", "gl-theme-dark");
        document.body.className = "";
    });

    describe("getCurrentTheme", () => {
        it("returns dark when body has gl-theme-dark", () => {
            document.body.classList.add("gl-theme-dark");
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });

        it("returns light when body has gl-theme-light", () => {
            _UITheme.applyTheme("light");
            expect(_UITheme.getCurrentTheme()).toBe("light");
        });

        it("returns dark when theme is dark", () => {
            _UITheme.applyTheme("dark");
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });
    });

    describe("applyTheme", () => {
        it("applies dark and sets body class", () => {
            _UITheme.applyTheme("dark");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(document.body.classList.contains("gl-theme-light")).toBe(false);
        });

        it("applies light and sets body class", () => {
            _UITheme.applyTheme("light");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
            expect(document.body.classList.contains("gl-theme-dark")).toBe(false);
        });

        it("normalizes invalid theme to dark", () => {
            _UITheme.applyTheme("invalid");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });
    });

    describe("toggleTheme", () => {
        it("toggles from dark to light", () => {
            _UITheme.applyTheme("dark");
            _UITheme.toggleTheme();
            expect(_UITheme.getCurrentTheme()).toBe("light");
        });

        it("toggles from light to dark", () => {
            _UITheme.applyTheme("light");
            _UITheme.toggleTheme();
            expect(_UITheme.getCurrentTheme()).toBe("dark");
        });
    });

    describe("constants", () => {
        it("exposes THEME_LIGHT and THEME_DARK", () => {
            expect(_UITheme.THEME_LIGHT).toBe("light");
            expect(_UITheme.THEME_DARK).toBe("dark");
        });
    });

    describe("initThemeToggle", () => {
        it("applies initial theme and finds button by selector", () => {
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({ autoInitOnDomReady: false });
            expect(
                document.body.classList.contains("gl-theme-dark") ||
                    document.body.classList.contains("gl-theme-light")
            ).toBe(true);
            expect(btn.getAttribute("data-gl-theme-state")).toBeDefined();
            document.body.removeChild(btn);
        });

        it("when button not found logs a debug message", () => {
            _UITheme.initThemeToggle({
                buttonSelector: "#nonexistent-theme-btn",
                autoInitOnDomReady: false,
            });
            // Read the same specifier that was mocked above (index.js), so the
            // spy retrieved is the one the source actually invoked. The source
            // logs via Log.debug (not warn) when the toggle button is absent.
            expect(Log.debug).toHaveBeenCalled();
        });

        it("button click and keydown Enter toggle theme", () => {
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.applyTheme("light");
            _UITheme.initThemeToggle({ autoInitOnDomReady: false });
            btn.click();
            expect(_UITheme.getCurrentTheme()).toBe("dark");
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
            expect(_UITheme.getCurrentTheme()).toBe("light");
            document.body.removeChild(btn);
        });

        it("getCurrentTheme returns cached _currentTheme when set", () => {
            _UITheme.applyTheme("light");
            document.body.classList.remove("gl-theme-light", "gl-theme-dark");
            expect(_UITheme.getCurrentTheme()).toBe("light");
        });
    });

    describe("applyTheme with mapContainer and storage", () => {
        it("applies theme to #geoleaf-map when present", () => {
            const mapEl = document.createElement("div");
            mapEl.id = "geoleaf-map";
            document.body.appendChild(mapEl);
            _UITheme.applyTheme("dark");
            expect(mapEl.classList.contains("gl-theme-dark")).toBe(true);
            document.body.removeChild(mapEl);
        });

        it("persists theme to localStorage", () => {
            _UITheme.applyTheme("light");
            expect(localStorage.getItem("geoleaf_theme")).toBe("light");
        });

        it("initThemeToggle with autoInitOnDomReady true runs doInit when readyState not loading", () => {
            Object.defineProperty(document, "readyState", {
                value: "complete",
                configurable: true,
            });
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.initThemeToggle({ autoInitOnDomReady: true });
            expect(
                document.body.classList.contains("gl-theme-dark") ||
                    document.body.classList.contains("gl-theme-light")
            ).toBe(true);
            document.body.removeChild(btn);
        });

        it("keydown Space toggles theme", () => {
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            _UITheme.applyTheme("light");
            _UITheme.initThemeToggle({ autoInitOnDomReady: false });
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
            expect(_UITheme.getCurrentTheme()).toBe("dark");
            document.body.removeChild(btn);
        });

        it("resolveInitialTheme uses localStorage when valid", () => {
            localStorage.setItem("geoleaf_theme", "light");
            const btn = document.createElement("button");
            btn.setAttribute("data-gl-role", "theme-toggle");
            document.body.appendChild(btn);
            document.body.classList.remove("gl-theme-light", "gl-theme-dark");
            _UITheme.initThemeToggle({ autoInitOnDomReady: false });
            expect(_UITheme.getCurrentTheme()).toBe("light");
            document.body.removeChild(btn);
        });
    });
});
