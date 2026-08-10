#!/usr/bin/env node
/**
 * @fileoverview Purge les `dist/` de tous les workspaces AVANT un build — le versant
 * préventif de B-130.
 *
 * ## Pourquoi ce script existe
 *
 * `turbo run build` restaure son cache **sans vider `dist/` d'abord** (mesuré sur turbo
 * 2.9.18 au pré-vol de S6a : un canari posé à la main survit à un `FULL TURBO`). Deux jeux
 * de chunks capturés à des états d'entrée différents cohabitent alors, et le déployé
 * embarque les deux.
 *
 * ## Ce que ce script NE coûte PAS
 *
 * Purger `dist/` ne force **pas** un rebuild : turbo reste en cache HIT et restaure ses
 * artefacts dans un répertoire vide — donc en un seul exemplaire. Le coût est celui d'un
 * `rm -rf`, pas celui d'une compilation. C'est ce qui rend l'issue (b) du registre
 * acceptable en tête de chaque build plutôt que réservée au déploiement.
 *
 * ## Périmètre
 *
 * Dérivé de `scripts/lib/packages.cjs`, jamais d'un glob `packages/*​/dist` — qui ne matche
 * ni `packages/plugins/*` ni `packages/libs/*`. Un chemin en dur ne casse pas au
 * déplacement : il cesse silencieusement de matcher, et la purge sortirait en 0 sans avoir
 * rien purgé. `deploy/` n'est PAS purgé ici : il a son propre cycle
 * (`scripts/build-deploy.cjs` le nettoie par variante produite).
 *
 * @see _docs_projet/registres/backlog_technique.md § B-130
 * @see scripts/check-dist-integrity.cjs — le versant garde, qui rend le défaut visible
 */

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const quiet = process.argv.includes("--quiet");
const removed = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    if (!fs.existsSync(dist)) continue;
    fs.rmSync(dist, { recursive: true, force: true });
    removed.push(p.name);
}

// Anti-purge-vide : si le registre ne rend aucun paquet, le glob a cessé de matcher et la
// purge sort en 0 sans avoir rien fait — exactement le mode d'échec que `packages.cjs`
// existe pour empêcher. Un dépôt jamais buildé n'a légitimement aucun `dist/`, en revanche,
// donc c'est le REGISTRE qu'on vérifie, pas le nombre de suppressions.
if (packages.all().length === 0) {
    console.error("❌ [PURGE-DIST] le registre de paquets est VIDE — rien n'a été scanné.");
    process.exit(1);
}

if (!quiet) {
    console.log(
        `🧹 [PURGE-DIST] ${removed.length} dist/ supprimé(s) sur ${packages.all().length} paquet(s)` +
            (removed.length ? " : " + removed.join(", ") : " — rien à purger.")
    );
}
