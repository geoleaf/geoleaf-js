#!/usr/bin/env node
/**
 * Répertoires d'ARTEFACTS GÉNÉRÉS — définition unique, trois lecteurs.
 *
 * Lecteurs : `verify-repo-hygiene.cjs` (check 4, exemption de la limite de 700 lignes ;
 * check 5, interdiction d'indexation) et `check-package-files.cjs` (check 2, interdiction
 * de publication npm). Une seconde liste divergerait — c'est le motif pour lequel
 * `lib/source-inventory.cjs` et `lib/test-load-sites.cjs` ont été extraits.
 *
 * ## Pourquoi des FORMES de chemin, et jamais des emplacements
 *
 * `verify-repo-hygiene.cjs:279` portait déjà cette liste, sous le nom
 * `GENERATED_PATH_RE`. Mesure au T4 : elle matchait **zéro fichier**. Elle n'était
 * consultée que par `collectSourceFiles`, dont le périmètre est `<pkg>/src` — or aucun
 * `docs/api`, `docs/public` ni `docs-dist` ne vit sous un `src/`. La liste des chemins
 * d'artefacts du dépôt était elle-même vide-verte, pendant que 90 fichiers TypeDoc
 * générés étaient suivis par git et publiés sur npm.
 *
 * D'où la règle de conception, qui est la leçon du T3 appliquée littéralement : écrire
 * `packages/core/docs/api` en dur reproduirait la faute à l'identique. Le jour où le
 * core se déplace, ou où `docs-dist/` sort de `packages/`, une forme absolue cesse de
 * matcher — elle ne RATE pas des violations, elle sort **verte en ne regardant plus
 * rien**. Aucune des trois formes ci-dessous ne nomme son parent : toutes survivent aux
 * déplacements.
 *
 * ## Le complément indispensable : la dérivation depuis le producteur
 *
 * Une liste de formes, même relative, reste aveugle à un RENOMMAGE : si `typedoc.json`
 * passe à `"out": "docs/reference"`, plus aucun fichier généré ne tombe dans le
 * périmètre et rien ne rougit. `declaredOutputs()` lit la déclaration du producteur au
 * lieu de recopier son chemin, ce qui permet à la gate de DIRE qu'elle a perdu de vue
 * une sortie — au lieu de se taire.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Les formes de chemin qui désignent un répertoire d'artefacts générés.
 *
 * ⚠️ Relatives et sans parent, délibérément — voir l'en-tête de ce module.
 */
const GENERATED_DIR_FORMS = [
  { form: "docs/api", label: "sortie TypeDoc (typedoc.json → out)" },
  { form: "docs/public", label: "assets statiques VitePress (deploy-docs.cjs steps 2 + 2b)" },
  { form: "docs-dist", label: "build VitePress (.vitepress/config.ts → outDir)" },
];

/**
 * La racine d'artefact qui contient `p`, ou `null`.
 *
 * Comparaison par SEGMENTS, jamais par sous-chaîne : `docs/publicity/x.md` et
 * `packages/my-docs-dist-tool/a.js` ne sont pas des artefacts, alors qu'un
 * `String.includes("docs/public")` ou `includes("docs-dist")` les capterait tous les
 * deux. Un faux positif ici ferait rougir une gate sur une source rédigée.
 *
 * Rendre la RACINE (et pas seulement `true`) est ce qui permet de grouper le rapport :
 * 91 lignes de HTML sont illisibles, 2 lignes avec compteurs se lisent.
 *
 * @param {string} p Chemin relatif au dépôt (séparateurs `/` ou `\`).
 * @returns {{root: string, form: string, label: string} | null}
 */
function generatedRootOf(p) {
  const parts = String(p).replaceAll("\\", "/").split("/");
  for (const { form, label } of GENERATED_DIR_FORMS) {
    const f = form.split("/");
    for (let i = 0; i + f.length <= parts.length; i++) {
      if (f.every((seg, k) => parts[i + k] === seg)) {
        return { root: parts.slice(0, i + f.length).join("/"), form, label };
      }
    }
  }
  return null;
}

/** Raccourci booléen de `generatedRootOf`. */
const isGeneratedPath = (p) => generatedRootOf(p) !== null;

/**
 * Les sorties DÉCLARÉES par un producteur, lues dans sa déclaration.
 *
 * Aujourd'hui : le `out` de chaque `typedoc.json` du registre. `docs/public` n'a pas de
 * producteur déclaratif (ce sont des constantes JS de `deploy-docs.cjs`), et `docs-dist`
 * est déclaré dans un `.ts` que ce module ne parse pas — les deux restent couverts par
 * `GENERATED_DIR_FORMS`. Les deux moitiés se compensent : celle-ci est vivante sur un
 * clone frais où rien n'a encore été généré, celle-là couvre ce qu'aucun JSON ne déclare.
 *
 * @returns {Array<{producer: string, rel?: string, error?: string}>}
 */
function declaredOutputs() {
  const out = [];
  for (const pkg of require("./packages.cjs").all()) {
    const cfg = path.join(pkg.absDir, "typedoc.json");
    if (!fs.existsSync(cfg)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(cfg, "utf8"));
    } catch (e) {
      out.push({ producer: `${pkg.dir}/typedoc.json`, error: `JSON invalide — ${e.message}` });
      continue;
    }
    // Un `out` absent n'est pas neutre : le défaut de TypeDoc est `./docs`, c'est-à-dire
    // l'arbre RÉDIGÉ. Il écraserait 62 .md par du HTML généré. Silencieux serait pire
    // que rouge.
    if (typeof json.out !== "string" || json.out.length === 0) {
      out.push({
        producer: `${pkg.dir}/typedoc.json`,
        error: 'pas de "out" — TypeDoc écrirait dans ./docs, soit l\'arbre rédigé',
      });
      continue;
    }
    out.push({
      producer: `${pkg.dir}/typedoc.json ("out")`,
      rel: `${pkg.dir}/${json.out.replace(/^\.\//, "").replace(/\/+$/, "")}`,
    });
  }
  return out;
}

/**
 * Demande à git lesquels des chemins donnés sont ignorés. Un seul appel groupé.
 *
 * `git check-ignore` sort en 1 quand rien ne matche : c'est un résultat normal ici, et
 * surtout pas un échec.
 *
 * La barre oblique finale est PORTEUSE et doit être préservée : `.gitignore` écrit
 * `dist/`, et un motif à slash final ne matche qu'un RÉPERTOIRE. Sur un chemin nu
 * (`packages/x/dist`), git ne peut pas savoir qu'il s'agit d'un répertoire s'il n'existe
 * pas sur le disque — le motif ne matcherait pas et l'entrée serait déclarée manquante.
 * C'est précisément le cas du clone frais, avant le premier build.
 *
 * @param {string[]} queryPaths Chemins relatifs au dépôt, slash final compris.
 * @param {{noIndex?: boolean}} [opts] `noIndex` ajoute `--no-index` : la question devient
 *   « une RÈGLE couvre-t-elle ce chemin ? » et non « ce chemin est-il suivi ? ». Sans
 *   lui, git refuse de qualifier d'ignoré un chemin présent dans l'index — ce qui rend
 *   muette toute vérification menée AVANT une désindexation.
 * @returns {Set<string>} Le sous-ensemble ignoré, tel qu'écrit en entrée.
 */
function gitIgnoredSet(queryPaths, opts = {}) {
  if (queryPaths.length === 0) return new Set();
  const args = ["check-ignore", "--stdin"];
  if (opts.noIndex) args.push("--no-index");
  const res = spawnSync("git", args, {
    cwd: ROOT,
    input: queryPaths.join("\n"),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) return new Set(); // git indisponible → tout vérifier
  return new Set(
    (res.stdout || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

module.exports = {
  GENERATED_DIR_FORMS,
  generatedRootOf,
  isGeneratedPath,
  declaredOutputs,
  gitIgnoredSet,
};
