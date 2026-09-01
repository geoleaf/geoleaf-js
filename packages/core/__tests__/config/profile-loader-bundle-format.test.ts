/**
 * The bundle format version is CONFRONTED, not merely written.
 *
 * The build stamps `_bundleVersion` into every profile bundle. For months nothing read it —
 * and the comment beside the writer asserted that something did, which is how the field
 * survived a purge that removed its neighbour for exactly the reason it should itself have
 * been removed. This suite is the other half: it holds the reader to its promise.
 *
 * ⚠️ A stale bundle is not hypothetical. The bundle is pre-cached by the service worker, so a
 * browser can hold one produced by an earlier deployment. The reader therefore WARNS and
 * continues rather than refusing: refusing would turn a cached bundle into a blank map, which
 * is worse than a profile assembled from a format we half-understand. What the guard asserts is
 * that a mismatch stops being invisible — not that it becomes fatal.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const { ProfileLoader } = await import("../../src/kernel/config/profile-loader.ts");

// 🛑 The expected version comes from the PRODUCER, never the reader.
// Rereading it from the reader would amount to exercising it against its own
// constant — a test that would pass whatever the real agreement between
// build and runtime, i.e. the only thing to verify here.
const { BUNDLE_VERSION } = createRequire(import.meta.url)(
    path.join(REPO, "scripts/lib/bundle-profiles.cjs")
);

/** Minimal payload: enough shape for `_processBundle` to run to completion. */
const bundleWith = (version?: string) => ({
    ...(version === undefined ? {} : { _bundleVersion: version }),
    _profileId: "fixture",
    layersFile: { layers: [] },
    layerConfigs: {},
});

const profile = { id: "fixture", Files: {} };

/** Runs the reader and returns only what it said about the format. */
function warningsFor(version?: string) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ProfileLoader._processBundle(bundleWith(version), profile, "/profiles/fixture", "fixture");
    const hits = warn.mock.calls
        .map((c) => c.map(String).join(" "))
        .filter((m) => m.includes("bundle format"));
    warn.mockRestore();
    return hits;
}

describe("bundle format version", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("says nothing when the build's own format is what the loader receives", () => {
        expect(warningsFor(BUNDLE_VERSION)).toEqual([]);
    });

    it("names the mismatch — and names the likely cause — on an older format", () => {
        const hits = warningsFor("0.9");
        expect(hits).toHaveLength(1);
        expect(hits[0]).toContain("0.9");
        expect(hits[0]).toContain(BUNDLE_VERSION);
        // The cause matters as much as the fact: without it a reader hunts in the build.
        expect(hits[0]).toMatch(/service worker/i);
    });

    it("says nothing when the field is absent — a bundle predating the field is not a mismatch", () => {
        expect(warningsFor(undefined)).toEqual([]);
    });

    it("WARNS and continues: the profile is still assembled", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const out = ProfileLoader._processBundle(
            bundleWith("0.9"),
            profile,
            "/profiles/fixture",
            "fixture"
        );
        warn.mockRestore();
        expect(out).toBeTruthy();
        expect(typeof out).toBe("object");
    });
});
