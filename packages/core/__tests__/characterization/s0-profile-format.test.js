/**
 * S0 characterization — standard profile / modular-vs-legacy detection (S3).
 *
 * Pins the CURRENT discriminator between the modular profile format and the
 * legacy flat format. Sprint S3 removes the legacy-format fallback path
 * (`useLegacyProfileData` flag + legacy loader); this test fixes the detection
 * contract so that removal is intentional, not silent.
 */

import { ProfileLoader } from "../../src/kernel/config/profile-loader.ts";

describe("S0 char — modular vs legacy profile detection (S3)", () => {
    it("treats a profile carrying a Files{} block as modular", () => {
        expect(ProfileLoader.isModularProfile({ Files: {} })).toBe(true);
    });

    it("treats version >= 1.2 as modular", () => {
        expect(ProfileLoader.isModularProfile({ version: "1.2" })).toBe(true);
        expect(ProfileLoader.isModularProfile({ version: "2.0.0" })).toBe(true);
    });

    it("treats a legacy flat profile (no Files, version < 1.2) as non-modular", () => {
        expect(ProfileLoader.isModularProfile({ version: "1.1" })).toBe(false);
        expect(ProfileLoader.isModularProfile({ layers: [] })).toBe(false);
    });

    it("returns false for null / undefined / non-object", () => {
        expect(ProfileLoader.isModularProfile(null)).toBe(false);
        expect(ProfileLoader.isModularProfile(undefined)).toBe(false);
        expect(ProfileLoader.isModularProfile("profile")).toBe(false);
    });
});
