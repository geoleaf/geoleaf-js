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
// ⚠️ R.21 (24/07/2026) — un `vi.mock(".../config/normalization.js")` vivait ici. Les
// deux mocks au-dessus sont légitimes (`config-core.ts` importe bien `storage.js` et
// `profile.js`), celui-ci ne l'était pas : `normalization.ts` n'est importé que par
// `globals.config.ts` et `geojson/loader/data-mapping.ts`, dont aucun n'est chargé par
// ce test. Décoratif, retiré après preuve que la suite est inchangée sans lui.

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
