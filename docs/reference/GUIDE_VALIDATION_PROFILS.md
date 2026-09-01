# Guide — Validation des profils GeoLeaf

> Version : 2.0.0 · Mise à jour : 2026-07-27  
> Audience : intégrateurs et développeurs de profils
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

GeoLeaf valide les profils à deux niveaux complémentaires :

| Niveau          | Quand                          | Outil                         | Champs contrôlés                                                                |
| --------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| **Boot léger**  | Au chargement de l'application | `kernel/config/profile.ts:22` | Structure, types critiques : `id`, `version`, `map`, `map.zoom/minZoom/maxZoom` |
| **AJV complet** | **Gate bloquante**             | `npm run validate:profiles`   | Tous les champs du schéma `profiles/schemas/profile.schema.json`                |

Le validateur boot est embarqué dans `@geoleaf/core` (`_validateProfileStructure`,
`packages/core/src/kernel/config/profile.ts:22`). AJV reste **hors bundle** — outillage seulement.

⚠️ **AJV n'est plus « opt-in ».** `validate-profiles.cjs` est une gate **bloquante**, câblée à deux
endroits : `scripts/ci-local.cjs:384` et `.husky/pre-commit:22` (il sort 1 à la moindre violation).
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
