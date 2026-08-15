#!/usr/bin/env node
"use strict";
/**
 * gitleaks-local.cjs — la gate `Secret scan (gitleaks)` de `ci.yml`, rejouée AVANT le push.
 *
 * ## Pourquoi elle existe
 *
 * `gitleaks` est la seule gate de fond de `ci.yml` portée par une ACTION GitHub, donc la
 * seule que `ci:local` ne pouvait structurellement pas exécuter. Elle a mordu deux fois de
 * suite le 29/07/2026, pour deux causes différentes, et chaque découverte a coûté un run
 * d'un quota rare. Un secret poussé n'était visible qu'à distance — c'est-à-dire trop tard.
 *
 * L'action n'est pas reproductible ; son BINAIRE l'est. Ce script lance la version EXACTE
 * que l'action installe (relevée dans le journal du run : `gitleaks version: 8.24.3`) sur la
 * même plage de commits, via Docker.
 *
 * ## Ce qu'il scanne, et pourquoi pas « le dépôt »
 *
 * Sur un `push`, l'action ne scanne pas l'arbre : elle scanne la PLAGE POUSSÉE. L'équivalent
 * local avant push est donc `origin/main..HEAD` — les commits qu'on s'apprête à envoyer.
 * Scanner l'arbre de travail répondrait à une autre question et laisserait passer un secret
 * introduit puis retiré dans deux commits de la même poussée.
 *
 * ⚠️ LE PIÈGE QUE CE SCRIPT FERME PAR CONSTRUCTION — et c'est le défaut de `f15b0575` pris
 * par l'autre bout. Sur une plage vide, gitleaks scanne zéro octet et imprime sereinement
 * « no leaks found ». C'est exactement ce qu'avait affiché la CI juste avant d'échouer :
 *
 *     WRN scanned ~0 bytes (0)
 *     WRN no leaks found in partial scan
 *
 * Un verdict rassurant sur un scan vide est pire qu'aucun verdict, parce qu'on le croit.
 * Ce script COMPTE donc les commits de la plage avant de lancer quoi que ce soit, et refuse
 * de rendre un verdict s'il n'y en a aucun — il ne sort pas « vert », il sort « sans objet ».
 *
 * ## Ce qu'il ne couvre pas
 *
 * Le chemin `pull_request` de l'action, qui interroge l'API GitHub pour énumérer les commits
 * de la PR et exige `GITHUB_TOKEN`. Aucun équivalent local n'existe : il n'y a pas
 * d'événement `pull_request` sur un poste. Cette moitié reste vérifiable seulement à distance.
 *
 * Usage : node scripts/gitleaks-local.cjs [--all]
 *   (sans argument)  scanne `origin/main..HEAD` — ce qu'on s'apprête à pousser
 *   --all            scanne tout l'historique atteignable depuis HEAD (lent, ponctuel)
 *
 * Sortie : 0 si aucune fuite (ou si Docker est absent / la plage est vide, avec le motif
 * imprimé), 1 si une fuite est trouvée ou si le scan n'a pas pu aboutir.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

/**
 * Dépôt scanné. Surchargeable pour que cette gate soit PROUVABLE : sans ce crochet, la seule
 * façon de la voir rougir serait de committer un vrai faux secret dans le dépôt de travail —
 * donc on ne le ferait pas, et une garde jamais vue rouge ne garde rien (CLAUDE.md §Pré-vol).
 * Même patron que `GEOLEAF_CI_WORKFLOW_DIR` et `GEOLEAF_NYC_OUTPUT`.
 */
const ROOT = process.env.GEOLEAF_GITLEAKS_REPO
    ? path.resolve(process.env.GEOLEAF_GITLEAKS_REPO)
    : path.resolve(__dirname, "..");

/**
 * Épinglée sur la version que l'action installe. Un écart de version est un écart de RÈGLES :
 * deux gitleaks différents ne rendent pas le même verdict, et un vert local obtenu avec des
 * règles plus anciennes ne dirait rien du run à venir — la promesse même qu'on répare ici.
 */
const IMAGE = "ghcr.io/gitleaks/gitleaks:v8.24.3";

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

function dockerAvailable() {
    const res = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return res.status === 0;
}

function main() {
    const all = process.argv.includes("--all");
    console.log(`${C.b}── SECRET SCAN (gitleaks ${IMAGE.split(":").pop()}) ──${C.x}`);

    // 1. Docker. Son absence est une dépendance d'ENVIRONNEMENT manquante, pas une gate en
    //    échec : faire rougir `ci:local` pour ça pousserait à le contourner, et une gate
    //    contournée ne garde rien. On l'annonce fort, et on sort 0.
    //
    // 🛑 SAUF EN CI, ET LE MOTIF DE L'INDULGENCE EST CE QUI A CHANGÉ. Cette tolérance reposait
    // sur une phrase — « la gate distante tournera quand même sur le runner » — qui était vraie
    // tant que le distant lançait `gitleaks-action`. Depuis le 11/08/2026, `ci.yml` lance CE
    // script : le filet invoqué pour justifier la sortie 0 est devenu le script lui-même. Sans
    // ce garde-fou, un runner sans Docker rendrait un vert silencieux en s'appuyant sur un
    // secours qui n'existe plus — exactement la classe de défaut que l'escalade de plage
    // ci-dessous vient de fermer, réintroduite par l'autre bout.
    if (!dockerAvailable()) {
        const inCI = process.env.CI === "true";
        console.log(`  ${C.y}⚠ Docker ne répond pas — CE SCAN N'A PAS EU LIEU.${C.x}`);
        if (inCI) {
            console.log(
                `  ${C.r}✗ En CI, c'est un ÉCHEC : ce script EST la gate distante depuis le\n` +
                    `  11/08/2026, donc rien ne le rattrape en aval. Un scan qui n'a pas eu lieu\n` +
                    `  ne peut pas sortir vert ici.${C.x}`
            );
            process.exit(1);
        }
        console.log(
            `  ${C.d}Sur un poste, ce n'est pas un échec : la gate distante rejouera le même\n` +
                `  scan sur le runner. Un secret présent dans les commits à pousser ne sera donc\n` +
                `  découvert qu'après avoir dépensé un run.${C.x}`
        );
        process.exit(0);
    }

    // 2. La plage. Comptée AVANT le scan, précisément pour ne pas rendre un verdict sur rien.
    //
    // 🛑 UNE PLAGE VIDE SORT 0 EN ANNONÇANT QU'ELLE N'A RIEN SCANNÉ — et ce n'est PAS
    //    satisfaisant. La tentative de le corriger a été faite le 11/08/2026 et RETIRÉE le
    //    jour même, parce que son remède était pire. L'histoire est écrite ici pour qu'on ne
    //    la refasse pas à l'identique.
    //
    // **Le défaut, réel** : un pas de `ci:local` qui sort 0 se lit VERT dans le tableau, quoi
    // qu'il imprime. Mesuré sur le clone du dépôt public — un commit, aucun remote — où ce pas
    // était vert pendant que le `--all` de la tâche 9.8 y trouvait **3 fuites**.
    //
    // **Le remède essayé** : escalader vers l'historique complet quand la plage est vide.
    // **Pourquoi il a été retiré** : sur un dépôt à long historique, il ressuscite des
    // trouvailles DÉJÀ REMÉDIÉES. Mesuré à la première poussée — la CI est passée rouge sur
    // `geoleaf-windows-datas-path` dans `5b8c6c8f`, un commit dont le Sprint 5 a nettoyé le
    // contenu depuis. Une gate qu'aucun correctif ne peut verdir sans réécrire l'historique
    // est une gate qu'on finit par contourner.
    //
    // **Les deux replis alternatifs sont mesurés et écartés eux aussi** :
    //   • `--log-opts=-1` (le commit de tête) — faux dès le 2ᵉ commit : sur le dépôt public il
    //     ne verrait plus le commit initial, donc pas les 3 fuites qui motivaient tout ceci ;
    //   • `gitleaks dir` (l'arbre) — scanne ce que git ignore : **108 trouvailles**, presque
    //     toutes dans `node_modules/`.
    //
    // **Ce qu'il faudrait** : la plage de l'ÉVÉNEMENT (`github.event.before..sha`), que
    // `gitleaks-action` obtenait de GitHub et qu'un script local ne peut pas deviner. C'est une
    // pièce à concevoir — un crochet d'environnement lu ici, posé par `ci.yml` —, pas à
    // improviser. En attendant, `9.8` (`--all`, sur un dépôt neuf) reste le verdict de fond.
    // ✅ `GEOLEAF_GITLEAKS_RANGE` — LA PIÈCE QUI MANQUAIT, posée le 11/08/2026.
    //
    // C'est la réponse au problème décrit au-dessus, et elle vient d'où l'information EXISTE :
    // l'événement GitHub. `ci.yml` calcule `before..sha` sur un push, `base..head` sur une PR,
    // et le passe ici. Un script local ne peut pas deviner ces bornes — c'est exactement ce que
    // `gitleaks-action` recevait de la plateforme, et la seule chose qu'on perdait en la
    // remplaçant par le binaire.
    //
    // 🛑 **Quand la plage vient de l'événement, une plage VIDE est un ÉCHEC, pas un silence.**
    // La tolérance du repli local se justifie par « il n'y a rien à comparer, c'est normal sur
    // un poste ». Ici la plomberie a AFFIRMÉ une plage : si elle ne contient rien, c'est que le
    // calcul est faux, et sortir 0 rendrait la gate muette précisément là où elle est seule.
    //
    // 📌 Quand la variable est absente — `workflow_dispatch`, premier push d'une branche —, le
    // comportement local s'applique tel quel, non-verdict compris. C'est assumé : un run manuel
    // n'a pas de plage naturelle, et inventer une borne serait pire que dire qu'on n'en a pas.
    const envRange = (process.env.GEOLEAF_GITLEAKS_RANGE || "").trim();
    const fromEvent = envRange.length > 0;

    let range;
    if (all) {
        range = "HEAD";
    } else if (fromEvent) {
        range = envRange;
        console.log(`  ${C.d}plage fournie par l'événement CI : ${range}${C.x}`);
    } else {
        const upstream = git("rev-parse", "--verify", "--quiet", "origin/main");
        if (upstream.status !== 0) {
            console.log(
                `  ${C.y}⚠ \`origin/main\` introuvable — impossible de délimiter la plage.${C.x}`
            );
            console.log(`  ${C.d}Relancer avec --all pour scanner tout l'historique.${C.x}`);
            process.exit(0);
        }
        range = "origin/main..HEAD";
    }

    /**
     * Nombre de lignes AJOUTÉES par la plage, ou `-1` si le compte n'est pas sûr.
     *
     * 🛑 Compté PAR COMMIT (`git log --numstat`), jamais sur le diff net (`git diff`). Un
     * secret ajouté puis retiré dans la même plage rend un diff net vide : s'y fier
     * laisserait passer exactement ce que cette gate existe pour attraper.
     *
     * Rend `-1` — donc REFUSE de conclure — sur un fichier binaire (`-` en numstat, contenu
     * indénombrable) ou sur une sortie git illisible. Dans le doute, la gate rougit.
     */
    function addedLinesIn(r) {
        const st = git("log", "--numstat", "--pretty=format:", r);
        if (st.status !== 0) return -1;
        let total = 0;
        for (const line of (st.stdout || "").split("\n")) {
            if (!line.trim()) continue;
            const add = line.split("\t")[0];
            if (add === "-") return -1;
            const v = Number(add);
            if (!Number.isFinite(v)) return -1;
            total += v;
        }
        return total;
    }

    const count = git("rev-list", "--count", range);
    const n = count.status === 0 ? Number(count.stdout.trim()) : -1;
    if (n === 0) {
        if (fromEvent) {
            console.log(
                `  ${C.r}✗ 0 commit dans \`${range}\`, une plage POURTANT fournie par` +
                    ` l'événement.${C.x}`
            );
            console.log(
                `  ${C.d}Ce n'est pas « rien à scanner » : c'est un calcul de bornes faux dans\n` +
                    `  ci.yml. Sortir 0 ici rendrait la gate muette là où elle est le seul œil.${C.x}`
            );
            process.exit(1);
        }
        console.log(
            `  ${C.y}⚠ 0 commit dans \`${range}\` — RIEN À SCANNER, DONC AUCUN VERDICT.${C.x}`
        );
        console.log(
            `  ${C.d}Ce n'est pas un vert. gitleaks aurait imprimé « no leaks found » sur zéro\n` +
                `  octet, ce qui est le mode d'échec que ce script existe pour ne pas répéter.${C.x}`
        );
        process.exit(0);
    }
    if (n < 0) {
        console.log(`  ${C.r}✗ plage \`${range}\` illisible — refus de conclure.${C.x}`);
        process.exit(1);
    }

    // 3. Le scan. Mêmes drapeaux que l'action : --redact (aucun secret en clair dans le
    //    journal), --exit-code=2 pour distinguer « fuite trouvée » d'une erreur d'exécution.
    //
    //    ⚠️ Cette ligne a dit « aucun `.gitleaks.toml` dans le dépôt » jusqu'au 10/08/2026.
    //    Le fichier existe désormais à la racine (Sprint 5, tâche 5.9) et gitleaks le trouve
    //    tout seul, ICI comme en CI, parce que les deux pointent la même racine : le dépôt
    //    est monté sur `/repo` et `--source=/repo` en fait le répertoire de recherche de la
    //    configuration. Il n'y a donc toujours rien à synchroniser à la main — mais pour une
    //    raison différente, et c'est le genre de phrase qui se recopie sans être relue.
    //
    //    🛑 Conséquence à connaître : ce fichier porte `[extend] useDefault = true`. Sans
    //    cette ligne, un `.gitleaks.toml` REMPLACE les ~150 règles par défaut, et ce script
    //    sortirait vert en ne gardant plus que quatre chaînes maison. La sonde de la tâche
    //    5.10 l'éprouve par mutation, sur un dépôt jetable, avec une vraie clé de test.
    console.log(`  plage : ${C.b}${range}${C.x} — ${n} commit(s)`);
    // ⚠️ DEPUIS UN WORKTREE GIT, `.git` est un FICHIER, pas un répertoire — il contient
    // `gitdir: /chemin/absolu/vers/.git/worktrees/<nom>`. Ce chemin est HORS du volume monté,
    // donc git dans le conteneur ne le résout pas :
    //
    //     fatal: not a git repository: /…/.git/worktrees/geoleaf-cipush-XXXX
    //     WRN scanned ~0 bytes (0)
    //     WRN no leaks found in partial scan
    //
    // Mesuré le 01/08/2026 au premier run de `ci:push`, qui travaille précisément dans un
    // worktree. Le garde-fou de ce script a bien refusé de conclure (l'étape est sortie en
    // erreur, pas en vert), mais le motif était un défaut de MONTAGE et non de sécurité —
    // exactement le couple qu'il faut savoir distinguer.
    //
    // Le vrai répertoire git est donc monté à SON CHEMIN ABSOLU, pour que le `gitdir:` du
    // fichier `.git` résolve à l'identique dans le conteneur.
    const gitCommonDir = git(
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
    ).stdout.trim();
    const extraMounts =
        gitCommonDir && !gitCommonDir.startsWith(`${ROOT}/.git`)
            ? ["-v", `${gitCommonDir}:${gitCommonDir}:ro`]
            : [];

    const res = spawnSync(
        "docker",
        [
            "run",
            "--rm",
            "-v",
            `${ROOT}:/repo:ro`,
            ...extraMounts,
            // Le conteneur tourne en root sur des fichiers de l'hôte : sans cette
            // déclaration, git refuse le dépôt en « dubious ownership » et gitleaks sort en
            // erreur — un rouge qui n'est pas un verdict de sécurité. Posé par variables
            // plutôt qu'en écrivant un ~/.gitconfig dans l'image.
            //
            // Le répertoire git commun, quand il est monté (cas du worktree), doit être
            // déclaré sûr LUI AUSSI : il appartient au même utilisateur de l'hôte.
            "-e",
            `GIT_CONFIG_COUNT=${extraMounts.length ? 2 : 1}`,
            "-e",
            "GIT_CONFIG_KEY_0=safe.directory",
            "-e",
            "GIT_CONFIG_VALUE_0=/repo",
            ...(extraMounts.length
                ? [
                      "-e",
                      "GIT_CONFIG_KEY_1=safe.directory",
                      "-e",
                      `GIT_CONFIG_VALUE_1=${gitCommonDir}`,
                  ]
                : []),
            IMAGE,
            "detect",
            "--source=/repo",
            "--redact",
            "-v",
            "--exit-code=2",
            `--log-opts=${range}`,
        ],
        { cwd: ROOT, encoding: "utf8" }
    );

    const out = `${res.stdout || ""}${res.stderr || ""}`;

    // 4. Le contrôle de vacuité, en seconde ligne. Le compte de commits ci-dessus peut être
    //    non nul alors que gitleaks n'a rien lu (commits sans ajout, plage mal transmise) —
    //    et c'est précisément l'état dans lequel la CI a annoncé « aucune fuite ».
    //
    //    ⚠️ MAIS LES DEUX CAS CITÉS N'ONT PAS LE MÊME STATUT, et les confondre a fait rougir
    //    la CI le 15/08/2026 sur un commit de 62 suppressions et ZÉRO ajout — la rotation du
    //    plafond du JOURNAL, c'est-à-dire un geste que le dépôt IMPOSE tous les mois.
    //    « Plage mal transmise » est un défaut ; « la plage n'ajoute rien » est un état sûr et
    //    récurrent. gitleaks ne lit que le contenu AJOUTÉ : sur une plage qui n'en a aucun,
    //    son silence n'est pas une cécité, c'est la vérité.
    const scanned = out.match(/scanned ~(\d+) bytes/);
    if (res.status === 0 && scanned && Number(scanned[1]) === 0) {
        const added = addedLinesIn(range);
        if (added === 0) {
            console.log(
                `  ${C.y}⚠ scan vide, et il est VRAI : la plage n'ajoute aucune ligne.${C.x}`
            );
            console.log(
                `  ${C.d}${n} commit(s), 0 ligne ajoutée — gitleaks ne scanne que les ajouts,\n` +
                    `  il n'avait donc rien à lire. Suppression pure (rotation, purge, retrait).${C.x}`
            );
            process.exit(0);
        }
        console.log(
            `  ${C.r}✗ gitleaks n'a lu AUCUN octet, et annonce pourtant « no leaks ».${C.x}`
        );
        console.log(
            `  ${C.d}Un scan vide n'est pas un verdict — et la plage ajoute pourtant ` +
                `${added < 0 ? "un contenu indénombrable (binaire ou illisible)" : `${added} ligne(s)`}` +
                `. Vérifier la plage.${C.x}`
        );
        process.exit(1);
    }

    for (const line of out.split("\n")) {
        if (/commits scanned|scanned ~|leaks found|Finding:|File:|Commit:|RuleID:/.test(line)) {
            console.log(`  ${C.d}${line.trim()}${C.x}`);
        }
    }

    if (res.status === 0) {
        console.log(
            `\n${C.g}✓ SECRET SCAN — aucune fuite dans ${n} commit(s) prêts à pousser.${C.x}`
        );
        process.exit(0);
    }
    if (res.status === 2) {
        console.log(`\n${C.r}✗ SECRET SCAN — FUITE DÉTECTÉE dans les commits à pousser.${C.x}`);
        console.log(
            `  ${C.d}Réécrire l'historique avant de pousser : une fois le commit distant, le\n` +
                `  secret est à considérer comme compromis, et le retirer ne suffit plus.${C.x}`
        );
        process.exit(1);
    }
    console.log(
        `\n${C.r}✗ SECRET SCAN — gitleaks a échoué (exit ${res.status}), pas de verdict.${C.x}`
    );
    console.log(out.split("\n").slice(-8).join("\n"));
    process.exit(1);
}

if (require.main === module) {
    main();
}
