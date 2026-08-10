#!/usr/bin/env node
/**
 * Which packages belong to which test scope — et l'invariant qui les lie (B.48).
 *
 * Ce dépôt exécute ses tests unitaires de **deux** manières, et il faut les deux :
 *
 *   1. **L'essaimage turbo** — `npm test` → `turbo run test`, un processus `vitest run`
 *      par package, chacun lisant SA config. C'est le gate de `ci:local`.
 *   2. **Le mode `projects`** — `npx vitest run` depuis la racine, un SEUL processus qui
 *      charge les configs des packages comme autant de projets. C'est le gate de `ci.yml`.
 *
 * Chacun avait sa propre liste, écrite à la main, et elles avaient divergé. L'en-tête de
 * `packages.cjs` le notait déjà : « le script `test` racine et `vitest.config.ts#projects`
 * divergeaient sur neuf paquets ». Au 22/07/2026 la liste de `npm test` sautait encore
 * **5 paquets / 27 fichiers de test** (`plugin-cog`, `plugin-file-import`,
 * `plugin-flatgeobuf`, `plugin-realtime-layer`, `host-runtime`) — jamais par arbitrage :
 * `git log -L21,21:package.json` montre une liste **par accrétion**, où chaque paquet
 * était ajouté à la main le jour où il recevait des tests. Les 5 n'ont jamais été ajoutés.
 *
 * ## L'invariant : `unitScope() ⊇ rootProjectScope()`
 *
 * C'est la seule propriété qui rende vraie la phrase du protocole de push — « local vert
 * → push sûr ». Si `ci:local` teste moins que `ci.yml`, un vert local ne dit rien du run
 * distant, et le quota GitHub Actions se dépense sur une inconnue.
 *
 * Elle est donc **vérifiée, pas conventionnée** : {@link assertUnitScopeCoversRoot} jette.
 *
 * ## Pourquoi les deux listes sont dérivées, et les exceptions écrites
 *
 * Même raison que `packages.cjs` : une liste en dur **ne casse pas** au déplacement d'un
 * paquet, elle cesse silencieusement de matcher, et la gate sort verte en n'ayant rien
 * scanné. Ici, un nouveau paquet rejoint les deux périmètres **par défaut** ; l'en sortir
 * exige d'écrire pourquoi, dans {@link PARKED} ou {@link EXCLUDED_FROM_ROOT_RUN}.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Paquets mis au parc, exclus du gate unitaire turbo (`npm test`).
 *
 * **Vide au 22/07/2026, et c'est l'état normal.** Ce registre existe pour que la roadmap
 * PLUGINS puisse sortir un paquet du gate le temps d'une réécriture SANS le faire par
 * omission — la raison est obligatoire, et elle est lue à chaque run.
 *
 * ⚠️ **Parquer cache réellement le paquet, et des DEUX gates locaux** — l'unitaire et
 * celui de couverture passent tous deux par `run-tests.cjs`. C'est assumé : un paquet
 * qu'on parque est un paquet dont on a décidé de ne plus lire les tests pour un temps.
 * Ce qui change par rapport à l'omission silencieuse d'avant, c'est que le fait est
 * **écrit, motivé, et affiché à chaque exécution** au lieu d'être invisible.
 *
 * Le garde-fou est ailleurs : {@link assertUnitScopeCoversRoot} interdit de parquer un
 * paquet que `ci.yml` continue, lui, d'exécuter — sinon un vert local couvrirait un rouge
 * distant.
 *
 * @type {Record<string, string>}
 */
const PARKED = {};

/**
 * Paquets délibérément absents du run `projects` racine (`npx vitest run`) — ARCHI S9.3.
 *
 * Déplacé ici depuis `vitest.config.ts` (B.48) : c'est une connaissance de **périmètre**,
 * pas de configuration Vitest, et elle doit être lisible par le runner CJS qui vérifie
 * l'invariant. La config racine la lit maintenant depuis ce module.
 *
 * La liste était jadis l'inverse — 11 chemins en dur, donc toute exclusion était une
 * exclusion PAR OMISSION : invisible, inexpliquée, et silencieusement fausse le jour où
 * un paquet bougeait. Énoncer les exclusions signifie qu'un nouveau paquet rejoint le run
 * par défaut, et qu'en retirer un demande désormais d'écrire pourquoi.
 *
 * @type {Record<string, string>}
 */
const EXCLUDED_FROM_ROOT_RUN = {
    "@geoleaf-plugins/offline-ui":
        "infrastructure de test à reprendre (mock IndexedDB/IDBFactory) — exclusion héritée",
    "@geoleaf/field-renderer": "tourne en autonome via son propre `npm test`",
    "@geoleaf-plugins/editor": "tourne en autonome via son propre `npm test`",
    "@geoleaf-plugins/measure": "tourne en autonome via son propre `npm test`",
    "@geoleaf/host-runtime": "tourne en autonome via son propre `npm test`",
    "@geoleaf/build-config": "package de configuration — aucun test propre",
};

/**
 * Les paquets qui portent une suite Vitest, dérivés — et la cohérence config/script
 * vérifiée au passage.
 *
 * Le filtre est **structurel** (`vitest.config.ts` présent), donc un paquet qui perdrait
 * sa config disparaîtrait des deux périmètres sans bruit : exactement le mode d'échec que
 * ce module combat. D'où le contre-contrôle — un `package.json` qui déclare un script
 * `test` sans config, ou l'inverse, **jette**.
 *
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function testablePackages() {
    const all = registry.all();
    /** @type {string[]} */
    const inconsistent = [];
    const testable = [];

    for (const p of all) {
        const hasConfig = fs.existsSync(path.join(p.absDir, "vitest.config.ts"));
        const hasScript = Boolean(p.manifest.scripts && p.manifest.scripts.test);

        if (hasConfig !== hasScript) {
            inconsistent.push(
                `  - ${p.name} (${p.dir}) : vitest.config.ts ${hasConfig ? "présent" : "ABSENT"}, ` +
                    `script "test" ${hasScript ? "déclaré" : "ABSENT"}`
            );
            continue;
        }
        if (hasConfig) testable.push(p);
    }

    if (inconsistent.length) {
        throw new Error(
            "test-scope.cjs : config Vitest et script `test` désaccordés — un paquet ne peut " +
                "pas sortir d'un périmètre de test en silence.\n" +
                inconsistent.join("\n")
        );
    }

    return testable;
}

/**
 * Périmètre du gate unitaire turbo (`npm test`).
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function unitScope() {
    return testablePackages().filter((p) => !(p.name in PARKED));
}

/**
 * Périmètre du run `projects` racine (`npx vitest run`).
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function rootProjectScope() {
    return testablePackages().filter((p) => !(p.name in EXCLUDED_FROM_ROOT_RUN));
}

/**
 * Vérifie que chaque clé de {@link PARKED} et {@link EXCLUDED_FROM_ROOT_RUN} désigne
 * un paquet qui existe. Jette en nommant les clés mortes.
 *
 * ⚠️ STRUCT S3 (26/07/2026) — cette vérification MANQUAIT, et c'est ce qui faisait de
 * ces deux tables une panne SILENCIEUSE. Les deux filtres sont des `!(p.name in TABLE)` :
 * une clé qui ne correspond à aucun paquet ne retire rien et n'avertit de rien. Au
 * renommage `@geoleaf-plugins/storage` → `@geoleaf-plugins/offline-ui`, le paquet aurait
 * donc réintégré le run `projects` racine **sans un mot**, avec son infrastructure de mock
 * IndexedDB non portée — un rouge attribué au mauvais coupable, deux sprints plus tard.
 *
 * L'asymétrie compte : une clé morte est toujours une erreur (on a nommé un paquet qui
 * n'existe pas), alors qu'un paquet absent des deux tables est le cas NORMAL — il tourne.
 *
 * ⚠️ Le critère de vivacité est `registry.all()`, PAS `testablePackages()`. Première
 * version écrite sur `testablePackages()` : elle a rougi sur `@geoleaf/build-config`,
 * une exclusion parfaitement légitime — ce paquet n'a aucun test, donc aucune
 * `vitest.config.ts`, donc il n'est pas « testable ». Exclure un paquet sans suite est
 * précisément ce qu'on veut pouvoir écrire ; c'est son ABSENCE DU DÉPÔT qui est l'erreur.
 *
 * @returns {void}
 */
function assertExclusionKeysAlive() {
    const alive = new Set(registry.all().map((p) => p.name));
    /** @type {string[]} */
    const dead = [];

    for (const [table, entries] of [
        ["PARKED", PARKED],
        ["EXCLUDED_FROM_ROOT_RUN", EXCLUDED_FROM_ROOT_RUN],
    ]) {
        for (const name of Object.keys(entries)) {
            if (!alive.has(name)) dead.push(`  - ${name} : clé de ${table}, paquet introuvable`);
        }
    }

    if (dead.length) {
        throw new Error(
            "test-scope.cjs : une exclusion nomme un paquet qui n'existe pas. Elle ne retire " +
                "plus rien — le paquet visé est SILENCIEUSEMENT revenu dans le périmètre.\n" +
                dead.join("\n") +
                "\nRe-keyer l'entrée sur le nouveau nom du paquet, ou la supprimer si " +
                "l'exclusion n'a plus lieu d'être."
        );
    }
}

/**
 * Vérifie `unitScope() ⊇ rootProjectScope()` — la propriété qui rend vrai
 * « `ci:local` vert → push sûr ». Jette en nommant les paquets fautifs.
 *
 * Un paquet ne peut être dans le run racine ET au parc : on l'aurait retiré du gate local
 * tout en le laissant dans le gate distant, soit précisément le cas où un vert local ne
 * dit rien du rouge à venir.
 *
 * @returns {void}
 */
function assertUnitScopeCoversRoot() {
    assertExclusionKeysAlive();

    const unit = new Set(unitScope().map((p) => p.name));
    const missing = rootProjectScope()
        .map((p) => p.name)
        .filter((name) => !unit.has(name));

    if (missing.length) {
        throw new Error(
            "test-scope.cjs : `ci:local` testerait MOINS que `ci.yml` — un vert local ne " +
                "dirait plus rien du run distant, et le quota se dépenserait sur une inconnue.\n" +
                missing
                    .map((n) => `  - ${n} : dans le run racine, mais au parc (PARKED)`)
                    .join("\n") +
                "\nRetirer ces paquets de PARKED, ou les exclure AUSSI du run racine " +
                "(EXCLUDED_FROM_ROOT_RUN) en écrivant la raison."
        );
    }
}

// Surface volontairement réduite à ce qui est consommé : `run-tests.cjs` (les trois
// premiers) et `vitest.config.ts` (le dernier). `EXCLUDED_FROM_ROOT_RUN` et
// `testablePackages` restent internes — les exposer sans consommateur ferait de ce module
// une source d'exports orphelins, que `dead-code` (knip) et `check-orphan-exports` gatent.
module.exports = {
    PARKED,
    unitScope,
    assertUnitScopeCoversRoot,
    rootProjectScope,
};
