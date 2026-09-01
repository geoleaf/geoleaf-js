#!/usr/bin/env node
/**
 * publish-plugins.cjs
 * Publishes plugin workspaces to their configured npm registry.
 * Usage: node scripts/publish-plugins.cjs [--dry-run]
 *
 * 🔏 PROVENANCE — a (re)publication SHOULD go through `.github/workflows/publish.yml`
 * (tag `v*` or workflow_dispatch), NOT this script at a terminal. The workflow carries
 * `id-token: write` and upgrades npm to >= 11.5.1, so trusted publishing AUTO-emits an
 * SLSA provenance attestation with NO flag — measured present on the packages published
 * that way, absent on those published by hand (a version is immutable, so provenance
 * cannot be added retroactively). Do NOT set `publishConfig.provenance: true` nor add
 * `--provenance` here: outside CI, `npm publish` then fails on "Provenance generation
 * not supported", breaking the manual EOTP fallback documented below. The provenance of
 * the hand-published packages resolves on their next real bump via the workflow.
 * Verify: `npm view <pkg> --json | jq .dist.attestations`.
 */
"use strict";

const { execSync } = require("child_process");
const registry = require("./lib/packages.cjs");
const { alreadyPublished } = require("./lib/npm-registry.cjs");

// Identified by npm NAME, not by workspace path. A name is the stable
// identity of a package: ARCHI S10 moves these directories under `packages/plugins/`
// and `npm publish --workspace=<name>` keeps working, where a path would not.
//
// ⚠️ This list is a POLICY, deliberately narrower than `registry.publishable()`
// (14 packages — measured on 2026-08-09: 17 workspaces minus the 3 `private` ones,
// namely `@geoleaf/app`, `@geoleaf/build-config` and `@geoleaf/host-runtime`. The
// "15" written here until then never matched anything measurable; it re-derives in
// one line:
// `node -e "console.log(require('./scripts/lib/packages.cjs').publishable().length)"`).
// Publishing is externally visible and hard to walk back, so widening it is a decision to
// take explicitly — never a side effect of a package ceasing to be private. Note the
// divergence: the comment below says every plugin is MIT on npmjs, yet only these two are
// pushed by this script.
//
// 🛑 Decision of 2026-08-09, written here so it is not indistinguishable from an
// oversight. The ask was to "derive the policy from `packages.cjs`": that is EXACTLY
// the side effect the paragraph above forbids, and replacing this literal with a
// function call would widen the publication surface from 2 to 14 packages with no
// line carrying the decision. **The list stays hand-written.** The widening to 14 was
// planned, as an assumed publication decision — not a refactoring side effect.
//
// ✅ **WIDENING EXECUTED on 2026-08-11 — Mattieu's decision.** The list goes from 2 to
// **12**, and it stays **hand-written**, name by name: the shape the paragraph above
// demands, and substituting `publishable().filter(…)` would have made the publication
// surface depend on a `private: true` someone removes elsewhere.
//
// ⚠️ **12 and not 14**: this script only publishes the PLUGINS. `@geoleaf/core` and
// `@geoleaf/field-renderer` publish separately and FIRST — the 12 declare the core at
// `^3.0.0`, and `editor` additionally declares `field-renderer`. Publishing them here
// would send them off before their dependencies.
//
// 📌 **The order among the 12 is indifferent, and that is measured**: no plugin
// depends on another plugin (0 inter-plugin edges as of 2026-08-11). The alphabetical
// order is thus not a publication order, it is a reading convenience.
//
// What IS derived from `packages.cjs`, however, is the coherence CHECK below: a name
// of this list that ceased to exist must make the script THROW, never publish a
// shorter list in silence.
// ✅ **SECOND WIDENING, 2026-09-01 — Mattieu's decision, asked for in those words.** The
// list goes from **12 to 15**: `navigation`, `position-share` and `routing` join it. Same
// shape as the first widening, and for the same reason — hand-written, name by name. The
// three were `publishable()` since they were written yet published by nothing, and an audit
// on 2026-08-31 first read that as a defect of the guard. **It was not**: the paragraphs
// above say in full that narrowness is a POLICY and that widening is a decision, never a
// side effect. The guard was doing exactly its job; what was missing was this line.
//
// 📌 The three were ready on their own terms before joining: `v1.0.0`, `@geoleaf/core` at
// `^3.0.0` (satisfied by the registry), `publishConfig.access: public`, `files[]`, MIT
// `LICENSE`. Nothing about them was bumped for this — joining the list is the whole change.
const PUBLISHED_PLUGINS = [
    "@geoleaf-plugins/cog",
    "@geoleaf-plugins/connector",
    "@geoleaf-plugins/editor",
    "@geoleaf-plugins/file-import",
    "@geoleaf-plugins/flatgeobuf",
    "@geoleaf-plugins/geocoding",
    "@geoleaf-plugins/measure",
    "@geoleaf-plugins/navigation",
    "@geoleaf-plugins/offline-ui",
    "@geoleaf-plugins/position-share",
    "@geoleaf-plugins/print",
    "@geoleaf-plugins/realtime-layer",
    "@geoleaf-plugins/routing",
    "@geoleaf-plugins/table",
    "@geoleaf-plugins/websocket",
];
const dryRun = process.argv.includes("--dry-run");

// Fail loudly if a name drifts, rather than publishing a shorter list in silence.
for (const name of PUBLISHED_PLUGINS) {
    const pkg = registry.byName(name);
    if (!pkg) {
        throw new Error(
            `publish-plugins: "${name}" is not a workspace package. Known: ${registry
                .all()
                .map((p) => p.name)
                .join(", ")}`
        );
    }
    if (pkg.private) {
        throw new Error(
            `publish-plugins: "${name}" is private:true — npm would refuse to publish it.`
        );
    }
}

/**
 * Is this package's version ALREADY on the registry?
 *
 * 🛑 **The widening from 2 to 12 is what makes this check necessary, not caution on
 * principle.** At two packages, a failure on the second is retaken by hand without a
 * thought. At twelve, a failure on the seventh leaves **six packages published** and
 * five not — and a simple re-run then died with
 * `403 You cannot publish over the previously published versions` on the first of the
 * six, never reaching the five left to do. The script became non-replayable at the
 * worst moment: in the middle of an irreversible operation.
 *
 * Here, a package already published at this version is **skipped while saying so**,
 * and the run continues.
 *
 * ⚠️ Do NOT mistake it for a green: skipping is not publishing. The final tally
 * separates the two, otherwise "12/12" would read as twelve publications when there
 * may have been only five.
 *
 * ✅ **The body now lives in `lib/npm-registry.cjs`** (2026-08-15), because a SECOND
 * caller was needed: the `@geoleaf/core` and `@geoleaf/field-renderer` steps of
 * `publish.yml` were bare `npm publish` calls and died in `E403` on an
 * already-published version — the workflow thus never reached the 12 plugins below.
 * Copying this body would have let two definitions of "already published" diverge, in
 * an irreversible move.
 */

let published = 0;
let skipped = 0;

for (const workspace of PUBLISHED_PLUGINS) {
    // 🛑 `.manifest.version`, and it is a FIX — this line read `.version`, which
    // `byName()` does not expose: it returned `undefined`, `npm view <name>@undefined`
    // failed, and `alreadyPublished()` thus ALWAYS concluded "not published".
    //
    // ⚠️ Consequence, measured on 2026-08-15: the replayability the twenty comment
    // lines above document **never worked**. A resume after partial failure would
    // have skipped nothing and died in `E403` on the first already-published package
    // — precisely the scenario this check exists to avoid. The guard had never been
    // seen biting, and it did not bite.
    const version = registry.byName(workspace).manifest.version;
    if (!dryRun && alreadyPublished(workspace, version)) {
        console.log(`\n↷ ${workspace}@${version} — DÉJÀ au registre, sauté (reprise de run).`);
        skipped++;
        continue;
    }
    console.log(`\n→ Publishing ${workspace}${dryRun ? " (dry-run)" : ""}…`);
    // --access public is explicit rather than inherited from publishConfig: every
    // plugin is MIT on npmjs since the all-MIT switch (04/07/2026), and a scoped
    // package defaults to restricted when the flag is absent.
    const cmd = dryRun
        ? `npm publish --workspace=${workspace} --access public --dry-run`
        : `npm publish --workspace=${workspace} --access public`;
    try {
        execSync(cmd, { stdio: "inherit" });
        console.log(`✓ ${workspace} published.`);
        published++;
    } catch (err) {
        console.error(`✗ Failed to publish ${workspace}:`, err.message);
        console.error(
            `\n  ${published} publié(s), ${skipped} sauté(s) avant cet échec, ` +
                `${PUBLISHED_PLUGINS.length - published - skipped - 1} non tenté(s).`
        );
        console.error(
            `  Le script est REJOUABLE : les paquets déjà au registre seront sautés.\n` +
                `  ⚠️ Si l'échec est \`EOTP\`, npm exige une confirmation 2FA. LE REMÈDE EST UNE\n` +
                `     VARIABLE, PAS UN CODE — relancer avec un navigateur nommé :\n` +
                `         BROWSER=wslview node scripts/publish-plugins.cjs\n` +
                `     npm ouvre alors un onglet de confirmation PAR PAQUET, on clique, il continue.\n` +
                `     \`BROWSER=echo\` marche aussi : npm imprime l'URL et attend, on la colle à la main.\n` +
                `     Sans variable, npm meurt sur « Set the BROWSER environment variable » — un\n` +
                `     message qui ne nomme ni EOTP ni 2FA, d'où la confusion.\n` +
                `     🛑 CE MESSAGE A ENVOYÉ CHERCHER UN AUTHENTICATOR JUSQU'AU 01/09/2026, et c'est\n` +
                `     sa TROISIÈME version fausse sur ce même sujet. Il disait « npm hérite du tty et\n` +
                `     pose la question — un code par paquet » : npm ne pose pas cette question, il\n` +
                `     propose un flux WEB. Mesuré ce jour-là, depuis un vrai terminal, en publiant 5\n` +
                `     paquets sans taper un seul code. La version d'avant le 12/08 disait l'inverse\n` +
                `     symétrique (« sans tty, ne peut pas y répondre »).\n` +
                `     📌 Ce qui RESTE vrai des versions précédentes : aucun type de jeton ne lève\n` +
                `     l'exigence de 2FA, et \`auth-only\` n'y change rien. Ce qui était faux, c'est la\n` +
                `     FORME que prend cette exigence.`
        );
        process.exit(1);
    }
}

// ⚠️ The tally SEPARATES published and skipped, deliberately: "12/12" on a resumed
// run would suggest twelve publications where there may have been only five.
console.log(
    `\n${dryRun ? "[dry-run] " : ""}${published} publié(s), ${skipped} déjà au registre ` +
        `(sauté), sur ${PUBLISHED_PLUGINS.length} plugin(s).`
);
