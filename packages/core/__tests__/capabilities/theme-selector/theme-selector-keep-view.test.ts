/**
 * `ThemeSelector.setTheme` hands the engine the theme WITH its view — and `keepView` only when
 * asked.
 *
 * The switch bar is how a user, a host or the permalink activates a theme. The camera move
 * itself is the engine's (`kernel/themes/theme-applier/`); what is pinned here is the seam:
 *
 * - the theme reaches the engine carrying the view the loader kept, so a framed theme frames;
 * - by default the engine is asked nothing more — it frames;
 * - `keepView` is forwarded when the caller sets a view of its own alongside the theme, which
 *   is what the permalink does for the theme of a shared address.
 *
 * Seen RED: the `keepView` case on a `setTheme` that dropped its second argument.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const applyTheme = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve()));

const SECTOR_VIEW = {
    bounds: [
        [43.25, 1.25],
        [43.75, 1.75],
    ],
};
const THEMES = [
    { id: "general", type: "primary", label: "General", layers: [] },
    { id: "sector", type: "primary", label: "Sector", layers: [], view: SECTOR_VIEW },
    { id: "winter", type: "secondary", label: "Winter", layers: [] },
    {
        id: "summer",
        type: "secondary",
        label: "Summer",
        layers: [],
        view: { center: [43.25, 1.75], zoom: 13 },
    },
];

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// `modules.theme-selector.enabled` is not `true`: no bar is built, which this file does not need.
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: () => null },
}));
vi.mock("../../../src/kernel/themes/theme-loader.js", () => ({
    ThemeLoader: {
        loadThemesConfig: () =>
            Promise.resolve({
                config: {
                    primaryThemes: { enabled: false, position: "top-map" },
                    secondaryThemes: { enabled: false, position: "top-layermanager" },
                },
                themes: THEMES,
                defaultTheme: "general",
            }),
    },
}));
vi.mock("../../../src/kernel/themes/declares-no-themes.js", () => ({
    declaresNoThemes: () => false,
}));
vi.mock("../../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: { applyTheme },
}));

const { ThemeSelector } =
    await import("../../../src/capabilities/theme-selector/theme-selector.js");

beforeEach(async () => {
    ThemeSelector.destroy();
    await ThemeSelector.init({ profileId: "p" });
    applyTheme.mockClear();
});

describe("ThemeSelector.setTheme — what the engine is handed", () => {
    it("the theme with the view it declares, and nothing else: the engine frames", async () => {
        await ThemeSelector.setTheme("sector");

        expect(applyTheme).toHaveBeenCalledTimes(1);
        expect(applyTheme.mock.calls[0]).toHaveLength(1);
        expect(applyTheme.mock.calls[0]?.[0]).toMatchObject({ id: "sector", view: SECTOR_VIEW });
    });

    it("a theme without a view, as it is: the engine leaves the camera alone", async () => {
        await ThemeSelector.setTheme("general");

        expect(applyTheme.mock.calls[0]).toHaveLength(1);
        expect(applyTheme.mock.calls[0]?.[0]).not.toHaveProperty("view");
    });

    it("🛑 `keepView` when the caller asks for it", async () => {
        await ThemeSelector.setTheme("sector", { keepView: true });

        expect(applyTheme).toHaveBeenCalledWith(expect.objectContaining({ id: "sector" }), {
            keepView: true,
        });
    });

    it.each([
        ["an empty options bag", {}],
        ["`keepView: false`", { keepView: false }],
    ])("nothing more with %s", async (_label, options) => {
        await ThemeSelector.setTheme("sector", options);

        expect(applyTheme.mock.calls[0]).toHaveLength(1);
    });
});

describe("ThemeSelector — the secondary themes frame like the primary ones", () => {
    it("`nextTheme()` hands the engine a secondary theme with its view", async () => {
        ThemeSelector.nextTheme(); // general → first secondary: winter (no view)
        await vi.waitFor(() => expect(ThemeSelector.getCurrentTheme()).toBe("winter"));
        ThemeSelector.nextTheme(); // winter → summer (a view)
        await vi.waitFor(() => expect(ThemeSelector.getCurrentTheme()).toBe("summer"));

        expect(applyTheme.mock.calls.map((call) => call.length)).toEqual([1, 1]);
        expect(applyTheme.mock.calls[1]?.[0]).toMatchObject({
            id: "summer",
            view: { center: [43.25, 1.75], zoom: 13 },
        });
    });
});
