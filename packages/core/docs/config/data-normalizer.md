---
title: "GeoLeaf — Normalisation de données & format POI unifié"
---

# GeoLeaf — Normalisation de données & format POI unifié

**Version** : 3.0.0
**Dernière mise à jour :** mars 2026

---

> **Note architecture :** La normalisation de données est un processus **interne automatique**. Les modules `DataNormalizer`, `Normalization` et `DataConverter` (`src/modules/utils/data/`) ne font pas partie de l'API publique de GeoLeaf et ne sont pas exposés sur le namespace `GeoLeaf.*`. Les développeurs interagissent avec ce système uniquement via la **configuration du profil** (`dataMapping` dans les layers, `mapping.json`).

---

## Format POI unifié (référence)

Toutes les sources de données (JSON, GeoJSON, Routes) sont converties automatiquement vers ce format interne avant d'être affichées sur la carte.

```json
{
    "id": "poi_123",
    "title": "Restaurant La Bonne Table",

    "lat": 48.8566,
    "lng": 2.3522,

    "categoryId": "restaurant",
    "subCategoryId": "gastronomique",
    "description": "Restaurant gastronomique au cœur de Paris",

    "attributes": {
        "address": "123 rue de Paris",
        "phone": "+33 1 23 45 67 89",
        "website": "https://example.com",
        "opening_hours": "9h-18h",
        "reviews": {
            "rating": 4.5,
            "count": 127,
            "summary": "Excellent restaurant",
            "recent": [{ "author": "Jean", "rating": 5, "comment": "Parfait !" }]
        }
    }
}
```

**Champs clés** :

| Champ           | Type   | Description                                             |
| --------------- | ------ | ------------------------------------------------------- |
| `id`            | string | Identifiant unique (généré si absent dans la source)    |
| `title`         | string | Nom affiché (mappé depuis `name`, `nom`, `label`, etc.) |
| `lat` / `lng`   | number | Coordonnées géographiques                               |
| `categoryId`    | string | Catégorie principale (taxonomie)                        |
| `subCategoryId` | string | Sous-catégorie                                          |
| `attributes`    | object | Toutes les propriétés métier de la source               |

---

## Sources supportées

| Type      | Format source                              | Détection automatique                           |
| --------- | ------------------------------------------ | ----------------------------------------------- |
| `json`    | Objet JSON brut avec champs plats          | `data.lat` + `data.lng` ou fallbacks            |
| `geojson` | GeoJSON Feature (Point/LineString/Polygon) | `type: "Feature"` + `geometry`                  |
| `route`   | Objet avec `latLng` ou waypoints           | `data.latLng` ou `data.order`                   |
| `gpx`     | Waypoint GPX                               | `data.lat` + `data.lon` + `data.name` (partiel) |

---

## Configuration : `dataMapping` dans le profil

Le `dataMapping` dans la config d'un layer permet de mapper des champs non-standard vers le format GeoLeaf, sans `mapping.json` externe.

```jsonc
{
    "layers": [
        {
            "id": "restaurants",
            "type": "poi",
            "url": "data/restaurants.json",
            "dataMapping": {
                "title": "nom", // source.nom → POI.title
                "lat": "latitude", // source.latitude → POI.lat
                "lng": "longitude", // source.longitude → POI.lng
                "categoryId": "type", // source.type → POI.categoryId
            },
        },
    ],
}
```

---

## Configuration : `mapping.json`

Pour des transformations plus complexes ou partagées entre plusieurs layers, un fichier `mapping.json` peut être placé dans le répertoire du profil.

### Structure

```json
{
    "version": "1.0",
    "description": "Mapping pour API externe XYZ",
    "mapping": {
        "id": "uid",
        "title": "name",
        "description": "short_description",
        "location.lat": "coordinates.latitude",
        "location.lng": "coordinates.longitude",
        "categoryId": "type",
        "attributes.address": "full_address",
        "attributes.phone": "contact.telephone",
        "attributes.website": "links.web",
        "attributes.opening_hours": "horaires"
    }
}
```

### Syntaxe des chemins

- **Chemin simple** : `"title": "nom"` — mappe `source.nom` vers `target.title`
- **Chemin imbriqué** : `"location.lat": "coords.latitude"` — mappe `source.coords.latitude` vers `target.location.lat`
- **Tableau** : `"attributes.tags": "categories[0]"` — premier élément du tableau

### Placement

```
profiles/
└── mon-profil/
    ├── geoleaf.config.json
    └── mapping.json          ← fichier de mapping
```

### Activation dans le profil

```jsonc
{
    "layers": [
        {
            "id": "pois-externes",
            "type": "poi",
            "url": "https://api.example.com/pois",
            "normalized": false, // déclenche l'application du mapping
            "mappingFile": "mapping.json",
        },
    ],
}
```

---

## Exemple : intégrer une API externe

**Données brutes de l'API** :

```json
[
    {
        "restaurant_id": "rest_123",
        "restaurant_name": "Le Petit Bistrot",
        "geo": { "lat": 48.8566, "lon": 2.3522 },
        "contact_info": { "tel": "0123456789", "web": "https://petitbistrot.fr" },
        "rating": { "average": 4.5, "total_reviews": 127 }
    }
]
```

**mapping.json** :

```json
{
    "mapping": {
        "id": "restaurant_id",
        "title": "restaurant_name",
        "location.lat": "geo.lat",
        "location.lng": "geo.lon",
        "attributes.phone": "contact_info.tel",
        "attributes.website": "contact_info.web",
        "attributes.reviews.rating": "rating.average",
        "attributes.reviews.count": "rating.total_reviews"
    }
}
```

**Layer config dans le profil** :

```jsonc
{
    "layers": [
        {
            "id": "restaurants",
            "type": "poi",
            "url": "https://api.example.com/restaurants",
            "normalized": false,
            "mappingFile": "mapping.json",
        },
    ],
}
```

GeoLeaf applique automatiquement le mapping au chargement, sans appel de code supplémentaire.

---

## Comportement par défaut (sans mapping)

Si aucun `dataMapping` ni `mappingFile` n'est configuré :

- **JSON** : GeoLeaf cherche automatiquement `title`/`name`/`nom`/`label` pour le titre, `lat`/`latitude`/`y` et `lng`/`longitude`/`x` pour les coordonnées
- **GeoJSON** : propriétés standard (`name`, `title`, `nom`) mappées automatiquement ; coordonnées extraites de `geometry.coordinates`
- Les POI déjà conformes au format unifié passent sans transformation

---

## Limitations

- **GPX** : support partiel (waypoints simples uniquement ; import .gpx natif non implémenté)
- **Transformations calculées** : pas de support pour concatenations ou calculs dans mapping.json
- **Validation stricte** : un POI sans `id` ou coordonnées après normalisation est ignoré (warning console)

---

## Voir aussi

- [Configuration des layers GeoJSON](../geojson/GEOJSON_LAYERS_GUIDE.md) — format complet de la config layer
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — structure des fichiers de profil
- [GeoLeaf_Config_README.md](GeoLeaf_Config_README.md) — chargement du profil et des fichiers annexes
