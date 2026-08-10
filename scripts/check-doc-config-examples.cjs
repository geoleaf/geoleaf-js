#!/usr/bin/env node
/**
 * @fileoverview DOC-CONFIG-EXAMPLES — les exemples de configuration JSON de la doc PRODUIT
 * sont-ils validables par les schémas de profil ?
 *
 * ## Le trou que cette gate ferme
 *
 * Le dépôt gate déjà lourdement ses exemples de doc — `validate-docs-examples.cjs` traque les
 * API fantômes, `typecheck-docs-examples.cjs` compile les blocs TypeScript **et** les
 * `@example` du TSDoc. Les deux ont le même angle mort : **ils regardent du CODE**. Un bloc
 * ` ```json ` décrivant un profil n'est ni une API ni du TypeScript — personne ne le lit.
 *
 * Or `profiles/schemas/*.json` pose `additionalProperties: false` sur ses objets à forme
 * fixe. Une clé retirée d'un schéma mais laissée dans un exemple de doc produit un extrait
 * **copiable-collable qui fait échouer `npm run validate:profiles` chez l'intégrateur**, dans
 * les deux guides de configuration les plus lus du projet.
 *
 * 🛑 **C'est la forme EXACTE du trou comblé le 31/07/2026** — un `GeoLeaf.POI.add()` copiable
 * vivait dans `README.md` et `packages/core/README.md` alors que la règle qui l'interdit
 * existait et avait été vue mordre. **La règle était bonne, son corpus s'arrêtait avant.**
 * Ici, le corpus était bon et c'est le TYPE DE BLOC qui s'arrêtait avant.
 *
 * ## Les trois règles
 *
 *   CDE-01  Aucune clé invalide NEUVE dans un exemple de config JSON. Une clé absente de la
 *           baseline est une erreur : elle ne peut pas naître en dette.
 *   CDE-02  La baseline ne peut que RÉTRÉCIR. Une entrée corrigée dans la doc doit être
 *           retirée du fichier.
 *   CDE-03  Ni le corpus ni la table de conteneurs ne peuvent être vides. Une gate verte qui
 *           n'a rien scanné, ou qui n'a résolu aucun schéma, est le pire des résultats —
 *           même classe que NNA-03, EOD-03 et JTD-03.
 *
 * ## Deux décisions de conception, chacune motivée par un défaut MESURÉ
 *
 * **Les conteneurs sont DÉRIVÉS des schémas, jamais listés ici.** On indexe tout objet à
 * `additionalProperties: false` portant ses propres `properties`, par son nom de propriété.
 * Une liste écrite à la main se périmerait au premier schéma modifié — et elle se périmerait
 * en SILENCE, en cessant de matcher, exactement la classe que `probe-gate-visibility.cjs`
 * surveille.
 *
 * **Le corpus vient de `productDocsFiles()`** (`lib/tsdoc-examples.cjs`), partagé avec les
 * deux autres gates de doc. Un seul corpus, trois consommateurs — jamais un glob
 * `packages/**`, qui capterait `dist/` et `node_modules/`.
 *
 * ⚠️ **Le premier instrument écrit pour ce relevé était FAUX, et il faut le dire ici** : il
 * comparait les clés `ui.*` des exemples aux propriétés de PREMIER NIVEAU de
 * `ui.schema.json` — or ce schéma décrit le FICHIER `ui.json`, dont la racine est
 * `{_comment, ui, layerManagerConfig}`. Il rendait **75 violations dont l'immense majorité
 * étaient fausses**, contre **44 réelles** une fois l'indexation corrigée. C'est le
 * corollaire « le pré-vol porte la cécité qu'il mesure », rencontré en écrivant la gate qui
 * mesure. D'où l'indexation générique ci-dessous, qui ne suppose aucune profondeur.
 *
 * ## Ce que cette gate NE garde pas
 *
 * Elle vérifie l'**existence** des clés, pas leurs types ni les `required`. Les exemples de
 * doc sont des FRAGMENTS : valider un fragment contre le schéma complet ferait rougir sur
 * `required` toutes les illustrations partielles, c'est-à-dire presque toutes. La classe
 * traquée est « cette clé n'existe pas / plus », et c'est celle qui casse au copier-coller.
 *
 * ⚠️ **Limite résiduelle, bornée et assumée : le rapprochement se fait par NOM, donc un bloc
 * JSON qui n'est pas un profil mais qui emploie un nom de conteneur de profil est jugé comme
 * s'il en était un.** Mesuré au câblage : 3 entrées `map.target` viennent d'exemples
 * d'initialisation JavaScript, pas de profils. Le retrait des noms ambigus (ci-dessus) a
 * éliminé la classe massive — 150 → 118 entrées, dont les 24 `data.*` qui étaient toutes
 * fausses — et le reste est absorbé par la baseline. Fermer ce dernier cas demanderait
 * d'identifier le TYPE de document de chaque bloc, ce qu'aucun marqueur du corpus ne donne
 * aujourd'hui. Préférence assumée : un faux positif est bruyant et se corrige ; un faux
 * négatif est silencieux, et c'est exactement la classe que cette gate existe pour fermer.
 *
 * ⚠️ **Ce que le correctif du 09/08/2026 a COÛTÉ, mesuré avant d'être écrit.** Relever
 * l'ouverture d'un nœud `additionalProperties: true` sans `properties` (voir `visit()`) fait
 * sortir **un seul** conteneur de l'index : `offline`. Les clés d'un bloc `offline` de NIVEAU
 * COUCHE ne sont donc plus jugées dans les exemples de doc. Perte mesurée le jour même :
 * **0 violation** — 93 → 92, la seule disparue étant le faux positif du CHANGELOG, et **0**
 * entrée de baseline devenue orpheline (elle n'en citait aucune en `offline.*`). C'est la
 * conséquence honnête d'un nom que deux schémas emploient pour deux choses ; la taire aurait
 * demandé de réécrire un exemple JUSTE.
 *
 * 🛑 **Et une variante plus large a été mesurée puis ÉCARTÉE** : ne plus juger sous un parent
 * ouvert (`modules`, `data`, `table`…) supprimait 6 violations — dont
 * `defaultSort.direction`, qui est un **VRAI** défaut (`layer-config.schema.json` déclare
 * `{field, order}`, la doc écrit `direction`) aujourd'hui correctement gelé en baseline. Elle
 * achetait la réparation d'un faux positif au prix d'un faux négatif, c'est-à-dire du mauvais
 * côté de l'arbitrage énoncé juste au-dessus.
 *
 * ⚠️ **Une trouvaille du câblage, laissée ouverte parce qu'elle sort du périmètre** :
 * `themes.schema.json` déclare **`defautTheme`** (sans le second `l`) là où la doc écrit
 * `defaultTheme`. C'est une faute de frappe DANS LE SCHÉMA, donc un renommage de clé de
 * configuration — cassant pour les profils, à trancher séparément.
 *
 * ## Usage
 *
 *        node scripts/check-doc-config-examples.cjs
 *        node scripts/check-doc-config-examples.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` se lance APRÈS avoir corrigé la doc, jamais pour faire taire un
 * exemple neuf — qui doit être écrit avec des clés qui existent.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { productDocsFiles } = require("./lib/tsdoc-examples.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "profiles", "schemas");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "doc-config-examples.json");
const UPDATE = process.argv.includes("--update-baseline");

/**
 * Indexe, dans tous les schémas de profil, les objets à forme FERMÉE
 * (`additionalProperties: false`) portant leurs propres `properties`, par leur nom de
 * propriété.
 *
 * ⚠️ La descente est générique et ne suppose AUCUNE profondeur : c'est précisément
 * l'hypothèse de profondeur qui avait faussé le premier relevé (voir l'en-tête). Un
 * conteneur peut vivre sous `properties`, sous `items`, sous `definitions` ou sous un
 * `patternProperties` — tous sont visités.
 *
 * @returns {Map<string, Set<string>>} nom de conteneur → clés qu'il accepte
 */
function closedContainers() {
    /** @type {Map<string, Set<string>>} */
    const index = new Map();
    /**
     * Noms qu'AU MOINS UN schéma déclare OUVERT. Ils sont retirés de l'index à la fin.
     *
     * 🛑 Sans ce retrait, la gate produit des faux positifs en masse, et c'est MESURÉ : `data`
     * existe dans trois schémas — fermé à 3 clés dans `geoleaf-config`, **ouvert à 15 dans
     * `layer-config`**. Indexer le seul fermé faisait juger tout bloc `data` d'exemple de
     * couche contre le mauvais schéma : `data.file`, `data.url`, `data.directory`… étaient
     * signalées invalides alors qu'elles sont déclarées. **Juger par NOM n'est sain que si le
     * nom est fermé PARTOUT** — sinon un bloc légitime de la variante ouverte se fait juger
     * par la fermée. Une gate bruyante apprend à être ignorée, ce qui est pire qu'une gate
     * absente.
     *
     * @type {Set<string>}
     */
    const openSomewhere = new Set();

    /**
     * @param {unknown} node
     * @param {string | null} name nom de la propriété qui porte ce nœud, si connu
     * @returns {void}
     */
    const visit = (node, name) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return;
        const obj = /** @type {Record<string, unknown>} */ (node);

        // 🛑 L'ouverture se relève AVANT le test sur `properties`, et c'est là qu'était le
        // trou (09/08/2026). La forme la plus OUVERTE qui existe — `{type: "object",
        // additionalProperties: true}` **sans `properties`** — n'entrait dans aucune des
        // deux branches ci-dessous : le mécanisme écrit pour voir l'ouverture était aveugle
        // à son cas le plus franc. Mesuré : `profile.schema.json` déclare `modules.offline`
        // exactement sous cette forme, à dessein (« opaque au schéma », le contenu
        // appartient à la capacité). Conséquence, l'exemple JUSTE du CHANGELOG public
        // `{"modules":{"offline":{"cache":{"maxTileCacheEntries":2000}}}}` se faisait juger
        // contre le `offline` de NIVEAU COUCHE (`layer-config.schema.json`, fermé à
        // `enabled|maxFeatures|maxAgeMs|source`) : gate rouge, doc juste.
        if (name && obj["additionalProperties"] === true) openSomewhere.add(name);

        const props = obj["properties"];
        if (name && props && typeof props === "object" && !Array.isArray(props)) {
            if (obj["additionalProperties"] === false) {
                const keys = Object.keys(/** @type {Record<string, unknown>} */ (props));
                const existing = index.get(name);
                // Deux schémas peuvent décrire le même nom FERMÉ : on UNIT plutôt qu'on
                // écrase. Écraser rendrait le verdict dépendant de l'ordre de lecture.
                if (existing) for (const k of keys) existing.add(k);
                else index.set(name, new Set(keys));
            } else {
                // Même nom, forme OUVERTE ailleurs → le nom devient injugeable (voir
                // `openSomewhere`). On l'enregistre même si un autre schéma l'a fermé :
                // c'est l'existence d'UNE variante ouverte qui rend le jugement non sûr.
                openSomewhere.add(name);
            }
        }

        for (const [key, value] of Object.entries(obj)) {
            // `properties` / `definitions` / `patternProperties` portent des NOMS ; partout
            // ailleurs (`items`, `allOf`, `then`…) le nom courant se propage.
            const carriesNames =
                key === "properties" || key === "definitions" || key === "patternProperties";
            if (carriesNames && value && typeof value === "object" && !Array.isArray(value)) {
                for (const [child, sub] of Object.entries(
                    /** @type {Record<string, unknown>} */ (value)
                )) {
                    visit(sub, child);
                }
            } else {
                visit(value, name);
            }
        }
    };

    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"))) {
        visit(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8")), null);
    }
    for (const ambiguous of openSomewhere) index.delete(ambiguous);
    return index;
}

/**
 * Les blocs ```json d'un fichier Markdown, analysés. Les blocs non analysables sont
 * ignorés en silence : un extrait volontairement tronqué (`…`) est une illustration
 * légitime, pas une erreur de configuration.
 *
 * @param {string} src contenu du `.md`
 * @returns {unknown[]} les blocs JSON valides
 */
function jsonBlocks(src) {
    const out = [];
    for (const m of src.matchAll(/```json\s*\n([\s\S]*?)```/g)) {
        try {
            out.push(JSON.parse(m[1]));
        } catch {
            /* fragment illustratif — non analysable, donc non jugeable */
        }
    }
    return out;
}

/**
 * Les schémas dont la RACINE est fermée, avec une signature qui permet de reconnaître un
 * bloc de doc SANS ambiguïté.
 *
 * 🛑 **Pourquoi cette fonction existe : sans elle la gate est aveugle à la moitié de sa
 * propre cible.** `scan()` ne jugeait que les clés d'un CONTENEUR NOMMÉ (`ui.x`, `edition.y`).
 * Les clés de PREMIER NIVEAU d'un exemple de `profile.json` n'étaient jamais confrontées,
 * alors que les 10 schémas racine sont `additionalProperties: false` — donc la classe la plus
 * directe passait. Mesuré à la pose : **`poiAddConfig` est enseigné comme bloc racine dans
 * trois documents produit** (dont une §17 entière de `PROFILE_JSON_REFERENCE.md`) et n'est
 * déclaré dans AUCUN schéma. La gate sortait verte dessus.
 *
 * **La signature est DÉRIVÉE, pas écrite.** Un schéma racine n'est utilisable que s'il porte
 * au moins une propriété qu'AUCUN autre schéma racine ne déclare : c'est ce qui rend le
 * rapprochement non ambigu par construction. Sans ce critère, `profile.schema.json` et
 * `layer-config.schema.json` sont indiscernables — les deux ont `required: ["id"]`, et juger
 * un exemple de couche contre le schéma de profil produirait des faux positifs en masse,
 * exactement la classe `data.*` déjà rencontrée sur les conteneurs.
 *
 * Un bloc qui ne matche AUCUNE signature est ignoré : on préfère ne pas juger à mal juger.
 *
 * @returns {{ required: string[], unique: Set<string>, keys: Set<string>, name: string }[]}
 */
function rootSchemas() {
    const roots = [];
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"))) {
        const s = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8"));
        if (s.additionalProperties !== false || !s.properties) continue;
        roots.push({
            name: file,
            required: Array.isArray(s.required) ? s.required : [],
            keys: new Set(Object.keys(s.properties)),
            unique: new Set(),
        });
    }
    for (const r of roots) {
        for (const k of r.keys) {
            if (!roots.some((o) => o !== r && o.keys.has(k))) r.unique.add(k);
        }
    }
    return roots.filter((r) => r.unique.size > 0);
}

/**
 * @returns {{ violations: string[], files: number, blocks: number, containers: number,
 *   rootsJudged: number }}
 */
function scan() {
    const containers = closedContainers();
    const roots = rootSchemas();
    const violations = [];
    let files = 0;
    let blocks = 0;
    let rootsJudged = 0;

    for (const file of productDocsFiles()) {
        if (!file.endsWith(".md")) continue;
        files++;
        const rel = path.relative(ROOT, file).split(path.sep).join("/");

        for (const block of jsonBlocks(fs.readFileSync(file, "utf8"))) {
            blocks++;

            // ── Racine : jugée seulement si UNE signature discriminante matche ──────────
            if (block && typeof block === "object" && !Array.isArray(block)) {
                const rootKeys = Object.keys(/** @type {Record<string, unknown>} */ (block));
                const matched = roots.filter(
                    (r) =>
                        r.required.every((k) => rootKeys.includes(k)) &&
                        rootKeys.some((k) => r.unique.has(k))
                );
                // Deux signatures qui matchent le même bloc = ambiguïté : on ne juge pas.
                if (matched.length === 1) {
                    rootsJudged++;
                    const r = matched[0];
                    for (const k of rootKeys) {
                        if (k.startsWith("_") || k === "$schema") continue;
                        if (!r.keys.has(k)) violations.push(`${rel} :: <${r.name}>.${k}`);
                    }
                }
            }

            /**
             * @param {unknown} node
             * @returns {void}
             */
            const walk = (node) => {
                if (!node || typeof node !== "object") return;
                if (Array.isArray(node)) {
                    for (const item of node) walk(item);
                    return;
                }
                for (const [key, value] of Object.entries(
                    /** @type {Record<string, unknown>} */ (node)
                )) {
                    const valid = containers.get(key);
                    if (valid && value && typeof value === "object" && !Array.isArray(value)) {
                        for (const child of Object.keys(
                            /** @type {Record<string, unknown>} */ (value)
                        )) {
                            // `_comment*` est toléré partout par les schémas (PRF-SCHEMA).
                            if (child.startsWith("_") || child === "$schema") continue;
                            if (!valid.has(child)) violations.push(`${rel} :: ${key}.${child}`);
                        }
                    }
                    walk(value);
                }
            };
            walk(block);
        }
    }

    return {
        violations: [...new Set(violations)].sort(),
        files,
        blocks,
        containers: containers.size,
        rootsJudged,
    };
}

const { violations, files, blocks, containers, rootsJudged } = scan();
const bar = "─".repeat(72);

// ── CDE-03 — une gate qui n'a rien scanné, ou rien résolu, n'a rien prouvé ───────────────
if (files === 0 || blocks === 0 || containers === 0) {
    console.error("ERROR [DOC-CONFIG-EXAMPLES/CDE-03]: corpus ou table de conteneurs vide.");
    console.error(
        `  ${files} fichier(s) de doc produit · ${blocks} bloc(s) JSON · ${containers} conteneur(s)\n` +
            "  fermé(s) résolu(s) depuis profiles/schemas/. Si l'un des trois est à zéro, c'est\n" +
            "  la gate qui est aveugle, pas la doc qui est propre."
    );
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4 : Prettier possède `scripts/**/*.json` en `tabWidth: 4`.
        JSON.stringify(
            {
                _comment:
                    "DOC-CONFIG-EXAMPLES — clés de configuration citées par un exemple JSON de " +
                    "la doc PRODUIT et absentes du schéma qui les gouverne. Chaque entrée est un " +
                    "extrait copiable-collable qui ferait échouer `npm run validate:profiles` " +
                    "chez l'intégrateur, parce que les objets à forme fixe sont " +
                    "`additionalProperties: false`. Cette liste ne peut que RÉTRÉCIR (CDE-02) et " +
                    "aucune entrée ne peut y NAÎTRE (CDE-01). Régénérer avec --update-baseline " +
                    "UNIQUEMENT après avoir corrigé la doc, jamais pour faire taire un exemple neuf.",
                _generated: "node scripts/check-doc-config-examples.cjs --update-baseline",
                count: violations.length,
                entries: violations,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [DOC-CONFIG-EXAMPLES] baseline régénérée — ${violations.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    // Une baseline absente n'est PAS une liste vide : ce serait déclarer la doc propre.
    console.error("ERROR [DOC-CONFIG-EXAMPLES]: baseline absente.");
    console.error("  Run: node scripts/check-doc-config-examples.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(violations);

const fresh = violations.filter((v) => !baseline.has(v)); // CDE-01
const stale = [...baseline].filter((v) => !seen.has(v)).sort(); // CDE-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [DOC-CONFIG-EXAMPLES] ${violations.length} clé(s) invalide(s) gelée(s) — baseline à ` +
            `jour (${files} docs produit, ${blocks} blocs JSON, ${containers} conteneurs fermés).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [DOC-CONFIG-EXAMPLES/CDE-01] ${fresh.length} clé(s) invalide(s) NEUVE(S) :`);
    for (const v of fresh) console.error(`     + ${v}`);
    console.error(
        "\n  Cette clé n'existe pas dans le schéma qui gouverne ce bloc, et l'objet est\n" +
            "  `additionalProperties: false` : l'exemple est copiable-collable et ferait ÉCHOUER\n" +
            "  `npm run validate:profiles` chez celui qui le recopie. Corriger l'exemple, ou\n" +
            "  déclarer la clé au schéma si elle doit exister."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [DOC-CONFIG-EXAMPLES/CDE-02] ${stale.length} entrée(s) de baseline sans site :`
    );
    for (const v of stale) console.error(`     - ${v}`);
    console.error(
        "\n  Ces exemples ont été corrigés — bonne nouvelle, mais la baseline doit\n" +
            "  l'enregistrer : `--update-baseline`. Une baseline qui garde des entrées mortes\n" +
            "  cesse de mesurer la dette réelle."
    );
}

console.log(bar);
process.exit(1);
