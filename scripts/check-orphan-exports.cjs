#!/usr/bin/env node
/*!
 * GeoLeaf — Filet anti-code-mort du core (roadmap nettoyage, Sprint 2 / B3)
 * © 2026 Mattieu Pottier — MIT
 *
 * ⚠️ ATTENTION — la justification historique de ce script est PÉRIMÉE.
 *
 * Il a été écrit parce que « knip est aveugle sur packages/core/src » : 0 issue
 * rapportée sur ~470 fichiers, y compris avec un `entry` déclaré (spike Sprint 2.1).
 * Le constat était juste, le diagnostic faux. La cause n'était pas l'architecture à
 * registre : c'était `"./dist/*": "./dist/*"` dans le `exports` de
 * `packages/core/package.json`, qui promouvait TOUT `src/**` au rang de point
 * d'entrée — et un point d'entrée n'est jamais « unused ». Sous-chemin retiré à
 * l'API S2.4 ; knip a alors signalé 159 symboles sur le core.
 *
 * ⚠️ MISE À JOUR 26/07/2026 — ce script n'est plus complémentaire de knip sur cet
 * angle, il en est le SEUL titulaire. Les 159 symboles ci-dessus ont été triés un par
 * un (API S2.4c) : 116 faux positifs de baril, 39 usages intra-fichier, 3 tests seuls,
 * 1 déjà exempté, **0 actionnable**. `knip.js` porte donc désormais
 * `ignoreIssues: { "packages/core/src/**": ["exports", "types"] }` — motif écrit sur
 * place. Conséquence directe pour ici : la mesure du 25/07 (« 23 des 74 candidats de
 * la baseline sont vus par knip, les 51 autres sont l'apport propre de cette
 * méthode ») devient **74 sur 74**. Le recouvrement est nul, et ce fichier n'a plus de
 * filet sous lui.
 *
 * ⚠️ Corollaire à ne pas perdre : supprimer ou affaiblir ce script ne dégrade plus la
 * couverture, il la SUPPRIME sur les exports du core. Avant l'API S2.4 on pouvait
 * croire knip redondant ici ; ce n'est plus vrai dans aucun sens.
 *
 * La raison de fond n'a pas changé, et c'est elle qui a survécu au resserrage : les
 * deux gates ne cherchent pas la même chose. knip raisonne sur le graphe de modules ;
 * ici on cherche par token dans tout le dépôt, y compris les VALEURS littérales des
 * `const` de type chaîne — clés de registre, noms d'événements — qu'aucun graphe
 * d'imports ne peut relier à leur consommateur. C'est cette méthode-là qui apportait
 * déjà les 51 candidats invisibles à knip, et c'est pourquoi retirer la catégorie
 * exports de knip sur le core ne perd rien de vérifié.
 *
 * Pour chaque export nommé de packages/core/src, il cherche un consommateur réel
 * DANS TOUT LE MONOREPO (tous les packages + examples/), pas seulement dans core :
 * un export core légitimement consommé par un plugin (ex. `storage-contract.ts`,
 * consommé par plugin-storage/plugin-addpoi) ne doit jamais devenir un faux
 * positif — c'est précisément l'erreur d'un grep scopé à core seul.
 *
 * Un export sans consommateur (nom identifiant, ou valeur littérale pour les
 * `const` de type chaîne — clés de registre, noms d'événements) hors de son
 * propre fichier et hors de tout dossier __tests__ est un candidat mort.
 *
 * Limite assumée : recherche par token/chaîne, pas par résolution de binding
 * TypeScript complète — un nom générique (`config`, `init`…) redéclaré ailleurs
 * peut produire un faux "vivant" (faux négatif). C'est un choix délibéré : pour
 * un gate qui bloque la CI, un faux négatif (on rate un mort) est sans danger,
 * un faux positif (on flague un export vivant) casse la prod à la purge.
 *
 * Baseline (roadmap nettoyage, Sprint 2 / B3 — décision Mattieu 15/07) : le premier
 * passage a trouvé 224 candidats déjà présents, une dette jamais vue par knip. Bloquer
 * dessus dès l'introduction du gate aurait figé tout commit — l'anti-pattern « gate
 * rouge en permanence », déjà évité pour le gate audit-dev.
 * `check-orphan-exports.baseline.json` fige donc l'état connu : le gate ne bloque QUE
 * sur un export mort NOUVEAU. Régénérer avec `--update-baseline` une fois un lot purgé.
 *
 * Après le tri du Sprint 4, ce qui reste en baseline n'est plus de la « dette à
 * trier » mais les angles morts STRUCTURELS de la méthode — et chaque entrée porte
 * désormais sa classe dans `CLASSES`, asservie par CLS-01/CLS-02 (API publique S4.8) :
 *   - A. usage intra-fichier (le symbole est utilisé, mais jamais hors de son fichier —
 *        son `export` est superflu, pas le symbole) ;
 *   - C. consommation structurelle (duck-typing : le champ est lu, le TYPE jamais nommé) ;
 *   - D. seam de test (exporté pour `__tests__`, que le corpus exclut par conception).
 * Ce qui est INTENTIONNEL et permanent va dans `ALLOWLIST` ci-dessous, pas en baseline.
 *
 * ⚠️ Une 4ᵉ classe « registre à clé-string » figurait ici — `setModuleSetup("api", …)` →
 * `runModuleSetup("api")`, le token n'apparaissant jamais chez l'appelant. **Elle est vide,
 * et son mécanisme n'existe plus** : l'indirection a été retirée au S6 Lot 5 (cf.
 * `globals/globals.core.ts:117`), la seule trace restante étant les commentaires qui en
 * documentent le retrait. Elle est supprimée plutôt que gardée par précaution : une classe
 * dont aucun membre ne peut plus exister ne trie rien, elle donne l'illusion d'un tri.
 * Les 7 `globals/globals.*.ts::setup*` qu'elle prétendait couvrir relèvent de A — ils sont
 * appelés DANS leur propre fichier (ex. `globals.api.ts:227`).
 *
 * ⚠️ Les classes ne sont PAS disjointes : un type utilisé dans son propre fichier pour
 * annoter une frontière duck-typée relève de A ET de C. Ordre de priorité, du plus
 * spécifique au plus général : **D > C > A**. Sans cet ordre écrit, deux relecteurs
 * classent différemment et le classement ne vaut rien.
 *
 * Usage :
 *   node scripts/check-orphan-exports.cjs                  # gate (bloque sur le NOUVEAU)
 *   node scripts/check-orphan-exports.cjs --json            # + dump JSON complet
 *   node scripts/check-orphan-exports.cjs --update-baseline # régénère la baseline
 * Exit codes : 0 vert (aucun nouveau candidat) · 1 régression · 2 erreur d'outillage.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
// T5.5 — par le registre, qui jette si le core est introuvable. Un littéral aurait laissé
// `collectFiles` rendre une liste vide et la gate conclure « 0 export orphelin ».
const CORE_SRC = path.join(require("./lib/packages.cjs").requireByDirName("core").absDir, "src");
const PKG_DIR = path.join(ROOT, "packages");
const EXAMPLES_DIR = path.join(ROOT, "examples");
const BASELINE_PATH = path.join(__dirname, "check-orphan-exports.baseline.json");
const JSON_OUT = process.argv.includes("--json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

/** Chemin relatif normalisé en `/` — `path.relative` rend `\` sous Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

function candidateKey(c) {
    // ⚠ Normaliser : sans ça, une exécution Windows native produit
    // `adapters\maplibre\x.ts::Y`, qui ne matche AUCUNE clé de la baseline (stockée
    // en `/`) — les ~130 candidats connus remonteraient tous comme « nouveaux ».
    // Masqué en CI (ubuntu) et par le trampoline WSL du hook, mais pas en local.
    return `${normPath(c.file)}::${c.name}`;
}

function loadBaseline() {
    try {
        const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
        return new Set(raw.candidates || []);
    } catch {
        return new Set();
    }
}

function writeBaseline(candidates) {
    const keys = candidates.map(candidateKey).sort();
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "Angles morts STRUCTURELS de scripts/check-orphan-exports.cjs — PAS une dette à purger. " +
                    "Ce qui reste ici est ce que la recherche par token ne peut pas voir : usage intra-fichier " +
                    "(A — l'`export` est superflu, pas le symbole), consommation structurelle (C — duck-typing : " +
                    "le champ est lu, le type jamais nommé), et seams de test (D — le corpus exclut __tests__ par " +
                    "conception). CHAQUE entrée doit porter sa classe dans CLASSES (dans le script), sans quoi " +
                    "CLS-01 bloque ; une classe sans entrée correspondante bloque par CLS-02. " +
                    "Ce qui est INTENTIONNEL et permanent va dans ALLOWLIST (dans le script), pas ici. " +
                    "Régénérée via `--update-baseline`. Le gate ne bloque que sur un candidat absent d'ici.",
                generatedCount: keys.length,
                candidates: keys,
            },
            null,
            // 4, not 2 — same reason as check-module-headers.cjs: Prettier owns this
            // file (`tabWidth: 4`) and the commit hook reformatted every line, turning
            // any one-entry change into a whole-file diff.
            4
        ) + "\n"
    );
}

/*
 * ─── Classement de la baseline (API publique S4.8) ──────────────────────────────────────
 *
 * Chaque entrée de `check-orphan-exports.baseline.json` porte UNE classe. Sans ça, la baseline
 * dit « voici de la dette » sans dire de quelle nature : elle ne peut ni rétrécir de façon
 * défendable, ni être distinguée d'un oubli. Les trois classes sont celles du docblock, et
 * l'ordre de priorité **D > C > A** y est écrit — elles ne sont pas disjointes.
 *
 * ## Comment ce classement a été obtenu, et comment le REFAIRE
 *
 * Un verdict qu'on ne peut pas re-mesurer se fossilise. Les deux critères sont mécaniques :
 *
 *   D  le symbole a un consommateur réel sous `__tests__/` et aucun ailleurs. Se re-mesure par
 *      un grep du nom sur `packages apps`, en EXCLUANT `dist/`, `deploy/`, `coverage/` et
 *      `node_modules/` — sans quoi les `.d.ts` émis et les copies de `typescript/lib/*.js` se
 *      comptent comme consommateurs (mesuré : `getInternalMap` sortait à 35 faux positifs).
 *   C  un symbole EXPORTÉ du même fichier porte ce type dans sa signature, et CE porteur a un
 *      consommateur hors du fichier et hors tests. L'appelant construit alors un littéral sans
 *      jamais nommer le type — c'est la consommation structurelle. Vaut par TRANSITIVITÉ :
 *      `ThemeSelectorLike` est porté par `PermalinkGeoLeaf`, lui-même porté par
 *      `getPermalinkGeoLeaf`, consommé par `permalink-sync.ts`.
 *   A  ni l'un ni l'autre : le symbole n'est utilisé que dans son propre fichier.
 *
 * Mesure du 25/07/2026 : **D 35 · C 32 · A 7 = 74**, et 0 mort réel.
 *
 * ⚠️ Deux énoncés que cette mesure a infirmés, tous deux écrits ici avant elle :
 *   - le classement de première passe annonçait « A ~67 · D ~9 ». Il est INVERSÉ ;
 *   - le docblock donnait « les 7 `globals/globals.*.ts::setup*` relèvent de A ». Six sur sept :
 *     `setupCoreMap` est importé et appelé par `__tests__/core/utils.test.js:51` et
 *     `__tests__/utils/utils-shape.test.js:23`, donc **D** par la priorité D > C > A.
 */

/** D — seams de test : exportés pour `__tests__/`, que le corpus exclut par conception. */
const CLASS_D = [
    "adapters/maplibre/maplibre-event-subscriptions.ts::trackedCleanupCount",
    "adapters/maplibre/maplibre-hatch-patterns.ts::generateHatchImage",
    "adapters/maplibre/maplibre-primitives.ts::detectGeometryTypes",
    "adapters/maplibre/maplibre-poi-builders.ts::toClusterLayerIds",
    "adapters/maplibre/maplibre-poi-builders.ts::toClusterSourceId",
    "adapters/maplibre/maplibre-style-converter.ts::conditionToExpression",
    "adapters/maplibre/maplibre-style-converter.ts::parseDashArray",
    "capabilities/feature-info/render/lightbox.ts::LightboxManager",
    "capabilities/permalink/share/share-qr.ts::_resetQrLoaderForTests",
    "capabilities/route/apply.ts::endpointsLayerId",
    "capabilities/taxonomy/tint.ts::tintKey",
    "capabilities/theme-selector/theme-selector-secondary.ts::attachDropdownHandler",
    "capabilities/theme-selector/theme-selector-secondary.ts::attachNavButtonHandler",
    "globals/globals.core.ts::setupCoreMap",
    "kernel/api/module-catalog.ts::CATALOG_EXPECTED_ABSENT",
    "kernel/basemaps/hillshade.ts::buildHillshadeSourceSpec",
    "kernel/basemaps/image-source.ts::buildImageSourceSpec",
    "kernel/basemaps/registry.ts::_resetStateForTesting",
    "kernel/basemaps/registry.ts::getInternalMap",
    "kernel/basemaps/terrain.ts::_resetTerrainStateForTesting",
    "kernel/basemaps/terrain.ts::getActiveTerrainBasemapKey",
    "kernel/basemaps/wmts-resolver.ts::_clearWmtsCache",
    "kernel/basemaps/wmts-resolver.ts::_getWmtsCache",
    "kernel/basemaps/wmts-resolver.ts::parseWmtsCapabilities",
    "kernel/config/profile-loader-helpers.ts::validateFilesModules",
    "kernel/geojson/loader/single-layer.ts::applyOgcRefreshedData",
    "kernel/geojson/style-resolver.ts::GeoJSONStyleResolver",
    "kernel/layer-manager/item-controls.ts::renderToggleControls",
    "utils/notify/notify.primitive.ts::createNotifyPrimitive",
    "utils/validators/style-validator-properties.ts::validateCasing",
    "utils/validators/style-validator-properties.ts::validateFillPattern",
    "utils/validators/style-validator-properties.ts::validateFont",
    "utils/validators/style-validator-properties.ts::validateLabelComponent",
    "utils/validators/style-validator-properties.ts::validateStroke",
];

/**
 * C — consommation structurelle : un porteur exporté du même fichier transporte ce type
 * jusqu'à un consommateur qui en lit les champs sans jamais le nommer (duck-typing).
 * Exemple lisible : `lifecycle.ts:33` appelle `ScaleControl.init(_map, { … })` avec un littéral
 * et importe `ScaleMapLike`, mais jamais `ScaleControlConfig`.
 */
const CLASS_C = [
    "adapters/maplibre/maplibre-layer-registry.ts::LayerRegistryEntry",
    "adapters/maplibre/maplibre-poi-builders.ts::ClusterSourceOptions",
    "adapters/maplibre/maplibre-poi-builders.ts::PoiEventHandlers",
    "adapters/maplibre/maplibre-style-converter.ts::CirclePaint",
    "adapters/maplibre/maplibre-style-converter.ts::FillExtrusionPaint",
    "adapters/maplibre/maplibre-style-converter.ts::FillPaint",
    "adapters/maplibre/maplibre-style-converter.ts::LinePaint",
    "adapters/maplibre/maplibre-style-transform.ts::OwnedStyleIds",
    "adapters/maplibre/maplibre-style-transform.ts::StyleSpecLike",
    "app/boot-install.ts::BootInstallation",
    "capabilities/filter/types.ts::FilterActionsConfig",
    "capabilities/filter/types.ts::FilterKind",
    "capabilities/permalink/types.ts::PermalinkFilterConfig",
    "capabilities/permalink/types.ts::PermalinkFilterState",
    "capabilities/permalink/types.ts::PermalinkGeoLeaf",
    "capabilities/permalink/types.ts::ThemeSelectorLike",
    "capabilities/scale/scale-control.ts::ScaleControlConfig",
    "kernel/basemaps/basemaps-types.ts::NativeSourceView",
    "kernel/basemaps/basemaps-types.ts::NativeStyleView",
    "kernel/basemaps/ui.ts::BasemapUIConfigInput",
    "kernel/config/geoleaf-config/config-types.ts::DataConfig",
    "kernel/config/geoleaf-config/config-types.ts::LoggingConfig",
    "kernel/config/geoleaf-config/config-types.ts::SecurityConfig",
    "kernel/config/geoleaf-config/config-types.ts::UIConfig",
    "kernel/geojson/core-types.ts::GeoJSONStyleLabelConfig",
    "kernel/geojson/core-types.ts::LayerRegistryLike",
    "kernel/geojson/core-types.ts::MapEventHandler",
    "kernel/geojson/core-types.ts::MapLngLatLike",
    "kernel/geojson/core-types.ts::MapPointLike",
    "kernel/geojson/loader/loader-types.ts::GeoJSONLayerConfigLike",
    "kernel/geojson/loader/loader-types.ts::TaxonomyResolverFeature",
];

/**
 * A — usage intra-fichier : le symbole vit, son `export` est superflu. Les six `setup*` sont
 * appelés dans leur propre `globals.*.ts` (ex. `globals.api.ts:227`) ; `closeSheet` l'est par
 * ses trois écouteurs (`mobile-toolbar-sheet.ts:61,63,71`).
 */
const CLASS_A = [
    "globals/globals.api.ts::setupAPIKernel",
    "globals/globals.config.ts::setupConfig",
    "globals/globals.core.ts::setupSecurity",
    "globals/globals.geojson.ts::setupGeoJSONKernel",
    "globals/globals.storage.ts::setupStorage",
    "globals/globals.ui.ts::setupUIKernel",
    "kernel/ui/mobile/mobile-toolbar-sheet.ts::closeSheet",
];

/**
 * Clé de `candidateKey()` → classe. Composée depuis les trois listes ci-dessus.
 *
 * ⚠️ La composition REFUSE un doublon. Les classes n'étant pas disjointes (D > C > A), une clé
 * écrite dans deux listes prendrait silencieusement celle de la dernière — le classement
 * dirait alors autre chose que ce que son auteur croit avoir écrit.
 */
const CLASSES = (() => {
    const entries = [
        ...CLASS_D.map((k) => [k, "D"]),
        ...CLASS_C.map((k) => [k, "C"]),
        ...CLASS_A.map((k) => [k, "A"]),
    ];
    const map = new Map(entries);
    if (map.size !== entries.length) {
        const seen = new Set();
        const dup = entries
            .map(([k]) => k)
            .filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
        console.error(
            `ERROR [check-orphan-exports]: ${[...new Set(dup)].join(", ")} figure(nt) dans ` +
                "plusieurs listes de classe. Priorité D > C > A : n'en garder qu'une."
        );
        process.exit(2);
    }
    return map;
})();

/**
 * CLS-01 / CLS-02 — le classement doit couvrir la baseline, exactement.
 *
 *   CLS-01  une entrée de baseline sans classe → le classement a un trou.
 *   CLS-02  une clé de `CLASSES` qui ne correspond à aucune entrée → entrée FANTÔME, même
 *           défaut que `checkAllowlistFresh` traque sur l'`ALLOWLIST` : elle survit aux purges
 *           et donne l'illusion d'un tri complet.
 *
 * Même forme que `checkAllowlistFresh` : rend un tableau de chaînes, n'imprime rien, ne sort pas.
 */
function checkClassificationComplete(baseline) {
    const problems = [];
    for (const key of [...baseline].sort()) {
        if (!CLASSES.has(key)) problems.push(`${key} — non classé (CLS-01)`);
    }
    for (const key of [...CLASSES.keys()].sort()) {
        if (!baseline.has(key))
            problems.push(`${key} — classé mais absent de la baseline (CLS-02)`);
    }
    return problems;
}

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "coverage", ".turbo", "__tests__"]);
const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

// ─── Allowlist — exports intentionnellement sans consommateur ─────────────────
// Voir roadmap_nettoyage.md (Sprint 2 tâche 2.3, Sprint 4 tâche 4.4).
//
// Clé = chemin relatif à `packages/core/src`, en `/`, **match exact** (et non plus
// `endsWith` : deux fichiers peuvent partager un suffixe). Le cas qui a motivé la
// bascule — `dom-helpers.ts` en double dans `utils/general/` et `utils/helpers/` —
// n'existe plus depuis KERNEL S14 (la façade est devenue `utils/general/helpers.ts`,
// renommée `helpers-namespace.ts` au STRUCT S6 — l'autre moitié de la collision N5,
// contre `app/app-namespace.ts`, que le S14 avait laissée intacte),
// mais le match exact reste la bonne règle : il est robuste par construction et ne
// dépend pas de l'absence d'homonymes.
//
// Valeur :
//   "*"   → tout le fichier est exempté (surface conservée en bloc) ;
//   [...] → SEULS ces symboles le sont, le reste du fichier reste gaté.
//
// Le symbol-level est ce qui permet d'exempter les 15 membres publics de
// `errors/index.ts` sans aveugler le fichier : il contenait AUSSI deux types morts
// (S4). Un `"*"` posé là aurait masqué ses propres morts — et rouvert, à petite
// échelle, le trou que ce gate est censé fermer.
//
// `storage-contract.ts` et `geoleaf:popup:action` ne sont PAS ici : le scope
// repo-wide les trouve vivants. Les y ajouter à l'aveugle masquerait une vraie
// régression.
//
// ⚠️ Ce commentaire disait « vivants via les PLUGINS », et c'était faux pour la
// seconde depuis sa naissance : l'unique émetteur de `geoleaf:popup:action` est
// dans le CORE (`capabilities/feature-info/render/widget-dispatch.ts`), posé par
// B-69 le 29/07/2026 — aucun plugin ne l'émet ni ne l'écoute. Le backlog notait
// la contradiction comme « prémisse à re-mesurer » ; mesurée le 14/08/2026, c'est
// le commentaire qui avait tort. La CONCLUSION (ne pas exempter) reste juste, et
// c'est précisément ce qui l'a fait survivre : un motif faux sous une décision
// juste ne se fait jamais contredire par une gate.
const ALLOWLIST = {
    // ── Un décâblage exporté POUR LE HARNAIS, sans lequel les tests ne prouvent rien ────
    //
    // `unwireEvictionNotice` (B-163) n'a aucun appelant de production : le core n'a pas de
    // chemin de démontage, et `wireEvictionNotice()` est posée une fois pour toutes par
    // `setupStorage()`. Son consommateur est le harnais — `__tests__/storage/eviction-notice.test.ts`.
    //
    // ⚠️ **Elle n'est pas un confort de test, elle est ce qui rend la suite falsifiable.**
    // L'écouteur porte un drapeau module (`_evictionNoticeWired`) qui rend tout second
    // `wireEvictionNotice()` inopérant — c'est le but : `setupStorage()` est re-callable, et
    // deux écouteurs afficheraient deux toasts. Sans le décâblage, un `beforeEach` ne pourrait
    // pas remettre l'état à zéro : les cas s'exécuteraient sur l'écouteur du premier, et les
    // trois cas de cycle de vie (idempotence, décâblage, re-câblage) sortiraient verts **sans
    // rien éprouver**.
    //
    // C'est le cas exact de `unwireEngineSignals` dans `offline-ui`, dont le relevé C1 de la
    // tâche 8.8 avait conclu « sans consommateur » — et sa dé-exportation avait fait rougir
    // 7 cas immédiatement. Même classe, même motif : « annoncé mort ≠ mort ».
    "kernel/storage/eviction-notice.ts": ["unwireEvictionNotice"],

    // ── Un seam de GATE : exporté pour être confronté, pas pour être appelé ────
    //
    // `RENDERED_WIDGETS` est dérivé de la table de rendu (`Object.keys`), jamais écrit à
    // la main, et son unique consommateur est la garde de parité
    // `__tests__/guards/attributes-parity.guard.test.js` — que le corpus exclut par
    // conception. C'est exactement ce que la décision A11′ demande : la liste
    // décroissante de CE fichier suit des exports et ne peut pas voir un widget déclaré
    // que rien ne rend, parce que `AttributeWidget` y est une seule entrée pour l'union
    // entière. Le seam est ce qui rend la confrontation possible.
    //
    // ⚠️ Il ne se dé-exporte donc PAS : sans lui, la gate ne peut plus lire ce que le
    // moteur rend, et le trou latent que FE-14 a coûté redevient invisible.
    "capabilities/feature-info/render/widget-dispatch.ts": ["RENDERED_WIDGETS"],

    // ── Un type qui n'a plus d'importeur EXTERNE, et qui n'est pas mort pour autant ────
    //
    // `GeoLeafApiController` décrit la forme du contrôleur d'API. Jusqu'à socle-init 7.7, son
    // unique consommateur hors fichier était `kernel/api/geoleaf-api.ts`, qui l'importait pour
    // typer son accesseur validé — supprimé avec le doublon B11. Le gate l'a donc vu apparaître
    // comme « nouvel export sans consommateur ».
    //
    // ⚠️ **Il est vivant, et le purger serait une purge d'API publique.** Deux mesures : il type
    // `_APIController` dans `GeoLeafApiNamespace` (même fichier, `:133`) — donc la forme de
    // l'objet que `GeoLeafAPI` expose —, et il figure sur la **surface publiée**
    // (`docs/reference/API_SURFACE.txt`, entrées `api-types.GeoLeafApiController.*`),
    // donc dans `dist/types/` chez l'intégrateur. Non exporté, la déclaration publiée citerait
    // un type que personne ne peut nommer — le défaut B-87, exactement.
    //
    // C'est le cas d'école que le message de ce gate annonce : « annoncé mort ≠ mort ».
    "kernel/api/api-types.ts": ["GeoLeafApiController"],

    // ── Un type de SURFACE PUBLIÉE, sans importeur interne par construction ────
    //
    // `SizeByType` est le type de `byType` dans le retour — INFÉRÉ — de
    // `CacheMetrics.estimateProfileSize()`. Il part donc dans `dist/types/`, et il est
    // exporté pour que l'intégrateur puisse le NOMMER : non exporté, la déclaration publiée
    // citait un type que personne ne pouvait écrire (qualite Q5, B-87).
    //
    // Aucun fichier du monorepo ne l'importe, et aucun ne le fera : son consommateur est
    // hors du dépôt. C'est la définition même d'« intentionnel et permanent », donc ALLOWLIST
    // et pas baseline — la baseline est un tri en attente, celle-ci est une décision.
    "capabilities/offline/cache/metrics.ts": ["SizeByType"],

    // ── Deux seams de TEST du rapport hors-ligne (tâche 4.8) ──────────────────
    //
    // `deriveStatus` porte la table de vérité des 5 `LayerOfflineStatus`, et c'est la seule
    // règle de ce module qui se décide sans toucher la base. L'éprouver à travers
    // `buildSyncReport()` demanderait de fabriquer un état IndexedDB par ligne de table :
    // on testerait le montage, pas la règle — et la ligne qui distingue `declaredNeverPulled`
    // de « rapatrié à vide » est précisément celle que la tâche existe pour tenir.
    //
    // `PULL_STATE_KEY` est la clé du store `preferences`. Elle est exportée pour que
    // `layer-pull.test.js` la LISE au lieu de la recopier : un littéral en double laisserait
    // le test vert le jour où la clé de production changerait — c'est-à-dire le jour où le
    // marqueur cesserait d'être relu.
    //
    // ALLOWLIST et pas baseline : ce sont des décisions, pas un tri en attente.
    "capabilities/offline/report/sync-report.ts": ["deriveStatus"],
    "capabilities/offline/report/pull-state.ts": ["PULL_STATE_KEY"],
    // ── Les 3 patchers de `ThemeApplierCore` — modules d'EFFET DE BORD ────────
    //
    // Leur export n'a AUCUN consommateur, et c'est normal : ils ne sont pas là pour être
    // importés nommément mais pour GREFFER 13 méthodes sur `ThemeApplierCore` au moment
    // de leur import (`TA._hideAllLayers = function …`). `core.ts` les appelle dans
    // `applyTheme()` (`this._hideAllLayers()`, `this._applyLayerConfig(cfg)`,
    // `self._syncLegendVisibility()`) SANS les définir.
    //
    // ⚠️ Inscrits ici après une régression réelle, le 25/07/2026. Ils étaient tirés dans le
    // graphe par l'`Object.assign` qui composait `GeoLeaf._ThemeApplier` ; le retrait de
    // cette clé (API S4.3, aucun lecteur) a sorti les patches avec elle. CETTE GATE, ESLint
    // et la lecture humaine ont alors dit « mort » de concert — les trois avaient raison sur
    // la lettre, tort sur le fond : un module d'effet de bord n'a pas de consommateur par
    // définition. La suite est restée VERTE (tout ce qui touche aux thèmes mocke
    // `ThemeApplierCore`) ; la production aurait levé `TypeError: this._hideAllLayers is not
    // a function` au premier changement de thème.
    //
    // L'ancrage est désormais explicite (`import "…"` dans `globals.ui.ts`) et gardé par
    // `__tests__/themes/theme-applier-patching.contract.test.js`.
    "kernel/themes/theme-applier/deferred.ts": ["ThemeApplierDeferred"],
    "kernel/themes/theme-applier/ui-sync.ts": ["ThemeApplierUISync"],
    "kernel/themes/theme-applier/visibility.ts": ["ThemeApplierVisibility"],

    // ── Contrat attributaire — figé UN SPRINT AVANT son moteur ────────────────
    // Posé le 02/08/2026 par l'Étape 1 de `roadmap_collecte-terrain-offline` : le
    // contrat et son schéma sont livrés au Sprint 1, le moteur qui les lit arrive au
    // Sprint 2. Ces exports n'ont donc PAS de consommateur par ordre de sprint, pas par
    // abandon — et le schéma `layer-config.schema.json`, lui, les applique déjà.
    //
    // ⚠️ Liste NOMMÉE et non `"*"`, délibérément : un export de plus fait rougir la gate,
    // et le Sprint 2 la vide entrée par entrée à mesure que le moteur les consomme.
    // `checkAllowlistFresh` garde le revers : une entrée dont l'export disparaît devient
    // fantôme et bloque. Le décompte ne se recopie pas ici — il s'imprime au run.
    //
    // ⚠️ Cette liste a été décrite comme « la baseline décroissante de A11 ». Elle est
    // bien décroissante et bien nommée, mais elle suit des EXPORTS, pas des WIDGETS :
    // `AttributeWidget` y est UNE entrée pour l'union entière, donc un widget déclaré
    // que rien ne rend n'y change rien et n'y sera jamais vu. Ce que A11 voulait suivre
    // est porté par la gate de PARITÉ du Sprint 2 (tâche 2.6), qui confronte le contrat
    // à la table de rendu. Précision faite au pré-vol 2.0 — voir A11′.
    "contracts/attributes.contract.ts": [
        // Widget `action` et bloc `presentation` — ajoutés au pré-vol du Sprint 2
        // (02/08), parce que le contrat figé ne pouvait porter ni le bouton d'action
        // déjà émis ni les 79 déclarations de présentation des profils.
        "ActionOptions",
        "AttributeDisplayOnlyWidget",
        "AttributeDisplayPresentation",
        "AttributeEmphasis",
        "AttributeChoice",
        "AttributeComputedSource",
        "AttributeDisplay",
        "AttributeDisplayMode",
        "AttributeEdit",
        "AttributeField",
        "AttributeFieldBase",
        "AttributePrimitive",
        "AttributeSurface",
        "AttributeTableColumn",
        "AttributeWidget",
        "AttributeWidgetOptions",
        "AttributeWidgetPrimitive",
        "BadgeOptions",
        "CheckboxOptions",
        "DateOptions",
        "DropdownOptions",
        "GalleryOptions",
        "GeometryCanonicalType",
        "GeometryDomainName",
        "HoursOptions",
        "ImageOptions",
        // `LayerAttributes` n'est PAS ici : `theme-applier/core.ts` le consomme déjà.
        // La liste est donc à 35 dès sa pose, pas à 36 — elle ne peut que décroître.
        "LinkOptions",
        "ListOptions",
        "LongtextOptions",
        "MetricOptions",
        "NumberOptions",
        "PlaceholderOnlyOptions",
        "PriceOptions",
        "RadioOptions",
        "RatingOptions",
        "ReviewsOptions",
        "TableOptions",
        "TagsOptions",
        "TextOptions",
    ],

    // ── Contrat de synchronisation — même régime que le contrat attributaire ──
    // Posé le 02/08/2026 par l'Étape 1bis. Le cycle (rapatrier → lire local → éditer →
    // mettre en file → repousser → réconcilier) est figé au Sprint 1 ; le socle de
    // données qui l'implémente arrive au Sprint 3, le cycle lui-même au Sprint 4.
    // `LayerWriteTarget` n'est PAS ici : `theme-applier/core.ts` le consomme déjà.
    //
    // ⚠️ Liste nommée, décroissante, même contrat que ci-dessus : un export de plus fait
    // rougir, et chaque type sort de la liste quand son moteur le consomme.
    "contracts/sync.contract.ts": [
        "ConflictPolicy",
        "DataOriginDeclaration",
        "DataOriginRole",
        "EvictionClass",
        "FeatureRecord",
        // Permissions d'édition par couche — figées à l'Étape 4 (02/08), exécutées à
        // la fusion des deux plugins d'édition.
        "LayerEditionPermissions",
        "LayerOfflineStatus",
        "LayerSyncConfig",
        "LayerSyncMode",
        "LayerSyncReport",
        "LocalId",
        "OutboxEntry",
        "PullGranularity",
        "QuarantineReason",
        "ServerDeletionPolicy",
        "ServerId",
        "StoragePersistenceRegime",
        "SyncOperationKind",
        "SyncState",
        "VersionMarker",
        "WriteAuth",
        "WriteDialect",
    ],

    // ── ✅ B-20 — LES 4 EXEMPTIONS GLOBALES SONT RETIRÉES (16/08/2026) ──────────
    //
    // Elles couvraient `api/geoleaf.introspection.ts`, `contracts/introspection.contract.ts`,
    // `contracts/capability.contract.ts` et `kernel/api/plugin-registry.ts`, sous le motif
    // « Façade Introspection (~850 l., 0 appel réel hors JSDoc) — conservée pour le futur SaaS ».
    //
    // 🛑 MESURÉ : elles masquaient **ZÉRO** orphelin. Les 13 exports de ces quatre fichiers ont
    // tous un consommateur réel, et aucun n'était en baseline. Le motif était juste à sa date ;
    // il ne l'est plus, et son chiffre non plus — `geoleaf.introspection.ts` fait **36 lignes**,
    // pas 850.
    //
    // ⚠️ ET VOICI POURQUOI PERSONNE NE POUVAIT LE VOIR : `checkAllowlistFresh` portait
    // `if (value === "*") continue;`. **Une exemption globale était exemptée du contrôle de
    // péremption lui-même.** C'est la seule forme d'exemption qui ne pouvait jamais se périmer,
    // et c'est exactement pourquoi ces quatre-là ont survécu à la purge de leur motif.
    //
    // ✅ Le joker n'appartient plus au vocabulaire : l'ALLOWLIST n'accepte QUE des listes de
    // symboles nommés, et toute autre valeur est signalée comme périmée. Un fichier entièrement
    // exempté doit donc NOMMER ses exports — ce qui les rend visibles, donc périssables.
    // ── `GeoLeaf.Errors.*` — vivants via la façade, jamais importés nommément ──
    // `kernel-exports.ts` ré-exporte `Errors`, monté au boot B1 par `globals.core.ts`.
    // Le token-search ne voit que l'agrégat, pas ses membres : exemple canonique du
    // piège « annoncé mort ≠ mort ».
    "utils/errors/errors.ts": [
        "DataError",
        "ErrorCodes",
        "InitializationError",
        "MapError",
        "NetworkError",
        "POIError",
        "RouteError",
        "UIError",
        "createError",
        "createErrorByType",
        "getErrorCode",
        "isErrorType",
        "normalizeError",
        "safeErrorHandler",
        "sanitizeErrorMessage",
    ],

    // ── Blocklist anti-prototype-pollution : la liste figée est test-only ──────
    // `UNSAFE_KEY_LIST` n'a AUCUN consommateur de production, et c'est voulu : il
    // n'existe que pour que `__tests__/guards/prototype-pollution-sinks.guard.test.js`
    // épingle le contenu de la blocklist. Avoir une source unique (S13.2) veut dire
    // qu'en retirer une clé affaiblit les 7 sinks d'un coup, en silence — d'où un test
    // qui vérifie la liste elle-même, et donc un export qui n'a de lecteur que lui.
    // Le gate exclut `__tests__/` de son scan par conception (il mesure la consommation
    // en prod), il ne peut donc pas le voir.
    // Symbol-level et pas `"*"` : les deux autres exports du fichier, `isUnsafeKey` et
    // `hasUnsafeSegment`, DOIVENT rester gatés — le jour où plus aucun sink ne les
    // appelle, c'est que les gardes ont sauté et on veut l'apprendre ici.
    "utils/general/object-path-guard.ts": ["UNSAFE_KEY_LIST"],

    // ── Contrats de duck-typing avec les plugins ──────────────────────────────
    // Ces types décrivent une frontière vérifiée STRUCTURELLEMENT (le plugin
    // déclare sa propre copie) : aucun import cross-package, par conception.
    "contracts/api.contract.ts": ["IGeoLeafAPIConstructors", "IHealthError"],
    // ⚠️ `GeoLeafGeolocationStateChangeDetail` (B-207) est le même cas, et il l'est de façon
    // particulièrement littérale : l'événement `geoleaf:geolocation:statechange` est émis par le
    // core et lu par `plugins/measure/src/tools/tool-gps.ts`, qui n'en importe pas le type — il
    // lit `e.detail` en duck-typing. Le type part dans `dist/types/` pour que l'intégrateur
    // puisse le NOMMER ; non exporté, la déclaration publiée citerait un type que personne ne
    // peut écrire (B-87). C'est un contrat qui FRANCHIT la frontière core → plugin, donc
    // « sans consommateur » y est une propriété, pas un symptôme.
    "contracts/event-bus.contract.ts": [
        "GeoLeafFeatureGeometry",
        "GeoLeafLayerAddedDetail",
        "GeoLeafGeolocationStateChangeDetail",
    ],
    "contracts/sidepanel-renderer.contract.ts": [
        "SidePanelFeatureDetail",
        "SidePanelFeatureGeometry",
        "SidePanelLayoutField",
    ],
    "contracts/ui-controls.contract.ts": ["IGeoLocationControlConfig"],

    // ── Forme documentée des objets `GeoLeaf.X` (intégrateurs / Studio) ────────
    // Les `buildPublicApi()` sont vivants ; c'est le TYPE de leur retour qui n'est
    // jamais importé — il documente la surface publique.
    "capabilities/branding/public-api.ts": ["BrandingPublicApi", "BrandingReadApi"],
    "capabilities/coordinates/public-api.ts": ["CoordinatesPublicApi", "CoordinatesReadApi"],
    "capabilities/geolocation/public-api.ts": ["GeolocationStateSnapshot"],
    "capabilities/labels/public-api.ts": ["LabelsPublicApi", "LabelsReadApi"],
    "capabilities/permalink/share/public-api.ts": ["SharePublicApi", "ShareReadApi"],
    "capabilities/scale/public-api.ts": ["ScalePublicApi", "ScaleReadApi"],
    "capabilities/theme-toggle/public-api.ts": ["ThemeTogglePublicApi"],

    // ── Divers, publics par un autre chemin ───────────────────────────────────
    // `CreateElementOptions` type l'option-bag de `GeoLeaf.Helpers.createElement` ;
    // `LogImplInterface`/`LogLevelName` typent `GeoLeaf.Log` et sont documentés dans
    // `log/index.ts` comme importables directement (contournement Rollup pour les
    // plugins) ; `PresetId` est le contrat public de composition d'entrée.
    "utils/log/logger.ts": ["LogImplInterface", "LogLevelName"],
    "contracts/preset.contract.ts": ["PresetId"],

    // KERNEL S14 — publics par l'OBJET, pas par un import nommé.
    // Ces 3 fonctions sont des membres de `GeoLeaf.Utils` (montées par
    // `utils-namespace.ts` via `Object.assign(target, UtilsBase)`). Elles ont perdu
    // leur dernier importeur *nommé* de production
    // quand le S14 a supprimé `utils-api.ts` — un assembleur mort depuis le retrait
    // des builds UMD en v2.0.0. Le gate raisonne sur les imports nommés et ne voit pas
    // l'atteinte par propriété d'objet : sans cette entrée il les signale à chaque run.
    // ⚠️ NE PAS PURGER. `object-utils.ts:23` documentait déjà ce cas au S11 pour
    // `resolveField` (« neither has an internal caller left ») : ces symboles ne
    // subsistent que par leur exposition publique, ce qui est exactement leur raison
    // d'être. Les retirer casserait `GeoLeaf.Utils` en silence.
    "utils/general/utils-base.ts": ["fireMapEvent", "throttle", "resolveField"],

    // ── Nommé par une signature inférée ───────────────────────────────────────
    // `FetchHelper.getConfig()` le retourne et `FetchHelper` est ré-exposé sur
    // `GeoLeaf.Utils` : le dé-exporter casse la déclaration de `Utils` (TS4023).
    "utils/general/fetch-helper.ts": ["FetchHelperOptions"],
    // Même contrainte, apparue à la tâche 5.1-f : `poiToFeature` est montée sur
    // `GeoLeaf.Utils` (`utils-namespace.ts`) et `PoiToFeatureInput` EST son type de
    // paramètre — un intégrateur qui type cet appel en a besoin, et le dé-exporter
    // casserait la déclaration de `Utils`.
    // ⚠️ Il est devenu « sans consommateur » parce que son SEUL importeur nommé était la
    // copie du seam dans `addpoi/src/utils/core-utils.ts`, partie avec le paquet fusionné.
    // C'est un faux positif structurel, pas un export mort : la fonction, elle, est
    // appelée par `e2e/18-security.spec.js` sur `deploy-full` — la variante qui n'a jamais
    // porté `addpoi`.
    "utils/general/poi-to-feature.ts": ["PoiToFeatureInput"],
    // Même contrainte, depuis KERNEL S14 (backlog B.16) : `CSRFToken` fait partie de
    // l'objet `Security` du baril, donc TypeScript doit pouvoir NOMMER son type pour
    // émettre la déclaration de `Security`. Aucun consommateur ne l'importe par son nom
    // — c'est un faux positif structurel, pas un export mort.
    "kernel/security/csrf-token.ts": ["CSRFTokenInternal"],

    // Même cas, introduit par la découpe de `ui/components.ts` (KERNEL S8) :
    // `_UIComponents` agrège `_LegendSymbols` + `_UIWidgets` par spread, donc son
    // type inféré nomme les configs de ces deux modules. Les dé-exporter casse la
    // déclaration de l'agrégat (TS4023). Aucun consommateur nommé, par conception —
    // les appelants passent des littéraux.
    "kernel/ui/legend-symbols.ts": ["SymbolConfig", "HatchConfig"],
    "kernel/ui/widgets.ts": ["AccordionConfig", "ToggleButtonConfig"],

    // Même contrainte TS4023 que `FetchHelperOptions` ci-dessus : `DOMSecurity.createSVGIcon()`
    // et `.getIcon()` le prennent en paramètre, et `DOMSecurity` est ré-exposé sur
    // `GeoLeaf.Utils` (`utils/general/utils-namespace.ts:75,123`) — le dé-exporter casse
    // l'émission de la déclaration de `Utils`. Le geste juste est donc l'ALLOWLIST, PAS la
    // purge (R.46, backlog résiduel S5).
    //
    // ⚠️ ENTRÉE ENCORE INERTE — et la note qui vivait ici disait le contraire.
    //
    // Elle a été posée PRÉVENTIVE et sans effet : `hasConsumer()` est une recherche par
    // token sur tout le monorepo, et `SVGIconOptions` apparaissait dans
    // `packages/plugins/table/src/utils/dom-security.ts` — une COPIE LOCALE non exportée
    // qui n'importait rien du core. Le gate y voyait un consommateur et tenait l'export
    // pour vivant : le faux négatif que le docblock de ce fichier assume.
    //
    // Cette copie a bien été fusionnée dans `@geoleaf/host-runtime/src/core-utils-seam.ts`
    // (G1 de l'audit de structure du 24/07, `audit_structure-arborescence.md` 📦), et le type
    // y a été DÉLIBÉRÉMENT renommé `IconOptions` : le garder sous le même nom aurait déplacé
    // le faux négatif de table vers host-runtime au lieu de le lever.
    //
    // 🔄 MAIS l'entrée n'est PAS devenue active pour autant, contrairement à ce que cette
    // note a affirmé du 26/07 au 01/08/2026 (« ✅ ENTRÉE DEVENUE ACTIVE à STRUCT S2 (F3) »).
    // Le token survit dans `kernel/security/index.ts:19`, le BARIL du sous-système :
    //     export type { SVGIconOptions } from "./dom-security.js";
    // `collectMonorepoCorpusFiles()` scanne `<paquet>/src` de tous les workspaces, donc le
    // core lui-même, et `hasConsumer()` ne saute que le fichier DÉFINISSANT. Le baril compte
    // comme consommateur. L'export n'est donc jamais candidat, et cette entrée n'absorbe rien.
    //
    // Mesuré par DOUBLE MUTATION le 01/08/2026, pas déduit :
    //   1. retirer cette entrée seule           → 0 candidat, gate verte  (elle n'absorbe rien)
    //   2. retirer cette entrée ET la ligne 19  → `SVGIconOptions` remonte en
    //      `kernel/security/dom-security.ts:26`, gate ROUGE, « 1 régression »
    // La 2e branche est ce qui prouve la cause ; la 1re seule ne l'aurait pas isolée.
    //
    // L'erreur de raisonnement, à ne pas refaire : S2 a VÉRIFIÉ que le fork disparaissait —
    // c'était vrai — puis en a DÉDUIT que l'entrée mordait, sans relancer le check. Un
    // obstacle levé ne prouve pas qu'il était le seul. ⚠️ Et `checkAllowlistFresh()` ne
    // rattrape pas cette classe : elle vérifie que le fichier et le symbole existent
    // toujours, jamais que l'entrée SERT à quelque chose.
    //
    // L'entrée RESTE malgré tout, et ce n'est pas de la superstition : la contrainte TS4023
    // ci-dessus est réelle, donc le jour où le baril cesse de ré-exporter ce type, l'export
    // devient orphelin pour de bon et c'est cette entrée qui doit l'absorber. La retirer
    // maintenant échangerait une entrée muette contre une gate rouge différée.
    // Suivi : dette `D-09` (`_docs_projet/registres/dette_technique.md`).
    "kernel/security/dom-security.ts": ["SVGIconOptions"],

    // Même cas encore, introduit par la mutualisation de la normalisation cluster
    // (R.40) : `resolveClusteringNormalization()` est exportée et retourne
    // `ClusteringNormalizationPatch | null`, donc TypeScript doit pouvoir NOMMER ce type
    // pour émettre la déclaration de la fonction. Aucun appelant ne l'importe par son nom
    // — les deux sites passent le résultat à `Object.assign`.
    "kernel/geojson/loader/clustering-normalize.ts": ["ClusteringNormalizationPatch"],
};

/** `"*"` | tableau de symboles | undefined. */
function allowlistFor(relFile) {
    return ALLOWLIST[normPath(relFile)];
}

/**
 * Une entrée d'allowlist qui ne correspond plus à rien est une entrée FANTÔME : elle
 * survit aux purges et exempte silencieusement un fichier qui n'existe plus. Le projet
 * s'est déjà fait mordre par des entrées `sideEffects` fantômes (PB-1/PB-1bis) — on ne
 * rejoue pas.
 */
function checkAllowlistFresh(coreFiles, exportsByFile) {
    const stale = [];
    for (const [rel, value] of Object.entries(ALLOWLIST)) {
        const abs = path.join(CORE_SRC, rel);
        if (!coreFiles.includes(abs)) {
            stale.push(`${rel} — fichier introuvable`);
            continue;
        }
        // 🛑 B-20 — LE JOKER `"*"` N'EXISTE PLUS, et cette ligne disait pourquoi il fallait
        // le retirer. Elle s'écrivait `if (value === "*") continue;` : une exemption globale
        // était donc **exemptée du contrôle de péremption lui-même**. Les quatre qui vivaient
        // ici ont survécu à ce titre — mesuré le 16/08/2026, elles masquaient **zéro** orphelin,
        // et rien ne pouvait le dire. Une exemption qui échappe au contrôle des exemptions est
        // la seule qui ne se périme jamais.
        if (!Array.isArray(value)) {
            stale.push(
                `${rel} — valeur non listée (${JSON.stringify(value)}). L'ALLOWLIST n'accepte ` +
                    `QUE des listes de symboles nommés : une exemption globale échapperait à ce ` +
                    `contrôle et survivrait à la purge de sa cible.`
            );
            continue;
        }
        const names = new Set((exportsByFile.get(abs) || []).map((e) => e.name));
        for (const sym of value) {
            if (!names.has(sym)) stale.push(`${rel}::${sym} — export introuvable`);
        }
    }
    return stale;
}

// ─── Collecte de fichiers ──────────────────────────────────────────────────────
function collectFiles(dir, exts, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            collectFiles(full, exts, acc);
        } else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) {
            acc.push(full);
        }
    }
    return acc;
}

function collectCoreSourceFiles() {
    return collectFiles(CORE_SRC, [".ts"], []).filter((f) => !f.endsWith(".d.ts"));
}

function collectMonorepoCorpusFiles() {
    const acc = [];
    // ARCHI S9.5 — packages from the workspace registry, and NO swallow.
    //
    // The previous form did `try { readdirSync(PKG_DIR) } catch { pkgEntries = [] }`,
    // which is the most dangerous shape in this file: an unreadable packages/ yielded
    // an EMPTY corpus, and an orphan-export check against an empty corpus finds no
    // orphans and exits 0. The gate reported success precisely when it could not run.
    // A registry failure now propagates.
    for (const pkg of require("./lib/packages.cjs").all()) {
        collectFiles(path.join(pkg.absDir, "src"), [".ts", ".tsx", ".js"], acc);
    }
    collectFiles(EXAMPLES_DIR, [".ts", ".tsx", ".js"], acc);
    if (acc.length === 0) {
        throw new Error(
            "check-orphan-exports: the monorepo corpus is empty. Refusing to report " +
                "'no orphans' from a corpus that could not be built."
        );
    }
    return acc;
}

// ─── Extraction des exports nommés (TypeScript compiler API) ──────────────────
function modifiersOf(stmt) {
    return ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) || [] : [];
}

function extractExports(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    const found = [];

    for (const stmt of sf.statements) {
        const mods = modifiersOf(stmt);
        const hasExport = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
        const line = sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;

        if (hasExport && !isDefault) {
            if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
                if (stmt.name) found.push({ name: stmt.name.text, line, literal: null });
            } else if (
                ts.isInterfaceDeclaration(stmt) ||
                ts.isTypeAliasDeclaration(stmt) ||
                ts.isEnumDeclaration(stmt)
            ) {
                found.push({ name: stmt.name.text, line, literal: null });
            } else if (ts.isVariableStatement(stmt)) {
                for (const decl of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name)) {
                        const literal =
                            decl.initializer && ts.isStringLiteral(decl.initializer)
                                ? decl.initializer.text
                                : null;
                        found.push({ name: decl.name.text, line, literal });
                    }
                }
            }
        }

        // `export { A, B as C }` (local re-export) and `export * as ns from "./x"`.
        if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
            if (ts.isNamedExports(stmt.exportClause)) {
                for (const spec of stmt.exportClause.elements) {
                    found.push({ name: spec.name.text, line, literal: null });
                }
            } else if (ts.isNamespaceExport(stmt.exportClause)) {
                found.push({ name: stmt.exportClause.name.text, line, literal: null });
            }
        }
    }

    return found;
}

// ─── Corpus (commentaires retirés, tokenisé) ───────────────────────────────────
function stripComments(text) {
    // Suffisant pour ce grep, pas un vrai parseur : évite les faux "vivant" purement
    // JSDoc (cas Introspection) ; un "//" dans une chaîne littérale peut tronquer à
    // tort, cas rare et sans risque (biaise vers le faux négatif, pas le faux positif).
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadCorpus(files) {
    const corpus = [];
    for (const f of files) {
        let raw;
        try {
            raw = fs.readFileSync(f, "utf8");
        } catch {
            continue;
        }
        const stripped = stripComments(raw);
        const tokens = new Set(stripped.match(IDENTIFIER_RE) || []);
        corpus.push({ file: path.resolve(f), content: stripped, tokens });
    }
    return corpus;
}

function hasConsumer(exp, definingFile, corpus) {
    const defResolved = path.resolve(definingFile);
    for (const entry of corpus) {
        if (entry.file === defResolved) continue;
        if (entry.tokens.has(exp.name)) return true;
        if (exp.literal && entry.content.includes(exp.literal)) return true;
    }
    return false;
}

// ─── Run ────────────────────────────────────────────────────────────────────────
function main() {
    let coreFiles, corpusFiles;
    try {
        coreFiles = collectCoreSourceFiles();
        corpusFiles = collectMonorepoCorpusFiles();
    } catch (e) {
        console.error("✖ check-orphan-exports: erreur de collecte des fichiers —", e.message);
        process.exit(2);
    }

    if (coreFiles.length === 0) {
        console.error("✖ check-orphan-exports: aucun fichier trouvé dans packages/core/src.");
        process.exit(2);
    }

    const corpus = loadCorpus(corpusFiles);
    const candidates = [];
    const exportsByFile = new Map();

    for (const file of coreFiles) {
        let exportsFound;
        try {
            exportsFound = extractExports(file);
        } catch (e) {
            console.error(`✖ check-orphan-exports: échec de parsing sur ${file} —`, e.message);
            process.exit(2);
        }
        exportsByFile.set(file, exportsFound);

        const relFile = path.relative(CORE_SRC, file);
        const allow = allowlistFor(relFile);
        // B-20 — plus de joker : `allow` est soit `undefined`, soit une liste de symboles.
        // Un fichier entièrement exempté se déclare donc en NOMMANT ses exports, ce qui les
        // rend visibles à `checkAllowlistFresh` — et donc périssables.

        for (const exp of exportsFound) {
            if (allow && allow.includes(exp.name)) continue;
            if (!hasConsumer(exp, file, corpus)) {
                candidates.push({ file: relFile, line: exp.line, name: exp.name });
            }
        }
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ candidates }, null, 2));
    }

    // Une allowlist qui pourrit exempte en silence — la vérifier AVANT tout verdict.
    const stale = checkAllowlistFresh(coreFiles, exportsByFile);
    if (stale.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${stale.length} entrée(s) d'allowlist obsolète(s) —\n`
        );
        for (const s of stale) console.error(`  ${s}`);
        console.error(
            "\nLa cible a été purgée ou renommée : retirer l'entrée d'`ALLOWLIST`\n" +
                "(scripts/check-orphan-exports.cjs). Une entrée fantôme exempte un fichier\n" +
                "qui n'existe plus et masquera le prochain export mort qui prendra sa place."
        );
        process.exit(1);
    }

    if (UPDATE_BASELINE) {
        writeBaseline(candidates);
        console.log(
            `✓ check-orphan-exports: baseline régénérée (${candidates.length} candidat(s) figé(s) dans ` +
                `${path.relative(ROOT, BASELINE_PATH)}).`
        );
        process.exit(0);
    }

    const baseline = loadBaseline();

    // ⚠️ APRÈS le bloc `--update-baseline` ci-dessus, et c'est structurel : posée avant lui,
    // cette vérification interdirait de RÉGÉNÉRER la baseline au moment précis où un candidat
    // neuf n'a pas encore de classe — la gate se verrouillerait elle-même. L'ordre correct est :
    // on régénère, puis la prochaine exécution normale rougit tant que la classe manque.
    const unclassified = checkClassificationComplete(baseline);
    if (unclassified.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${unclassified.length} écart(s) entre la baseline et son ` +
                "classement —\n"
        );
        for (const p of unclassified) console.error(`  ${p}`);
        console.error(
            "\nChaque entrée de la baseline porte UNE classe dans `CLASSES`\n" +
                "(scripts/check-orphan-exports.cjs) : A usage intra-fichier · C consommation\n" +
                "structurelle · D seam de test, priorité D > C > A. Une baseline non classée ne\n" +
                "dit pas de quelle nature est sa dette, donc elle ne peut pas rétrécir ; une clé\n" +
                "classée sans entrée est une entrée fantôme, qui simule un tri complet."
        );
        process.exit(1);
    }

    const known = candidates.filter((c) => baseline.has(candidateKey(c)));
    const fresh = candidates.filter((c) => !baseline.has(candidateKey(c)));

    if (candidates.length === 0) {
        console.log(
            `✓ check-orphan-exports: aucun export orphelin (${coreFiles.length} fichiers core, ` +
                `${corpusFiles.length} fichiers de corpus analysés).`
        );
        process.exit(0);
    }

    if (known.length > 0) {
        console.log(
            `ℹ check-orphan-exports: ${known.length} candidat(s) déjà connu(s) (baseline, Sprint 3/4 — ` +
                "non bloquant)."
        );
    }

    if (fresh.length === 0) {
        console.log(
            `✓ check-orphan-exports: aucun NOUVEL export orphelin (${known.length} déjà en baseline, non bloquant).`
        );
        process.exit(0);
    }

    console.error(
        `✖ check-orphan-exports: ${fresh.length} NOUVEL export(s) sans consommateur :\n`
    );
    for (const c of fresh) {
        console.error(`  ${c.file}:${c.line}  ${c.name}`);
    }
    console.error(
        `\n${fresh.length} régression(s) — vérifier avant de purger (« annoncé mort ≠ mort »), ` +
            "ajouter à ALLOWLIST si volontaire, ou régénérer la baseline (--update-baseline) " +
            "si c'est un candidat légitime destiné au tri Sprint 3/4."
    );
    process.exit(1);
}

main();
