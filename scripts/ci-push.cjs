#!/usr/bin/env node
"use strict";
/**
 * ci-push.cjs — `ci:local`, mais dans les CONDITIONS du runner. Le vert qui autorise un push.
 *
 * ## Le problème qu'il résout, et pourquoi `ci:local` ne pouvait pas le résoudre
 *
 * « Si c'est vert en local, c'est vert au push » n'a jamais été vrai sur ce dépôt. La cause
 * n'était pas la LISTE des gates — elle est en parité, et `verify-ci-parity.cjs` le vérifie.
 * C'est que `ci:local` ne tourne pas dans les mêmes conditions que la CI, sur cinq axes
 * mesurés le 01/08/2026 :
 *
 *   • **il rejoue des verdicts en cache** — 19 HIT / 22 tâches de typecheck, 32 / 36 de test,
 *     sur 4,3 Go de `.turbo`. La CI n'a AUCUN cache (`grep -c actions/cache ci.yml` → 0). Un
 *     vert local ne disait donc pas « les contrôles sont passés » mais « ils sont passés un
 *     jour, et turbo croit que rien n'a bougé » ;
 *   • **il voit des fichiers git-ignorés** que le runner n'aura jamais. `connector.local.js`,
 *     présent sur le poste depuis juin, rendait 8 specs E2E vertes ici et rouges là-bas —
 *     pendant des mois, sans que rien ne puisse le montrer ;
 *   • **son `node_modules` est accrété** par des `npm install` successifs, pas reconstruit ;
 *   • **`process.env.CI` est absent** — or `log.test.js` a un `test.skipIf(CI)` qui CHANGE la
 *     couverture mesurée, et `playwright.config.js` change `retries` et `forbidOnly` ;
 *   • **le fuseau diffère** — `new Date(2026, 6, 23)` n'est pas le même instant ici et en UTC.
 *
 * Aucun de ces cinq axes ne se ferme en ajoutant une gate. Ils se ferment en changeant les
 * CONDITIONS. C'est tout ce que fait ce script.
 *
 * ## Ce qu'il fait
 *
 *   1. `git worktree add --detach` sur HEAD → SEULS les fichiers commités
 *   2. un TÉMOIN : la chambre doit être vide de tout fichier ignoré/non suivi, sinon elle
 *      n'est pas propre et le verdict ne vaudrait rien
 *   3. `npm ci` → l'arbre du lockfile
 *   4. `ci-local.cjs` avec `CI=true`, `TZ=UTC`, `TURBO_FORCE=true`
 *   5. suppression du worktree, y compris en cas d'erreur
 *
 * ## ⚠️ Ce qu'il NE ferme PAS — à savoir avant de croire son vert
 *
 *   • **le parallélisme** : ce poste a plus de cœurs qu'un runner GitHub (2-4), et
 *     `maxWorkers` en dépend. Une panne sensible à la charge se manifeste à des taux
 *     différents des deux côtés, par construction ;
 *   • **les audits réseau** : `npm audit` rend un verdict fonction de la base d'avis À
 *     L'INSTANT T, pas du commit ;
 *   • **la version du navigateur** : la CI fait `playwright install` à chaque run, le poste
 *     utilise son cache ;
 *   • **la mineure de Node** : `.nvmrc` ne pin qu'une majeure.
 *
 * Ces quatre-là sont hors d'atteinte d'un poste, et le script les ÉNONCE en fin de run
 * plutôt que de laisser croire à une garantie totale.
 *
 * Usage :
 *   node scripts/ci-push.cjs            # les gates du mode par défaut
 *   node scripts/ci-push.cjs --e2e      # + les 4 étapes E2E (ce que la CI lance vraiment)
 *   node scripts/ci-push.cjs --keep     # ne supprime pas la chambre (diagnostic)
 *
 * Sortie : 0 si tout passe dans les conditions du runner, 1 sinon.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const KEEP = process.argv.includes("--keep");
const PASS_THROUGH = process.argv.slice(2).filter((a) => a !== "--keep");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    b: "\x1b[1m",
    x: "\x1b[0m",
};

const run = (cmd, args, opts = {}) =>
    spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });

/** Chemins que la chambre ne doit PAS contenir : c'est la propriété qu'on vend. */
function assertCleanRoom(dir) {
    const res = run("git", ["status", "--porcelain", "--ignored=matching"], { cwd: dir });
    if (res.status !== 0) {
        throw new Error(`la chambre ne répond pas à git — ${(res.stderr || "").trim()}`);
    }
    const lines = (res.stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        // `node_modules/` apparaîtra APRÈS `npm ci` ; ce témoin tourne AVANT.
        .filter((l) => !/^!! node_modules\//.test(l));
    if (lines.length) {
        throw new Error(
            `la chambre n'est pas propre — ${lines.length} entrée(s) non suivie(s) ou ignorée(s) :\n` +
                lines
                    .slice(0, 10)
                    .map((l) => `      ${l}`)
                    .join("\n")
        );
    }
}

function main() {
    console.log(`${C.b}── CI-PUSH — ci:local dans les conditions du runner ──${C.x}`);

    // Ce qui sera VÉRIFIÉ est HEAD, pas le worktree. Une modification non commitée ne sera
    // pas testée, et un vert obtenu ici ne dirait rien d'elle : on le dit avant de partir.
    const dirty = run("git", ["status", "--porcelain"]).stdout.trim();
    if (dirty) {
        const n = dirty.split("\n").length;
        console.log(
            `  ${C.y}⚠ ${n} fichier(s) modifié(s) NON COMMITÉS — ils ne seront pas testés.${C.x}`
        );
        console.log(
            `  ${C.d}Ce run porte sur HEAD, c'est-à-dire sur ce qui partira au push.${C.x}`
        );
        // ⚠️ CONSÉQUENCE NON ÉVIDENTE, mesurée le 01/08/2026 : les gates de FRAÎCHEUR
        // d'artefact généré (`docs:tree:check`, `gen:*:check`) peuvent rougir ICI alors
        // qu'elles sont vertes sur le poste. Leurs générateurs parcourent le DISQUE —
        // `lib/source-inventory.cjs` fait `readdirSync`, jamais `git ls-files` — donc
        // l'artefact commité a été produit depuis un worktree SALE. La chambre, elle, ne voit
        // que HEAD. Écart mesuré ce jour-là : **+251 lignes sur 6 fichiers**, tous modifiés
        // par des sessions concurrentes et non commités.
        //
        // Ce n'est PAS un faux positif : c'est le constat exact que l'artefact commité ne
        // correspond pas à HEAD seul. Mais ça ne se répare pas en régénérant — voir B-102.
        console.log(
            `  ${C.d}    ⚠ Les gates de fraîcheur d'artefact généré peuvent rougir pour cette\n` +
                `      seule raison : leurs générateurs lisent le DISQUE, pas l'index (B-102).${C.x}`
        );
    }

    const head = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-cipush-"));
    let ok = false;

    try {
        console.log(`  chambre : ${C.d}${dir}${C.x}`);
        console.log(`  commit  : ${C.b}${head}${C.x}\n`);

        const add = run("git", ["worktree", "add", "--detach", "--quiet", dir, "HEAD"]);
        if (add.status !== 0) {
            throw new Error(`git worktree add a échoué — ${(add.stderr || "").trim()}`);
        }

        // TÉMOIN — sans lui, une chambre accidentellement polluée rendrait un vert qui vaut
        // exactement autant que celui de `ci:local`, et personne ne le saurait.
        assertCleanRoom(dir);
        console.log(`  ${C.g}✓${C.x} témoin : aucun fichier ignoré ni non suivi dans la chambre`);

        console.log(`\n${C.c}── npm ci ──${C.x}`);
        const ci = run("npm", ["ci"], { cwd: dir, stdio: "inherit" });
        if (ci.status !== 0) {
            throw new Error(
                "`npm ci` a échoué dans la chambre. C'est un défaut RÉEL : la CI fera " +
                    "exactement la même chose sur un clone frais."
            );
        }

        console.log(`\n${C.c}── ci:local (CI=true, TZ=UTC, TURBO_FORCE=true) ──${C.x}`);
        const gates = run("node", ["scripts/ci-local.cjs", ...PASS_THROUGH], {
            cwd: dir,
            stdio: "inherit",
            env: {
                ...process.env,
                CI: "true",
                TZ: "UTC",
                // Le worktree n'a de toute façon aucun `.turbo`, mais une configuration de
                // cache globale rendrait la ceinture utile — et elle ne coûte rien.
                TURBO_FORCE: "true",
            },
        });
        ok = gates.status === 0;
    } catch (err) {
        console.log(`\n${C.r}✗ CI-PUSH — la chambre n'a pas pu conclure${C.x}`);
        console.log(`  ${err.message}`);
    } finally {
        if (KEEP) {
            console.log(`\n${C.d}chambre conservée (--keep) : ${dir}${C.x}`);
            console.log(`${C.d}la retirer : git worktree remove --force ${dir}${C.x}`);
        } else {
            run("git", ["worktree", "remove", "--force", dir]);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    // ⚠️ L'ÉNONCIATION EST OBLIGATOIRE, même sur un vert. Un « tout est couvert » serait un
    // sur-énoncé, et c'est exactement le défaut que ce script existe pour ne pas répéter.
    console.log(`\n  ${C.y}⚠ Ce que la chambre propre ne couvre PAS :${C.x}`);
    for (const line of [
        `parallélisme — ce poste a ${os.availableParallelism ? os.availableParallelism() : "?"} cœurs, un runner GitHub 2 à 4`,
        "audits réseau — `npm audit` juge la base d'avis à l'instant T, pas le commit",
        "navigateur — la CI fait `playwright install` à chaque run, le poste utilise son cache",
        "Node — `.nvmrc` ne pin qu'une majeure (22), la mineure du runner flotte",
    ]) {
        console.log(`      ${C.d}• ${line}${C.x}`);
    }

    if (ok) {
        console.log(`\n${C.g}✓ CI-PUSH — vert dans les conditions du runner, sur ${head}.${C.x}`);
        process.exit(0);
    }
    console.log(`\n${C.r}✗ CI-PUSH — NE PAS POUSSER.${C.x}`);
    console.log(
        `  ${C.d}Un échec ici est un échec que la CI aurait rencontré, pour un run de quota.${C.x}`
    );
    process.exit(1);
}

if (require.main === module) {
    main();
}
