#!/usr/bin/env node
/**
 * Porter l'état de l'atelier vers le dépôt public `geoleaf/geoleaf-js`.
 *
 * Usage :
 *   node scripts/port-to-public.cjs              # dry-run : mesure et décrit, n'écrit rien
 *   node scripts/port-to-public.cjs --apply      # copie, commite et pousse
 *   node scripts/port-to-public.cjs --apply --no-push   # copie et commite, sans pousser
 *   node scripts/port-to-public.cjs --keep-clone <dir>  # réutilise/garde un clone à cet endroit
 *
 * ## Pourquoi ce script existe
 *
 * Le portage était un `cp` à la main. Mesuré le 11/08/2026 : le dépôt public était **15 commits
 * en retard**, dont sept touchant de la doc publique — les 45 fiches `docs/specs/` relues, le
 * corpus d'exemples passé de 88 à 148 fichiers, et un bloc de configuration copiable qui
 * déclarait sept clés racine mortes. **Rien ne l'a signalé**, parce qu'aucun mécanisme ne
 * comparait les deux dépôts.
 *
 * ⚠️ Et la cause est structurelle, pas un oubli : le clone public **n'existe nulle part sur le
 * disque**. Il est créé, poussé, supprimé. Un script qui supposerait un clone permanent aurait
 * le même défaut. Celui-ci **clone à chaque portage**, ce qui règle la divergence par
 * construction — on part toujours de l'état réel du distant, jamais d'une copie qui a dérivé.
 *
 * ## Ce qu'il refuse de faire
 *
 * - tourner sur un arbre de travail sale (le lot dérive de `git ls-files`, qui ne décrit pas
 *   les modifications non commitées — le décompte imprimé mentirait) ;
 * - écrire un lot sous le plancher de vraisemblance, ou dont un motif de partition n'a rien
 *   retiré (`public-partition.cjs`) ;
 * - commiter un clone dont `git ls-files` contient encore un chemin d'atelier.
 *
 * Chacun de ces trois refus a été VU mordre avant que le script soit cru — cf. la tâche
 * d'épreuve, deux mutations et une assertion.
 *
 * ## L'ordre des étapes n'est pas arbitraire
 *
 * `ARBORESCENCE_QUALIFIEE.md` est régénéré **après** le `git add`, jamais avant : son générateur
 * lit `git ls-files` (`lib/source-inventory.cjs:87`), pas le disque. Un arbre régénéré avant
 * l'indexation décrit le lot précédent en sortant 0 — c'est ce que les commits publics
 * `18ccd025` et `ed7bbaf2` ont dû rattraper à la main, deux fois de suite.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");
const partition = require("./lib/public-partition.cjs");

const ROOT = registry.ROOT;
const PUBLIC_REMOTE = "https://github.com/geoleaf/geoleaf-js.git";
/** Le dépôt attendu au bout du remote, en forme `<orga>/<nom>`, pour l'assertion d'identité. */
const PUBLIC_SLUG = "geoleaf/geoleaf-js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const noPush = argv.includes("--no-push");
const keepCloneIdx = argv.indexOf("--keep-clone");
const keepClone = keepCloneIdx !== -1 ? argv[keepCloneIdx + 1] : null;

/**
 * Lancer une commande, en jetant sur échec plutôt qu'en poursuivant.
 *
 * @param {string} cmd Exécutable.
 * @param {string[]} args Arguments, non interprétés par un shell.
 * @param {{cwd?: string, quiet?: boolean}} [opts]
 * @returns {string} La sortie standard, ébarbée.
 */
function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {
        cwd: opts.cwd ?? ROOT,
        encoding: "utf8",
        stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) throw res.error;
    if (res.status !== 0) {
        throw new Error(
            `port-to-public: \`${cmd} ${args.join(" ")}\` a rendu ${res.status}` +
                (res.stderr ? ` — ${String(res.stderr).trim()}` : "")
        );
    }
    return String(res.stdout ?? "").trim();
}

/**
 * Les fichiers suivis par git, chemins repo-relatifs POSIX.
 *
 * @param {string} cwd Racine du dépôt à interroger.
 * @returns {string[]}
 */
function trackedFiles(cwd) {
    const out = run("git", ["ls-files", "-z"], { cwd, quiet: true });
    return out.split("\0").filter(Boolean);
}

/**
 * Refuser de porter depuis un arbre sale.
 *
 * ⚠️ Ce n'est pas de la propreté de principe. Le lot est dérivé de `git ls-files`, qui décrit
 * **l'index**, pas le disque : un fichier modifié non commité serait copié dans son état
 * courant alors que le décompte imprimé le décrit comme la version commitée. Le portage
 * partirait juste et le message de commit serait faux.
 */
function assertCleanWorktree() {
    const dirty = run("git", ["status", "--porcelain"], { quiet: true });
    if (dirty) {
        const count = dirty.split("\n").length;
        throw new Error(
            `port-to-public: l'arbre de travail porte ${count} modification(s) non commitée(s).\n` +
                `  Le lot se dérive de \`git ls-files\` — porter maintenant copierait un état que\n` +
                `  le décompte ne décrit pas. Commiter d'abord, puis relancer.`
        );
    }
}

/**
 * Cloner le dépôt public, et vérifier que c'est bien lui.
 *
 * @returns {{dir: string, ephemeral: boolean}}
 */
function clonePublic() {
    const dir = keepClone ?? fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-public-"));
    const ephemeral = keepClone === null;

    if (fs.existsSync(path.join(dir, ".git"))) {
        console.log(`↻ Clone existant réutilisé : ${dir}`);
        run("git", ["fetch", "origin", "main"], { cwd: dir });
        run("git", ["reset", "--hard", "origin/main"], { cwd: dir });
        run("git", ["clean", "-fdx"], { cwd: dir });
    } else {
        console.log(`⇣ Clonage de ${PUBLIC_SLUG}…`);
        run("git", ["clone", "--quiet", PUBLIC_REMOTE, dir], { cwd: ROOT });
    }

    // Assertion d'identité : écraser le mauvais dépôt serait irréversible.
    const remote = run("git", ["remote", "get-url", "origin"], { cwd: dir, quiet: true });
    if (!remote.includes(PUBLIC_SLUG)) {
        throw new Error(
            `port-to-public: le clone pointe "${remote}", attendu "${PUBLIC_SLUG}". REFUS.`
        );
    }
    return { dir, ephemeral };
}

/**
 * Rendre le clone identique au lot public : copier ce qui doit être là, retirer le reste.
 *
 * @param {string} cloneDir Racine du clone.
 * @param {string[]} publicFiles Chemins repo-relatifs POSIX à porter.
 * @returns {{copied: number, removed: string[]}}
 */
function syncClone(cloneDir, publicFiles) {
    const wanted = new Set(publicFiles);

    // ① Retirer du clone tout fichier suivi qui n'est plus dans le lot. Sans cette passe, un
    //    fichier supprimé ici survivrait indéfiniment là-bas — la forme silencieuse de la
    //    divergence, et la plus difficile à voir puisqu'elle n'apparaît dans aucun diff.
    const removed = [];
    for (const file of trackedFiles(cloneDir)) {
        if (wanted.has(file)) continue;
        const abs = path.join(cloneDir, file);
        if (fs.existsSync(abs)) fs.rmSync(abs);
        removed.push(file);
    }

    // ② Copier le lot. `copyFileSync` traite binaires et textes de la même façon.
    let copied = 0;
    for (const file of publicFiles) {
        const src = path.join(ROOT, file);
        const dest = path.join(cloneDir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copied++;
    }

    return { copied, removed };
}

/**
 * Ajouter le bloc d'appareil interne au `.gitignore` du clone.
 *
 * ⚠️ **Après** la copie, jamais avant : l'étape ② vient d'écraser le `.gitignore` du clone par
 * celui de l'atelier, qui ne porte pas ces règles — et ne doit pas les porter (voir le module
 * de partition). Poser le fragment d'abord reviendrait à le supprimer.
 *
 * @param {string} cloneDir Racine du clone.
 */
function appendGitignoreFragment(cloneDir) {
    const target = path.join(cloneDir, ".gitignore");
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current.includes("Appareil INTERNE")) return; // déjà posé, portage idempotent
    fs.writeFileSync(target, current + partition.gitignoreFragment(), "utf8");
}

/**
 * Dernier filet : aucun chemin d'atelier ne doit être indexé côté clone.
 *
 * C'est la seule assertion qui juge le RÉSULTAT plutôt que l'intention. Les précédentes
 * vérifient que la partition a mordu sur la liste ; celle-ci vérifie ce que git s'apprête
 * réellement à commiter — la seule chose qui parte.
 *
 * @param {string} cloneDir Racine du clone.
 * @throws {Error} Si un fichier interne a survécu.
 */
function assertNoInternalLeak(cloneDir) {
    const leaked = trackedFiles(cloneDir).filter((f) => partition.isInternal(f));
    if (leaked.length > 0) {
        throw new Error(
            `port-to-public: ${leaked.length} fichier(s) d'ATELIER sont indexés dans le clone —\n` +
                leaked
                    .slice(0, 20)
                    .map((f) => `    ${f}`)
                    .join("\n") +
                (leaked.length > 20 ? `\n    … et ${leaked.length - 20} autre(s)` : "") +
                `\n  REFUS avant commit. Le \`.gitignore\` du clone n'a pas mordu.`
        );
    }
}

/** @returns {void} */
function main() {
    console.log("── Portage vers le dépôt public ──\n");

    assertCleanWorktree();

    const head = run("git", ["rev-parse", "--short", "HEAD"], { quiet: true });
    const parts = partition.split(trackedFiles(ROOT));
    partition.assertPartitionSane(parts);

    // ⚠️ Le décompte s'imprime AVANT toute écriture, et il ventile par motif : un total seul
    // ne distingue pas « 39 fichiers retirés » de « 39 fichiers qu'un seul motif a happés ».
    console.log(
        `Atelier @ ${head} — ${parts.publicFiles.length + parts.internalFiles.length} fichiers suivis`
    );
    console.log(`  → ${parts.publicFiles.length} portés au public`);
    console.log(`  → ${parts.internalFiles.length} retenus à l'atelier :`);
    for (const [pattern, files] of parts.byPattern) {
        console.log(`       ${String(files.length).padStart(4)}  ${pattern}`);
    }
    console.log();

    if (!apply) {
        console.log("[dry-run] Rien n'a été écrit. Relancer avec --apply pour porter.");
        return;
    }

    const { dir: cloneDir, ephemeral } = clonePublic();
    const before = run("git", ["rev-parse", "--short", "HEAD"], { cwd: cloneDir, quiet: true });

    try {
        const { copied, removed } = syncClone(cloneDir, parts.publicFiles);
        appendGitignoreFragment(cloneDir);
        console.log(`\n✓ ${copied} fichier(s) copié(s), ${removed.length} retiré(s) du clone.`);

        // L'indexation précède la régénération de l'arbre : le générateur lit `git ls-files`,
        // donc un arbre produit avant le `git add` décrit le lot PRÉCÉDENT en sortant 0.
        run("git", ["add", "-A"], { cwd: cloneDir });

        console.log("↻ Régénération de l'arbre côté public…");
        run("node", ["scripts/generate-docs-tree.cjs"], { cwd: cloneDir });
        run("git", ["add", "-A"], { cwd: cloneDir });

        assertNoInternalLeak(cloneDir);

        const staged = run("git", ["diff", "--cached", "--name-only"], {
            cwd: cloneDir,
            quiet: true,
        });
        if (!staged) {
            console.log("\n= Le dépôt public est déjà à jour, rien à commiter.");
            return;
        }
        const changed = staged.split("\n").length;

        const message =
            `chore(sync): porter l'état de l'atelier — ${changed} fichier(s)\n\n` +
            `Source : ${head}. Portage dérivé par scripts/port-to-public.cjs :\n` +
            `${parts.publicFiles.length} fichiers publics, ${parts.internalFiles.length} retenus\n` +
            `à l'atelier par les motifs de scripts/lib/public-partition.cjs.\n`;
        run("git", ["commit", "-m", message], { cwd: cloneDir });
        const after = run("git", ["rev-parse", "--short", "HEAD"], { cwd: cloneDir, quiet: true });
        console.log(`\n✓ Commit ${before} → ${after} (${changed} fichier(s)).`);

        if (noPush) {
            console.log(`  --no-push : le clone reste local dans ${cloneDir}`);
            return;
        }
        run("git", ["push", "origin", "main"], { cwd: cloneDir });
        console.log(`✓ Poussé sur ${PUBLIC_SLUG}.`);
    } finally {
        if (ephemeral && !noPush) fs.rmSync(cloneDir, { recursive: true, force: true });
        else console.log(`\n  Clone conservé : ${cloneDir}`);
    }
}

try {
    main();
} catch (err) {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
}
