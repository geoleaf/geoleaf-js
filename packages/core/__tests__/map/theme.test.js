/**
 */
// Tests for src/kernel/map/theme.ts - Phase R0

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setTheme, getTheme } from "../../src/kernel/map/theme.js";
import { Log } from "../../src/utils/log/index.js";

describe("map/theme", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.className = "";
    });

    it("setTheme('dark') adds gl-theme-dark class to body", () => {
        setTheme("dark");
        expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        expect(getTheme()).toBe("dark");
    });

    it("setTheme('light') adds gl-theme-light class to body", () => {
        setTheme("light");
        expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        expect(getTheme()).toBe("light");
    });

    it("setTheme with invalid value warns and does not change theme", () => {
        setTheme("light");
        setTheme("purple");
        expect(Log.warn).toHaveBeenCalled();
        expect(getTheme()).toBe("light");
    });

    it("logs warn when document.body is null", () => {
        const origBody = document.body;
        Object.defineProperty(document, "body", { value: null, configurable: true });
        setTheme("dark");
        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("document.body not found"));
        Object.defineProperty(document, "body", { value: origBody, configurable: true });
    });
});
