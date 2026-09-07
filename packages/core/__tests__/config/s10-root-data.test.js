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

        it("profilesBasePath defaults to 'profiles' in the baseUrl (ANO-022, aligned 25/08/2026)", async () => {
            // The historic default here was "data/profiles" while every other reader of the
            // key fell back to "profiles" — profile fetched from one directory, layers
            // resolved from another. The set of allowed defaults is pinned by
            // guards/profiles-base-path-defaults.guard.test.ts.
            ProfileManager.init({ data: { activeProfile: "p1" } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(mockLog.info).toHaveBeenCalledWith(
                "[GeoLeaf.Config.Profile] Starting profile load:",
                expect.objectContaining({ baseUrl: "profiles/p1" })
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

    // ── data.profileVersion — the cache token of every profile resource ──────
    //
    // Nothing asserted the `?t=` parameter before this block: the token could have been
    // dropped, inverted or left to a clock without a single test moving. The four cases
    // below pin the whole decision — default, declared, debug precedence, encoding.
    describe("loadActiveProfileResources — data.profileVersion (cache token)", () => {
        const firstUrl = () => fetchJsonMock.mock.calls[0][0];

        it("nothing declared → the historical fixed URL, ?t=0", async () => {
            ProfileManager.init({ data: { activeProfile: "p1" } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).toBe("profiles/p1/profile.json?t=0");
        });

        it("declared → the URL carries it verbatim", async () => {
            ProfileManager.init({ data: { activeProfile: "p1", profileVersion: "a1b2c3d" } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).toBe("profiles/p1/profile.json?t=a1b2c3d");
        });

        it("a numeric revision is carried as well", async () => {
            ProfileManager.init({ data: { activeProfile: "p1", profileVersion: 42 } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).toBe("profiles/p1/profile.json?t=42");
        });

        it("null falls back to the default, it does not stringify", async () => {
            // The store is populated programmatically by the host, which bypasses schema
            // validation: a `x || null` upstream must not become the token `"null"`.
            ProfileManager.init({ data: { activeProfile: "p1", profileVersion: null } });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).toBe("profiles/p1/profile.json?t=0");
        });

        it("debug: true takes precedence over a declared fingerprint", async () => {
            // Debug is a debugging mode: it must keep defeating every cache, including one a
            // correct fingerprint would legitimately let stand.
            ProfileManager.init({
                debug: true,
                data: { activeProfile: "p1", profileVersion: "a1b2c3d" },
            });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).not.toContain("a1b2c3d");
            expect(firstUrl()).toMatch(/^profiles\/p1\/profile\.json\?t=\d{13}$/);
        });

        it("a fingerprint carrying reserved characters comes out percent-encoded", async () => {
            // Unencoded, `&` would open a second query parameter and `#` would truncate the
            // URL at the fragment — the request would silently target another resource.
            ProfileManager.init({
                data: { activeProfile: "p1", profileVersion: "v1 &x#y/z" },
            });
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(firstUrl()).toBe("profiles/p1/profile.json?t=v1%20%26x%23y%2Fz");
        });

        it("the token reaches the modular loader, which fans it out to the sections", async () => {
            const { ProfileLoader } = await import("../../src/kernel/config/profile-loader.js");
            isModularProfileMock.mockReturnValue(true);
            ProfileLoader.loadModularProfile.mockResolvedValue({ layers: [] });
            ProfileManager.init({ data: { activeProfile: "p1", profileVersion: "a1b2c3d" } });
            fetchJsonMock.mockResolvedValue({ version: "1.2" });
            await ProfileManager.loadActiveProfileResources({});
            expect(ProfileLoader.loadModularProfile).toHaveBeenCalledWith(
                expect.anything(),
                "profiles/p1",
                "p1",
                "a1b2c3d",
                expect.anything(),
                false
            );
        });
    });
});
