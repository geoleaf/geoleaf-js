# GeoLeaf — Module GeoJSON (module interne)

Product Version: GeoLeaf Platform V3
**Version**: 3.0.0 — relu contre le code le 27/07/2026
**Fichiers (monorepo)** : `packages/core/src/kernel/geojson/`
**Dernière mise à jour**: mars 2026

---

> **GeoJSON est un module INTERNE.**
> Il n'existe pas de namespace public `GeoLeaf.GeoJSON` dans l'API.
> Les couches GeoJSON sont configurées dans `profile.json` via la clé `geojsonLayers`
> et gérées depuis l'API publique par `GeoLeaf.Legend`.

---

## 1. Rôle fonctionnel

Le module GeoJSON (`kernel/geojson/`) gère en interne :

- le chargement des couches vectorielles déclarées dans `profile.json` ;
- le rendu MapLibre GL (polygones, lignes, points, clusters) via sources et layers natifs ;
- la synchronisation avec le `LayerManager` pour la légende ;
- les popups unifiés compatibles avec le système POI ;
- le clustering natif MapLibre via `clusterMaxZoom` et `clusterRadius` sur les sources GeoJSON ;
- la gestion des tuiles vectorielles MVT via `map.addSource({ type: 'vector' })` + `map.addLayer()` ;
- le traitement différé en Web Worker (`geojson-worker.ts`) pour les grands jeux de données.

Ce module est initialisé automatiquement lors du chargement du profil. **Aucun appel explicite n'est requis depuis le code applicatif.**

### Architecture interne (v2.0.0)

```
kernel/geojson/
├── core.ts                    // Agrégateur principal, délègue aux sous-modules
├── core-types.ts              // Types de la définition de couche (chemin inline)
├── shared.ts                  // État partagé et constantes
├── style-resolver.ts          // Évaluation styleRules, buildLayerOptions
├── style-operators.ts         // STYLE_OPERATORS
├── layer-config-manager.ts    // Résolution de la config d'une couche
├── layers-public-api.ts       // La façade GeoLeaf.Layers
├── layers/                    // Store, style, visibilité, intégration légende
├── loader/                    // Chargement (profile, single-layer, data, clustering-normalize, ogc-api…)
├── feature-interaction.ts     // Clic / survol sur une feature
├── feature-validator.ts       // Validation de features
├── geojson-filter.ts          // getFeatures et son filtrage
├── geojson-worker.ts          // Web Worker pour traitement async
├── worker-manager.ts          // Gestion du cycle de vie du worker
├── visibility-manager.ts      // État de visibilité par couche
└── geojson-utils.ts           // Utilitaires (validateFeature, calculateBounds, etc.)
```

> ⚠️ **Cet arbre était racine sur `built-in/geojson/`, répertoire qui n'existe pas**, et
> 3 de ses 10 fichiers étaient introuvables (corrigé le 11/08/2026) : `popup-tooltip.ts` a
> disparu, `clustering.ts` est devenu `loader/clustering-normalize.ts`, et `vector-tiles.ts`
> est sorti du kernel pour devenir la **capacité** `capabilities/vector-tiles/`. Le nouvel
> arbre est relevé sur le disque. Il n'est pas gaté ici : l'arbre **gaté** du dépôt est
> [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), régénérée par
> `npm run docs:tree`.

---

## 2. Configuration dans `profile.json`

Les couches GeoJSON sont déclarées dans la section `geojsonLayers` du fichier de profil :

```json
{
    "id": "tourism",
    "label": "Profil tourisme",
    "geojsonLayers": [
        {
            "id": "tourism-routes",
            "label": "Itinéraires touristiques",
            "url": "../data/profiles/tourism/geojson/itineraries.geojson",
            "visible": true,
            "clustering": false,
            "style": {
                "color": "#FF9800",
                "weight": 3,
                "opacity": 0.9
            }
        },
        {
            "id": "tourism-poi-nature",
            "label": "POI Nature",
            "url": "../data/profiles/tourism/geojson/poi-naturels.geojson",
            "visible": true,
            "clustering": true,
            "style": {
                "radius": 8,
                "fillColor": "#10b981",
                "fillOpacity": 0.9
            }
        }
    ]
}
```

> ⚠️ **La seconde couche portait `"pointStyle"` — clé morte** (corrigé le 11/08/2026). Le
> résolveur de couleur ne lit que `config.style`, pour les points comme pour le reste
> (`kernel/geojson/layers/integration.ts:119`).

### Propriétés de chaque couche

🛑 **Il y a DEUX façons de déclarer une couche, et ce guide ne disait pas laquelle il
décrivait.** C'est le défaut de fond de la section, corrigé le 11/08/2026.

| Chemin                                                   | Ce qui le gouverne                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **inline** — le tableau `geojsonLayers` d'un profil (§2) | **aucun schéma JSON** ; la forme est typée par `kernel/geojson/core-types.ts` et `loader/loader-types.ts` |
| **modulaire** — un `<couche>_config.json` par couche     | `profiles/schemas/layer-config.schema.json`, `additionalProperties: false`                                |

`loader/profile.ts` (`_getLayersDef`) accepte les deux, dans cet ordre : `geojsonLayers`, puis
`geojson.layers`, puis `layers`, puis le système modulaire. **La forme plate du §2 est donc
vivante** — ce n'est pas un vestige.

**Pour le chemin modulaire, la liste exhaustive est
[`PROFILE_SCHEMA_REFERENCE.md`](../../reference/PROFILE_SCHEMA_REFERENCE.md), section
`layer-config.schema.json`** : dérivée des schémas (`npm run gen:profile-schema`), **gatée** par
`gen:profile-schema:check`, 476 chemins. Ce guide ne la recopie pas — une seconde rédaction du
même schéma rediverge.

> ⚠️ **Une table de 14 propriétés a été retirée d'ici, et son défaut n'est pas celui qu'on
> croit.** Elle n'était pas « fausse » en bloc : elle décrivait le chemin **inline** sans le
> dire, à un endroit où le lecteur pouvait la prendre pour le contrat du chemin **modulaire**,
> qui rejette la plupart de ses clés (`additionalProperties: false`). Trois de ses lignes sont
> néanmoins mortes **dans les deux chemins**, mesuré sur `packages/core/src` :
>
> - **`popupTemplate`** et **`detailProfileId`** — **0 occurrence** dans tout le dépôt hors doc.
> - **`pointStyle`** — 0 occurrence en source. Ses 16 occurrences sont **dans des tests**, dont
>   deux s'intitulent _« \_resolveLayerColor uses pointStyle »_ alors que la fonction
>   (`kernel/geojson/layers/integration.ts:119`) ne lit que `config.style` et retombe sur sa
>   couleur par défaut. Le test passe donc **en n'éprouvant plus ce qu'il nomme**.
> - Enfin **`tileUrl` n'est une clé de config d'aucun des deux chemins** : la source de tuiles
>   est `data.vectorTiles.tilesUrl` (`capabilities/vector-tiles/vector-tiles.ts:176`). Le nom
>   `tileUrl` n'existe qu'en variable interne — c'est ce qui l'a fait passer pour vivant à un
>   premier relevé, et c'est le piège « l'instrument porte la cécité qu'il mesure ».

---

## 3. API publique de gestion des couches

La visibilité des couches GeoJSON est contrôlée via `GeoLeaf.Legend` :

```js
// Masquer une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", false);

// Afficher une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", true);

// Lister toutes les couches actives
const layers = GeoLeaf.Legend.getAllLayers();
```

Voir la [documentation `GeoLeaf.Legend`](../../../packages/core/docs/legend/GeoLeaf_Legend_README.md) pour l'API complète.

---

## 4. Intégration avec `geoleaf.config.json`

Les défauts de clustering **globaux** se déclarent dans le bloc `modules.cluster` :

```json
{
    "modules": {
        "cluster": {
            "enabled": true,
            "clustering": true,
            "clusterRadius": 80,
            "disableClusteringAtZoom": 14
        }
    }
}
```

> Ce sont des **défauts** : une couche les surcharge par son propre bloc `clustering`.
> Table complète et gatée : [`docs/specs/capacites/cluster.md`](../../specs/capacites/cluster.md) §Configuration.

> ⚠️ **Cette section décrivait un bloc `poiConfig` avec `applyToAllSources` — les deux sont
> morts** (corrigé le 11/08/2026). `applyToAllSources` : **0 occurrence** dans
> `packages/core/src`. `poiConfig` : plus aucun lecteur, ses seules traces sont des commentaires
> de `capabilities/cluster/types.ts` qui le nomment **au passé** (_« was `poiConfig.clusterStrategy` »_).
> Le bloc vivant est `modules.cluster`, gaté par `modules.cluster.enabled` (opt-out), et sa
> table de configuration est tenue à jour par `doc-capability-config.guard.test.js` — c'est-à-dire
> par une gate, pas par une relecture.

---

## 5. Géométries supportées

| Type Geometry     | Rendu MapLibre         | Style Config | Clustering |
| ----------------- | ---------------------- | ------------ | ---------- |
| `Point`           | `circle` layer         | `style`      | ✅ Oui     |
| `LineString`      | `line` layer           | `style`      | ❌ Non     |
| `Polygon`         | `fill` + `line` layers | `style`      | ❌ Non     |
| `MultiPoint`      | `circle` layer         | `style`      | ✅ Oui     |
| `MultiLineString` | `line` layer           | `style`      | ❌ Non     |
| `MultiPolygon`    | `fill` + `line` layers | `style`      | ❌ Non     |

> ⚠️ La colonne « Style Config » donnait `pointStyle` pour les deux lignes de points — **clé
> morte** (corrigé le 11/08/2026). Il n'y a qu'un bloc de style, `style`, quelle que soit la
> géométrie.

---

## 6. Tuiles vectorielles MVT

Le module `vector-tiles.ts` ajoute le support des couches MVT via l'API native MapLibre :

```json
{
    "id": "admin-boundaries",
    "label": "Limites administratives",
    "geometryType": "Polygon",
    "data": {
        "directory": "data",
        "file": "admin.geojson",
        "vectorTiles": {
            "enabled": true,
            "tilesUrl": "https://tiles.example.com/admin/{z}/{x}/{y}.pbf",
            "layerName": "admin",
            "minZoom": 0,
            "maxNativeZoom": 12,
            "maxZoom": 18,
            "interactive": true
        }
    },
    "styles": {
        "directory": "styles",
        "default": "default.json"
    }
}
```

Aucune dépendance tierce requise — MapLibre GL JS supporte nativement le format MVT.

> ⚠️ **Cet exemple portait `"tileUrl"` au premier niveau de la couche — faux deux fois**
> (corrigé le 11/08/2026, trouvé par `DOC-CONFIG-EXAMPLES` le jour où `docs/` est entré dans
> son corpus). La clé s'appelle **`tilesUrl`** et vit sous **`data.vectorTiles`** ; au premier
> niveau, `additionalProperties: false` la rejette. `data.file` reste renseigné : c'est le
> **repli GeoJSON** quand `shouldUseVectorTiles()` refuse la source — il exige une URL absolue
> (`capabilities/vector-tiles/vector-tiles.ts`).

---

## 7. Format GeoJSON recommandé

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "poi-001",
                "name": "Parc National",
                "description": "Vue panoramique.",
                "category": "nature"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [-60.68, -32.95]
            }
        }
    ]
}
```

Les popups sont générées automatiquement depuis `properties.name`, `properties.label` ou `properties.title`.

---

## 8. Événements

```js
// Écouter les changements de visibilité
map.on("geoleaf:geojson:visibility-changed", (e) => {
    console.log(`Couche ${e.layerId} : ${e.visible ? "visible" : "masquée"}`);
});

// Écouter le chargement des couches
map.on("geoleaf:geojson:layers-loaded", (e) => {
    console.log(`${e.count} couche(s) chargée(s)`, e.layers);
});
```

---

## 9. Limites et performances

- Avertissement si > 10 couches dans `geojsonLayers[]`
- Recommandation : 3–5 couches max pour performances optimales
- Pas de limite technique de features, mais surveiller les performances si > 5 000 features/couche
- Utiliser le clustering MapLibre natif pour les couches POI denses
- Le Web Worker (`geojson-worker.ts`) traite les opérations lourdes (calcul de bounds, filtrage de features) hors du thread principal

---

## 10. Séquence d'initialisation

1. `GeoLeaf.loadConfig({ url, profileId })` charge la config et le profil.
2. La section `geojsonLayers` du profil est lue automatiquement.
3. Les couches sont ajoutées comme sources MapLibre (`map.addSource`) et layers (`map.addLayer`).
4. Les couches sont synchronisées avec la légende.
5. **Aucun appel `GeoLeaf.GeoJSON.*` n'est nécessaire depuis l'application.**

Pour les exemples de configuration de profil avancés, voir
[`GEOJSON_LAYERS_GUIDE.md`](../../../packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md) et
[`CONFIGURATION_GUIDE.md`](../../../packages/core/docs/CONFIGURATION_GUIDE.md).

> ⚠️ **Cette ligne annonçait que `GEOJSON_LAYERS_GUIDE.md` « n'existe pas »** — il existe, à
> `packages/core/docs/geojson/`. L'annotation qui le déclarait absent était fausse, et le
> soulignement Markdown l'avait de surcroît rendue illisible. Corrigé le 11/08/2026 : c'est le
> mode 3 du pré-vol, à l'envers — un document déclaré mort qui ne l'était pas.
