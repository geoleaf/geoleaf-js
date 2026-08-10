/**
 * Config-contract Phase C / C1 — B1 root family: geoleaf.config.json `data.*`.
 *
 * Per-value verification of the profile/data resolution in config/profile.ts:
 *   - data.enableProfilePoiMapping + legacy aliases useProfilePoiMapping/useMapping
 *     (canonical key + fallback precedence + code default `true`) — ANO-020/021
 *   - data.activeProfile gating + data.profilesBasePath baseUrl (default
 *     "data/profiles") — ANO-022
 *
 * Consumer: packages/core/src/kernel/config/profile.ts. Inventory B1.
 * (Mock scaffolding mirrors __tests__/config/profile.test.js.)
 */

const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const fetchJsonMock = vi.fn();
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { fetchJson: (...args) => fetchJsonMock(...args) },
}));

vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: {
        normalizePoiWithMapping: vi.fn((x) => x),
    },
}));

const isModularProfileMock = vi.fn(() => false);
vi.mock("../../src/kernel/config/profile-loader.js", () => ({
    ProfileLoader: {
        isModularProfile: (...args) => isModularProfileMock(...args),
        loadModularProfile: vi.fn(),
    },
}));

import { ProfileManager } from "../../src/kernel/config/profile.js";

describe("config B1 — data.* (config/profile.ts)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isModularProfileMock.mockReturnValue(false);
    });

    // ── data.enableProfilePoiMapping + legacy aliases (ANO-020/021) ──────────
    describe("isProfilePoiMappingEnabled — enableProfilePoiMapping + aliases", () => {
        it("defaults to true when data.* is absent (code default — ANO-021)", () => {
            ProfileManager.init({});
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
            ProfileManager.init({ data: {} });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        it("enableProfilePoiMapping is the canonical key (true / false)", () => {
            ProfileManager.init({ data: { enableProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
            ProfileManager.init({ data: { enableProfilePoiMapping: true } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        it("legacy alias useProfilePoiMapping is honoured as fallback (ANO-020)", () => {
            ProfileManager.init({ data: { useProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        it("legacy alias useMapping is honoured as fallback (ANO-020)", () => {
            ProfileManager.init({ data: { useMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        it("enableProfilePoiMapping wins over the legacy aliases (precedence)", () => {
            ProfileManager.init({
                data: {
                    enableProfilePoiMapping: true,
                    useProfilePoiMapping: false,
                    useMapping: false,
                },
            });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });
    });

    // ── data.activeProfile gating + data.profilesBasePath baseUrl (ANO-022) ──
    describe("loadActiveProfileResources — activeProfile + profilesBasePath", () => {
        it("no activeProfile → resolves current config, never fetches", async () => {
            const cfg = { data: {} };
            ProfileManager.init(cfg);
            const out = await ProfileManager.loadActiveProfileResources({});
            expect(out).toBe(cfg);
            expect(fetchJsonMock).not.toHaveBeenCalled();
        });

        it("profilesBasePath defaults to 'data/profiles' in the baseUrl (ANO-022)", async () => {
            ProfileManager.init({ data: { activeProfile: "p1" } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(mockLog.info).toHaveBeenCalledWith(
                "[GeoLeaf.Config.Profile] Starting profile load:",
                expect.objectContaining({ baseUrl: "data/profiles/p1" })
            );
        });

        it("explicit profilesBasePath is used to build the baseUrl", async () => {
            ProfileManager.init({ data: { activeProfile: "p1", profilesBasePath: "../profiles" } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(mockLog.info).toHaveBeenCalledWith(
                "[GeoLeaf.Config.Profile] Starting profile load:",
                expect.objectContaining({ baseUrl: "../profiles/p1" })
            );
        });
    });
});
