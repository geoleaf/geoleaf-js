---
type: spec-capacite
title: cluster — la politique de regroupement des points
capability_id: cluster
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# cluster — la politique de regroupement des points

**Type :** capacité in-core (**de politique**) · **Code :** `packages/core/src/capabilities/cluster/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Capacité de politique, comme [`vector-tiles`](vector-tiles.md)** : elle n'a **ni `module.ts`
> ni `lifecycle.ts`** — rien à monter, rien à démonter, aucun écouteur. Elle **répond** à des
> questions que le chargeur GeoJSON lui pose. Mais contrairement à `vector-tiles`, elle a un
> `configSchema`, un `config.ts`, une API publique **et** une façade : sa forme est un troisième
> patron, pas une copie.

---

## Périmètre

### Ce que la capacité fait

Elle **décide** si une couche de points doit être regroupée, et avec quels paramètres. Elle est
purement décisionnelle : deux résolveurs sans effet de bord, interrogés à la demande.

- `getClusteringStrategy(def, data)` → `{ shouldCluster, useSharedCluster }` : cette couche
  doit-elle être regroupée, et rejoint-elle le **cluster POI partagé** ou obtient-elle le sien ?
- `applyGeoJSONClusterOptions(options, def, layerId, Log)` : renseigne rayon et zoom de coupure
  dans le sac d'options de l'adaptateur.

Le regroupement lui-même est **natif MapLibre** (`cluster: true`) : aucune dépendance externe de
type supercluster.

### Ce qu'elle ne fait pas

- **Elle ne crée aucune source et n'installe aucune couche.** Les primitives natives — création de
  la source regroupée, câblage du clic pour éclater un amas — vivent dans l'adaptateur MapLibre.
  Cette capacité ne possède que la **politique** et les **défauts**.
- **Elle ne pilote pas le cluster POI partagé.** Son rayon est fixé **côté adaptateur**
  (`adapters/maplibre/maplibre-cluster.ts`), délibérément : l'adaptateur MapLibre ne doit pas
  importer `capabilities/`. Voir §Décisions — c'est la source de la confusion la plus probable sur
  `clusterRadius`.
- **Elle n'a pas de cycle de vie.** Aucun `ICoreModule`, aucun écouteur ; le gate est appliqué par
  le lecteur de configuration, pas au boot.
- **Elle ne regroupe pas ce qui n'a pas de points.** Une couche sans géométrie `Point` n'est jamais
  regroupée, quelle que soit la configuration.

---

## Fonctionnalités

| ID    | Fonctionnalité                            | Entrée                                                                           | Sortie observable                                                                                                    | Code                                         |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| CL-01 | Gate de capacité                          | `modules.cluster.enabled: false`                                                 | `{ shouldCluster: false, useSharedCluster: false }` — sortie immédiate, plus aucune décision                         | `strategy.ts` → `getClusteringStrategy`      |
| CL-02 | Refus explicite par couche                | `def.clustering.enabled === false`                                               | Aucun regroupement, même si le défaut global l'active                                                                | `strategy.ts` → `_resolveClusteringConfig`   |
| CL-03 | Double gate global / par couche           | `clustering: false` et aucun opt-in de couche                                    | Aucun regroupement. Un `def.clustering.enabled: true` suffit à passer outre                                          | `strategy.ts` → `getClusteringStrategy`      |
| CL-04 | Sonde de géométrie                        | Données sans aucune géométrie `Point`                                            | Aucun regroupement — y compris quand `features` est absent                                                           | `strategy.ts` → `getClusteringStrategy`      |
| CL-05 | Détection d'un réglage propre à la couche | `maxClusterRadius` ou `disableClusteringAtZoom` **différent** du défaut effectif | La couche obtient **son propre** cluster (`useSharedCluster: false`)                                                 | `strategy.ts` → `_resolveCustomClusterCheck` |
| CL-06 | Stratégie `unified`                       | `clusterStrategy: "unified"` (le défaut)                                         | Regroupement **et** partage du cluster POI                                                                           | `strategy.ts` → `_resolveStrategyResult`     |
| CL-07 | Stratégie `by-layer`                      | `clusterStrategy: "by-layer"`                                                    | Un cluster par couche, jamais partagé                                                                                | `strategy.ts` → `_resolveStrategyResult`     |
| CL-08 | Stratégie `by-source`                     | `clusterStrategy: "by-source"`                                                   | Regroupé sauf si `clusterStrategies["by-source"].sources.geojson === false`                                          | `strategy.ts` → `_resolveStrategyResult`     |
| CL-09 | Stratégie `json-only`                     | `clusterStrategy: "json-only"`                                                   | Regroupé **seulement** si `clusterStrategies["json-only"].geojsonClustering === true`                                | `strategy.ts` → `_resolveStrategyResult`     |
| CL-10 | Stratégie inconnue                        | `clusterStrategy: "n-importe-quoi"`                                              | Avertissement journalisé **puis repli sur `unified`** — jamais d'échec                                               | `strategy.ts` → `_resolveStrategyResult`     |
| CL-11 | Résolution du rayon                       | Couche chargée avec regroupement                                                 | `clusterRadius` = def de couche → `modules.cluster` → constante partagée, dans cet ordre                             | `options.ts` → `applyGeoJSONClusterOptions`  |
| CL-12 | Résolution du zoom de coupure             | idem                                                                             | `clusterMaxZoom` résolu selon la même précédence, **puis borné à `sourceMaxZoom - 1`**                               | `options.ts` → `applyGeoJSONClusterOptions`  |
| CL-13 | Journalisation des valeurs appliquées     | Couche regroupée                                                                 | Un `Log.info` nommant la couche, le rayon et le zoom de coupure **effectivement retenus**                            | `options.ts`                                 |
| CL-14 | Deux surfaces montées                     | `registerGlobals(gl)`                                                            | `GeoLeaf.Cluster` (publique, deux lectures) **et** `GeoLeaf._Cluster` (privée, les deux résolveurs)                  | `install.ts`                                 |
| CL-15 | Déclaration introspectable                | —                                                                                | `getAllCapabilities()` la liste, `getCapabilitySchema("cluster")` rend son schéma, `clusterStrategy` avec son `enum` | `cluster-capability.ts`                      |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/cluster/` — déclaration,
stratégie, options.

---

## Configuration

Bloc `modules.cluster` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre                 | Type      | Défaut      | Où c'est lu                                                                                                 |
| ------------------------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `enabled`                 | `boolean` | `true`      | `constants.ts` → `clusterConfigDefaults()` ; gate **opt-out**, appliqué par `strategy.ts`                   |
| `clustering`              | `boolean` | `false`     | `strategy.ts` → `getClusteringStrategy` — le défaut **global** pour les couches de points GeoJSON           |
| `clusterRadius`           | `number`  | `80`        | `options.ts` → `applyGeoJSONClusterOptions`, **et** `strategy.ts` comme référence de comparaison            |
| `disableClusteringAtZoom` | `number`  | `14`        | idem, puis **borné** à `sourceMaxZoom - 1`                                                                  |
| `clusterStrategy`         | `string`  | `"unified"` | `strategy.ts` → `_resolveStrategyResult` ; `enum` déclaré : `unified`, `by-layer`, `by-source`, `json-only` |
| `clusterStrategies`       | `object`  | `{}`        | `strategy.ts` — **deux entrées seulement sont lues**, voir ci-dessous                                       |

### Deux gates superposés, et ils ne disent pas la même chose

C'est le point le plus facile à documenter de travers sur cette capacité :

| Clé          | Rôle                                                                 | Défaut               |
| ------------ | -------------------------------------------------------------------- | -------------------- |
| `enabled`    | La capacité **répond-elle** ? `false` → plus aucune décision         | `true` (**opt-out**) |
| `clustering` | Les couches de points GeoJSON sont-elles regroupées **par défaut** ? | `false`              |

Une capacité **active** dont le défaut global est **désactivé** n'est pas une contradiction : le
gate `enabled` est opt-out pour préserver le comportement d'avant la migration (le regroupement
POI était actif par défaut), tandis que `clustering: false` signifie qu'une **couche GeoJSON**
n'est pas regroupée sans qu'elle le demande. Un `def.clustering.enabled: true` passe outre.

⚠️ `clustering: false` n'est pas un choix de style : `getClusteringStrategy` teste
`!config.clustering`, pour quoi une clé absente et `false` sont **la même chose**. Le TSDoc du type
a annoncé `true` par erreur — c'est écrit sur place, avec la correction.

### `clusterStrategies` — deux entrées lues, le reste ignoré

Le schéma annonce un objet libre, mais **deux chemins seulement** sont lus :

| Chemin                            | Effet                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `["by-source"].sources.geojson`   | `false` ⇒ les couches GeoJSON ne sont pas regroupées sous `by-source`. **Toute autre valeur** ⇒ elles le sont |
| `["json-only"].geojsonClustering` | Doit valoir **exactement `true`** pour que `json-only` regroupe                                               |

Ignoré sous `unified` et `by-layer`. Les deux sites de lecture retombent sur un objet vide, donc
**absent ≡ `{}`**.

### Les trois copies des défauts, et le fichier qui les a réunies

`constants.ts` répare une divergence **mesurée**, et celle-ci était plus grave que celle de
[`branding`](branding.md) parce que les valeurs ne concordaient pas :

| Endroit                                      | Rayon annoncé / appliqué                   |
| -------------------------------------------- | ------------------------------------------ |
| Schéma d'introspection (valeur **annoncée**) | 50, et **aucun** défaut de zoom de coupure |
| `options.ts` (valeur **appliquée**)          | 80 / 14                                    |
| `strategy.ts` (référence de **comparaison**) | 80 / 18                                    |

Deux conséquences réelles : un auteur de profil lisant `getCapabilitySchema("cluster")` **ne
pouvait pas prédire** le rayon obtenu ; et une couche réglée explicitement sur le zoom de coupure
réellement appliqué (14) était classée « réglage propre » à tort, donc sortie du cluster partagé.

Depuis, le schéma (annoncé), le lecteur (appliqué) et la comparaison de surcharge importent la
**même fabrique**, `clusterConfigDefaults()` — égalité par construction, la divergence ne peut plus
se réouvrir. B.24 a élargi le principe des deux nombres à **tout** le jeu de défauts : le schéma
annonçait cinq défauts que le lecteur ne matérialisait pas, chaque consommateur réappliquant son
propre repli.

C'est une **fabrique**, pas une constante partagée, précisément parce que `clusterStrategies` est un
objet **mutable** : la carte remise à un appelant ne doit jamais être celle dont part le suivant.

⚠️ **Les replis `?? …` des consommateurs subsistent, et ce n'est pas de la redondance** : ils
protègent les appelants qui construisent une configuration **à la main** — tests, fusions par
couche — sans passer par le lecteur.

---

## Contrat exposé

### Deux surfaces, une publique et une privée

`install.ts` monte **deux** choses, et la distinction est le cœur du dispositif :

| Surface            | Contenu                                                      | Pour qui                                                                         |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GeoLeaf.Cluster`  | `isEnabled()`, `getConfig()` — deux lectures, aucune logique | Intégrateurs et le futur studio no-code. Façade ESM `src/api/geoleaf.cluster.ts` |
| `GeoLeaf._Cluster` | `{ getClusteringStrategy, applyGeoJSONClusterOptions }`      | **Le chargeur GeoJSON**, par localisateur de service. Aucune façade, préfixe `_` |

| Membre de `GeoLeaf.Cluster` | Rend                                               |
| --------------------------- | -------------------------------------------------- |
| `isEnabled()`               | `true` quand `modules.cluster.enabled !== false`   |
| `getConfig()`               | Le bloc `modules.cluster` fusionné sur les défauts |

⚠️ **`isEnabled()` teste `!== false`, pas `=== true`** — c'est la traduction fidèle du gate
opt-out : absent signifie actif. Les autres capacités de ce palier testent `=== true`, parce
qu'elles sont opt-in. Ne pas aligner les deux formes « par cohérence » : elles décrivent des gates
opposés.

Typage publié : `src/global.d.ts`, section des capacités (`Cluster?:` et `_Cluster?:`).
`_Cluster` figure aussi dans `kernel/api/module-catalog.ts`, que l'introspection énumère. Ne pas
citer de numéro de ligne pour `global.d.ts`.

### Le consommateur, et son repli

`kernel/geojson/loader/single-layer.ts` lit `_Cluster` par le localisateur de service
`_deps.getCluster()`, câblé dans `globals/globals.geojson.ts`. En l'absence de la capacité, le
chargeur retombe sur `{ shouldCluster: false }` — **exactement le même résultat** qu'une capacité
présente mais désactivée. C'est ce qui rend le retrait indolore.

### Événements

**Aucun** émis, **aucun** écouté. La capacité est une fonction de la configuration et de la
définition de couche ; elle n'a pas d'état à annoncer.

---

## Décisions de conception

| Décision                                                            | Pourquoi                                                                                                                                                                                                                           | Alternative écartée                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Capacité de politique**, sans `ICoreModule`                       | Deux résolveurs purs interrogés à la demande : rien à initialiser, rien à détruire, aucun écouteur. Le gate est appliqué par le lecteur de configuration, pas au boot                                                              | Un module de cycle de vie — un nœud de plus dans le tri topologique pour du code sans état de montage                    |
| **Gate opt-out** (`enableWhenAbsent: true`)                         | Le regroupement des points était actif par défaut avant la migration : le rendre opt-in aurait changé le rendu de tous les profils existants sans qu'ils touchent à rien                                                           | L'opt-in, comme les autres capacités de ce palier                                                                        |
| **Deux surfaces séparées** (`Cluster` publique / `_Cluster` privée) | Le chargeur a besoin des résolveurs, l'intégrateur a besoin de lire l'état. Les mélanger publierait deux fonctions internes dans le contrat d'API                                                                                  | Une seule surface — soit on publie l'interne, soit le chargeur importe statiquement la capacité et la rend non retirable |
| **Lecture paresseuse par localisateur de service**                  | Un import statique depuis `kernel/geojson/loader/` épinglerait la capacité dans la clôture eager de tous les bundles. Relire le seam à l'appel rend l'ordre d'écriture indifférent                                                 | L'import statique — c'est l'état d'avant le S7                                                                           |
| **Le rayon du cluster POI reste côté adaptateur**                   | L'adaptateur MapLibre **ne doit pas importer `capabilities/`** : la frontière moteur est à sens unique. Le défaut POI vit donc dans `adapters/maplibre/maplibre-cluster.ts`, et cette capacité ne possède que la politique GeoJSON | Le centraliser ici — inverserait la frontière moteur                                                                     |
| **Une fabrique de défauts partagée** (`constants.ts`)               | Trois copies avaient **divergé en valeur**, pas seulement en emplacement : annoncé 50, appliqué 80, comparé 80/18. Un auteur de profil ne pouvait pas prédire ce qu'il obtiendrait                                                 | Trois littéraux et un test qui les compare — le test aurait signalé la divergence, pas empêché sa réouverture            |
| **Fabrique plutôt que constante partagée**                          | `clusterStrategies` est un objet mutable : une constante partagée laisserait un appelant modifier les défauts du suivant                                                                                                           | Un objet gelé exporté                                                                                                    |
| **Les replis `?? …` des consommateurs subsistent**                  | Ils couvrent les appelants qui fabriquent une configuration à la main (tests, fusions par couche) sans passer par le lecteur — défense en profondeur, pas duplication                                                              | Les retirer maintenant que le lecteur matérialise tout                                                                   |
| **Une stratégie inconnue avertit puis retombe sur `unified`**       | Une faute de frappe dans un profil ne doit pas faire disparaître le regroupement en silence, ni casser le chargement d'une couche                                                                                                  | Lever, ou ignorer sans rien dire                                                                                         |
| **Le zoom de coupure est borné à `sourceMaxZoom - 1`**              | Sans cela, un amas pourrait ne jamais pouvoir être éclaté : il faut qu'il reste un niveau de zoom vers lequel voler                                                                                                                | Honorer la valeur telle quelle                                                                                           |
| **Regroupement natif MapLibre**                                     | `cluster: true` est fourni par le moteur ; une bibliothèque tierce ajouterait du poids pour un service déjà rendu                                                                                                                  | Une dépendance de type supercluster                                                                                      |
| Pas de `loader`                                                     | Inline : la capacité est universelle et mince, c'est la configuration qui décide                                                                                                                                                   | Un `import()` paresseux                                                                                                  |

---

## Dépendances et frontières

### Aucune dépendance de cycle de vie

Pas de `module.ts`, donc aucune arête dans le tri topologique. Le manifeste
`presets/manifest.full.ts` la place dans le lot des capacités d'API simples, dans un ordre qui
**reproduit celui de l'ancien bloc de déclaration au boot** (taxonomy → feature-info → cluster) pour
que l'ordre d'insertion vu par l'introspection reste identique à l'octet. `registerPresetModules`
saute les installeurs sans fabrique — le même non-événement que l'ancien bloc.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                              | Statut vis-à-vis de R.8                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `kernel/config/config-primitives.js`                | **Exception** nommée par la règle                |
| `kernel/geojson/loader/loader-types.js` (type seul) | **Hub de types** — exception nommée par la règle |

Le reste passe par `utils/general/di-accessors` (`getLog`). **Aucun import de
`adapters/maplibre/`** — une règle ESLint l'interdit à tout `capabilities/**`, et c'est
exactement ce qui explique où vit le défaut du cluster POI.

### Frontière moteur, dans les deux sens

C'est la capacité où la frontière est la plus visible :

- **Elle ne construit rien** : les primitives natives restent dans l'adaptateur.
- **L'adaptateur ne la lit pas** : il porte ses propres défauts POI plutôt que d'importer
  `capabilities/`.

Les deux moitiés de cette frontière expliquent pourquoi `clusterRadius` de `modules.cluster` ne
gouverne **que** les couches GeoJSON, et jamais le cluster POI partagé.

### Aucune feuille de style

La capacité est décisionnelle : elle n'a pas de DOM, donc pas de CSS. Le rendu des amas appartient
à l'adaptateur et aux styles de couches.

**Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`.
