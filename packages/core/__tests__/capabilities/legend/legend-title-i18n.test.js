/**
 * @fileoverview Legend panel title — localised default (suite de B.24/B.38).
 *
 * `getLegendConfig()` returned the ENGLISH literal `"Legend"` as its built-in default, in a
 * product whose interface is otherwise French, and served it to all six locales. B.24
 * surfaced it by declaring the default in the schema — it had been invisible until then
 * because the schema advertised nothing at all.
 *
 * Same silent shape as the filter panel (B.38): nothing fails, the panel simply speaks the
 * wrong language, and only a reader comparing the dictionary to the literal would notice.
 * The fix is the same too — ask i18n — and the mechanical guard added in B.38
 * (`__tests__/i18n/requested-keys-exist.test.js`) now enforces that the key exists in all
 * six dictionaries, so this cannot regress into a missing-key fallback.
 *
 * A profile that sets `modules.legend.title` keeps winning: the dictionary supplies the
 * DEFAULT, not an override.
 */

const getLabel = vi.fn();

vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: (...args) => getLabel(...args),
}));

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const configGet = vi.fn();
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...args) => configGet(...args) },
}));

import { getLegendConfig } from "../../../src/capabilities/legend/config.js";

beforeEach(() => {
    getLabel.mockReset();
    configGet.mockReset();
    configGet.mockReturnValue({});
    getLabel.mockImplementation((key) => `«${key}»`);
});

describe("legend title — the default comes from the dictionary (B.24/B.38)", () => {
    it("asks i18n for the title instead of hardcoding one", () => {
        getLegendConfig();
        expect(getLabel).toHaveBeenCalledWith("ui.legend.title");
    });

    it("no longer returns the English literal to a French interface", () => {
        getLabel.mockImplementation((key) => (key === "ui.legend.title" ? "Légende" : `«${key}»`));
        expect(getLegendConfig().title).toBe("Légende");
    });

    it("serves the ACTIVE locale, not a fixed language", () => {
        getLabel.mockImplementation((key) => (key === "ui.legend.title" ? "Legende" : `«${key}»`));
        expect(getLegendConfig().title).toBe("Legende");
    });

    it("a profile-supplied title still wins over the dictionary", () => {
        configGet.mockReturnValue({ title: "Ma légende" });
        expect(getLegendConfig().title).toBe("Ma légende");
    });

    it("the other defaults are untouched by this change", () => {
        const cfg = getLegendConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.position).toBe("bottomleft");
        expect(cfg.collapsedByDefault).toBe(false);
    });
});
