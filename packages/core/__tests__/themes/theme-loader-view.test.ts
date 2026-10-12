/**
 * The theme loader keeps the view a theme declares — and SAYS when it drops one.
 *
 * A normalised theme used to carry six fields; anything else a theme declared was left behind.
 * `view` is now carried through, in the writing of the profile, because it is what the theme
 * engine frames the map on and what `GeoLeaf.ThemeSelector.getThemes()` shows.
 *
 * A view that cannot be used is dropped with a warning naming the theme. Silently, the theme
 * would still apply and simply never move the camera — the integrator would look for a defect
 * in the engine rather than a typo in the profile.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const log = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }));
vi.mock("../../src/utils/log/index.js", () => ({ Log: log }));

const { ThemeLoader } = await import("../../src/kernel/themes/theme-loader.js");

const BOUNDS = [
    [43.25, 1.25],
    [43.75, 1.75],
];

/** Normalises one theme entry and returns it. */
function normalise(theme: Record<string, unknown>) {
    const [normalised] = ThemeLoader._validateConfig({ themes: [theme] }).themes;
    if (!normalised) throw new Error("the theme was not kept");
    return normalised;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("ThemeLoader — a theme that declares a view", () => {
    it("keeps `bounds`, in the writing of the profile", () => {
        expect(normalise({ id: "sector", view: { bounds: BOUNDS } }).view).toEqual({
            bounds: BOUNDS,
        });
    });

    it("keeps `center` with `zoom`", () => {
        expect(normalise({ id: "spot", view: { center: [43.25, 1.75], zoom: 13 } }).view).toEqual({
            center: [43.25, 1.75],
            zoom: 13,
        });
    });

    it("keeps the form that applies when both are declared, without its comment", () => {
        const view = { _comment: "north", bounds: BOUNDS, center: [43.25, 1.75], zoom: 13 };
        expect(normalise({ id: "sector", view }).view).toEqual({ bounds: BOUNDS });
    });

    it("says nothing: a usable view is not a diagnosis", () => {
        normalise({ id: "sector", view: { bounds: BOUNDS } });
        expect(log.warn).not.toHaveBeenCalled();
    });

    it("carries it on a primary theme and on a secondary one alike", () => {
        const { themes } = ThemeLoader._validateConfig({
            themes: [
                { id: "sector", type: "primary", view: { bounds: BOUNDS } },
                { id: "season", type: "secondary", view: { center: [43.25, 1.75], zoom: 13 } },
            ],
        });
        expect(themes.map((theme) => [theme.type, theme.view !== undefined])).toEqual([
            ["primary", true],
            ["secondary", true],
        ]);
    });
});

describe("ThemeLoader — a theme that declares no view", () => {
    it("carries no `view` key at all", () => {
        expect("view" in normalise({ id: "general" })).toBe(false);
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe("ThemeLoader — a view that cannot be used", () => {
    it.each([
        ["an empty view", {}],
        ["a centre without its zoom", { center: [43.25, 1.75] }],
        [
            "corners written north-east first",
            {
                bounds: [
                    [43.75, 1.75],
                    [43.25, 1.25],
                ],
            },
        ],
        ["a view that is not an object", "north"],
        ["null", null],
    ])("is dropped — %s — and the theme is kept", (_label, view) => {
        const theme = normalise({ id: "sector", label: "Sector", view });

        expect("view" in theme).toBe(false);
        expect(theme).toMatchObject({ id: "sector", label: "Sector" });
    });

    it("is SAID, in a warning that names the theme and the two forms a view takes", () => {
        normalise({ id: "sector", view: { center: [43.25, 1.75] } });

        expect(log.warn).toHaveBeenCalledTimes(1);
        const message = String(log.warn.mock.calls[0]?.[0]);
        expect(message).toContain('"sector"');
        expect(message).toContain('"bounds"');
        expect(message).toContain('"center"');
        expect(message).toContain('"zoom"');
    });
});
