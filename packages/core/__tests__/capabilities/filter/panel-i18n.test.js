/**
 * @fileoverview Filter panel — accessible name and localisation (B.38).
 *
 * Two defects of the same origin: `panel/render.ts` hardcodes its chrome instead of asking
 * i18n, even though a complete `ui.filter_panel.*` namespace exists and is TRANSLATED IN ALL
 * SIX dictionaries. The translations were written and left unused.
 *
 *  1. **Accessible name ≠ visible label.** `config.title` falls back to `"Filter"` for the
 *     region's `aria-label` and to `"Filtrer"` for the heading it labels. A profile that does
 *     not set `title` therefore announces one thing to a screen reader and shows another —
 *     WCAG 2.5.3 (Label in Name). Two fallbacks for one config key is how they drifted; the
 *     fix is one expression, so they cannot drift again.
 *
 *  2. **French served to every locale.** The heading, the apply/reset buttons and the empty
 *     -category notice are French string literals. Nothing fails: the panel simply speaks
 *     French to a German user while `lang-de.ts` already carries "Filter"/"Anwenden"/
 *     "Zurücksetzen". Same silent shape as the missing `feature-info.sidepanel.*` keys.
 */

const getLabel = vi.fn();

vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: (...args) => getLabel(...args),
}));

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { renderFilterPanel } from "../../../src/capabilities/filter/panel/render.js";

/** Stands in for the active dictionary: returns a marker so routing is observable. */
function dictionary(overrides = {}) {
    return (key, ...args) => overrides[key] ?? `«${key}»${args.length ? `(${args})` : ""}`;
}

beforeEach(() => {
    getLabel.mockReset();
    getLabel.mockImplementation(dictionary());
});

describe("filter panel — accessible name matches the visible label (B.38)", () => {
    it("uses ONE source for the region's accessible name and its heading", () => {
        const panel = renderFilterPanel({ fields: [] });

        const region = panel.matches('[role="region"]')
            ? panel
            : panel.querySelector('[role="region"]');
        const heading = panel.querySelector(".gl-filter-panel__title");

        expect(region).not.toBeNull();
        expect(heading).not.toBeNull();
        // WCAG 2.5.3: the accessible name must contain the visible label.
        expect(region.getAttribute("aria-label")).toBe(heading.textContent);
    });

    it("keeps them equal when the profile DOES set a title", () => {
        const panel = renderFilterPanel({ title: "Mes filtres", fields: [] });
        const region = panel.matches('[role="region"]')
            ? panel
            : panel.querySelector('[role="region"]');
        const heading = panel.querySelector(".gl-filter-panel__title");

        expect(region.getAttribute("aria-label")).toBe("Mes filtres");
        expect(heading.textContent).toBe("Mes filtres");
    });
});

describe("filter panel — chrome comes from the dictionary, not from literals (B.38)", () => {
    it("asks i18n for the panel title when the profile does not set one", () => {
        renderFilterPanel({ fields: [] });
        expect(getLabel).toHaveBeenCalledWith("ui.filter_panel.title");
    });

    it("asks i18n for the apply and reset labels when the profile does not set them", () => {
        renderFilterPanel({ fields: [] });
        const asked = getLabel.mock.calls.map(([k]) => k);
        expect(asked).toContain("ui.filter_panel.apply");
        expect(asked).toContain("ui.filter_panel.reset");
    });

    it("still lets the profile override apply/reset — config wins over the dictionary", () => {
        const panel = renderFilterPanel({
            fields: [],
            actions: { applyLabel: "Go", resetLabel: "Clear" },
        });
        expect(panel.textContent).toContain("Go");
        expect(panel.textContent).toContain("Clear");
    });

    it("renders the localised strings, not French literals", () => {
        getLabel.mockImplementation(
            dictionary({
                "ui.filter_panel.title": "Filter",
                "ui.filter_panel.apply": "Anwenden",
                "ui.filter_panel.reset": "Zurücksetzen",
            })
        );

        const panel = renderFilterPanel({ fields: [] });

        expect(panel.textContent).toContain("Filter");
        expect(panel.textContent).toContain("Anwenden");
        expect(panel.textContent).toContain("Zurücksetzen");
        expect(panel.textContent).not.toContain("Filtrer");
        expect(panel.textContent).not.toContain("Appliquer");
        expect(panel.textContent).not.toContain("Réinitialiser");
    });
});
