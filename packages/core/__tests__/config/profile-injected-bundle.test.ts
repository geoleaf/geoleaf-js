/**
 * Witness — a profile handed over in the configuration costs zero requests.
 *
 * ## What this pins
 *
 * `boot({ config })` removes ONE request: the configuration itself. The profile resources
 * that follow are fetched by `ProfileManager.loadActiveProfileResources`, which has no
 * in-memory path at all. This file pins the path that gives it one.
 *
 * ⚠️ **The roadmap says this function "fetches unconditionally". That is false at the
 * letter**: it returns without a single request when `data.activeProfile` is absent
 * (`profile.ts`). What is missing is not a guard, it is a BRANCH — and writing a
 * guard where a branch is needed would have produced a green test over a broken path.
 *
 * ## Why the key carries TWO payloads
 *
 * `profile-bundle.json` does NOT contain `profile.json`: the bundle compiler writes
 * `_bundleVersion` plus the sections, and `_processBundle(bundle, profile, …)` takes the
 * profile as a SEPARATE second argument. Injecting "the bundle" alone would therefore leave
 * the `profile.json` request in place — the very request this is meant to remove. Hence
 * `{ profile, bundle }`, mirroring the two on-disk artefacts one to one.
 *
 * 🛑 **RED until the branch exists.** The loader is left REAL on purpose — mocking
 * `ProfileLoader` would prove the branch was called, not that a profile comes out of it.
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
    ConfigLoader: { fetchJson: (...args: unknown[]) => fetchJsonMock(...args) },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileManager } from "../../src/kernel/config/profile.js";

/** The two on-disk artefacts, reduced to what the assembly actually reads. */
const PROFILE = {
    id: "witness",
    files: { themes: "config/core/themes.json", layers: "config/core/layers.json" },
};
const BUNDLE = {
    _bundleVersion: "1.0",
    themes: { list: [{ id: "day", label: "Day" }] },
    layersFile: { layers: [{ id: "poi", type: "geojson" }] },
    layerConfigs: {},
};

describe("profile resources handed over in the configuration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchJsonMock.mockImplementation(() => {
            throw new Error(
                "WITNESS: a profile handed over in the configuration must cost no request"
            );
        });
    });

    it("assembles in memory and issues zero requests", async () => {
        ProfileManager.init({
            data: {
                activeProfile: "witness",
                profilesBasePath: "data/profiles",
                profileBundle: { profile: PROFILE, bundle: BUNDLE },
            },
        } as never);

        await expect(ProfileManager.loadActiveProfileResources({})).resolves.toBeDefined();

        expect(fetchJsonMock).not.toHaveBeenCalled();
        expect(ProfileManager.getActiveProfileId()).toBe("witness");
        expect(ProfileManager._activeProfile).toMatchObject({ themes: expect.anything() });
    });

    it("absent, the key changes nothing — the cascade stays the default path", async () => {
        ProfileManager.init({
            data: { activeProfile: "witness", profilesBasePath: "data/profiles" },
        } as never);

        // The cascade is reached, so the throwing stub fires — the outcome does not matter
        // here, only that the historical path was taken. That IS the point: without the key,
        // nothing changes.
        // Wrapped: without the key the cascade throws SYNCHRONOUSLY, so a `.catch()` on the
        // returned value is never reached — the call itself is what throws.
        await Promise.resolve()
            .then(() => ProfileManager.loadActiveProfileResources({}))
            .catch(() => undefined);
        expect(fetchJsonMock).toHaveBeenCalled();
    });
});
