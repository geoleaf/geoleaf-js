#!/usr/bin/env node
/**
 * publish-plugins.cjs
 * Publishes plugin workspaces to their configured npm registry.
 * Usage: node scripts/publish-plugins.cjs [--dry-run]
 */
"use strict";

const { execSync } = require("child_process");
const registry = require("./lib/packages.cjs");

// Identified by npm NAME, not by workspace path (ARCHI S9.4). A name is the stable
// identity of a package: ARCHI S10 moves these directories under `packages/plugins/`
// and `npm publish --workspace=<name>` keeps working, where a path would not.
//
// ⚠️ This list is a POLICY, deliberately narrower than `registry.publishable()`
// (14 packages — mesuré le 09/08/2026 : 17 workspaces moins les 3 `private`, à savoir
// `@geoleaf/app`, `@geoleaf/build-config` et `@geoleaf/host-runtime`. Le « 15 » écrit ici
// jusque-là n'a jamais correspondu à rien de mesurable ; il se re-dérive en une ligne :
// `node -e "console.log(require('./scripts/lib/packages.cjs').publishable().length)"`).
// Publishing is externally visible and hard to walk back, so widening it is a decision to
// take explicitly — never a side effect of a package ceasing to be private. Note the
// divergence: the comment below says every plugin is MIT on npmjs, yet only these two are
// pushed by this script.
//
// 🛑 Roadmap `roadmap_passage-public-npm.md`, tâche 2.8 — décision du 09/08/2026, écrite ici
// pour qu'elle ne soit pas indiscernable d'un oubli. La tâche demandait de « dériver la
// politique de `packages.cjs` » : c'est EXACTEMENT le side-effect que le paragraphe ci-dessus
// interdit, et remplacer ce littéral par un appel de fonction élargirait la surface de
// publication de 2 à 14 paquets sans qu'aucune ligne ne porte la décision. **La liste reste
// écrite à la main.** L'élargissement aux 14 est prévu, mais il appartient à la tâche 10.5,
// où il est une décision de publication assumée — pas un effet de bord de refactorisation.
//
// Ce qui EST dérivé de `packages.cjs`, en revanche, c'est le CONTRÔLE de cohérence
// ci-dessous : un nom de cette liste qui cesserait d'exister doit faire JETER le script,
// jamais publier une liste plus courte en silence.
const PUBLISHED_PLUGINS = ["@geoleaf-plugins/offline-ui", "@geoleaf-plugins/editor"];
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

for (const workspace of PUBLISHED_PLUGINS) {
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
    } catch (err) {
        console.error(`✗ Failed to publish ${workspace}:`, err.message);
        process.exit(1);
    }
}
