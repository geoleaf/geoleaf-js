#!/usr/bin/env node
/**
 * Racines de la DOCUMENTATION — définition unique, quinze lecteurs.
 *
 * Lecteurs : les 11 scripts qui écrivent ou lisent un artefact de `reference/`
 * (`generate-docs-tree`, `gen-api-surface`, `gen-attributes-report`,
 * `gen-profile-schema-reference`, `gen-config-reference`, `check-tsdoc-conformity`,
 * `check-config-coverage`, `check-config-consumers`, `check-dead-links`,
 * `audit-report-freshness`, `audit-cleanup`) et les 3 guards de `packages/core/__tests__/guards/`
 * qui lisent `specs/`. Une seconde liste divergerait — même motif que `lib/packages.cjs`,
 * `lib/source-inventory.cjs` et `lib/generated-artifacts.cjs`.
 *
 * ## Deux racines, parce que la documentation se SCINDE
 *
 * Le passage du dépôt en public partage `_docs_projet/` en deux :
 *
 *   `docs/`           PUBLIC   — `specs/`, `reference/`, `guides/`
 *   `_docs_projet/`   INTERNE  — `ETAT`, `JOURNAL`, `INDEX`, les 2 checklists,
 *                                `registres/`, `travail/`, `vision/`
 *
 * Les deux racines coïncident avant le déplacement et divergent après : c'est le seul
 * endroit du dépôt qui le sait, et c'est pour ça que la bascule tient en une ligne.
 * ⚠️ **Ne jamais dériver l'une de l'autre** — `internal("specs")` doit rester faux, pas
 * devenir un synonyme. Un helper permissif rendrait la scission invisible aux lecteurs.
 *
 * ## Pourquoi ce module JETTE — et pourquoi les deux racines ne jettent pas au même moment
 *
 * Les onze scripts partageaient une seule forme :
 *
 *     const OUT = path.join(ROOT, "_docs_projet", "reference", "X.md");
 *
 * Déplacer le répertoire ne les casse pas : il les rend **muets**. Un générateur écrit
 * alors son artefact à un chemin que plus personne ne lit, et une gate qui marche un
 * répertoire absent rend `[]` — donc « 0 lien mort sur 0 fichier », **exit 0**. C'est le
 * mode d'échec mesuré sur les 7 scopes `_docs_projet` de `check-dead-links.cjs`, dont
 * aucun ne portait `mustNotBeEmpty`.
 *
 * Jeter transforme la disparition silencieuse en panne bruyante. Un lecteur qui ne trouve
 * plus sa racine doit s'arrêter, pas continuer en ne regardant rien — c'est la doctrine
 * `packages.cjs` (« a registry that silently returns fewer packages than it should is worse
 * than no registry »), appliquée aux docs.
 *
 * ⚠️ **Mais les deux racines n'ont pas la même existence, et depuis le 10/08/2026 elles ne
 * s'assertissent plus au même instant.** `DOCS_ROOT` est vérifiée **au chargement** : elle
 * existe partout, y compris dans le dépôt public, donc l'exiger tôt est gratuit.
 * `INTERNAL_ROOT` est vérifiée **au premier appel d'`internal()`**, parce qu'elle
 * **n'existe légitimement pas** dans le clone public — la tâche 9.4 du passage public l'y
 * retire, délibérément.
 *
 * 🛑 **Le motif, et il vaut d'être lu avant de « rétablir la symétrie ».** L'assertion au
 * chargement était juste au Sprint 6, où le danger était un déplacement **silencieux** ;
 * au Sprint 9 le retrait est **voulu**, et la même ligne devenait un arrêt. Mesuré sur le
 * clone réel : les **16** fichiers qui requièrent ce module jetaient, dont **11 gates de
 * `ci:local`**, alors que **3 seulement** appellent `internal()`. Treize lecteurs publics
 * étaient arrêtés par une assertion qui ne les concerne pas — et `ci:local` sur le clone,
 * « la seule mesure qui compte » du passage public, ne pouvait pas démarrer.
 *
 * 📌 **Ce report ne coûte RIEN aux trois vrais lecteurs, et c'est vérifiable** :
 * `audit-cleanup.cjs`, `audit-report-freshness.cjs` et `check-config-consumers.cjs`
 * appellent `internal()` en **portée de module**, pas dans une fonction. Le jet se déplace
 * donc de la ligne de ce module à leur propre première ligne — **même instant d'exécution,
 * même message**. Il change qui meurt, pas quand.
 *
 * ## Les deux surcharges d'environnement, et à quoi elles servent vraiment
 *
 * `GEOLEAF_DOCS_ROOT` et `GEOLEAF_INTERNAL_DOCS_ROOT` ne sont pas là pour la souplesse :
 * elles existent pour **mettre les quinze lecteurs à l'épreuve pendant qu'on a encore le
 * filet**, avant tout déplacement. Deux injections distinctes, deux pannes distinctes :
 *
 *   racine INEXISTANTE → ce module jette         (le lecteur meurt bruyamment)
 *   racine VIDE mais existante → il ne jette pas (c'est `mustNotBeEmpty` qui doit mordre)
 *
 * Confondre les deux ferait croire qu'une assertion anti-gate-vide est éprouvée alors que
 * c'est le garde de racine qui a parlé.
 *
 * Usage :
 *   const docsPaths = require("./lib/docs-paths.cjs");
 *   docsPaths.reference("API_SURFACE.txt");        // <repo>/docs/reference/API_SURFACE.txt
 *   docsPaths.specs("capacites");                  // <repo>/docs/specs/capacites
 *   docsPaths.internal("travail", "rapports");     // <repo>/_docs_projet/travail/rapports
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Résout une racine : la surcharge d'environnement si elle est posée, sinon le défaut.
 *
 * Une surcharge relative est résolue depuis la racine du dépôt et non depuis
 * `process.cwd()` — les gates s'invoquent depuis n'importe où, et un chemin qui dépend du
 * répertoire courant redonnerait exactement l'instabilité que ce module retire.
 *
 * @param {string} envName Nom de la variable d'environnement.
 * @param {string} fallbackRel Chemin par défaut, relatif au dépôt.
 * @returns {string} Chemin absolu.
 */
function resolveRoot(envName, fallbackRel) {
    const raw = process.env[envName];
    return raw && raw.length > 0
        ? path.resolve(REPO_ROOT, raw)
        : path.join(REPO_ROOT, fallbackRel);
}

/**
 * Racine de la doc PUBLIQUE — `specs/`, `reference/`, `guides/`.
 *
 * ⚠️ C'est LA ligne que le déplacement du 10/08/2026 a basculée, et la seule : les quinze
 * lecteurs ont suivi sans qu'aucun ne soit retouché. Avant elle, les quatorze qui peuvent
 * jeter ont été VUS jeter sur une racine inexistante — pendant que `_docs_projet/` était
 * encore là, donc pendant qu'un vert avait encore un sens.
 */
const DOCS_ROOT = resolveRoot("GEOLEAF_DOCS_ROOT", "docs");

/** Racine de la doc INTERNE — `registres/`, `travail/`, `vision/`, et les 5 fichiers de tête. */
const INTERNAL_ROOT = resolveRoot("GEOLEAF_INTERNAL_DOCS_ROOT", "_docs_projet");

/**
 * Jette si la racine est absente ou n'est pas un répertoire.
 *
 * Le message nomme la surcharge : sans elle, un opérateur qui vient de déplacer un
 * répertoire lit « introuvable » et cherche une faute de frappe, alors que la réponse est
 * une ligne de ce fichier.
 *
 * @param {string} abs Chemin absolu à vérifier.
 * @param {string} label Nom lisible de la racine.
 * @param {string} envName Variable d'environnement qui la surcharge.
 */
function requireRoot(abs, label, envName) {
    let ok = false;
    try {
        ok = fs.statSync(abs).isDirectory();
    } catch {
        ok = false;
    }
    if (!ok) {
        throw new Error(
            `docs-paths.cjs — racine ${label} introuvable : ${abs}\n` +
                `  Ce module JETTE plutôt que de laisser un lecteur marcher un répertoire absent\n` +
                `  et rendre « 0 résultat » en sortant 0. Corriger le chemin, ou poser ${envName}.`
        );
    }
}

requireRoot(DOCS_ROOT, "PUBLIQUE", "GEOLEAF_DOCS_ROOT");

/**
 * L'assertion de la racine INTERNE n'a été passée qu'une fois — voir le §« Pourquoi ce
 * module JETTE » : elle est reportée au premier `internal()` parce que le clone public
 * n'a légitimement pas ce répertoire, et que 13 des 16 lecteurs n'y touchent jamais.
 */
let internalRootChecked = false;

/** Un chemin sous la racine PUBLIQUE. */
const docs = (...seg) => path.join(DOCS_ROOT, ...seg);

/** Un chemin sous `docs/reference/` — le généré et le lu-par-un-programme. */
const reference = (...seg) => docs("reference", ...seg);

/** Un chemin sous `docs/specs/` — les 45 fiches gelées. */
const specs = (...seg) => docs("specs", ...seg);

/** Un chemin sous `docs/guides/` — les procédures. */
const guides = (...seg) => docs("guides", ...seg);

/**
 * Un chemin sous la racine INTERNE — ce qui ne part pas dans le dépôt public.
 *
 * ⚠️ **C'est ICI que la racine interne est assertie**, au premier appel et pas au
 * chargement du module : un lecteur qui n'appelle jamais `internal()` n'a aucune raison de
 * mourir parce que `_docs_projet/` est absent, et il l'est **par construction** dans le
 * clone public. La panne bruyante est intégralement conservée pour qui s'en sert.
 *
 * @param {...string} seg Segments de chemin sous la racine interne.
 * @returns {string} Chemin absolu.
 * @throws {Error} Si la racine interne est absente ou n'est pas un répertoire.
 */
const internal = (...seg) => {
    if (!internalRootChecked) {
        requireRoot(INTERNAL_ROOT, "INTERNE", "GEOLEAF_INTERNAL_DOCS_ROOT");
        internalRootChecked = true;
    }
    return path.join(INTERNAL_ROOT, ...seg);
};

/**
 * La racine INTERNE existe-t-elle ? Prédicat qui **ne jette jamais**.
 *
 * ⚠️ **Il n'existe que pour un cas, et l'élargir serait le dénaturer** : un lecteur du corpus
 * interne qui tourne sur le **dépôt public**, où `_docs_projet/` est absent **par décision**
 * (tâche 9.4 du passage public). Là, jeter n'apprend rien — l'absence est le contrat. Un tel
 * lecteur doit **SAUTER en le disant**, patron `CONSUMER-CONTRACT/CC-00`, jamais verdir en
 * silence.
 *
 * 🛑 **Ne pas s'en servir pour éviter un jet dans l'atelier.** Ici, une racine interne absente
 * est un défaut, et `internal()` doit continuer de mourir bruyamment : c'est toute la doctrine
 * du §« Pourquoi ce module JETTE ». Le prédicat distingue « absente parce que ce dépôt ne la
 * porte pas » de « absente parce que quelque chose est cassé » — les deux se ressemblent à
 * l'octet, et seul l'appelant sait dans lequel des deux mondes il tourne.
 *
 * 📌 Il répond `false` **uniquement** sur une racine inexistante ou non-répertoire. Une racine
 * présente mais **VIDE** rend `true` : c'est à `mustNotBeEmpty` de mordre là, distinction que
 * le §« Les deux surcharges d'environnement » pose déjà et qu'il ne faut pas confondre.
 *
 * @returns {boolean} `true` si la racine interne est un répertoire existant.
 */
function internalRootExists() {
    try {
        return fs.statSync(INTERNAL_ROOT).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Chemin relatif au dépôt, en séparateurs POSIX — pour les messages de gate.
 *
 * Les gates impriment des chemins que l'on recopie dans un éditeur ; un antislash y
 * survit mal, et un chemin absolu de poste n'a rien à faire dans une sortie partagée.
 *
 * @param {string} abs
 * @returns {string}
 */
const rel = (abs) => path.relative(REPO_ROOT, abs).replaceAll("\\", "/");

module.exports = {
    REPO_ROOT,
    DOCS_ROOT,
    INTERNAL_ROOT,
    docs,
    reference,
    specs,
    guides,
    internal,
    internalRootExists,
    rel,
};
