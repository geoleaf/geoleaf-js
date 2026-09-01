/**
 * Tests for config/config-primitives — re-export barrel
 * Batch D1: ensures Config is correctly re-exported (0% → 100%)
 */
const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: { init: vi.fn(), deepMerge: vi.fn((a, b) => Object.assign({}, a, b)) },
}));
vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: { init: vi.fn() },
}));
// ⚠️ A `vi.mock(".../config/normalization.js")` lived here. The two mocks
// above are legitimate (`config-core.ts` does import `storage.js` and
// `profile.js`), this one was not: `normalization.ts` is only imported by
// `globals.config.ts` and `geojson/loader/data-mapping.ts`, neither loaded
// by this test. Decorative, removed after proving the suite is unchanged without it.

import { Config } from "../../src/kernel/config/config-primitives.js";
import { Config as CoreConfig } from "../../src/kernel/config/geoleaf-config/config-core.js";

describe("config/config-primitives", () => {
    it("re-exports Config object", () => {
        expect(Config).toBeDefined();
        expect(typeof Config).toBe("object");
    });

    it("re-exported Config has core methods", () => {
        expect(typeof Config.init).toBe("function");
        expect(typeof Config.isLoaded).toBe("function");
        expect(typeof Config.getSource).toBe("function");
    });

    it("Config is the same singleton as config-core", () => {
        expect(Config).toBe(CoreConfig);
    });
});
