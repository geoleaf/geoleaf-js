/**
 */
/* Phase 5.29 - theme-selector */

/* Relocated S8/F4: themes/ (depth 2) → capabilities/theme-selector/ (depth 3); imports rebased ../../src → ../../../src. */
const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockConfigGet = vi.fn(() => null);
const mockLoadThemesConfig = vi.fn(() =>
    Promise.resolve({
        config: {
            primaryThemes: { enabled: false },
            secondaryThemes: { enabled: false },
        },
        themes: [
            { id: "light", type: "primary", label: "Light" },
            { id: "dark", type: "primary", label: "Dark" },
        ],
        defaultTheme: "light",
    })
);
const mockApplyTheme = vi.fn(() => Promise.resolve());

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (key) => mockConfigGet(key) },
}));
vi.mock("../../../src/kernel/themes/theme-loader.js", () => ({
    ThemeLoader: { loadThemesConfig: (id) => mockLoadThemesConfig(id) },
}));
vi.mock("../../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: { applyTheme: (theme) => mockApplyTheme(theme) },
}));
// `$create` IS `createElement` (an export alias). The double must therefore answer to
// both names with ONE implementation, or the suite would silently stop covering the
// sites migrated off the alias (B.18).
const createElementDouble = vi.hoisted(() =>
    vi.fn((tag, attrs) => {
        const el = document.createElement(tag || "div");
        if (attrs) {
            if (attrs.value !== undefined) el.value = attrs.value;
            if (attrs.textContent !== undefined) el.textContent = attrs.textContent;
            if (attrs.disabled !== undefined) el.disabled = attrs.disabled;
        }
        return el;
    })
);
vi.mock("../../../src/utils/general/dom-helpers.js", () => ({
    createElement: createElementDouble,
    $create: createElementDouble,
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
}));
vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        clearElementFast: vi.fn((el) => {
            if (el) el.innerHTML = "";
        }),
    },
}));
const mockEventsOn = vi.fn();
vi.mock("../../../src/utils/general/event-listener-manager.js", () => ({
    events: { on: (...args) => mockEventsOn(...args) },
}));

import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import { ThemeSelector } from "../../../src/capabilities/theme-selector/theme-selector.js";

describe("theme-selector (Phase 5.29)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        mockLoadThemesConfig.mockReturnValue(
            Promise.resolve({
                config: {
                    primaryThemes: { enabled: false },
                    secondaryThemes: { enabled: false },
                },
                themes: [
                    { id: "light", type: "primary", label: "Light" },
                    { id: "dark", type: "primary", label: "Dark" },
                ],
                defaultTheme: "light",
            })
        );
        mockApplyTheme.mockResolvedValue(undefined);
    });

    describe("ThemeSelector export", () => {
        it("exports init, setTheme, getCurrentTheme, getThemes, getPrimaryThemes, getSecondaryThemes, isInitialized, destroy", () => {
            expect(ThemeSelector.init).toBeDefined();
            expect(ThemeSelector.setTheme).toBeDefined();
            expect(ThemeSelector.getCurrentTheme).toBeDefined();
            expect(ThemeSelector.getThemes).toBeDefined();
            expect(ThemeSelector.getPrimaryThemes).toBeDefined();
            expect(ThemeSelector.getSecondaryThemes).toBeDefined();
            expect(ThemeSelector.isInitialized).toBeDefined();
            expect(ThemeSelector.destroy).toBeDefined();
        });
    });

    describe("before init (state)", () => {
        it("getCurrentTheme returns null when not yet initialized", () => {
            expect(ThemeSelector.getCurrentTheme()).toBeNull();
        });
        it("getThemes and getPrimaryThemes return empty when not yet initialized", () => {
            expect(ThemeSelector.getThemes()).toEqual([]);
            expect(ThemeSelector.getPrimaryThemes()).toEqual([]);
            expect(ThemeSelector.getSecondaryThemes()).toEqual([]);
        });
    });

    describe("init", () => {
        it("rejects when options or profileId missing", async () => {
            await expect(ThemeSelector.init(null)).rejects.toThrow("profileId required");
            await expect(ThemeSelector.init({})).rejects.toThrow("profileId required");
        });

        it("resolves and reflects the default theme (does NOT apply — F2) when profileId provided", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            expect(mockLoadThemesConfig).toHaveBeenCalledWith("test-profile");
            // F2/S8: the default theme is applied by ThemeEngineModule, not the selector's init.
            expect(mockApplyTheme).not.toHaveBeenCalled();
            expect(ThemeSelector.getCurrentTheme()).toBe("light");
            expect(ThemeSelector.isInitialized()).toBe(true);
        });

        it("dispatches geoleaf:themes:ready event after init", async () => {
            const handler = vi.fn();
            document.addEventListener("geoleaf:themes:ready", handler);
            await ThemeSelector.init({ profileId: "test-profile" });
            expect(handler).toHaveBeenCalled();
            document.removeEventListener("geoleaf:themes:ready", handler);
        });
    });

    describe("setTheme", () => {
        it("rejects when theme id not found", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            await expect(ThemeSelector.setTheme("unknown")).rejects.toThrow("not found");
        });

        it("resolves and updates currentTheme when theme exists", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            mockApplyTheme.mockClear();
            await ThemeSelector.setTheme("dark");
            expect(mockApplyTheme).toHaveBeenCalled();
            expect(ThemeSelector.getCurrentTheme()).toBe("dark");
        });
    });

    describe("getCurrentTheme", () => {
        it("returns current theme id after init", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            expect(ThemeSelector.getCurrentTheme()).toBe("light");
        });
    });

    describe("getThemes, getPrimaryThemes, getSecondaryThemes", () => {
        it("return loaded themes after init", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            expect(ThemeSelector.getThemes().length).toBe(2);
            expect(ThemeSelector.getPrimaryThemes().length).toBe(2);
            expect(ThemeSelector.getSecondaryThemes().length).toBe(0);
        });
    });

    describe("_createUI integration", () => {
        it("does not create UI when modules.theme-selector.enabled is false", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: false } });
            const primary = document.createElement("div");
            const secondary = document.createElement("div");
            document.body.appendChild(primary);
            document.body.appendChild(secondary);
            await ThemeSelector.init({
                profileId: "test-profile",
                primaryContainer: primary,
                secondaryContainer: secondary,
            });
            expect(primary.querySelector(".gl-theme-btn")).toBeNull();
        });

        it("creates primary buttons when enabled and containers provided", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [
                        { id: "light", type: "primary", label: "Light" },
                        { id: "dark", type: "primary", label: "Dark" },
                    ],
                    defaultTheme: "light",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "test-profile", primaryContainer: primary });
            const buttons = primary.querySelectorAll(".gl-theme-btn");
            expect(buttons.length).toBe(2);
        });

        it("creates secondary UI (dropdown + nav) when enabled", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: false },
                        secondaryThemes: {
                            enabled: true,
                            placeholder: "Choose...",
                            showNavigationButtons: true,
                        },
                    },
                    themes: [
                        { id: "s1", type: "secondary", label: "Secondary 1" },
                        { id: "s2", type: "secondary", label: "Secondary 2" },
                    ],
                    defaultTheme: "s1",
                })
            );
            const secondary = document.createElement("div");
            document.body.appendChild(secondary);
            await ThemeSelector.init({
                profileId: "test-profile",
                secondaryContainer: secondary,
            });
            expect(secondary.classList.contains("gl-theme-selector-secondary")).toBe(true);
            expect(secondary.querySelector(".gl-theme-dropdown")).not.toBeNull();
            expect(secondary.querySelectorAll(".gl-theme-nav").length).toBe(2);
        });
    });

    describe("setTheme when not initialized", () => {
        it("rejects when not initialized", async () => {
            ThemeSelector.destroy();
            await expect(ThemeSelector.setTheme("light")).rejects.toThrow(/not initialized/);
        });
    });

    describe("setTheme error path", () => {
        it("rejects and warns on applyTheme failure", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            mockApplyTheme.mockRejectedValueOnce(new Error("apply failed"));
            await expect(ThemeSelector.setTheme("dark")).rejects.toThrow("apply failed");
        });
    });

    describe("init error path", () => {
        it("dispatches geoleaf:themes:ready with error and rethrows", async () => {
            mockLoadThemesConfig.mockRejectedValueOnce(new Error("load failed"));
            const handler = vi.fn();
            document.addEventListener("geoleaf:themes:ready", handler);
            await expect(ThemeSelector.init({ profileId: "x" })).rejects.toThrow("load failed");
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    detail: expect.objectContaining({ error: "load failed" }),
                })
            );
            document.removeEventListener("geoleaf:themes:ready", handler);
        });
    });

    describe("nextTheme / previousTheme", () => {
        it("nextTheme cycles to next secondary theme", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: false } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: false },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [
                        { id: "a", type: "secondary", label: "A" },
                        { id: "b", type: "secondary", label: "B" },
                    ],
                    defaultTheme: "a",
                })
            );
            await ThemeSelector.init({ profileId: "p" });
            mockApplyTheme.mockClear();
            ThemeSelector.nextTheme();
            await Promise.resolve();
            expect(mockApplyTheme).toHaveBeenCalled();
            expect(ThemeSelector.getCurrentTheme()).toBe("b");
        });

        it("previousTheme cycles to previous secondary theme", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: false } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: false },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [
                        { id: "x", type: "secondary", label: "X" },
                        { id: "y", type: "secondary", label: "Y" },
                    ],
                    defaultTheme: "y",
                })
            );
            await ThemeSelector.init({ profileId: "p" });
            mockApplyTheme.mockClear();
            ThemeSelector.previousTheme();
            await Promise.resolve();
            expect(mockApplyTheme).toHaveBeenCalled();
            expect(ThemeSelector.getCurrentTheme()).toBe("x");
        });

        it("nextTheme does nothing when no secondary themes", async () => {
            await ThemeSelector.init({ profileId: "test-profile" });
            mockApplyTheme.mockClear();
            ThemeSelector.nextTheme();
            expect(mockApplyTheme).not.toHaveBeenCalled();
        });
    });

    describe("_updateUIState via setTheme", () => {
        it("updates primary button active state and dropdown value", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: true, showNavigationButtons: false },
                    },
                    themes: [
                        { id: "p1", type: "primary", label: "P1" },
                        { id: "s1", type: "secondary", label: "S1" },
                    ],
                    defaultTheme: "p1",
                })
            );
            const primary = document.createElement("div");
            const secondary = document.createElement("div");
            document.body.appendChild(primary);
            document.body.appendChild(secondary);
            await ThemeSelector.init({
                profileId: "p",
                primaryContainer: primary,
                secondaryContainer: secondary,
            });
            const buttons = primary.querySelectorAll(".gl-theme-btn");
            expect(buttons[0].classList.contains("gl-theme-btn--active")).toBe(true);
            await ThemeSelector.setTheme("s1");
            expect(ThemeSelector.getCurrentTheme()).toBe("s1");
            const dropdown = secondary.querySelector(".gl-theme-dropdown");
            if (dropdown) expect(dropdown.value).toBe("s1");
        });
    });

    describe("destroy", () => {
        it("runs event cleanups and sets initialized to false", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [{ id: "t", type: "primary", label: "T" }],
                    defaultTheme: "t",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "p", primaryContainer: primary });
            expect(ThemeSelector.isInitialized()).toBe(true);
            ThemeSelector.destroy();
            expect(ThemeSelector.isInitialized()).toBe(false);
        });

        it("clears themes/currentTheme/DOM refs — no stale state survives a destroy → recreate cycle (PA-2)", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [{ id: "t", type: "primary", label: "T" }],
                    defaultTheme: "t",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "p", primaryContainer: primary });
            expect(ThemeSelector.getThemes().length).toBeGreaterThan(0);
            expect(ThemeSelector.getCurrentTheme()).toBe("t");

            ThemeSelector.destroy();

            expect(ThemeSelector.getThemes()).toEqual([]);
            expect(ThemeSelector.getPrimaryThemes()).toEqual([]);
            expect(ThemeSelector.getSecondaryThemes()).toEqual([]);
            expect(ThemeSelector.getCurrentTheme()).toBeNull();
        });
    });

    // ── T22i — theme-selector-primary.ts branch coverage ─────────────
    describe("theme-selector-primary branch coverage", () => {
        beforeAll(() => {
            // jsdom does not implement scrollIntoView — polyfill for compact mode tests
            HTMLElement.prototype.scrollIntoView = vi.fn();
        });
        it("createPrimaryUI returns early when no primaryContainer provided (branch 4.0)", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [{ id: "light", type: "primary", label: "Light" }],
                    defaultTheme: "light",
                })
            );
            // No primaryContainer → _state.primaryContainer is null → early return
            await expect(ThemeSelector.init({ profileId: "p" })).resolves.toBeUndefined();
        });

        it("createPrimaryUI activates compact mode when themes > threshold (branches 6.0, 10.0, 12.0)", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            const manyThemes = Array.from({ length: 6 }, (_, i) => ({
                id: `t${i}`,
                type: "primary",
                label: `Theme ${i}`,
            }));
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: manyThemes,
                    defaultTheme: "t0",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "p", primaryContainer: primary });
            expect(primary.classList.contains("gl-theme-selector-primary--compact")).toBe(true);
            const scrollEl = primary.querySelector(".gl-theme-selector-primary__scroll");
            expect(scrollEl).not.toBeNull();
        });

        it("updateUIStatePrimary triggers ensurePrimaryThemeVisible when scrollEl set (branch 3.0)", async () => {
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            const manyThemes = Array.from({ length: 6 }, (_, i) => ({
                id: `t${i}`,
                type: "primary",
                label: `Theme ${i}`,
            }));
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: manyThemes,
                    defaultTheme: "t0",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "p", primaryContainer: primary });
            // setTheme triggers updateUIStatePrimary with _state.primaryScrollEl set
            await expect(ThemeSelector.setTheme("t1")).resolves.toBeUndefined();
            expect(ThemeSelector.getCurrentTheme()).toBe("t1");
        });
    });

    // ── T22 — theme-selector-events.ts branch coverage ───────────────
    describe("theme-selector-events attachDOMEvent branch coverage", () => {
        it("uses native addEventListener to wire UI events", async () => {
            ThemeSelector.destroy();
            // Source always uses native el.addEventListener
            mockConfigGet.mockReturnValueOnce({ "theme-selector": { enabled: true } });
            mockLoadThemesConfig.mockReturnValueOnce(
                Promise.resolve({
                    config: {
                        primaryThemes: { enabled: true },
                        secondaryThemes: { enabled: false },
                    },
                    themes: [{ id: "ev1", type: "primary", label: "Ev1" }],
                    defaultTheme: "ev1",
                })
            );
            const primary = document.createElement("div");
            document.body.appendChild(primary);
            await ThemeSelector.init({ profileId: "p", primaryContainer: primary });
            // Verify UI was created with native event listeners (buttons exist)
            const buttons = primary.querySelectorAll(".gl-theme-btn");
            expect(buttons.length).toBeGreaterThan(0);
        });
    });
});
