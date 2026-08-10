/**
 * Branding capability — runtime control.
 * Relocated from __tests__/ui/branding.test.js (extraction roadmap contrôles carte).
 * Config source migrated: `branding` (root) → `modules.branding` (capability).
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn() },
}));

import { Branding } from "../../../src/capabilities/branding/branding.js";
import { Config } from "../../../src/kernel/config/config-primitives.js";

describe("capabilities/branding", () => {
    it("init does not throw when map null (logs error)", () => {
        expect(() => Branding.init(null)).not.toThrow();
    });

    it("has destroy method", () => {
        expect(typeof Branding.destroy).toBe("function");
    });

    it("destroy does not throw", () => {
        expect(() => Branding.destroy()).not.toThrow();
    });

    it("init when text is empty does not create control", () => {
        Config.get.mockReturnValue({ enabled: true, text: "" });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        expect(map.addControl).not.toHaveBeenCalled();
    });

    it("init with text and position creates control", () => {
        Config.get.mockReturnValue({
            enabled: true,
            text: "Powered by X",
            position: "bottomright",
        });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        expect(map.addControl).toHaveBeenCalled();
    });

    it("show makes container visible when hidden", () => {
        Config.get.mockReturnValue({ enabled: true, text: "X", position: "bottomright" });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        Branding.hide();
        Branding.show();
        expect(Branding._container).toBeTruthy();
        expect(Branding._container.style.display).toBe("");
    });

    it("hide hides container", () => {
        Config.get.mockReturnValue({ enabled: true, text: "X", position: "bottomright" });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        Branding.hide();
        expect(Branding._container.style.display).toBe("none");
    });

    it("setText updates branding content when control has container", () => {
        Config.get.mockReturnValue({ enabled: true, text: "Initial", position: "bottomright" });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        const container = Branding._container;
        if (container) {
            const content = container.querySelector(".gl-branding__content");
            if (content) {
                Branding.setText("New text");
                expect(content.textContent).toBe("New text");
            }
        }
    });

    it("destroy removes control via handle when _controlHandle and _map set", () => {
        Config.get.mockReturnValue({ enabled: true, text: "X", position: "bottomright" });
        const mockHandle = { remove: vi.fn() };
        const map = { addControl: vi.fn(() => mockHandle) };
        Branding.init(map);
        Branding.destroy();
        expect(mockHandle.remove).toHaveBeenCalled();
    });
});
