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
// ✅ **ÉLARGISSEMENT EXÉCUTÉ le 11/08/2026 — tâche 10.5, décision de Mattieu.** La liste passe
// de 2 à **12**, et elle reste **écrite à la main**, nom par nom : c'est la forme que le
// paragraphe ci-dessus exige, et la substituer par `publishable().filter(…)` aurait rendu la
// surface de publication dépendante d'un `private: true` qu'on retire ailleurs.
//
// ⚠️ **12 et non 14** : ce script ne publie que les PLUGINS. `@geoleaf/core` (tâche 10.3) et
// `@geoleaf/field-renderer` (10.4) se publient séparément et AVANT — les 12 déclarent le core
// en `^3.0.0`, et `editor` déclare en plus `field-renderer`. Les publier ici les ferait partir
// avant leurs dépendances.
//
// 📌 **L'ordre entre les 12 est indifférent, et c'est mesuré** : aucun plugin ne dépend d'un
// autre plugin (0 arête inter-plugins au 11/08/2026). L'ordre alphabétique n'est donc pas un
// ordre de publication, c'est une commodité de lecture.
//
// Ce qui EST dérivé de `packages.cjs`, en revanche, c'est le CONTRÔLE de cohérence
// ci-dessous : un nom de cette liste qui cesserait d'exister doit faire JETER le script,
// jamais publier une liste plus courte en silence.
const PUBLISHED_PLUGINS = [
    "@geoleaf-plugins/cog",
    "@geoleaf-plugins/connector",
    "@geoleaf-plugins/editor",
    "@geoleaf-plugins/file-import",
    "@geoleaf-plugins/flatgeobuf",
    "@geoleaf-plugins/geocoding",
    "@geoleaf-plugins/measure",
    "@geoleaf-plugins/offline-ui",
    "@geoleaf-plugins/print",
    "@geoleaf-plugins/realtime-layer",
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
 * La version de ce paquet est-elle DÉJÀ sur le registre ?
 *
 * 🛑 **C'est l'élargissement de 2 à 12 qui rend ce contrôle nécessaire, pas une prudence de
 * principe.** À deux paquets, un échec au second se reprend à la main sans y penser. À douze,
 * un échec au septième laisse **six paquets publiés** et cinq non — et un simple re-run mourait
 * alors en `403 You cannot publish over the previously published versions` sur le premier des
 * six, sans jamais atteindre les cinq qui restent à faire. Le script devenait non rejouable au
 * pire moment : au milieu d'une opération irréversible.
 *
 * Ici, un paquet déjà publié à cette version est **sauté en le disant**, et le run continue.
 *
 * ⚠️ Ne PAS confondre avec un vert : sauter n'est pas publier. Le décompte final distingue les
 * deux, sans quoi « 12/12 » se lirait comme douze publications alors qu'il pourrait n'y avoir
 * eu que cinq.
 *
 * @param {string} name Nom npm du paquet.
 * @param {string} version Version déclarée dans son manifeste.
 * @returns {boolean} `true` si le registre porte déjà exactement cette version.
 */
function alreadyPublished(name, version) {
    try {
        const out = execSync(`npm view ${name}@${version} version --json`, {
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        }).trim();
        return out.length > 0 && out !== "undefined";
    } catch {
        // `npm view` sort en erreur sur un E404 — le paquet ou la version n'existe pas.
        return false;
    }
}

let published = 0;
let skipped = 0;

for (const workspace of PUBLISHED_PLUGINS) {
    const version = registry.byName(workspace).version;
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
                `  ⚠️ Si l'échec est un OTP demandé, le 2FA du compte est en \`auth-and-writes\` —\n` +
                `     ce script publie par \`execSync\` sans TTY et ne peut pas y répondre.\n` +
                `     Voir \`npm profile enable-2fa auth-only\`.`
        );
        process.exit(1);
    }
}

// ⚠️ Le décompte SÉPARE publiés et sautés, délibérément : « 12/12 » sur une reprise de run
// laisserait croire à douze publications là où il n'y en a peut-être eu que cinq.
console.log(
    `\n${dryRun ? "[dry-run] " : ""}${published} publié(s), ${skipped} déjà au registre ` +
        `(sauté), sur ${PUBLISHED_PLUGINS.length} plugin(s).`
);
