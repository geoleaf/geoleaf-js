/**
 * Guard — the deployed profiles' cache token measures CONTENT, and nothing else.
 *
 * ## Why this guard exists
 *
 * Every profile resource is fetched with a `?t=<token>`, and outside debug mode that token was
 * the literal `0` — a FIXED URL. Measured on 06/09/2026 at an integrator whose server sends
 * `Cache-Control: max-age=604800`: the profile and every section it points to stayed pinned for
 * a WEEK in an already-open browser, a correctly-served setting staying invisible in the page.
 *
 * `build-deploy.cjs` now writes `data.profileVersion` into each deliverable, from
 * `lib/profile-fingerprint.cjs`. Two properties make that useful, and the SECOND is the one that
 * is easy to lose without anything turning red:
 *
 *   ① it changes when the content changes — otherwise it invalidates nothing;
 *   ② it does NOT change when the content does not — otherwise every deployment makes the
 *      browser and the service worker re-fetch a profile that did not move.
 *
 * A clock satisfies ① and fails ②, and would pass any test written only against ①. That is the
 * whole reason this file asserts both directions on the same tree.
 *
 * ## Why HERE, and why on a TEMP tree
 *
 * Same split as `capabilities/profile-switcher/profile-harvest.guard.test.ts`: the WRITE into a
 * shipped variant needs a `deploy/` on disk, absent from a fresh clone, so it is not asserted
 * here. What is asserted is the function that decides the token — pure, and therefore provable
 * without any build having run. As a unit test it sits on `ci:local`'s default path, where
 * `--e2e` gates never reach.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

const { profileContentFingerprint, SELF_REFERENTIAL } = createRequire(import.meta.url)(
    path.join(REPO, "scripts/lib/profile-fingerprint.cjs")
) as { profileContentFingerprint: (dir: string) => string; SELF_REFERENTIAL: string };

/** Builds a throwaway profiles tree from a path → content map. */
function makeTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gl-fingerprint-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, "utf-8");
    }
    return root;
}

const BASE = {
    "geoleaf.config.json": '{"data":{"activeProfile":"p1"}}',
    "p1/profile.json": '{"id":"p1","version":"1.3.0"}',
    "p1/config/core/ui.json": '{"showLegend":true}',
    "p1/profile-bundle.json": '{"_bundleVersion":"1.0","ui":{"showLegend":true}}',
};

describe("profileContentFingerprint — the cache token of a deployed profiles tree", () => {
    it("returns the same fingerprint for an unchanged tree (property ②)", () => {
        const dir = makeTree(BASE);
        expect(profileContentFingerprint(dir)).toBe(profileContentFingerprint(dir));
    });

    it("returns the same fingerprint for identical trees at DIFFERENT instants", () => {
        // The rebuild case: unchanged sources, output directory recreated. A fingerprint that
        // moved here would make every deployment re-fetch a profile that did not change.
        //
        // 🛑 The wait is not decoration, it was ADDED AFTER A MUTATION. The first version
        // compared two consecutive calls; replacing the digest with `Date.now()` left this
        // test GREEN — both calls landed in the same millisecond. It certified property ②
        // while being unable to tell it from its opposite. Crossing a millisecond is what
        // makes a clock discernible, and it is the only thing that does: a clock and a digest
        // differ only in time.
        const before = profileContentFingerprint(makeTree(BASE));
        const start = Date.now();
        while (Date.now() - start < 2) {
            /* cross a millisecond — without it, a clock would pass for a digest */
        }
        expect(profileContentFingerprint(makeTree(BASE))).toBe(before);
    });

    it("changes when a single BYTE changes (property ①)", () => {
        const before = profileContentFingerprint(makeTree(BASE));
        const after = profileContentFingerprint(
            makeTree({ ...BASE, "p1/config/core/ui.json": '{"showLegend":false}' })
        );
        expect(after).not.toBe(before);
    });

    it("changes when only the BUNDLE changes — the file that carried the defect", () => {
        // Outside debug mode a deployed profile loads ONLY its bundle: a fingerprint blind to
        // that file would let through exactly the case this mechanism exists for.
        const before = profileContentFingerprint(makeTree(BASE));
        const after = profileContentFingerprint(
            makeTree({ ...BASE, "p1/profile-bundle.json": '{"_bundleVersion":"1.0","ui":{}}' })
        );
        expect(after).not.toBe(before);
    });

    it("changes when a file is MOVED at identical content", () => {
        // The digest covers the path as much as the bytes: without it, moving a layer config
        // from one profile to another would leave the token still on a deployment that
        // genuinely differs.
        const before = profileContentFingerprint(makeTree(BASE));
        const moved = { ...BASE } as Record<string, string>;
        delete moved["p1/config/core/ui.json"];
        moved["p1/config/core/renamed.json"] = '{"showLegend":true}';
        expect(profileContentFingerprint(makeTree(moved))).not.toBe(before);
    });

    it("IGNORES the root config, which carries the token itself", () => {
        // Without this exclusion the function would be self-referential: the input would
        // depend on the output. The consequence is accepted and compensated elsewhere — that
        // one file must be served `no-cache`, which gate SC-05 requires of both recipes.
        const before = profileContentFingerprint(makeTree(BASE));
        const after = profileContentFingerprint(
            makeTree({ ...BASE, [SELF_REFERENTIAL]: '{"data":{"activeProfile":"AUTRE"}}' })
        );
        expect(after).toBe(before);
    });

    it("THROWS on a tree with nothing to hash — anti-constant", () => {
        // A digest over nothing is a CONSTANT: it satisfies the type, pins every client
        // forever, and never fails. Refusing is the only honest answer.
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gl-fingerprint-vide-"));
        expect(() => profileContentFingerprint(empty)).toThrow(/CONSTANTE/);
        expect(() => profileContentFingerprint(path.join(empty, "absent"))).toThrow(/CONSTANTE/);
        // A tree holding ONLY the excluded file counts as empty: there is nothing to measure.
        expect(() => profileContentFingerprint(makeTree({ [SELF_REFERENTIAL]: "{}" }))).toThrow(
            /CONSTANTE/
        );
    });

    it("returns a token that interpolates into a URL as-is", () => {
        // It travels into a query string with no re-encoding on the build side.
        const token = profileContentFingerprint(makeTree(BASE));
        expect(token).toMatch(/^[0-9a-f]{16}$/);
        expect(encodeURIComponent(token)).toBe(token);
    });
});
