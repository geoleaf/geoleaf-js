/**
 * @file taxonomy-symbol-prefix.guard.test.js
 * @description Guard test — no profile `svgId` repeats its own `symbolPrefix`.
 *
 * Why this guard exists (28/07/2026)
 * -----------------------------------------------------------------
 * `resolvePoiIcon` composes the MapLibre image id by CONCATENATION:
 *
 *     symbolPrefix + svgId   (+ "--" + tint, if any)
 *
 * A profile that writes the prefix **inside** `svgId` **and** declares it in
 * `icons.symbolPrefix` thus produces a doubled id —
 * `tourism-poi-cat-tourism-poi-cat-musee` — existing in no sprite. Rendering
 * raises nothing: `icon-image` points at an image never registered, and
 * **the glyph vanishes silently**.
 *
 * ## Not a precaution of principle: it already happened, at scale
 *
 * The `taxonomy` rework's CDC (v3.0.0, 14/07/2026, §13.1) noted the defect
 * on **three deployed profiles**, and not marginally: 11/11 broken
 * categories on one, 7/7 on the other two. Those profiles have since gone
 * (removal of the 6 demo profiles, `4967db6d`) — in other words **the defect
 * was never fixed, its subjects were deleted**. Nothing has therefore ever
 * prevented its reappearance.
 *
 * ## What the rule had as its only defence until now
 *
 * One sentence, in the capability's `configSchema` `description`
 * (`capabilities/taxonomy/taxonomy-capability.ts` → `icons.symbolPrefix`):
 * "Do NOT repeat it inside `svgId`". It is published to integrators by
 * `getCapabilitySchema('taxonomy')`, and that is fine — but a sentence
 * verifies nothing. Exactly the documentation regime the rework measures as
 * the only one to have failed in this repo.
 *
 * ## Why a TEST and not a `scripts/` script
 *
 * Same motive as `doc-plugin-manifest.guard.test.js`, and it is written
 * there in full: a new script is refused by `verify-repo-hygiene.cjs` /
 * `verify-ci-scripts-tracked.cjs` until git-tracked **and** enrolled in
 * `SCRIPTS_ALLOWLIST` — so `ci:local` stays red until the commit. A test
 * under `__tests__/guards/` enters the already-wired suite.
 *
 * ⚠️ **Nor does it join `validate-profiles.cjs`**, which would yet be the
 * natural place: that script is being modified by another work stream as
 * this guard is written. The day the two meet, this file may disappear in
 * favour of a rule there — the note is here so that is a decision and not an oversight.
 *
 * ## A guard never seen red guards nothing
 *
 * Three anti-empty-guard assertions: at least one profile found, at least
 * one non-empty `symbolPrefix`, at least one `svgId` read. Without them,
 * this guard would come out green the day `profiles/` moves, the key is
 * renamed, or no profile declares a prefix any more.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PROFILES_DIR = path.join(REPO_ROOT, "profiles");

/** Canonical location of a profile's `modules.taxonomy` block. */
const TAXONOMY_REL = path.join("config", "plugins", "taxonomy.json");

/**
 * The profiles present on disk — the list is not written, it is READ.
 *
 * `schemas/` is the only `profiles/` directory that is not a profile (it
 * carries the JSON schemas). It is set aside by the absence of
 * `config/plugins/taxonomy.json`, not by its name: a name-based filter would
 * stop protecting at the first rename.
 */
function readProfiles() {
    if (!fs.existsSync(PROFILES_DIR)) return [];
    return fs
        .readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ id: d.name, file: path.join(PROFILES_DIR, d.name, TAXONOMY_REL) }))
        .filter((p) => fs.existsSync(p.file))
        .map((p) => ({
            ...p,
            rel: `profiles/${p.id}/${TAXONOMY_REL.split(path.sep).join("/")}`,
            json: JSON.parse(fs.readFileSync(p.file, "utf8")),
        }));
}

/**
 * Harvests every `svgId` of a taxonomy block, at any depth.
 *
 * The harvest is RECURSIVE and not targeted at
 * `taxonomies.<name>.categories.<val>.svgId`: sub-categories carry them too,
 * and a future level would still. Aiming at the exact path would let this
 * guard come out green on half the deposit — the defect the original survey
 * precisely measured on the sub-categories.
 */
function collectSvgIds(node, out = []) {
    if (Array.isArray(node)) {
        for (const v of node) collectSvgIds(v, out);
        return out;
    }
    if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
            if (k === "svgId" && typeof v === "string") out.push(v);
            else collectSvgIds(v, out);
        }
    }
    return out;
}

const PROFILES = readProfiles();

describe("test-garde — aucun `svgId` de profil ne répète son `symbolPrefix`", () => {
    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("trouve au moins un profil portant un bloc taxonomy (sinon ce garde ne garde rien)", () => {
        expect(
            PROFILES.length,
            `aucun ${TAXONOMY_REL} sous ${PROFILES_DIR} — le répertoire a-t-il bougé ?`
        ).toBeGreaterThan(0);
    });

    it("trouve au moins un `symbolPrefix` non vide, tous profils confondus", () => {
        const withPrefix = PROFILES.filter(
            (p) => typeof p.json?.icons?.symbolPrefix === "string" && p.json.icons.symbolPrefix
        );
        expect(
            withPrefix.length,
            "aucun profil ne déclare `icons.symbolPrefix` : la clé a-t-elle été renommée ?"
        ).toBeGreaterThan(0);
    });

    it("lit au moins un `svgId`, tous profils confondus", () => {
        const total = PROFILES.reduce((n, p) => n + collectSvgIds(p.json).length, 0);
        expect(
            total,
            "aucun `svgId` récolté : la forme du bloc `taxonomies` a-t-elle changé ?"
        ).toBeGreaterThan(0);
    });

    PROFILES.forEach((profile) => {
        const prefix = profile.json?.icons?.symbolPrefix;
        if (typeof prefix !== "string" || prefix.length === 0) return;

        it(`${profile.rel} — aucun \`svgId\` ne commence par \`${prefix}\``, () => {
            const doubled = collectSvgIds(profile.json).filter((id) => id.startsWith(prefix));
            expect(
                doubled,
                doubled.length === 0
                    ? ""
                    : `${profile.rel} — ${doubled.length} \`svgId\` répètent le préfixe \`${prefix}\`, ` +
                          `ce qui produit un identifiant d'image DOUBLÉ (\`${prefix}${doubled[0]}\`) que le sprite ne contient pas. ` +
                          `L'icône disparaît SANS ERREUR. Retirer le préfixe des \`svgId\` : ${doubled.join(", ")}`
            ).toEqual([]);
        });
    });
});
