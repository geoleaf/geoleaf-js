---
type: spec-plugin
title: flatgeobuf — la lecture de vecteur binaire, filtrée par emprise
plugin_id: flatgeobuf
package: "@geoleaf-plugins/flatgeobuf"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# flatgeobuf — la lecture de vecteur binaire, filtrée par emprise

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/flatgeobuf` ·
**Code :** `packages/plugins/flatgeobuf/` · **Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Ce plugin a une porte d'entrée que [`cog`](CDC_cog.md) n'a pas : il est utilisable
> _déclarativement_.** Une couche de profil portant `"plugin": "flatgeobuf"` est rendue sans une
> ligne de code d'intégration, via un **chargeur de couche enregistré** — une quatrième étape
> d'`entry.ts` absente du squelette figé. C'est la différence structurante entre les deux fiches.

---

## Périmètre

### Ce que le plugin fait

Il lit un fichier **FlatGeobuf** — format vecteur binaire portant son propre **index spatial
R-tree** — et en rend les entités sur la carte. Grâce à cet index et aux requêtes HTTP partielles,
il peut ne récupérer **que les entités d'une emprise donnée**, sans télécharger le fichier entier.

Il s'utilise de deux façons : **impérativement** (quatre fonctions sur son namespace) ou
**déclarativement** (une couche de profil qui le désigne).

### Ce qu'il ne fait pas

- **Il n'enregistre pas la couche dans le gestionnaire de couches.** Le tracé apparaît sur la carte,
  mais **pas** dans le panneau : cet enregistrement est interne au core et n'est pas atteignable
  depuis un plugin. C'est la limite la plus surprenante de ce plugin.
- **Il ne convertit pas vers FlatGeobuf** : il lit, il n'écrit pas.
- **Il ne suit pas l'emprise tout seul** — le rafraîchissement au déplacement de carte est
  **opt-in**.
- **Il ne détecte pas le format** : c'est le plugin `connector` qui décide qu'une URL est du
  FlatGeobuf.
- **Il ne lit aucun bloc `modules.flatgeobuf`.** Sa configuration déclarative vit dans la
  **définition de couche**, pas dans un bloc de plugin — voir §Configuration.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                               |
| ------------ | ------------------------------------ |
| `name`       | `flatgeobuf`                         |
| `label`      | `FlatGeobuf (spatial binary vector)` |
| `requires`   | `[]`                                 |
| `optional`   | `[]`                                 |
| `namespace`  | `GeoLeaf.FlatGeobuf`                 |
| `paquet npm` | `@geoleaf-plugins/flatgeobuf`        |

⚠️ **Le nom `GeoLeaf.FGB` n'existe pas, et deux commentaires l'annonçaient.** Mesuré : les deux
seules occurrences du dépôt étaient les en-têtes de `public-api.ts` et de `fgb-api.ts` — **deux
commentaires qui se pointaient l'un l'autre**, aucun montage réel. `entry.ts` monte `FlatGeobuf`,
`global.d.ts` déclare `FlatGeobuf`. Les deux en-têtes sont **corrigés** le 27/07/2026, avec la
mesure sur place. Un intégrateur qui suivait l'un des deux cherchait une API non montée.

### La forme de `entry.ts` — quatre étapes, dont une hors squelette

| Étape                                          | `flatgeobuf` ?                                    |
| ---------------------------------------------- | ------------------------------------------------- |
| 1 — dictionnaires i18n                         | ❌ aucune interface, donc aucun libellé           |
| 2 — montage du namespace                       | ✅ `GeoLeaf.FlatGeobuf = buildPublicApi()`        |
| 3 — auto-enregistrement                        | ✅ avec `healthCheck` sur le namespace            |
| **4 — enregistrement d'un chargeur de couche** | ✅ `plugins.registerLayerLoader("flatgeobuf", …)` |

La quatrième étape **n'est pas dans le squelette figé** du contrat (§4), qui n'en décrit que trois.
Elle est ce qui rend le plugin utilisable sans code : le chargeur de profil du core interroge
`GeoLeaf.plugins.getLayerLoader` pour toute couche portant `"plugin": "<id>"`.

⚠️ **Conséquence pour l'écriture des fiches suivantes** : le squelette d'`entry.ts` est un
**minimum**, pas un gabarit. `cog` en exerce deux étapes, `flatgeobuf` quatre, `geocoding` six.

---

## Fonctionnalités

| ID    | Fonctionnalité                    | Entrée                                            | Sortie observable                                                                                                | Code                                                    |
| ----- | --------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| FG-01 | Lecture complète                  | `load(url, opts?)`                                | Une collection d'entités GeoJSON, plus les métadonnées d'en-tête si le format les porte                          | `fgb-api.ts` → `load`                                   |
| FG-02 | Lecture filtrée par emprise       | `loadBbox(url, bbox, opts?)`                      | Seules les entités de l'emprise, obtenues par **index R-tree + requêtes partielles**                             | `fgb-bbox-filter.ts`                                    |
| FG-03 | Rendu direct sur la carte         | `loadAsLayer(url, opts?)`                         | Source et sous-couches créées par l'adaptateur du core ; rend l'identifiant de couche                            | `fgb-api.ts` → `loadAsLayer`                            |
| FG-04 | Rendu filtré sur la carte         | `loadBboxAsLayer(url, bbox, opts?)`               | Idem, sur l'emprise seule                                                                                        | `fgb-api.ts` → `loadBboxAsLayer`                        |
| FG-05 | **Chargement déclaratif**         | Couche de profil portant `"plugin": "flatgeobuf"` | Rendue **sans code d'intégration**, par le chargeur enregistré                                                   | `entry.ts` ; `config-loader.ts` → `loadLayerFromConfig` |
| FG-06 | Rafraîchissement au déplacement   | `autoRefresh: true`                               | Les entités sont re-cherchées sur la nouvelle emprise à chaque fin de déplacement, **et remplacées en place**    | `fgb-api.ts` ; `fgb-bbox-filter.ts`                     |
| FG-07 | Anti-rebond du rafraîchissement   | Déplacements rapprochés                           | Une seule requête après le délai d'anti-rebond, réglable                                                         | `fgb-bbox-filter.ts`                                    |
| FG-08 | Plafond d'entités                 | Fichier plus gros que la limite                   | L'accumulation **s'arrête** au plafond — garde anti-déni de service                                              | `internal.ts` → `collectFeatures`                       |
| FG-09 | Validation d'URL déléguée au core | Toute URL                                         | Passe par la validation du core quand elle est disponible ; **repli** sur une liste blanche de protocoles locale | `internal.ts` → validation                              |
| FG-10 | Abandon avant démarrage           | Signal déjà abandonné                             | Échec immédiat, **aucune requête émise**                                                                         | `internal.ts` → `validateLoadPreconditions`             |
| FG-11 | Abandon en cours                  | Signal abandonné pendant l'itération              | L'accumulation s'interrompt                                                                                      | `internal.ts` → `collectFeatures`                       |
| FG-12 | Validation de l'emprise           | Emprise portant `NaN` ou l'infini                 | Refusée avant toute requête                                                                                      | `fgb-bbox-filter.ts` → validation d'emprise             |
| FG-13 | Identifiant de couche             | `layerId` absent                                  | Identifiant auto-incrémenté                                                                                      | `fgb-api.ts`                                            |
| FG-14 | Carte absente                     | Appel avant l'initialisation de la carte          | Erreur explicite plutôt qu'un échec silencieux                                                                   | `fgb-api.ts` → résolution de l'adaptateur               |

Les tests qui couvrent ces lignes : `packages/plugins/flatgeobuf/src/__tests__/` (PC-09).

---

## Configuration

**Aucun bloc `modules.flatgeobuf`.** Comme [`cog`](CDC_cog.md), ce plugin n'a pas de configuration
de plugin — mais pour une raison différente, et c'est la nuance à retenir : **il a bien une
configuration déclarative, elle vit dans la définition de couche.**

### La configuration déclarative de couche

`config-loader.ts` → `FgbLayerJsonConfig` décrit la forme qu'une couche de profil peut porter :

| Clé                | Rôle                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `id`               | Identifiant, réutilisé comme identifiant de source et de couche              |
| `label`            | Nom lisible                                                                  |
| `plugin`           | **Doit valoir `"flatgeobuf"`** — c'est ce qui route la couche vers ce plugin |
| `data.url`         | URL du fichier `.fgb`, absolue ou relative à la racine du profil déployé     |
| `data.bbox`        | Emprise de filtrage `[O, S, E, N]` ; si présente, l'index R-tree est utilisé |
| `data.limit`       | Plafond d'entités                                                            |
| `data.autoRefresh` | Re-chercher au déplacement de carte                                          |
| `data.debounceMs`  | Délai d'anti-rebond du rafraîchissement                                      |
| `defaultVisible`   | Visibilité initiale                                                          |
| `cluster`          | Regroupement des points                                                      |

⚠️ **Cette forme n'est décrite que dans le TSDoc du plugin**, avec un exemple. Elle n'est ni dans
`profiles/schemas/`, ni dans l'inventaire des paramètres — ce qui est **conforme au contrat**
(§5 : le core ne déclare, ne valide et ne défaute pas la configuration d'un plugin), mais signifie
aussi qu'**aucune gate ne la vérifie**. Une clé mal orthographiée dans un profil est ignorée en
silence.

Les valeurs par défaut vivent dans le code du plugin (plafond d'entités, délai d'anti-rebond), pas
dans un schéma.

---

## Contrat exposé

### API publique — `GeoLeaf.FlatGeobuf`

Montée par `entry.ts`. `public-api.ts` est une **pure ré-exportation** de `fgb-api.ts`
(INV-FACADE — elle a été vidée pour cela : elle portait l'état de rafraîchissement et la
construction de couche).

| Membre                              | Rend / fait                                              |
| ----------------------------------- | -------------------------------------------------------- |
| `load(url, opts?)`                  | Les entités, sans toucher à la carte                     |
| `loadBbox(url, bbox, opts?)`        | Idem, filtré par emprise                                 |
| `loadAsLayer(url, opts?)`           | Charge **et** rend ; rend l'identifiant de couche        |
| `loadBboxAsLayer(url, bbox, opts?)` | Idem, filtré par emprise, avec rafraîchissement possible |
| `loadLayerFromConfig(def)`          | Le chemin déclaratif, exposé aussi impérativement        |

Les types sont **ré-exportés depuis `entry.ts`** — `FgbBbox`, `FgbLoadOptions`, `FgbBboxOptions`,
`FgbLayerOptions`, `FgbLoadResult`, `FgbLayerJsonConfig`.

⚠️ **Le namespace est déclaré mais non typé.** `global.d.ts` porte `FlatGeobuf?: unknown` — comme
les six autres namespaces de plugins déclarés au passage de B-13. Conséquence exacte : une **faute
de frappe sur le nom du namespace** ne compile plus (c'est le gain de B-13), mais **l'arité et la
forme des appels ne sont pas vérifiées**. Gisement suivi par
`scripts/check-namespace-typing-coverage.cjs` et le backlog **B-13**.

### Le seam de rendu, et ce qu'il n'atteint pas

Le rendu passe par `addGeoJSONLayer` de l'adaptateur du core — **le chemin MapLibre vivant** — et
non par une API de données du core qui serait inopérante dans ce mode. Le rafraîchissement passe par
un remplacement de données en place.

⚠️ **La couche est dessinée mais pas inscrite au panneau du gestionnaire de couches**, parce que
cette inscription est interne au core. L'utilisateur voit le tracé et **ne peut pas le désactiver
depuis l'interface**. C'est écrit dans le code, et c'est la limite à connaître avant de proposer ce
plugin.

### Événements et i18n

**Aucun** événement émis, **aucun** dictionnaire i18n. Le plugin **écoute** en revanche la fin de
déplacement de carte, mais seulement quand le rafraîchissement automatique est demandé.

---

## Décisions de conception

| Décision                                                          | Pourquoi                                                                                                                                                                   | Alternative écartée                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Un chargeur de couche enregistré, en plus de l'API impérative** | C'est ce qui rend le plugin utilisable **par configuration seule**, dans l'esprit d'un dépôt piloté par des profils JSON. Sans lui, chaque intégration demanderait du code | N'exposer que l'API impérative — comme `cog`                            |
| **Filtrage par emprise via l'index du format**                    | FlatGeobuf porte son propre index spatial : l'exploiter avec des requêtes partielles évite de télécharger un fichier entier pour en afficher un coin                       | Tout charger puis filtrer côté client                                   |
| **Plafond d'entités par défaut**                                  | Un fichier vecteur peut porter des millions d'entités : sans plafond, un profil mal réglé fige l'onglet. Le plafond est une garde, pas une limite de conception            | Aucun plafond                                                           |
| **Rafraîchissement opt-in, avec anti-rebond**                     | Re-chercher à chaque déplacement est coûteux, et souvent inutile pour une couche de référence. Quand c'est demandé, l'anti-rebond évite une rafale de requêtes             | Rafraîchir toujours, ou jamais                                          |
| **Remplacement des données en place**                             | Retirer puis recréer la couche à chaque rafraîchissement provoquerait un clignotement et perdrait l'ordre des couches                                                      | Recréer la couche                                                       |
| **Validation d'URL déléguée au core, avec repli local**           | Le core porte la politique de sécurité des URL ; la dupliquer la ferait dériver. Le repli couvre le cas où le plugin est chargé sans elle                                  | Une liste blanche locale seule                                          |
| **Abandon vérifié avant ET pendant**                              | Un signal déjà abandonné doit éviter la requête entière ; un abandon en cours doit interrompre l'accumulation. Les deux points sont distincts                              | Ne vérifier qu'au départ                                                |
| **Rendu par l'adaptateur, pas par une API de données du core**    | C'est le chemin réellement vivant en mode MapLibre ; l'autre serait un non-événement silencieux — le pire des deux échecs                                                  | Passer par l'API de données                                             |
| **La façade a été vidée de sa logique**                           | `public-api.ts` portait l'état de rafraîchissement et la construction de couche, ce que le contrat interdit (INV-FACADE)                                                   | Laisser l'implémentation dans la façade                                 |
| **Aucun bloc `modules.flatgeobuf`**                               | La configuration utile est **par couche**, pas globale : deux couches du même profil peuvent avoir des emprises et des plafonds différents                                 | Un bloc de plugin — il ne saurait pas dire _quelle_ couche il configure |

---

## Dépendances et frontières

### Conformité au contrat gelé

Vérifié par `scripts/verify-plugin-contract.cjs`, bloquant dans `ci:local` et
`.husky/pre-commit`. Comme [`cog`](CDC_cog.md), le plugin n'a **ni CSS ni écriture de HTML** :
PC-07 et PC-13 ne le concernent pas.

### Dépendances

| Dépendance                         | Nature                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `@geoleaf/core`                    | Dépendance d'espace de travail ; chargé **après** le core, **avant** `boot()`              |
| Bibliothèque de lecture FlatGeobuf | Importée par son **chemin ESM explicite** — c'est ce qui garde le plugin ESM pur (INV-ESM) |
| `@geoleaf/host-runtime`            | En **type seulement** (`GeoLeafHost`), comme `cog` — pas via sa fonction d'accès           |

**Aucune dépendance sur MapLibre** : le plugin passe par l'adaptateur du core, dont il ne consomme
qu'une vue **structurelle** locale. PC-10 ne s'applique pas.

### Frontières

- **Aucune lecture de configuration du core** : ce qu'il lit vient de la définition de couche qu'on
  lui passe.
- **Un couplage de fait, non déclaré** : `connector` reconnaît l'extension `.fgb` et route vers ce
  plugin. La détection est chez `connector`, le rendu ici, et **ni `requires` ni `optional` ne le
  disent** — les deux sont vides, ce qui est exact au sens du registre (aucun appel croisé) mais
  masque la relation fonctionnelle.
- **Aucune CSS**, aucune écriture de HTML.

---

## Écarts au CDC source

Le CDC `CDC_plugin-flatgeobuf.md` a été **consommé** en écrivant cette fiche, puis retiré du dossier
de tri — trace au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                              | Ce que dit le dépôt                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Le namespace nommé **`GeoLeaf.FGB`** dans la documentation | **Le nom n'existe nulle part** : deux en-têtes de code le portaient, corrigés dans la passe. Le montage est `FlatGeobuf` |
| Chiffres de volume et de gain recopiés en prose            | Non repris, par la règle 1                                                                                               |
| ✅ L'index R-tree et les requêtes partielles               | **Exacts**, et c'est le cœur du plugin                                                                                   |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le positionnement du format
(vecteur binaire indexé, lisible par morceaux — l'équivalent vecteur de ce que le COG est au
raster), les cas d'usage, et les alternatives écartées de la table §Décisions.

⚠️ **Retenu aussi, parce que le code ne le dit pas assez fort** : la couche rendue n'apparaît pas
dans le gestionnaire de couches. C'est la question à trancher avant de généraliser ce plugin, et
elle appartient au core, pas à lui.
