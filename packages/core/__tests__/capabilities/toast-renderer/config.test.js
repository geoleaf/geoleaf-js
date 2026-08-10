/**
 * S7 — toast-renderer capability config reader (opt-out gate).
 */

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn() },
}));

import { getToastRendererConfig } from "../../../src/capabilities/toast-renderer/config.js";
import { Config } from "../../../src/kernel/config/config-primitives.js";

describe("toast-renderer capability — config", () => {
    afterEach(() => vi.restoreAllMocks());

    it("defaults to enabled (opt-out) when the key is absent", () => {
        Config.get.mockReturnValue({});
        expect(getToastRendererConfig().enabled).toBe(true);
    });

    it("stays enabled when the key is missing entirely (undefined → default)", () => {
        Config.get.mockReturnValue(undefined);
        expect(getToastRendererConfig().enabled).toBe(true);
    });

    it("respects an explicit disable", () => {
        Config.get.mockReturnValue({ enabled: false });
        expect(getToastRendererConfig().enabled).toBe(false);
    });
});
