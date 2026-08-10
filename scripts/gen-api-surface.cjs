#!/usr/bin/env node
/*!
 * API-SURFACE : le manifeste de la surface publique dérivée, et sa gate de fraîcheur.
 *
 * ## Le défaut que cette gate ferme
 *
 * La référence d'API TypeDoc était un **fossile** : sa sortie datait du 25/07, le core avait
 * bougé jusqu'au 26/07, et `docs:api` n'était câblé **nulle part** — ni `package.json` racine,
 * ni `ci.yml`, ni `ci-local.cjs`. Pendant ce temps `API_REFERENCE.md` continuait d'être édité à
 * la main. Voilà toute la divergence entre les deux références du dépôt, et rien ne la disait.
 *
 * ## Pourquoi un MANIFESTE, et pas le rendu committé
 *
 * L'Étape 3 de la refonte V3 avait décidé « la sortie est committée, une gate échoue si elle
 * diverge » — sur le modèle de `docs:tree:check`, le seul régime qui ait tenu ici. **Mesuré, ce
 * geste est infaisable sur le rendu**, pour deux raisons indépendantes :
 *
 *   1. **Le rendu n'a pas de point fixe.** `typedoc/…/converter/utils/repository.js` fait
 *      `git rev-parse HEAD` et grave le SHA dans la sortie — relevé **29 fichiers sur 54**. Le
 *      SHA du commit n'existe pas quand on écrit la sortie qu'on veut y mettre : la gate
 *      sortirait rouge **au commit même qui vient de régénérer**.
 *   2. **Le volume.** `expand` sur le seul core produit **1 806 fichiers / 24 Mo**, à **une
 *      ligne de HTML par fichier**. Un diff inrevuable par construction.
 *
 * Donc on gate le **modèle**, pas le rendu — et c'est la leçon que
 * `generate-docs-tree.cjs` porte déjà par écrit : comparer le RENDU a laissé son `--check` vert
 * pendant que **31 annotations sur 129** étaient mortes, parce qu'il comparait ce qui est
 * affiché au lieu de ce qui est décrit.
 *
 * Le manifeste satisfait les trois propriétés du régime `docs:tree` :
 *   - **fonction pure de la source** — ni SHA, ni date, ni chemin absolu (assertés au run) ;
 *   - **revuable** — une ligne par réflexion, triée : un `@param` renommé, un export ajouté ou
 *     un TSDoc réécrit produisent **une ligne de diff** ;
 *   - **soustrait aux formateurs** — voir le choix de l'extension ci-dessous.
 *
 * ## Trois choix de forme, chacun contre un mode d'échec précis
 *
 * **`.txt` et non `.md`.** Un `.md` sous `docs/reference/` entrerait dans le scope
 * `reference/` de `check-dead-links.cjs` **et** serait réécrit par le glob `"*.{json,md}"` de
 * `lint-staged` à chaque commit — donc gate rouge en permanence, sans qu'une source ait bougé.
 * C'est exactement le défaut que `.prettierignore` documente pour `ARBORESCENCE_QUALIFIEE.md`.
 * `.txt` évite les deux sans ajouter une ligne d'exception.
 *
 * **Le hash de commentaire est NORMALISÉ en blancs.** `lint-staged` fait tourner
 * `prettier --write` sur `packages/**\/src/**\/*.{js,ts}` : il **re-wrappe** les blocs TSDoc
 * pendant le hook. Hacher le texte brut aurait donc créé une nouvelle instance de **B-27** — la
 * gate périmée par le commit qui la satisfait. En écrasant les suites de blancs, un re-wrap ne
 * change rien et une **réécriture** change tout : c'est précisément la discrimination voulue.
 *
 * **Le manifeste vit hors des formes d'artefact généré.** `docs/reference/` ne matche
 * aucune entrée de `GENERATED_DIR_FORMS` (`docs/api`, `docs/public`, `docs-dist`) — donc
 * `.gitignore`, les checks 4/5/5c de `verify-repo-hygiene` et `check-package-files` restent
 * **intacts**. C'est ce qui permet de gater la fraîcheur SANS rouvrir l'arbitrage 4.8 (le
 * `!docs/api/` du `files[]` reste, purge refusée — ligne au §Journal des décisions de la
 * roadmap).
 *
 * ## Ce que cette gate protège, en plus de la fraîcheur
 *
 * Le périmètre du core vient de `packages/core/typedoc.json`, que TypeDoc lit lui-même pour ce
 * paquet (une config de paquet gagne sur `packageOptions`). **Conséquence utile : rétrécir ce
 * fichier fait rougir cette gate.** Si quelqu'un ramenait `entryPoints` à
 * `["src/bundle-esm-entry.ts"]` en `resolve`, le manifeste s'effondrerait de ~11 600 réflexions
 * à ~1 100 et `--check` le dirait. La configuration élargie n'est donc pas protégée par un
 * commentaire — elle est protégée par une mesure. ⚠️ Et elle ne peut PAS porter de commentaire :
 * TypeDoc refuse les clés inconnues (`_comment` → *Unknown option*), et
 * `generated-artifacts.cjs` fait un `JSON.parse` strict, donc pas de JSONC non plus.
 *
 * ## Ce qu'elle NE juge PAS
 *
 * La véracité des phrases, comme partout ici. Un TSDoc peut mentir : le manifeste dira
 * seulement que le mensonge n'a pas changé depuis le dernier commit. Et il ne juge pas la
 * COMPLÉTUDE de la documentation — c'est TSD-05, dans `check-tsdoc-conformity.cjs`.
 *
 * Usage:
 *   node scripts/gen-api-surface.cjs            # (re)génère le manifeste
 *   node scripts/gen-api-surface.cjs --check     # gate : exit 1 si le manifeste est périmé
 *   node scripts/gen-api-surface.cjs --verbose
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = registry.ROOT;
const OUT_FILE = docsPaths.reference("API_SURFACE.txt");
const CHECK = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

// TypeDoc n'est installé que sous le core — résolu par le registre, jamais par un
// `packages/core` en dur : un chemin en dur ne casse pas au déplacement, il cesse
// silencieusement de matcher, et cette gate sortirait verte en n'ayant rien converti.
const CORE = registry.requireByDirName("core");
const TYPEDOC_ENTRY = path.join(CORE.absDir, "node_modules", "typedoc", "dist", "index.js");

/**
 * Les répertoires de paquet à couvrir — **dérivés, jamais listés**.
 *
 * Le critère est *ce qui est publié avec une surface d'API* : un paquet non `private`, qui
 * déclare une carte `exports`, et qui a un `src/`. Il rend aujourd'hui le core, les 13
 * plugins et `@geoleaf/field-renderer` — **15 paquets**.
 *
 * ⚠️ **Le premier jet filtrait sur `dir.includes("packages/plugins/")` plus le core, et il
 * OUBLIAIT `field-renderer`** — un paquet publié dont la surface (391 lignes de manifeste)
 * n'était donc gatée par rien. C'est exactement la classe que `CLAUDE.md` décrit : un filtre de
 * chemin ne casse pas au déplacement, il **cesse silencieusement de matcher**, et la gate sort
 * verte en n'ayant pas scanné. Le défaut a été trouvé en amputant délibérément le périmètre
 * pour voir la gate rougir : elle a rendu le bon verdict pour la mauvaise raison, ce qui a fait
 * relire le prédicat. **Une mutation utile n'est pas seulement celle qui rougit.**
 *
 * `host-runtime` est `private: true` — consommé par les plugins, jamais publié sur npm, donc
 * hors surface livrée. `geoleaf-app` et `build-config` de même.
 *
 * @returns {string[]} chemins absolus, triés — le tri rend le manifeste stable.
 * @throws {Error} si le prédicat ne rend plus rien, ou ne rend plus le core.
 */
function targets() {
    const dirs = [];
    for (const pkg of registry.all()) {
        const manifest = path.join(pkg.absDir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pj = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (pj.private === true) continue;
        if (!pj.exports) continue;
        if (!fs.existsSync(path.join(pkg.absDir, "src"))) continue;
        dirs.push(pkg.absDir);
    }
    dirs.sort();
    // Anti-périmètre-amputé : un prédicat qui ne rend plus rien produirait un manifeste vide
    // se comparant à lui-même ; s'il ne rend plus le core, il ne rend plus l'essentiel. Dans
    // les deux cas la gate refuse de conclure. (Les deux branches vues jeter par mutation.)
    if (dirs.length === 0 || !dirs.includes(CORE.absDir)) {
        throw new Error(
            `[API-SURFACE] le prédicat de périmètre rend ${dirs.length} paquet(s) et ` +
                `${dirs.includes(CORE.absDir) ? "inclut" : "N'INCLUT PAS"} le core. Le critère ` +
                "(non-private + carte `exports` + `src/`) ne décrit plus le dépôt — la gate " +
                "refuse de conclure plutôt que de gater un périmètre amputé."
        );
    }
    return dirs;
}

/**
 * Le texte documentaire d'une réflexion, normalisé en blancs.
 *
 * @param {object} reflection - La réflexion TypeDoc.
 * @returns {string} texte concaténé, suites de blancs écrasées ; `""` si aucun commentaire.
 */
function commentText(reflection) {
    const c = reflection.comment;
    if (!c) return "";
    const parts = [];
    for (const p of c.summary || []) if (p.text) parts.push(p.text);
    for (const t of c.blockTags || []) {
        parts.push(t.tag || "");
        for (const p of t.content || []) if (p.text) parts.push(p.text);
    }
    // ⚠️ L'écrasement des blancs est load-bearing : voir le § du haut sur `lint-staged`.
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Empreinte courte et stable du texte documentaire, ou `-` s'il n'y en a pas. */
function docFingerprint(reflection) {
    const t = commentText(reflection);
    if (!t) return "-";
    return crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
}

/** L'en-tête du manifeste — STATIQUE, jamais de date ni de compteur. */
const BANNER = [
    "# API_SURFACE — manifeste de la surface publique dérivée par TypeDoc.",
    "#",
    "# GÉNÉRÉ. Ne pas éditer à la main : `npm run gen:api-surface` réécrit ce fichier, et",
    "# `npm run gen:api-surface:check` (câblé dans ci:local et ci.yml) échoue s'il est périmé.",
    "#",
    "# Une ligne par réflexion : <Kind> | <nom qualifié> | doc:<empreinte du TSDoc>",
    "# L'empreinte est un sha256 tronqué du texte documentaire, blancs ÉCRASÉS — un re-wrap de",
    "# Prettier ne la change donc pas, une réécriture oui. `doc:-` = aucun commentaire.",
    "#",
    "# Ce fichier ne porte NI date NI SHA NI chemin absolu, à dessein : c'est ce qui en fait une",
    "# fonction pure de la source, donc gatable. Le rendu HTML, lui, grave le SHA de HEAD et",
    "# n'est pas gatable — motif complet dans l'en-tête de scripts/gen-api-surface.cjs.",
    "",
].join("\n");

/**
 * Construit le contenu du manifeste.
 *
 * @returns {Promise<{content: string, stats: object}>}
 * @throws {Error} si TypeDoc est absent, si un paquet ne convertit pas, ou si le manifeste
 *   sort vide — dans les trois cas la gate refuse de conclure plutôt que de sortir verte.
 */
async function build() {
    if (!fs.existsSync(TYPEDOC_ENTRY)) {
        throw new Error(
            `[API-SURFACE] TypeDoc introuvable sous ${path.relative(ROOT, TYPEDOC_ENTRY)} — ` +
                "lancer `npm install`. La gate refuse de conclure sans son convertisseur."
        );
    }
    const { Application, TSConfigReader, TypeDocReader, ReflectionKind } = await import(
        TYPEDOC_ENTRY
    );

    const dirs = targets();
    const shared = {
        skipErrorChecking: true,
        logLevel: "Error",
        readme: "none",
        excludeExternals: true, // sans lui, `Window` amène ~220 membres de lib.dom
        excludePrivate: true,
        excludeInternal: true,
        exclude: ["**/__tests__/**", "**/__mocks__/**", "**/*.test.ts", "**/*.spec.ts"],
    };

    const app = await Application.bootstrapWithPlugins(
        {
            entryPoints: dirs,
            entryPointStrategy: "packages",
            // Les 13 plugins n'ont AUCUN `typedoc.json`, et c'est voulu :
            // `generated-artifacts.cjs#declaredOutputs()` JETTE pour tout `typedoc.json` de
            // paquet sans `out`. En créer 13 créerait 13 erreurs au check 5c de l'hygiène.
            // `packageOptions` les couvre sans un octet de config par plugin. Le core, lui,
            // a sa config — TypeDoc la lit et elle GAGNE sur ces options.
            packageOptions: { ...shared, entryPoints: ["src"], entryPointStrategy: "expand" },
            name: "GeoLeaf API surface",
            ...shared,
        },
        [new TypeDocReader(), new TSConfigReader()]
    );

    const project = await app.convert();
    if (!project) {
        throw new Error(
            "[API-SURFACE] TypeDoc n'a rien converti. La gate refuse de conclure — un " +
                "manifeste vide se comparerait à lui-même et sortirait vert en ne décrivant rien."
        );
    }

    const lines = [];
    project.traverse(function walk(r) {
        lines.push(`${ReflectionKind[r.kind]} | ${r.getFullName()} | doc:${docFingerprint(r)}`);
        r.traverse(walk);
        return true;
    });
    lines.sort();

    const modules = (project.children || []).map((c) => c.name);
    if (lines.length === 0) {
        throw new Error("[API-SURFACE] manifeste vide — voir ci-dessus, même motif.");
    }
    // Anti-périmètre-rétréci : `packages` peut convertir MOINS de paquets qu'on lui en donne
    // sans que ce soit une erreur de TypeDoc. Un périmètre amputé produirait un manifeste
    // plus court, cohérent avec lui-même, et la gate resterait verte sur ce qu'elle ne
    // regarde plus. C'est le mode d'échec que `probe-gate-visibility.cjs` traque ailleurs.
    if (modules.length !== dirs.length) {
        throw new Error(
            `[API-SURFACE] ${modules.length} paquet(s) converti(s) pour ${dirs.length} ` +
                `demandé(s) — périmètre amputé, la gate refuse de conclure.\n` +
                `    demandés : ${dirs.map((d) => path.relative(ROOT, d)).join(", ")}\n` +
                `    obtenus  : ${modules.join(", ")}`
        );
    }

    return {
        content: BANNER + lines.join("\n") + "\n",
        stats: { packages: modules.length, reflections: lines.length, modules },
    };
}

async function main() {
    const { content, stats } = await build();
    const width = 72;

    if (!CHECK) {
        fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
        fs.writeFileSync(OUT_FILE, content);
        console.log(
            `✅ [API-SURFACE] ${path.relative(ROOT, OUT_FILE)} — ` +
                `${stats.reflections} réflexion(s) sur ${stats.packages} paquet(s).`
        );
        if (VERBOSE) console.log(`   paquets : ${stats.modules.join(", ")}`);
        return 0;
    }

    console.log("─".repeat(width));
    if (!fs.existsSync(OUT_FILE)) {
        console.log(
            `❌ [API-SURFACE] ${path.relative(ROOT, OUT_FILE)} est ABSENT.\n` +
                `   Lancer : npm run gen:api-surface — puis commiter le résultat.`
        );
        console.log("─".repeat(width));
        return 1;
    }
    // Comparaison d'OCTETS sur le contenu construit en mémoire, jamais un re-parse : même
    // patron que `generate-docs-tree.cjs` et `gen-config-reference.cjs`.
    const onDisk = fs.readFileSync(OUT_FILE, "utf8");
    if (onDisk !== content) {
        const a = onDisk.split("\n");
        const b = content.split("\n");
        const added = b.filter((l) => !a.includes(l)).slice(0, 8);
        const removed = a.filter((l) => !b.includes(l)).slice(0, 8);
        console.log(
            `❌ [API-SURFACE] le manifeste est PÉRIMÉ — la surface publique a bougé depuis la\n` +
                `   dernière génération (${a.length - 14} ligne(s) commitée(s) contre ${b.length - 14} mesurée(s)).\n` +
                `   Lancer : npm run gen:api-surface — puis commiter le résultat.\n`
        );
        if (removed.length) {
            console.log(`   Disparu du code (${removed.length > 8 ? "8 premiers" : "tout"}) :`);
            for (const l of removed) console.log(`     − ${l}`);
        }
        if (added.length) {
            console.log(`   Apparu dans le code (${added.length > 8 ? "8 premiers" : "tout"}) :`);
            for (const l of added) console.log(`     + ${l}`);
        }
        console.log("─".repeat(width));
        return 1;
    }

    console.log(
        `✅ [API-SURFACE] à jour — ${stats.reflections} réflexion(s), ${stats.packages} paquet(s).`
    );
    if (VERBOSE) console.log(`   paquets : ${stats.modules.join(", ")}`);
    console.log("─".repeat(width));
    return 0;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(String(err && err.message ? err.message : err));
        process.exit(2);
    }
);
