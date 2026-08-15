#!/usr/bin/env node
/**
 * publish-one.cjs — publie UN workspace nommé, en sautant ce que le registre porte déjà.
 *
 * Usage : node scripts/publish-one.cjs <nom-npm> [--dry-run]
 *
 * ## Pourquoi ce script existe, et pourquoi PAS dans `publish-plugins.cjs`
 *
 * `publish.yml` publie `@geoleaf/core` puis `@geoleaf/field-renderer` AVANT les 12 plugins —
 * les 12 déclarent le core en `^3.0.0`, et `editor` déclare en plus `field-renderer`. Ces deux
 * étapes étaient des `npm publish` NUS : sur une version déjà au registre, npm rend `E403` et
 * le workflow meurt à sa première étape, sans jamais atteindre ce qu'il existe pour publier.
 * Mesuré le 15/08/2026, avec `core@3.0.0` et `field-renderer@1.0.0` publiés depuis le 12/08.
 *
 * 🛑 CE N'EST PAS UN ÉLARGISSEMENT DE `publish-plugins.cjs`, et c'est délibéré. Sa liste
 * `PUBLISHED_PLUGINS` est une POLITIQUE écrite à la main, et son en-tête interdit
 * explicitement de l'élargir par effet de bord de refactorisation — « publishing is externally
 * visible and hard to walk back ». Publier le core par un script nommé « publish-plugins »,
 * ou lui ajouter un `--only` capable de viser hors liste, contournerait cette règle au lieu de
 * la respecter. Ce script prend donc son sujet EN ARGUMENT, sans liste à élargir.
 *
 * ⚠️ Il n'est pas un raccourci pour publier n'importe quoi : il refuse un workspace inconnu de
 * `packages.cjs`, et un workspace `private`.
 */
"use strict";

const { execSync } = require("child_process");
const registry = require("./lib/packages.cjs");
const { alreadyPublished } = require("./lib/npm-registry.cjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const name = args.find((a) => !a.startsWith("--"));

    if (!name) {
        console.error(`${C.r}✗ usage : node scripts/publish-one.cjs <nom-npm> [--dry-run]${C.x}`);
        process.exit(1);
    }

    // Refus d'un sujet inconnu : `npm publish --workspace=<inconnu>` échouerait de toute façon,
    // mais bien plus loin et avec un message qui ne nomme pas la cause.
    const pkg = registry.byName(name);
    if (!pkg) {
        console.error(`${C.r}✗ \`${name}\` n'est pas un workspace de ce dépôt.${C.x}`);
        process.exit(1);
    }
    if (pkg.private) {
        console.error(
            `${C.r}✗ \`${name}\` est \`private\` — il n'a rien à faire au registre.${C.x}`
        );
        process.exit(1);
    }

    // 🛑 `pkg.manifest.version`, PAS `pkg.version` — `byName()` rend
    // `{name, dir, absDir, dirName, private, manifest}` et n'expose AUCUN `version` à la
    // racine. Lire `pkg.version` rend `undefined`, `npm view <nom>@undefined` échoue, la
    // détection conclut « pas publié » et le script publie ce qu'il devait sauter. C'est
    // exactement le défaut qui vivait dans `publish-plugins.cjs` (voir là-bas).
    const { version } = pkg.manifest;

    if (!dryRun && alreadyPublished(name, version)) {
        // ⚠️ Sauté, PAS publié — et il faut que la sortie le dise, sinon un run vert se lit
        // comme une publication qui n'a pas eu lieu.
        console.log(`${C.y}↷ ${name}@${version} — DÉJÀ au registre, sauté (reprise de run).${C.x}`);
        process.exit(0);
    }

    console.log(`→ Publishing ${name}@${version}${dryRun ? " (dry-run)" : ""}…`);
    // `--access public` explicite plutôt qu'hérité de `publishConfig` : un paquet scopé part
    // en `restricted` quand le drapeau est absent.
    const cmd = `npm publish --workspace=${name} --access public${dryRun ? " --dry-run" : ""}`;
    try {
        execSync(cmd, { stdio: "inherit" });
    } catch {
        console.error(`${C.r}✗ ${name}@${version} — publication ÉCHOUÉE.${C.x}`);
        process.exit(1);
    }
    console.log(`${C.g}✓ ${name}@${version} publié.${C.x}`);
}

main();
