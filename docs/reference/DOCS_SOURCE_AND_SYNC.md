# Documentation — Gouvernance et synchronisation vers le repo public

**Règle de travail** pour la documentation du monorepo GeoLeaf-Js et pour la publication de la documentation publique du core.

> **Mis à jour mars 2026** — Le dossier `docs/` présent dans d'anciens documents n'existe plus. La documentation est désormais répartie en trois zones décrites ci-dessous.

---

## 1. Zones documentaires

### Zone 1 — `packages/core/docs/` (documentation publique)

- **Source principale publique** (100 % MIT, maintenue manuellement).
- Contenu : Getting Started, API reference, guides d'intégration, module READMEs, architecture technique, schemas JSON.
- ⚠️ **N'est PLUS synchronisée** vers `GeoLeaf-Core` : les 3 workflows de miroir sont supprimés (ARCHI S9.0, voir §2). Cette ligne affirmait le contraire de son propre §2 — corrigé le 27/07/2026. Le canal réel est **npm**.
- **À modifier directement** dans `packages/core/docs/` pour tout ajout ou correction de documentation publique.

### Zone 2 — `_docs_projet/` (documentation interne privée)

- Documentation **non publiée**, réservée à l'équipe.
- Contenu : voir `_docs_projet/INDEX.md`, qui n'indexe que ce qui existe.
  ⚠️ _Les quatre emplacements listés ici jusqu'au 27/07/2026 — `docs_de_travail/`, `legal/`,
  `guides/` avec SonarQube, `docs_de_travail/md/` — **n'existent aucun**. L'arborescence a été
  refondue par régime de maintenance : `specs/` · `reference/` · `guides/` · `travail/` ·
  `registres/` · `vision/`._
- **Jamais synchronisée** vers le dépôt public.

### Zone 3 — `_docs_communs/` (conventions partagées)

- Conventions de code, gabarits de documents (audits, roadmaps, CDC), méthodologie projet.
- Partagée entre projets via **jonction NTFS**. Non synchronisée.

---

## 2. Synchronisation vers le repo public — ⚠️ **supprimée (ARCHI S9.0, 20/07/2026)**

Les workflows `sync-core-public.yml`, `sync-demo-public.yml` et `sync-plugins-mit-public.yml` **n'existent plus**. `packages/core/docs/` n'est plus copié vers `GeoLeaf-Core` ; ce dépôt est figé sur son dernier état.

**Comment la doc publique atteint son lectorat aujourd'hui :**

| Canal       | Contenu                                                 | Mécanisme                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm**     | `packages/core/docs/` — **le markdown SEUL** (62 `.md`) | Embarqué dans le tarball de `@geoleaf/core` (`files[]`) — publié par `npm run publish:core`. ⚠️ **T4.3** : `docs/api/` et `docs/public/` en sont exclus par négation, la référence générée ne part plus sur npm            |
| **TypeDoc** | API générée depuis les TSDoc                            | ⚠️ **Plus AUCUNE automatisation depuis T4.2** — `docs-typedoc.yml` est supprimé. La référence est régénérée à la demande, en local, par `npm run docs:api` (step 1 de `docs:deploy`), et ne vit plus que sur `geoleaf.dev` |

Motif de la suppression : `GeoLeaf-Core` étant passé privé, le miroir synchronisait du privé vers du privé — la justification « seul canal public » était devenue fausse. Le workflow bloquait par ailleurs ARCHI S9 (copie verbatim de `tsconfig.json` / `rollup.config.mjs`, échec silencieux sur source absente).

Le gate `verify-core-standalone.cjs` s'exécutait dans ce workflow **et** dans `ci:local` / `ci.yml` / `.husky/pre-commit` depuis ARCHI S0 : il reste pleinement appliqué.

---

## 3. Résumé

| Question                                           | Réponse                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Où rédiger la doc publique (core) ?                | Dans **`packages/core/docs/`** directement.                                                                                                                                                                                                                |
| Où rédiger la doc interne (guides, légal, CDC) ?   | Dans **`_docs_projet/`**.                                                                                                                                                                                                                                  |
| Comment la doc core arrive-t-elle à son lectorat ? | Via **npm** — `packages/core/docs/` est dans le tarball de `@geoleaf/core`. Le miroir CI `sync-core-public.yml` est supprimé (ARCHI S9.0).                                                                                                                 |
| La doc publique inclut-elle la doc des plugins ?   | **Non.** Chaque `@geoleaf-plugins/*` embarque la sienne dans son package npm.                                                                                                                                                                              |
| Faut-il utiliser sync-core-docs.cjs ?              | **Non**, il n'existe plus — et **le workflow CI non plus**. ⚠️ _Cette ligne renvoyait vers « le workflow CI » alors que §2 le déclare supprimé : deuxième contradiction interne, corrigée le 27/07/2026._ Il n'y a **aucune** synchronisation automatique. |

---

## 4. Schémas JSON — source de vérité et synchronisation

### Règle de gouvernance

**`profiles/schemas/` est la source de vérité opérationnelle pour tous les schémas JSON.** C'est dans ce répertoire que vivent les schémas actifs. ⚠️ _La version précédente en annonçait **11** et citait `taxonomy.schema.json` : il y en a **12**, et celui-là **n'existe pas** — la taxonomie est un module depuis le Lot 2. Le décompte ne se recopie pas : `ls profiles/schemas/`._

**`packages/core/docs/schema/` est la copie documentaire** destinée aux consommateurs publics (`@geoleaf/core`). ⚠️ _Il n'est **plus** synchronisé par la CI (ARCHI S9.0) — troisième contradiction interne, corrigée le 27/07/2026._ Il atteint son lectorat par le **tarball npm** de `@geoleaf/core`. Vérifié le 27/07/2026 : il ne contient toujours qu'un `README.md`, les schémas y sont **à copier** manuellement.

### Règle de synchronisation

> **Tout ajout ou modification d'un schéma dans `profiles/schemas/` doit être répercuté dans `packages/core/docs/schema/`.**

Ordre des opérations :

1. Modifier / créer le schéma dans `profiles/schemas/`
2. Copier le fichier dans `packages/core/docs/schema/`
3. Mettre à jour le `README.md` de `packages/core/docs/schema/` si un nouveau fichier est ajouté
4. Committer les deux modifications ensemble

### État au 27 juillet 2026

| Répertoire                   | Contenu                                                 | Statut              |
| ---------------------------- | ------------------------------------------------------- | ------------------- |
| `profiles/schemas/`          | les schémas JSON opérationnels (`ls profiles/schemas/`) | ✅ Source de vérité |
| `packages/core/docs/schema/` | README uniquement — schémas absents                     | ⚠️ À synchroniser   |

---

## 5. Déploiement automatique des docs — GitHub Pages (A3)

### Flux complet

```
[1] ÉCRITURE — Monorepo privé
    packages/core/docs/*.md  ← modifier ici
         │
         ├──────────────────────────────┐
         │  npm run publish:core        │  ✂️ CHAÎNE COUPÉE — ARCHI S9.0
         ▼                              ▼
[2] PUBLICATION — npm          [2'] SYNC — sync-core-public.yml  ❌ SUPPRIMÉ
    docs/*.md dans le                packages/core/ → GeoLeaf-Core
    tarball @geoleaf/core                 │
                                          ▼
                               [3] BUILD — deploy-docs.yml (dans GeoLeaf-Core)
                                   VitePress → actions/deploy-pages
                                          │
                                          ▼
                               [4] GitHub Pages → docs.geoleaf.dev
                                   ⚠️ FIGÉ sur le dernier build
```

```callout warn label="Conséquence assumée de S9.0 — docs.geoleaf.dev ne se met plus à jour"
`deploy-docs.yml` ne vit **pas** dans ce dépôt : il s'exécute **dans `GeoLeaf-Core`**, sur push vers son `main`. Le seul producteur de ces push était `sync-core-public.yml`, supprimé. Le site reste **en ligne** (GitHub Pages sert le dernier build) mais **gelé**.

~~`packages/core/.github/workflows/deploy-docs.yml` subsiste dans ce dépôt~~ — **supprimé à T3.3** (l'affirmation était déjà fausse avant T4). Il était inerte : GitHub ne lit que `.github/workflows/` à la racine. C'était le fichier que le miroir recopiait, et son **intention** — build VitePress → GitHub Pages — n'a jamais eu d'équivalent racine (dette tranchée à T4.8, option (c) : la porteuse est T5.1).

**Les trois issues sont tranchées — T5.1 a rendu 4.8 (option (c)) exécutoire (25/07/2026).**

| # | Issue | Sort |
| --- | --- | --- |
| 1 | Rapatrier la publication ici (`deploy-docs.yml` → racine + Pages sur `GeoLeaf-Js`) | ❌ **Écartée.** Publier des Pages depuis un dépôt privé demande un plan payant, et le quota Actions du compte est rare |
| 2 | Attendre ARCHI S3.6 (passage public) | ❌ **Écartée comme condition** — elle ferait dépendre la publication documentaire d'une décision qui n'a pas de date |
| 3 | Accepter le gel de `docs.geoleaf.dev` | ✅ **Retenue, et rendue explicite** |

**Le canal est UNIQUE et MANUEL : `npm run docs:deploy` (`scripts/deploy-docs.cjs`).** Aucun workflow GitHub ne le déclenche — c'est un choix, pas un oubli, et le recréer rouvrirait 4.8. Le script porte cet énoncé dans son en-tête, ARCHITECTURE.md le répète à l'entrée `docs-dist/`.

⚠️ **Depuis T5.1, la cible externe vient de `GEOLEAF_DOCS_SITE_ROOT`** — obligatoire, sans valeur par défaut : absente, le script sort en 1 **sans rien écrire ni supprimer**. Invocation : `GEOLEAF_DOCS_SITE_ROOT=/chemin/vers/Sites_Web/geoleaf.dev npm run docs:deploy`. La variable remplace quatre `..` en dur qui rendaient indéterminée la cible d'un `rmSync` récursif, et T5.1 a corrigé au passage un défaut plus grave que le chemin : `syncDir` **détruisait avant de constater** — destination effacée, source manquante réduite à un `console.warn`, **exit 0**.

⚠️ « la doc reste distribuée par npm **et par TypeDoc** » est devenu faux à T4.2/4.3 : la référence générée n'est plus ni publiée automatiquement, ni embarquée dans le tarball. Le markdown, lui, y reste.

### Activation manuelle requise (une seule fois sur GitHub)

| #   | Action                                          | Où                                                                             |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Activer GitHub Pages sur `GeoLeaf-Core`         | Settings → Pages → Source : **GitHub Actions**                                 |
| 2   | Configurer le domaine custom `docs.geoleaf.dev` | Settings → Pages → Custom domain ; CNAME DNS → `mattpottier-ship-it.github.io` |

---

_Voir aussi : [MONOREPO_WORKFLOW.md](MONOREPO_WORKFLOW.md), [INDEX.md](../INDEX.md), [MONOREPO_STRUCTURE.md](MONOREPO_STRUCTURE.md)._
```
