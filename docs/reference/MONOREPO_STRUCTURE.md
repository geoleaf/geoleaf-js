# GeoLeaf-Js — Structure du monorepo

> **Version :** 1.3.0 | **Dernière mise à jour :** 31 mars 2026

**Rôles des répertoires** et conventions (packages, apps, test-deploy, scripts, profils). Pour le workflow quotidien et la release, voir [MONOREPO_WORKFLOW.md](MONOREPO_WORKFLOW.md). Pour l’arborescence détaillée, voir [ARBORESCENCE_QUALIFIEE.md](ARBORESCENCE_QUALIFIEE.md).

---

## Vue d’ensemble

| Répertoire          | Rôle principal                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **packages/**       | Packages npm, tous MIT — source du code publié. Le compte se mesure (`npm run versions:check`), il n'est pas recopié |
| **deploy/**         | Variantes de déploiement prêtes à servir (deploy-core, deploy-full), générées par `npm run build:deploy`             |
| **scripts/**        | Scripts build, déploiement, audit, sync doc — pas publiés comme packages                                             |
| **profiles/**       | Profils métier à la racine (référence) ; copies possibles dans package / deploy                                      |
| **\_docs_projet/**  | Documentation interne (guides, CDC, RFC, roadmaps, audits, docs de travail)                                          |
| **\_docs_communs/** | Conventions, gabarits et méthodologie partagés (jonction NTFS)                                                       |

---

## packages/

Contient les **packages npm** du monorepo.

| Package                             | Rôle                                                                                                      | Licence | Publication      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- | ---------------- |
| **packages/core**                   | Bibliothèque GeoLeaf (core)                                                                               | MIT     | npm public       |
| **packages/plugins/connector**      | Connecteur HTTP REST générique                                                                            | MIT     | npm public       |
| **packages/plugins/websocket**      | Transport WebSocket temps réel                                                                            | MIT     | npm public       |
| **packages/plugins/realtime-layer** | Couche temps réel (WebSocket+polling)                                                                     | MIT     | npm public       |
| **packages/plugins/file-import**    | Import fichiers géospatiaux                                                                               | MIT     | npm public       |
| **packages/plugins/flatgeobuf**     | Chargement FlatGeobuf + bbox spatial                                                                      | MIT     | npm public       |
| **packages/plugins/print**          | Plugin impression/export carte (PDF, JPG, 300 DPI, A4/A3)                                                 | MIT     | npmjs.org public |
| **packages/plugins/measure**        | Mesure et annotation cartographique                                                                       | MIT     | npmjs.org public |
| **packages/plugins/offline-ui**     | UI offline (sélecteur couches / cache / sync) — moteur in-core (`modules.offline`)                        | MIT     | npmjs (public)   |
| **packages/plugins/addpoi**         | Plugin ajout/édition POI                                                                                  | MIT     | npmjs.org        |
| **packages/plugins/editor**         | Édition géométries (Point/Ligne/Polygone) + catalogue form + persistance online/offline (Terra Draw lazy) | MIT     | npmjs.org        |
| **packages/plugins/cog**            | Rendu Cloud Optimized GeoTIFF                                                                             | MIT     | npmjs.org        |

> **Licence — MIT, sans exception.** Tous les paquets du dépôt déclarent `license: MIT`, et c'est désormais gaté (`LIC-05`, `scripts/check-license-headers.cjs`). Le nombre de paquets, ceux qui portent un fichier `LICENSE` et ceux qui portent un `publishConfig` ne sont **pas** recopiés ici : ils se mesurent, `npm run versions:check`.
>
> ⚠️ Cette ligne a écrit « Les 18 packages déclarent `license: MIT` **et** un `publishConfig` npmjs/public » — trois assertions dont une seule était vraie. Mesuré le 05/08/2026 : **17** paquets, **17/17** en MIT, mais **14/17** portent un `publishConfig`, l'écart étant exactement les 3 paquets privés. Un chiffre recopié en prose diverge sans que rien ne le voie ; une commande, non.

- Les **sources** du core sont dans `packages/core/src/` (TypeScript).
- Les **plugins** dépendent de `@geoleaf/core` et ont leur propre `src/`.
- Les **artefacts** de build sont dans chaque `packages/<name>/dist/`.

---

## Flux vers les dépôts publics — ⚠️ supprimé (ARCHI S9.0, 20/07/2026)

Les 3 workflows de miroir (`sync-core-public.yml`, `sync-demo-public.yml`, `sync-plugins-mit-public.yml`) **n'existent plus**. Ils alimentaient `GeoLeaf-Core`, `GeoLeaf-Demo` et `GeoLeaf-Plugins-MIT` ; ces 3 dépôts subsistent, **figés** sur leur dernier état synchronisé.

Motif de la suppression : leur justification (« seul canal par lequel le code MIT est publiquement lisible ») était devenue fausse — `GeoLeaf-Core` est passé privé, donc ils synchronisaient du privé vers du privé — et ils bloquaient la mise en déclaratif des configs de build (ils copiaient `tsconfig.json` et `rollup.config.mjs` verbatim, et échouaient en silence sur source absente).

**La distribution passe exclusivement par npm** : `@geoleaf/core` et `@geoleaf-plugins/*`, tous MIT/public.

Le sort des 3 dépôts satellites — suppression ou passage public du monorepo lui-même — se tranche avec **ARCHI S3.6**. Le dossier de préparation de **B-02** est `rapport_passage-public.md` : il vit à l'atelier, **il n'est pas publié**, et le lien qui y menait a été retiré plutôt que repointé — un renvoi qui 404 chez le lecteur public est pire qu'une mention sans lien.

> ⚠️ **Ce lien pointait `travail/roadmaps/roadmap_documentation-v3.md`** — un texte et une cible
> qui désignaient deux documents différents. `check-dead-links` ne voit pas cette classe : la
> cible existait, donc le lien était vert **en menant ailleurs que là où il disait**. Repointé le
> 01/08/2026, à l'archivage de la roadmap qui l'aurait rendu franchement mort.

> `verify-core-standalone.cjs` reste en vigueur. Il n'a jamais dépendu des miroirs : c'est une frontière d'**architecture** (le core ne référence aucun plugin), câblée dans `ci:local`, `ci.yml` et `.husky/pre-commit` depuis ARCHI S0.

## Templates démo et deploy/

- **`packages/core/index.html`** + **`packages/core/init.js`** : point d’entrée de la démo officielle, co-localisés avec le package core. Servent de **templates source** pour `build-deploy.cjs` : les chemins relatifs sont réécrits vers la structure plate du deploy.
- **`packages/core/demo/`** : fichiers support démo uniquement — `demo-header.html` (barre header avec sélecteurs) et `demo.extensions.js` (log verbeux, sélecteur de thème CSS, sélecteur de profil). Les deux blocs à retirer pour tout projet réel sont balisés `DEMO ONLY` dans `index.html`.
- **`deploy/`** : application prête à copier sur un serveur (chemins plats, bundles minifiés). **`npm run build:deploy`** produit les variantes livrables ; `scripts/build-deploy-coverage.cjs` produit en plus **`deploy-coverage/`**, une copie instrumentée qui n'est **pas** un livrable. La liste ne se recopie pas ici — elle se lit sur le disque (`ls deploy/`) ou dans `scripts/build-deploy.cjs`.

    > 🛑 **Cette ligne a décrit TROIS variantes dont `deploy-addpoi` jusqu'au 08/08/2026, et les trois assertions qu'elle portait étaient fausses ensemble.** `addpoi` a fusionné dans `editor` au Sprint 5 (05/08/2026) : le plugin, la variante et le port **8770** ont disparu le même jour. Le motif écrit ici — « AddPOI et Editor sont mutuellement exclusifs, d'où trois variantes et non deux » — est **éteint**, pas seulement périmé : c'est le mode d'échec où la cible est correctement décrite et où la contrainte qui la motivait est tombée. Les ports E2E réels sont dérivés par `e2e/helpers/base-url.js` et déclarés dans `playwright.config.js` — ne pas les recopier non plus.

---

## deploy/ (variantes)

Variantes de déploiement **prêtes à servir**, générées en une fois par **`npm run build:deploy`** (script `scripts/build-deploy.cjs`).

| Dossier                | Contenu                                    |
| ---------------------- | ------------------------------------------ |
| **deploy/deploy-core** | Core seul (minifié + profil tourism)       |
| **deploy/deploy-full** | + Storage + Cog + Editor (édition unifiée) |

Chaque variante contient index.html, dist/, css/, icons/, profiles/. Utilisé pour tests manuels, E2E Playwright et validation avant release. Servir avec `npx serve deploy -p 8765` ou `node scripts/serve-test.cjs` (ports 3001–3003).

---

## scripts/

Scripts **hors packages** : build, déploiement, audit, synchronisation doc.

- **build-deploy.cjs** : produit toutes les variantes livrables en une fois (`npm run build:deploy:all`). La liste vit dans le script, pas ici.
- **smoke-test.cjs**, **benchmark.cjs**, **audit-innerhtml.cjs** : tests et audits qualité.
- Autres : génération de tuiles vectorielles, publication plugins, validation de docs, etc.

Ces scripts ne sont **pas publiés** sur npm ; ils font partie du dépôt GeoLeaf-Js uniquement.

---

## Profils

- **`profiles/`** à la **racine** : **source unique** des profils métier (ex. `profiles/tourism/`). Structure : `profile.json`, `taxonomy.json`, `layers.json`, `mapping.json`, `themes.json`, `basemaps.json`, `layers/<layerId>/`, etc. C’est la source utilisée en développement, par `build-deploy.cjs`, et synchronisée vers le repo public MIT par le CI.
- **`deploy/*/profiles/`** : **copie** du ou des profils injectée par `build-deploy.cjs` pour chaque variante produite.

En résumé : **source = `profiles/` à la racine uniquement** — ne pas dupliquer dans `packages/core/`.

---

## Documentation

La documentation est répartie en trois zones distinctes :

- **`packages/core/docs/`** : la documentation d’**USAGE** — démarrage, tutoriels, recettes, guides de configuration, README de module. C’est la source du site VitePress rendu sur `www.geoleaf.dev/docs/`. ⚠️ **`docs/api/` et `docs/public/` n’en font PAS partie** : ce sont deux arbres GÉNÉRÉS et gitignorés. `docs-dist/` (racine depuis T4.4) est l’artefact du build VitePress : **jamais commité**. ⚠️ La chaîne « synchronisée vers GeoLeaf-Core par la CI, puis publiée via GitHub Pages » est **caduque** — les 3 workflows de miroir ont été supprimés à ARCHI S9.0. Le seul canal restant est `npm run docs:deploy`, manuel.
    - ⚠️ **Cette ligne a dit « documentation publique complète » et « 62 `.md` » jusqu’au 11/08/2026, et les deux sont faux** : il y en a **60**, et surtout elle n’est pas la doc publique _complète_ mais **un tiers de celle-ci** — `docs/specs/` porte le contrat, `docs/reference/` la référence dérivée. Le partage fait règle : [`DOCS_SOURCE_AND_SYNC.md`](DOCS_SOURCE_AND_SYNC.md).
    - ⚠️ **Elle disait aussi ce répertoire « exclu du tarball npm par une négation dans `files[]` »** — c’est le répertoire **entier** qui a quitté `files[]` le 11/08/2026 : un tarball n’emporte plus que `README.md` + `dist/`.
- **`_docs_projet/`** : documentation interne — CDC, guides opérationnels, RFC, roadmaps, audits, docs de travail. Non synchronisée vers le repo public.
- **`_docs_communs/`** : conventions de code, gabarits de documents, méthodologie de travail (jonction NTFS partagée). Non synchronisée.

Voir [DOCS_SOURCE_AND_SYNC.md](DOCS_SOURCE_AND_SYNC.md) pour la gouvernance documentaire complète.

---

## Documentation associée

- [MONOREPO_WORKFLOW.md](MONOREPO_WORKFLOW.md) — workflow quotidien, release, CI, sécurité.
- [ARBORESCENCE_QUALIFIEE.md](ARBORESCENCE_QUALIFIEE.md) — arborescence détaillée du dépôt, **générée**.
- Le guide de distribution — build, artefacts, test-deploy, publication npm — est **interne et non publié** : c'est une procédure d'exploitation, pas de la doc d'usage. Il vit dans le dépôt de travail et n'est donc pas atteignable depuis ici ; c'est délibéré, et le nommer par son chemin donnerait un renvoi qui ne résout pas.

> ⚠️ Les deux premières entrées portaient un **texte et une cible qui désignaient deux
> documents différents** — `PROJECT_TREE.md` pour `ARBORESCENCE_QUALIFIEE.md`, et le guide de
> distribution interne pour cette même arborescence. `check-dead-links` ne
> voit pas cette classe : la cible résolvait, donc la gate se taisait. C'est la troisième
> occurrence du même défaut dans ce seul fichier — voir l'avertissement du §Flux vers les
> dépôts publics, qui en consigne une autre.
