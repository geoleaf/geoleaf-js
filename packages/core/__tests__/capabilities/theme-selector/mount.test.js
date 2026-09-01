/**
 * Deterministic MOUNT test for the theme-selector capability — S2 Lot 8.
 *
 * This is the prerequisite posed when theme-selector was pulled out of Lot 2: its DOM
 * facade spans 6 files and its coverage came from a fragile, incidental full-boot path.
 * Here the bar is mounted for real in happy-dom, so the mount code is covered
 * deterministically — a precondition for moving `GeoLeaf.ThemeSelector` out of
 * `globals.ui.ts` into the capability installer.
 *
 * Design: mock ONLY the three I/O boundaries (config, theme loader, theme applier). The
 * DOM helpers, the DOM-security sanitiser and i18n run FOR REAL — mocking them (as the
 * existing theme-selector.test.js does) is exactly what left the mount uncovered.
 *
 * Non-determinism is stubbed, not mocked away:
 *   - `requestAnimationFrame` → synchronous ;
 *   - `Element.prototype.scrollBy` → happy-dom does NOT implement it, and
 *     `attachCompactNavHandler` calls it WITHOUT optional chaining → a nav click throws
 *     without this stub. That is the structural reason its handler was never covered ;
 *   - `scrollIntoView` + fake timers for the 350 ms nav-state recompute.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfigGet = vi.fn(() => ({ "theme-selector": { enabled: true } }));
const mockApplyTheme = vi.fn(() => Promise.resolve());
const mockLoadThemesConfig = vi.fn();

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: mockConfigGet },
}));
vi.mock("../../../src/kernel/themes/theme-loader.js", () => ({
    ThemeLoader: { loadThemesConfig: mockLoadThemesConfig },
}));
vi.mock("../../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: { applyTheme: mockApplyTheme },
}));

const { ThemeSelector } =
    await import("../../../src/capabilities/theme-selector/theme-selector.ts");
const { _state } = await import("../../../src/capabilities/theme-selector/theme-selector-state.ts");

const theme = (id, type, label) => ({ id, type, label, icon: "•", description: `${label} theme` });

/** Builds the themes payload `ThemeLoader.loadThemesConfig` resolves with. */
function themesConfig({ primaryCount = 3, secondary = true } = {}) {
    const primaries = Array.from({ length: primaryCount }, (_, i) =>
        theme(`p${i + 1}`, "primary", `Primary ${i + 1}`)
    );
    const secondaries = secondary
        ? [theme("s1", "secondary", "Sea"), theme("s2", "secondary", "Forest")]
        : [];
    return {
        config: {
            primaryThemes: { enabled: true },
            secondaryThemes: {
                enabled: secondary,
                showNavigationButtons: true,
                // Read by `_buildSecondaryDropdown` for the disabled first <option>.
                placeholder: "Autres thèmes…",
            },
        },
        themes: [...primaries, ...secondaries],
        defaultTheme: "p1",
    };
}

async function mount(opts) {
    mockLoadThemesConfig.mockResolvedValue(themesConfig(opts));
    await ThemeSelector.init({
        profileId: "tourism",
        primaryContainer: document.getElementById("gl-theme-primary-container"),
        secondaryContainer: document.getElementById("gl-theme-secondary-container"),
    });
}

/** happy-dom leaves scroll metrics at 0 → force a scrollable geometry. */
function makeScrollable(el, { scrollLeft = 0, clientWidth = 100, scrollWidth = 400 } = {}) {
    for (const [prop, value] of Object.entries({ scrollLeft, clientWidth, scrollWidth })) {
        Object.defineProperty(el, prop, { value, configurable: true, writable: true });
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb) => {
        cb(0);
        return 0;
    });
    Element.prototype.scrollBy = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();

    document.body.innerHTML =
        '<div id="gl-theme-primary-container"></div><div id="gl-theme-secondary-container"></div>';

    // `_state` is a module singleton: reset it so cases cannot leak DOM refs into each other
    // (destroy() only clears the listeners + the initialized flag).
    ThemeSelector.destroy();
    Object.assign(_state, {
        profileId: null,
        config: null,
        themes: [],
        primaryThemes: [],
        secondaryThemes: [],
        currentTheme: null,
        primaryContainer: null,
        secondaryContainer: null,
        dropdown: null,
        primaryScrollEl: null,
        primaryScrollNavPrev: null,
        primaryScrollNavNext: null,
    });
    mockApplyTheme.mockClear();
    mockConfigGet.mockReturnValue({ "theme-selector": { enabled: true } });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("theme-selector — mount (standard bar)", () => {
    it("renders one button per primary theme, marking the active one", async () => {
        await mount({ primaryCount: 3 });

        const container = document.getElementById("gl-theme-primary-container");
        expect(container.classList.contains("gl-theme-selector-primary")).toBe(true);
        expect(container.classList.contains("gl-theme-selector-primary--compact")).toBe(false);

        const buttons = container.querySelectorAll("button.gl-theme-btn");
        expect(buttons).toHaveLength(3);
        expect(buttons[0].querySelector(".gl-theme-btn__label").textContent).toBe("Primary 1");
        expect(buttons[0].classList.contains("gl-theme-btn--active")).toBe(true);
        expect(ThemeSelector.isInitialized()).toBe(true);
        expect(ThemeSelector.getCurrentTheme()).toBe("p1");
    });

    it("applies the theme when a primary button is clicked", async () => {
        await mount({ primaryCount: 3 });

        const buttons = document.querySelectorAll("button.gl-theme-btn");
        buttons[1].click();
        await vi.runAllTimersAsync();

        expect(mockApplyTheme).toHaveBeenCalledTimes(1);
        expect(ThemeSelector.getCurrentTheme()).toBe("p2");
        expect(buttons[1].classList.contains("gl-theme-btn--active")).toBe(true);
        expect(buttons[0].classList.contains("gl-theme-btn--active")).toBe(false);
    });

    it("renders the secondary dropdown and its two nav buttons", async () => {
        await mount({ primaryCount: 3 });

        const container = document.getElementById("gl-theme-secondary-container");
        expect(container.classList.contains("gl-theme-selector-secondary")).toBe(true);
        // Pre-existing `domCreate` site, unasserted until B.18's mutation sweep found it.
        expect(container.querySelector("div.gl-theme-selector-secondary__wrapper")).not.toBeNull();
        const select = container.querySelector("select.gl-theme-dropdown");
        expect(select).not.toBeNull();
        // placeholder + 2 secondary themes
        expect(select.querySelectorAll("option")).toHaveLength(3);
        expect(container.querySelectorAll("button.gl-theme-nav")).toHaveLength(2);
    });

    /**
     * B.18 — the option list was only ever counted, never read. A mutation sweep
     * showed both `<option>` call sites could lose their `textContent` with the
     * whole theme-selector suite still green, which left the `$create` →
     * `createElement` migration of `_buildSecondaryDropdown` unguarded.
     */
    it("fills the dropdown with a disabled placeholder then one option per secondary theme", async () => {
        await mount({ primaryCount: 3 });

        const select = document.querySelector("select.gl-theme-dropdown");
        const options = [...select.querySelectorAll("option")];
        expect(options.map((o) => o.value)).toEqual(["", "s1", "s2"]);
        expect(options.map((o) => o.textContent)).toEqual(["Autres thèmes…", "Sea", "Forest"]);
        // Only the placeholder is unselectable.
        expect(options.map((o) => o.disabled)).toEqual([true, false, false]);
        // No secondary theme is active on mount (default is the primary `p1`).
        expect(select.value).toBe("");
    });

    it("preselects the active theme when it is a secondary one", async () => {
        await mount({ primaryCount: 3 });
        await ThemeSelector.setTheme("s2");

        expect(document.querySelector("select.gl-theme-dropdown").value).toBe("s2");
    });

    it("mounts nothing when the merged config does not enable the capability", async () => {
        mockConfigGet.mockReturnValue({ "theme-selector": { enabled: false } });
        await mount({ primaryCount: 3 });

        expect(document.querySelectorAll("button.gl-theme-btn")).toHaveLength(0);
        expect(document.querySelector("select.gl-theme-dropdown")).toBeNull();
        // The late render gate blocks the UI, but init() still completes.
        expect(ThemeSelector.isInitialized()).toBe(true);
    });
});

describe("theme-selector — mount (compact bar, > 5 primaries)", () => {
    it("switches to compact mode with a scroll zone and two nav buttons", async () => {
        await mount({ primaryCount: 7 });

        const container = document.getElementById("gl-theme-primary-container");
        expect(container.classList.contains("gl-theme-selector-primary--compact")).toBe(true);

        const scroll = container.querySelector(".gl-theme-selector-primary__scroll");
        expect(scroll).not.toBeNull();
        expect(scroll.querySelectorAll("button.gl-theme-btn")).toHaveLength(7);
        expect(container.querySelector(".gl-theme-selector-primary__nav--prev")).not.toBeNull();
        expect(container.querySelector(".gl-theme-selector-primary__nav--next")).not.toBeNull();
    });

    it("scrolls the bar when a nav button is clicked", async () => {
        await mount({ primaryCount: 7 });
        const scroll = document.querySelector(".gl-theme-selector-primary__scroll");
        const prev = document.querySelector(".gl-theme-selector-primary__nav--prev");
        const next = document.querySelector(".gl-theme-selector-primary__nav--next");

        // happy-dom reports every scroll metric as 0 → at mount, updatePrimaryNavButtons()
        // sees atStart && atEnd and DISABLES both nav buttons (a disabled button fires no
        // click). Give the bar a real geometry, then let the scroll handler re-enable them.
        makeScrollable(scroll, { scrollLeft: 150, clientWidth: 100, scrollWidth: 400 });
        scroll.dispatchEvent(new Event("scroll"));
        expect(prev.disabled).toBe(false);
        expect(next.disabled).toBe(false);

        next.click();
        expect(scroll.scrollBy).toHaveBeenCalledWith({ left: 120, behavior: "smooth" });

        prev.click();
        expect(scroll.scrollBy).toHaveBeenLastCalledWith({ left: -120, behavior: "smooth" });
    });

    it("disables the nav buttons at each end of the scroll range", async () => {
        await mount({ primaryCount: 7 });
        const scroll = document.querySelector(".gl-theme-selector-primary__scroll");
        const prev = document.querySelector(".gl-theme-selector-primary__nav--prev");
        const next = document.querySelector(".gl-theme-selector-primary__nav--next");

        // At the start: prev disabled, next active.
        makeScrollable(scroll, { scrollLeft: 0, clientWidth: 100, scrollWidth: 400 });
        scroll.dispatchEvent(new Event("scroll"));
        expect(prev.disabled).toBe(true);
        expect(next.disabled).toBe(false);

        // At the end: the mirror image.
        makeScrollable(scroll, { scrollLeft: 300, clientWidth: 100, scrollWidth: 400 });
        scroll.dispatchEvent(new Event("scroll"));
        expect(prev.disabled).toBe(false);
        expect(next.disabled).toBe(true);
    });

    it("scrolls the newly active theme into view on setTheme", async () => {
        await mount({ primaryCount: 7 });
        const scroll = document.querySelector(".gl-theme-selector-primary__scroll");
        makeScrollable(scroll);

        await ThemeSelector.setTheme("p6");
        const active = scroll.querySelector('[data-theme-id="p6"]');
        expect(active.scrollIntoView).toHaveBeenCalled();

        // The nav state is recomputed 350 ms later.
        makeScrollable(scroll, { scrollLeft: 300, clientWidth: 100, scrollWidth: 400 });
        await vi.advanceTimersByTimeAsync(400);
        expect(document.querySelector(".gl-theme-selector-primary__nav--next").disabled).toBe(true);
    });
});

describe("theme-selector — destroy", () => {
    it("detaches its DOM listeners (a click no longer applies a theme)", async () => {
        await mount({ primaryCount: 3 });
        const buttons = document.querySelectorAll("button.gl-theme-btn");

        ThemeSelector.destroy();
        expect(ThemeSelector.isInitialized()).toBe(false);

        buttons[1].click();
        await vi.runAllTimersAsync();
        expect(mockApplyTheme).not.toHaveBeenCalled();
    });

    it("is idempotent", async () => {
        await mount({ primaryCount: 3 });
        ThemeSelector.destroy();
        expect(() => ThemeSelector.destroy()).not.toThrow();
    });
});
