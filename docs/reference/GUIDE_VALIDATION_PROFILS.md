# Guide — Validation des profils GeoLeaf

> Version : 2.2.0 · Mise à jour : 2026-09-28  
> Audience : intégrateurs et développeurs de profils
>
> **28/09/2026 — un niveau « données ».** Les trois niveaux ci-dessous jugent la FORME d'un profil,
> jamais sa donnée : un champ qu'il nomme et que la donnée ne porte pas passait sans un mot. Il est
> désormais dit au chargement de chaque couche, et refusé en gate sur les profils du dépôt (§9).
>
> **28/09/2026 — les schémas partent avec le paquet.** Un intégrateur valide désormais son profil
> hors de ce dépôt, contre les schémas que `@geoleaf/core` livre (§6.2) ; ce guide n'enseignait que
> la commande du monorepo.
>
> ⚠️ **Relu contre le code le 27/07/2026 — refonte majeure.** Plusieurs exemples enseignaient des
> erreurs qui ne se produisent plus : `clusteringConfig`, `performance` et `poiAddConfig` ont été
> **purgés** de `profile.schema.json`, et `geocodingConfig` n'est plus contrôlé au boot (le géocodage
> est passé au plugin `@geoleaf-plugins/geocoding`). Le schéma étant en `additionalProperties: false`,
> un profil portant l'une de ces clés est aujourd'hui rejeté **avec un autre message** que celui
> documenté. Sources de vérité relues : `profiles/schemas/profile.schema.json` et
> `packages/core/src/kernel/config/profile.ts:22`.

---

## 1. Vue d'ensemble

GeoLeaf valide les profils à deux niveaux complémentaires, et un intégrateur rejoue le second chez
lui, avec les schémas que le paquet livre. Un quatrième niveau confronte le profil à sa donnée :

| Niveau          | Quand                                          | Outil                                                                   | Champs contrôlés                                                                |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Boot léger**  | Au chargement de l'application                 | `kernel/config/profile.ts:22`                                           | Structure, types critiques : `id`, `version`, `map`, `map.zoom/minZoom/maxZoom` |
| **AJV complet** | **Gate bloquante**                             | `npm run validate:profiles`                                             | Tous les champs du schéma `profiles/schemas/profile.schema.json`                |
| **Intégrateur** | Dans son propre dépôt, sa CI                   | ajv + `@geoleaf/core/schemas`                                           | Les mêmes schémas, livrés par le paquet, octet pour octet (§6.2)                |
| **Données**     | Au chargement de chaque couche ; gate du dépôt | `Log.warn` du cœur ; garde `profile-field-reconciliation.guard.test.ts` | Chaque champ que le profil nomme existe dans la donnée de la couche (§9)        |

Le validateur boot est embarqué dans `@geoleaf/core` (`_validateProfileStructure`,
`packages/core/src/kernel/config/profile.ts:22`). AJV reste **hors bundle** — outillage seulement.

⚠️ **AJV n'est plus « opt-in ».** `validate-profiles.cjs` est une gate **bloquante**, câblée dans
`ci:local` et dans le hook `pre-commit` (il sort 1 à la moindre violation) — les deux se retrouvent
par `grep -n "validate:profiles" scripts/ci-local.cjs .husky/pre-commit`.
Aucun commit ne passe sur un profil invalide. Ne pas recopier ici le nombre de profils validés —
`npm run validate:profiles` l'imprime.

---

## 2. Profil minimal valide

Le seul champ obligatoire est `id`.

```json
{
    "id": "mon-profil"
}
```

---

## 3. Profil complet — exemple de référence (layout v2)

Depuis le layout profil v2 (2026-06), `profile.json` ne contient que l'identité, `map` et le manifeste `Files`. Les features core vivent dans `config/core/features.json`, la config de chaque plugin dans `config/plugins/<module-id>.json`.

**`profile.json` :**

<!-- geoleaf:docs:schema profile -->

```json
{
    "id": "tourism",
    "label": "Tourisme",
    "description": "Carte touristique avec POI et itinéraires",
    "version": "1.0.0",

    "map": {
        "center": [-65.0, -35.0],
        "zoom": 5,
        "minZoom": 3,
        "maxZoom": 18,
        "bounds": [
            [-75, -57],
            [-52, -20]
        ],
        "padding": [60, 20]
    },

    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "featuresFile": "config/core/features.json",
        "modules": {
            "offline": "config/plugins/offline.json",
            "taxonomy": "config/plugins/taxonomy.json"
        }
    }
}
```

> ⚠️ **`Files.taxonomyFile` n'existe plus** (retiré au Lot 2, 11/07/2026). Le bloc `Files` est en
> `additionalProperties: false` : le déclarer fait **échouer** `npm run validate:profiles`. La
> taxonomie se déclare comme un module — `Files.modules.taxonomy` → `config/plugins/taxonomy.json`.

**`config/core/features.json`** (fusionné à la racine du profil consolidé) :

```json
{
    "mapOptions": {
        "preserveDrawingBuffer": true
    }
}
```

⛔ **Cet exemple portait trois blocs qui feraient échouer la validation aujourd'hui**
(relu contre `profiles/schemas/features.schema.json` le 27/07/2026, qui n'accepte plus que
`$schema` et `mapOptions`, en `additionalProperties: false`) :

| Bloc de l'ancien exemple | Où il vit maintenant                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geocodingConfig`        | `modules.geocoding` → `config/plugins/geocoding.json` (plugin `@geoleaf-plugins/geocoding`)                                                                               |
| `clusteringConfig`       | `modules.cluster` → `config/plugins/cluster.json` (capacité in-core `cluster`) — la clé racine n'était **jamais lue au runtime**, purgée avec ses verrous ANO-027/ANO-031 |
| `performance`            | retiré du contrat de profil                                                                                                                                               |

C'est le défaut le plus coûteux de ce guide : un intégrateur qui recopiait « l'exemple de
référence » obtenait un profil **rejeté par la gate**.

**`config/plugins/offline.json`** (fusionné dans `modules.offline` — contenu opaque pour le core, INV-CONFIG). ⚠️ Ce bloc s'appelait `storage.json` → `modules.storage` ; renommé depuis, vérifié sur `profiles/tourism/profile.json` :

```json
{
    "enabled": true,
    "cache": { "enableProfileCache": true, "enableTileCache": true }
}
```

⚠️ **`enableServiceWorker` figurait dans cet exemple jusqu'au 03/08/2026 — la clé n'existe
plus.** Elle n'était posée par aucun profil et sa seule lecture était un avertissement qui ne
s'est jamais déclenché. Le Service Worker est enregistré **inconditionnellement** au démarrage
par la capacité `pwa` : il n'y a rien à activer. ⚠️ Et `enableOfflineDetector` ne vit pas ici
non plus — c'est `modules.pwa.offlineDetector.enabled`.

---

## 4. Exemples invalides — erreurs boot

### 4.1 `id` n'est pas une chaîne

```json
{
    "id": 42
}
```

**Erreur console au boot :**

```
[GeoLeaf] Profile "42" validation failed:
  ✗ "id" must be a string
```

---

### 4.2 `version` n'est pas une chaîne

```json
{
    "id": "mon-profil",
    "version": 100
}
```

**Erreur :**

```
[GeoLeaf] Profile "mon-profil" validation failed:
  ✗ "version" must be a string
```

---

### 4.3 `map.zoom` est une chaîne

```json
{
    "id": "mon-profil",
    "map": {
        "zoom": "12"
    }
}
```

**Erreur :**

```
[GeoLeaf] Profile "mon-profil" validation failed:
  ✗ "map.zoom" must be a number, got string
```

---

### 4.4 `map` est un tableau

```json
{
    "id": "mon-profil",
    "map": [48.8, 2.3]
}
```

**Erreur :**

```
[GeoLeaf] Profile "mon-profil" validation failed:
  ✗ "map" must be an object
```

---

### 4.5 ~~`geocodingConfig.enabled` n'est pas un booléen~~ — ce cas n'existe plus

⛔ **Cet exemple était faux au 27/07/2026 et est conservé annoté, pas supprimé** : il a été suivi.

Le validateur boot **ne contrôle plus `geocodingConfig`** — vérifié dans
`packages/core/src/kernel/config/profile.ts:22`, il ne lit que `id`, `version`, `map`, `map.zoom`,
`map.minZoom`, `map.maxZoom`. Le géocodage est sorti du core vers `@geoleaf-plugins/geocoding`.

Un profil portant ce bloc **ne produit plus l'erreur ci-dessous**. Il est rejeté **plus tôt et
autrement**, par AJV, parce que le schéma est fermé :

```json
{
    "id": "mon-profil",
    "geocodingConfig": {
        "enabled": "true"
    }
}
```

```
  ✗  mon-profil/profile.json
       : must NOT have additional properties (geocodingConfig)
```

La configuration du géocodage se déclare aujourd'hui sous `modules.geocoding`
(`config/plugins/geocoding.json`), et ses clés appartiennent au plugin (INV-CONFIG).

---

### 4.6 Profil n'est pas un objet (tableau JSON)

```json
["id", "version"]
```

**Erreur :**

```
[GeoLeaf] Profile "" must be a JSON object — got array
```

---

### 4.7 Erreurs multiples (toutes remontées en une seule fois)

```json
{
    "id": 99,
    "version": 2,
    "map": {
        "zoom": "far",
        "minZoom": "close"
    }
}
```

**Erreur :**

```
[GeoLeaf] Profile "99" validation failed:
  ✗ "id" must be a string
  ✗ "version" must be a string
  ✗ "map.zoom" must be a number, got string
  ✗ "map.minZoom" must be a number, got string
```

---

## 5. Exemples invalides — erreurs AJV (`npm run validate:profiles`)

Ces erreurs ne bloquent **pas** le boot (champs hors périmètre du validateur léger), mais sont détectées par le CLI.

### 5.1 `version` ne respecte pas le format SemVer

```json
{
    "id": "mon-profil",
    "version": "v1"
}
```

**Sortie `npm run validate:profiles` :**

```
  ✗  mon-profil/profile.json
       /version: must match pattern "^\d+\.\d+\.\d+$"

✗ Validation échouée — corriger les erreurs ci-dessus.
```

---

### 5.2 Clé inconnue à la racine (`additionalProperties: false`)

`profile.schema.json` est **fermé** : toute clé non déclarée est refusée. C'est le cas le plus
fréquent après une migration, parce que les clés retirées du contrat tombent ici.

```json
{
    "id": "mon-profil",
    "clusteringConfig": {
        "strategy": "auto"
    }
}
```

**Sortie :**

```
  ✗  mon-profil/profile.json
       : must NOT have additional properties (clusteringConfig)

✗ Validation échouée — corriger les erreurs ci-dessus.
```

⚠️ **Cet exemple documentait auparavant une erreur d'énumération sur `clusteringConfig.strategy`
(« valeurs acceptées : `by-layer` ou `unified` »).** La clé a été **purgée** : le clustering est une
capacité in-core configurée par `modules.cluster` (`config/plugins/cluster.json`), et
`features.schema.json` note que la clé racine n'était **jamais lue au runtime**. Le message d'erreur
réel n'est donc plus celui-là. Même chose pour `performance.*` et `poiAddConfig.*`.

**Clés racine acceptées** (mesurées sur le schéma) : `$schema`, `id`, `label`, `displayLabel`,
`icon`, `description`, `version`, `Files`, `map`, `modules`. Seul `id` est **requis**.

---

### 5.3 `map.padding` format mixte incorrect

```json
{
    "id": "mon-profil",
    "map": {
        "padding": { "top": 60, "invalid-key": 10 }
    }
}
```

**Sortie :**

```
  ✗  mon-profil/profile.json
       /map/padding: must match exactly one schema in oneOf

✗ Validation échouée — corriger les erreurs ci-dessus.
```

Formats acceptés :

- Array : `[vertical, horizontal]` ou `[top, right, bottom, left]` — entre 2 et 4 nombres
- Object : `{ "top": N, "right": N, "bottom": N, "left": N }` — clés exactes

---

### 5.4 Champ de type incorrect hors périmètre boot

Le validateur boot ne contrôle que `id`, `version` et `map.*`. Tout le reste n'est attrapé que
par AJV — d'où l'intérêt de la gate.

```json
{
    "id": "mon-profil",
    "map": {
        "center": "48.8, 2.3"
    }
}
```

**Sortie :**

```
  ✗  mon-profil/profile.json
       /map/center: must be array

✗ Validation échouée — corriger les erreurs ci-dessus.
```

⚠️ **Cet exemple utilisait `performance.maxConcurrentLayers`**, clé retirée du contrat : elle ne
produirait plus une erreur de type mais un `must NOT have additional properties`. Remplacée par
`map.center`, qui est réellement au schéma (`map` est fermé, ses 9 clés sont listées au §7).

---

## 6. Lancer la validation AJV

### 6.1 Dans ce dépôt

```bash
# Depuis la racine du monorepo
npm run validate:profiles
```

**Sortie si tout est valide** — forme réelle du script. ⚠️ La liste des profils et les décomptes
suivent le **disque** : ceux ci-dessous illustrent la forme, ils ne sont pas une cible. Ce bloc a
nommé cinq profils dont quatre étaient retirés depuis le 27/07/2026, et un cinquième l'a été au
Un exemple recopié vieillit sans que rien ne le dise.

```
GeoLeaf — validation des profils (profile.json + compagnons)

  ✓ _reference — 10 fichier(s)
  ✓ tourism — 69 fichier(s)

✓ 2 profils, 79 fichiers valides.
```

Exit code : `0` si valide, `1` si au moins une erreur — intégrable en CI (`npm run validate:profiles || exit 1`).

### 6.2 Hors du dépôt — avec le paquet npm

`@geoleaf/core` livre les dix schémas à `@geoleaf/core/schemas/<nom>.schema.json` (dans un paquet
installé : `node_modules/@geoleaf/core/dist/schemas/`), copiés octet pour octet de
`profiles/schemas/` au build, et des types TypeScript générés depuis eux à `@geoleaf/core/schemas`.
Aucun schéma ne décrit un profil entier : chaque fichier se valide seul, contre le schéma que sa
place désigne. La table fichier → schéma et la recette ajv vivent dans la page publique
[`packages/core/docs/schema/README.md`](../../packages/core/docs/schema/README.md) — c'est cette
recette que le test du paquet (`bundle-profile-contract.test.ts`) joue contre ce que le tarball
emporte.

⚠️ **Les options comptent** : `new Ajv({ allErrors: true, allowUnionTypes: true })`. Sans
`allowUnionTypes`, ajv émet quatre avertissements — deux schémas déclarent des unions de types.
**`strict: true` fonctionne aussi**, pourvu qu'`allowUnionTypes` reste : `validate-profiles.cjs`
compile les dix schémas ainsi, et sort en 1 sur un schéma qui cesserait de le tenir. C'est pourquoi
toute branche conditionnelle d'un schéma nomme, dans ses `properties`, les clés que son `required`
exige — sans quoi ajv refuse de compiler (`strictRequired`).

⚠️ **Les types sont un majorant des schémas**, pas un second validateur : tout fichier qu'un schéma
accepte se type, l'inverse n'est pas promis (règles conditionnelles, de présence, motifs et bornes ne
s'expriment pas). Le verdict reste aux schémas.

---

## 7. Champs contrôlés par chaque validateur

### Validateur boot — `packages/core/src/kernel/config/profile.ts:22`

Relu ligne à ligne le 27/07/2026. Il ne contrôle **que** ceci :

| Champ         | Règle                                           |
| ------------- | ----------------------------------------------- |
| racine        | Doit être un objet JSON (pas tableau, pas null) |
| `id`          | String si présent                               |
| `version`     | String si présent                               |
| `map`         | Objet (pas tableau)                             |
| `map.zoom`    | Number si présent                               |
| `map.minZoom` | Number si présent                               |
| `map.maxZoom` | Number si présent                               |

⚠️ **`geocodingConfig.enabled` et `geocodingConfig.provider` ne sont plus contrôlés** — ils
figuraient dans ce tableau, et le validateur ne les regarde plus : le géocodage est sorti du core
vers `@geoleaf-plugins/geocoding` (`modules.geocoding`). L'exemple §4.5 est conservé mais annoté.

### AJV — `profiles/schemas/profile.schema.json`

Le schéma est **fermé** (`additionalProperties: false`) à la racine **et** sous `map`. Clés racine
acceptées, mesurées sur le schéma :

| Champ                                          | Règle                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                                           | **Requis** — seul champ obligatoire                                                                                          |
| `version`                                      | Pattern `^\d+\.\d+\.\d+$` (SemVer strict)                                                                                    |
| `label`, `displayLabel`, `icon`, `description` | métadonnées de profil                                                                                                        |
| `$schema`                                      | référence de schéma                                                                                                          |
| `Files`                                        | objet fermé : `themesFile`, `layersFile`, `basemapsFile`, `uiFile`, `featuresFile`, `mappingFile`, `modules`                 |
| `map`                                          | objet fermé : `bounds`, `center`, `zoom`, `maxZoom`, `minZoom`, `initialMaxZoom`, `padding`, `positionFixed`, `boundsMargin` |
| `modules`                                      | dictionnaire `id → config` ; **les clés internes appartiennent au plugin** (Plugin Contract v1, INV-CONFIG)                  |

⚠️ **Cinq lignes ont été retirées de ce tableau** — elles décrivaient des clés **absentes du schéma**
depuis leur purge : `clusteringConfig.strategy`, `clusteringConfig.maxClusterRadius`,
`performance.maxConcurrentLayers`, `performance.layerLoadDelay`, `poiAddConfig.defaultPosition`.
Un intégrateur qui suivait ce tableau écrivait un profil **rejeté**.

> ⚠️ **Ne pas recopier ce tableau à la main la prochaine fois.** Il se dérive :
> `node -e "console.log(Object.keys(require('./profiles/schemas/profile.schema.json').properties))"`.
> C'est précisément la recopie manuelle qui l'a laissé diverger pendant deux purges de clés.

---

## 8. Ajouter un nouveau champ au schéma

1. Ajouter la définition dans `profiles/schemas/profile.schema.json` (section `properties` du bloc parent)
2. Si le champ est critique au boot, ajouter la vérification dans `packages/core/src/kernel/config/profile.ts` (`_validateProfileStructure`, l. 22)
3. Relancer `npm run validate:profiles` — vérifier 0 régression sur les profils existants
4. Documenter dans `docs/reference/GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md` et vérifier `node scripts/check-config-coverage.cjs` (il échoue si une clé de schéma n'a pas de ligne d'inventaire)

---

## 9. Le niveau « données » — les champs déclarés face à la donnée

Un profil nomme les propriétés de sa donnée en texte libre : la colonne de catégorie d'une
taxonomie, le champ d'une règle de style, celui d'une ligne d'attributs. Un nom que la donnée ne
porte pas se lit `undefined`, et son lecteur retombe sur un défaut **sans un mot** : icône de la
catégorie au lieu de celle de la sous-catégorie, ligne de popup absente, règle de style jamais
appliquée, couche vidée par le filtre. Les schémas n'y peuvent rien — ils jugent la forme, jamais
la donnée.

### 9.1 Au chargement : une ligne par couche

Le cœur confronte, pour chaque couche qu'il charge, les champs que ses lecteurs déclarent à un
échantillon de ses entités, et nomme chaque champ qu'aucune ne porte — **une fois** par couche,
clé et champ, en `Log.warn` :

```
[GeoLeaf.GeoJSON] Layer "candelabres": 1 declared field(s) carried by none of the 30 loaded
features — modules.taxonomy.taxonomies.poi-cat.subCategoryField "subcategoryId" (did you mean
"subCategoryId"?). …
```

Le message donne la clé de configuration où le champ est déclaré, le nom tel que le profil
l'écrit, et — quand une clé de la donnée ne diffère que par la casse — le nom que la donnée porte,
dans la notation de la déclaration. Un avertissement est **toujours enregistré**, quel que soit le
niveau de journal : il se relit par programme.

```js
GeoLeaf.Log.getEntries().filter((e) => e.level === "warn" && e.message.includes("declared field"));
```

Ce diagnostic **ne bloque rien** et ne change rien au rendu.

| Règle                       | Ce qu'elle dit                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Une **clé**, pas une valeur | Une propriété présente à `null` est portée — une donnée clairsemée n'est pas une faute de nom                       |
| L'échantillon               | Jusqu'à 1 000 entités, **réparties** sur la collection (une sur ⌈n / 1 000⌉), toutes en deçà                        |
| Couche vide                 | Rien n'est jugé — une collection vide ne prouve rien                                                                |
| Fréquence                   | Une fois par couche, clé et champ, pour la vie de la page ; un démontage de l'application réarme le diagnostic      |
| Changement de style         | Le style appliqué est jugé à son tour — ses règles peuvent tester des champs que le style par défaut ne testait pas |

### 9.2 Chaque clé est jugée avec la règle de SON lecteur

C'est le piège : la notation n'est pas la même d'une clé à l'autre, et un champ que le diagnostic
dirait « présent » avec une règle plus lâche que celle du lecteur ne s'afficherait jamais.

| Clé                                                                                          | Notation, telle que le lecteur la lit                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `modules.taxonomy` — `categoryField`, `subCategoryField` (et leur surcharge `layers.<id>.…`) | nom **nu**, sous `properties` ; `"properties.categoryId"` ne trouve rien                                                      |
| style — `styleRules[].when.field` (et ses branches `all`)                                    | nu ou préfixé : **un** `properties.` en tête est retiré ; `attributes.x` ne trouve rien                                       |
| étiquette — `label.field` du style, sinon `labels.field` de la couche                        | nom **nu**, strictement : `"properties.name"` cherche une clé littéralement nommée ainsi, et n'affiche rien                   |
| `attributes.fields[].field` — les lignes **affichées** seulement                             | `properties.x`, `attributes.x` ou nom nu                                                                                      |
| `searchable.fields`                                                                          | chemin pointé, depuis l'entité puis depuis `properties`                                                                       |
| `modules.filter.fields[]` — `field`, et `subField` d'un descripteur `taxonomy`               | chemin pointé, depuis l'entité puis depuis `properties` — seulement pour un descripteur qui **liste** la couche dans `layers` |

**Ce qui n'est pas jugé**, et pourquoi :

- un descripteur de filtre sans `layers`, ou de sorte `text` : il vaut pour plusieurs couches, et un
  champ qui n'en habite que certaines est normal ;
- une ligne d'attributs de **saisie** seule (un bloc `edit`, aucun `display`) : elle se remplit à la
  création, son absence de la donnée chargée est normale ;
- les clés d'un greffon (colonnes de la table, identifiant du temps réel, étiquette d'itinéraire) :
  le cœur ne valide pas la configuration d'un greffon ;
- les entités que le chargeur ne convertit pas : tuiles vectorielles, couche d'un greffon
  (FlatGeobuf), et tout ce qui arrive après le premier chargement (rafraîchissement OGC, flux temps
  réel, `GeoLeaf.Layers.setData`).

### 9.3 Dans ce dépôt : une gate

La garde `packages/core/__tests__/guards/profile-field-reconciliation.guard.test.ts` rejoue le même
jugement, avec les mêmes fonctions, sur les profils de `profiles/` — et elle juge **tous** les
styles d'une couche, là où le chargement ne voit que ceux qu'on applique. Elle tourne hors du cache
turbo, dans `ci:local` (étape des gardes) :

```bash
npx turbo run test:guards --filter=@geoleaf/core
```

Chaque couche qu'elle ne peut pas lire comme le chargeur (greffon, tuiles, OGC, `dataUrl` distante,
source convertie par `data.mapping`, collection vide) est **nommée**, jamais passée en silence.
