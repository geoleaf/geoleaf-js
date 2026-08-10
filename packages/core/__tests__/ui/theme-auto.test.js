/**
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));

import { _UITheme } from "../../src/kernel/ui/theme.js";

// ---------------------------------------------------------------------------
// Helper: mock window.matchMedia
// ---------------------------------------------------------------------------
function mockMatchMedia(prefersDark) {
    const listeners = [];
    const mq = {
        matches: prefersDark,
        addEventListener: vi.fn((_, handler) => listeners.push(handler)),
        removeEventListener: vi.fn((_, handler) => {
            const i = listeners.indexOf(handler);
            if (i !== -1) listeners.splice(i, 1);
        }),
    };
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query) =>
            query === "(prefers-color-scheme: dark)"
                ? mq
                : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    return { mq, trigger: (dark) => listeners.forEach((fn) => fn({ matches: dark })) };
}

describe("initAutoTheme", () => {
    const THEME_KEY = "geoleaf_theme";

    beforeEach(() => {
        localStorage.clear();
        // Reset module-level _currentTheme without writing to localStorage
        _UITheme.applyTheme("light", false);
        document.body.className = "";
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    describe('explicit config ("light" / "dark")', () => {
        it('applies "light" when config is "light"', () => {
            mockMatchMedia(true); // system = dark — should be ignored
            _UITheme.initAutoTheme("light");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
            expect(document.body.classList.contains("gl-theme-dark")).toBe(false);
        });

        it('applies "dark" when config is "dark"', () => {
            mockMatchMedia(false); // system = light — should be ignored
            _UITheme.initAutoTheme("dark");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(document.body.classList.contains("gl-theme-light")).toBe(false);
        });

        // Backlog B.18 — this used to assert the OPPOSITE ("persists explicit theme to
        // localStorage"). Persisting here is what wiped the user's chosen theme on every
        // load: the profile's `ui.theme` overwrote `geoleaf_theme`, so no chosen theme
        // survived a reload. The boot applies a theme, it never chooses one — only an
        // explicit user action (`toggleTheme()` / `GeoLeaf.setTheme()`) persists.
        it("does NOT persist the explicit profile theme", () => {
            _UITheme.initAutoTheme("dark");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(localStorage.getItem(THEME_KEY)).toBeNull();
        });

        it("lets a stored user choice outrank the explicit profile theme", () => {
            localStorage.setItem(THEME_KEY, "light");
            _UITheme.initAutoTheme("dark"); // profile says dark, user picked light
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
            expect(localStorage.getItem(THEME_KEY)).toBe("light");
        });
    });

    describe("auto mode — no user override", () => {
        it("applies dark when system prefers dark", () => {
            mockMatchMedia(true);
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("applies light when system prefers light", () => {
            mockMatchMedia(false);
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });

        it("does NOT write to localStorage in auto mode", () => {
            mockMatchMedia(true);
            _UITheme.initAutoTheme("auto");
            expect(localStorage.getItem(THEME_KEY)).toBeNull();
        });
    });

    describe("auto mode — user override present", () => {
        it('respects "light" override even when system is dark', () => {
            localStorage.setItem(THEME_KEY, "light");
            mockMatchMedia(true); // system = dark
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });

        it('respects "dark" override even when system is light', () => {
            localStorage.setItem(THEME_KEY, "dark");
            mockMatchMedia(false); // system = light
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("does not overwrite user override in localStorage", () => {
            localStorage.setItem(THEME_KEY, "light");
            mockMatchMedia(true);
            _UITheme.initAutoTheme("auto");
            expect(localStorage.getItem(THEME_KEY)).toBe("light");
        });
    });

    describe("auto mode — matchMedia unavailable", () => {
        it('falls back to "light" when matchMedia is not available', () => {
            Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });
    });

    describe("live matchMedia listener", () => {
        it("updates theme when OS preference changes (no user override)", () => {
            const { trigger } = mockMatchMedia(false); // start light
            _UITheme.initAutoTheme("auto");
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);

            trigger(true); // OS switches to dark
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("ignores OS change when user override is set", () => {
            localStorage.setItem(THEME_KEY, "light");
            const { trigger } = mockMatchMedia(false);
            _UITheme.initAutoTheme("auto");

            trigger(true); // OS switches to dark — should be ignored
            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        });
    });

    describe("applyTheme persist=false", () => {
        it("does not write to localStorage when persist is false", () => {
            _UITheme.applyTheme("dark", false);
            expect(localStorage.getItem(THEME_KEY)).toBeNull();
            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        });

        it("writes to localStorage when persist is true (default)", () => {
            _UITheme.applyTheme("light");
            expect(localStorage.getItem(THEME_KEY)).toBe("light");
        });
    });
});
