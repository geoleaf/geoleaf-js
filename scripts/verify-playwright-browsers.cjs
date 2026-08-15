/*!
 * GeoLeaf — préambule E2E : les navigateurs de Playwright sont-ils réellement là ?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Le défaut que cette garde existe pour rendre BRUYANT (B-235)
 *
 * Le 13/08/2026, `npx playwright test` ne lançait **aucun** test :
 *
 *     browserType.launch: Executable doesn't exist at
 *       ~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/…
 *
 * `ebb962b7` avait porté `@playwright/test` de `^1.49.0` à `^1.62.1` — une montée **délibérée**,
 * reprise de PR Dependabot — et la révision de navigateur requise était passée de 1217 à 1234.
 * Rien ne les avait réinstallés.
 *
 * 🛑 **L'ASYMÉTRIE EST CE QUI REND CETTE GARDE NÉCESSAIRE, ET ELLE SE COMPOSE AU PIRE.**
 * `ci.yml` lance `npx playwright install --with-deps chromium` **avant chaque run** E2E ; en
 * local, **rien** ne le fait (`package.json` n'a que `prepare: husky`). Le côté qui fonctionne
 * est donc celui dont les étapes E2E sont sous `workflow_dispatch`, que personne ne déclenche ;
 * le côté qu'on lance est celui qui est cassé. La suite était **exécutable là où on ne la lance
 * pas, et morte là où on la lance**.
 *
 * ⚠️ **CE QUE CETTE GARDE N'APPORTE PAS, ET QU'UNE PREMIÈRE RÉDACTION LUI PRÊTAIT.** Elle a été
 * justifiée par « la suite s'annonce en VERT quand le navigateur manque ». **C'est faux, et la
 * mesure le dit** : navigateur retiré, `npx playwright test` rend `215 failed · 14 skipped ·
 * 3 passed` et **exit 1**. Playwright rapporte correctement. Ce qui avait menti était
 * l'INSTRUMENT DE LECTURE — un `| tail -60` qui coupait la ligne `215 failed` hors de la fenêtre
 * et, le code de sortie d'un pipeline étant celui du dernier maillon, rendait **0**. Le faux vert
 * était le mien, pas celui de l'outil.
 *
 * ✅ **Ce qu'elle apporte réellement, et qui suffit à la justifier** : elle échoue en **2
 * secondes avec un diagnostic**, là où la suite met **1,2 minute à rendre 215 rouges
 * identiques**. Et surtout elle DISTINGUE : 215 tests rouges ressemblent à une régression
 * catastrophique du produit, pas à un répertoire absent. C'est la même famille que « un rouge
 * d'infrastructure est indiscernable d'un rouge de gate » — `CC-06`, puis `CC-01` lancé depuis
 * un `git worktree` sans `node_modules` —, à ceci près qu'ici les deux rouges existent : le
 * problème est de savoir LEQUEL on regarde.
 *
 * ## Ce que cette garde REFUSE, et pourquoi elle sort en 2
 *
 * Elle ne rend jamais de verdict sur la suite : elle dit seulement si la suite **peut** être
 * jouée. Un préalable manquant sort donc en **exit 2** — refus de conclure —, jamais en 1, qui
 * signifierait « la suite a trouvé une régression ». Même partition que
 * `lib/consumer-manifest.cjs` et `lib/ts-decl-read.cjs`.
 *
 * ## L'oracle, et le piège qu'il porte
 *
 * `npx playwright install --dry-run <navigateur>` imprime les chemins d'installation **attendus**
 * sans rien télécharger. On les lit ; on ne les devine pas.
 *
 * 🛑 **NE JAMAIS PRÉSUMER LES NOMS — C'EST CE QUI RENDRAIT CETTE GARDE CREUSE.** Pour la version
 * courante, `--dry-run chromium` annonce **trois** artefacts : `chromium-1234`, `ffmpeg-1011`
 * **et `chromium_headless_shell-1234`**. Or l'artefact qui manquait le jour de la panne est le
 * **troisième**, pas celui qui s'appelle « chromium ». Une garde qui n'aurait vérifié que
 * `chromium-*` serait **sortie verte le jour même du défaut qu'elle existe pour attraper**.
 * D'où : on vérifie tout ce que `--dry-run` imprime, quels que soient les noms.
 *
 * ⚠️ **Ne pas remplacer cette garde par « pensez à lancer `playwright install` » dans un
 * README.** La recette est déjà imprimée par Playwright dans son propre message d'erreur : ce
 * qui a manqué n'est pas la connaissance du remède, c'est que personne n'a été mis au courant
 * du besoin.
 *
 * Usage : node scripts/verify-playwright-browsers.cjs
 */
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const TAG = "PW-BROWSERS";

/**
 * Navigateurs dont les binaires sont exigés.
 *
 * `playwright.config.js` ne déclare qu'un seul projet, `chromium` — et c'est aussi le seul que
 * `ci.yml` installe. Élargir cette liste sans élargir les deux autres endroits produirait une
 * garde qui réclame ce que personne n'installe.
 */
const BROWSERS = ["chromium"];

/** Sortie d'outillage — jamais 0, jamais 1 : pouvoir jouer est un préalable, pas un verdict. */
function refuse(lignes) {
    console.error(`\x1b[31m✗\x1b[0m [${TAG}] La suite E2E NE PEUT PAS être jouée.`);
    for (const l of lignes) console.error(l);
    process.exit(2);
}

/**
 * Rend les chemins d'installation qu'attend la version courante de Playwright.
 *
 * @param {string} browser
 * @returns {string[]} chemins absolus, tels que `--dry-run` les imprime
 */
function cheminsAttendus(browser) {
    const res = spawnSync("npx", ["playwright", "install", "--dry-run", browser], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (res.error || res.status !== 0) {
        refuse([
            `  \`playwright install --dry-run ${browser}\` a échoué — impossible de savoir ce qui`,
            "  est attendu, donc impossible de conclure quoi que ce soit.",
            `  ${String(res.error ?? res.stderr ?? "").trim().slice(0, 300)}`,
        ]);
    }
    const out = String(res.stdout ?? "");
    const chemins = [...out.matchAll(/Install location:\s+(.+)/g)].map((m) => m[1].trim());
    if (chemins.length === 0) {
        refuse([
            `  \`--dry-run ${browser}\` n'a imprimé AUCUN « Install location ».`,
            "  L'oracle a changé de forme : cette garde comparerait deux ensembles vides et",
            "  sortirait verte en n'ayant rien vérifié. Elle refuse plutôt que de le faire.",
        ]);
    }
    return chemins;
}

function main() {
    const manquants = [];
    const vus = [];

    for (const browser of BROWSERS) {
        for (const chemin of cheminsAttendus(browser)) {
            // ⚠️ On teste CHAQUE chemin imprimé, sans filtrer sur son nom : le répertoire qui
            // manquait en B-235 est `chromium_headless_shell-*`, pas `chromium-*`.
            if (fs.existsSync(chemin)) vus.push(chemin);
            else manquants.push(chemin);
        }
    }

    // Plancher de non-vacuité : sans lui, un oracle devenu muet rendrait cette garde verte.
    if (vus.length === 0 && manquants.length === 0) {
        refuse([
            "  aucun artefact à vérifier — l'oracle n'a rien rendu.",
            "  Une garde qui ne vérifie rien est indiscernable d'une garde qui passe.",
        ]);
    }

    if (manquants.length > 0) {
        refuse([
            `  ${manquants.length} artefact(s) attendu(s) et ABSENT(S) :`,
            ...manquants.map((c) => `    ✗ ${c}`),
            ...vus.map((c) => `    ✓ ${c}`),
            "",
            "  Playwright a changé de version sans que ses navigateurs soient réinstallés.",
            "  ⚠️ Sans ce refus, la suite se lancerait et rendrait ~215 rouges IDENTIQUES en 1,2 min —",
            "     ce qui ressemble à une régression du produit, pas à un répertoire absent.",
            "",
            `  Le geste : \x1b[1mnpx playwright install ${BROWSERS.join(" ")}\x1b[0m`,
        ]);
    }

    console.log(
        `\x1b[32m✓\x1b[0m [${TAG}] ${vus.length} artefact(s) présent(s) — la suite peut être jouée.`
    );
    for (const c of vus) console.log(`\x1b[2m    ${c}\x1b[0m`);
}

main();
