/**
 * Theme-toggle capability — runtime control.
 * Relocated from the control tested via coverage-modules-ui-controls (extraction
 * roadmap contrôles carte). Drives the kernel `_UITheme` engine (mocked here).
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k) => k),
}));
vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        createSVGIcon: vi.fn(() => document.createElementNS("http://www.w3.org/2000/svg", "svg")),
    },
}));
vi.mock("../../../src/utils/general/dom-helpers.js", () => ({
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
}));
vi.mock("../../../src/utils/controls/propagation-blocker.js", () => ({
    blockMapPropagation: vi.fn(),
}));
vi.mock("../../../src/kernel/ui/theme.js", () => ({
    _UITheme: {
        THEME_DARK: "dark",
        getCurrentTheme: vi.fn(() => "light"),
        toggleTheme: vi.fn(),
    },
}));

import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import {
    initThemeToggleControl,
    _destroyThemeToggleControl,
} from "../../../src/capabilities/theme-toggle/theme-toggle.js";

describe("capabilities/theme-toggle", () => {
    it("initThemeToggleControl returns undefined when map missing", () => {
        expect(initThemeToggleControl(null)).toBeUndefined();
    });

    it("initThemeToggleControl adds a control and returns a destroy fn", () => {
        const handle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => handle) };
        const destroy = initThemeToggleControl(map);
        expect(map.addControl).toHaveBeenCalledWith(expect.any(Object), "topleft");
        expect(typeof destroy).toBe("function");
        destroy();
        expect(handle.remove).toHaveBeenCalled();
    });

    it("honours a custom position argument", () => {
        const handle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => handle) };
        initThemeToggleControl(map, "bottomright");
        expect(map.addControl).toHaveBeenCalledWith(expect.any(Object), "bottomright");
        _destroyThemeToggleControl();
    });

    it("_destroyThemeToggleControl does not throw when nothing mounted", () => {
        expect(() => _destroyThemeToggleControl()).not.toThrow();
    });
});
