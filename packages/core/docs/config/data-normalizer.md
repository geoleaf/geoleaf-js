---
title: "GeoLeaf — Data normalisation & unified POI format"
---

# GeoLeaf — Data normalisation & unified POI format

---

> **Architecture note:** data normalisation is an **automatic internal process**. The `DataNormalizer`, `Normalization` and `DataConverter` modules (`src/modules/utils/data/`) are not part of the public GeoLeaf API and are not exposed on the `GeoLeaf.*` namespace. Integrators interact with this system only through the **profile configuration** (`dataMapping` in the layers, `mapping.json`).

---

## Unified POI format (reference)

Every data source (JSON, GeoJSON, routes) is converted automatically into this internal format before being displayed on the map.

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

**Key fields**:

| Field           | Type   | Description                                               |
| --------------- | ------ | --------------------------------------------------------- |
| `id`            | string | Unique identifier (generated when absent from the source) |
| `title`         | string | Displayed name (mapped from `name`, `nom`, `label`, etc.) |
| `lat` / `lng`   | number | Geographic coordinates                                    |
| `categoryId`    | string | Main category (taxonomy)                                  |
| `subCategoryId` | string | Sub-category                                              |
| `attributes`    | object | All the business properties coming from the source        |

---

## Supported sources

| Type      | Source format                              | Automatic detection                             |
| --------- | ------------------------------------------ | ----------------------------------------------- |
| `json`    | Raw JSON object with flat fields           | `data.lat` + `data.lng`, or fallbacks           |
| `geojson` | GeoJSON Feature (Point/LineString/Polygon) | `type: "Feature"` + `geometry`                  |
| `route`   | Object with `latLng` or waypoints          | `data.latLng` or `data.order`                   |
| `gpx`     | GPX waypoint                               | `data.lat` + `data.lon` + `data.name` (partial) |

---

## Configuration: `dataMapping` in the profile

The `dataMapping` entry in a layer configuration maps non-standard fields onto the GeoLeaf format, without an external `mapping.json`.

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

## Configuration: `mapping.json`

For more complex transformations, or for transformations shared between several layers, a `mapping.json` file can be placed in the profile directory.

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

### Path syntax

- **Simple path**: `"title": "nom"` — maps `source.nom` onto `target.title`
- **Nested path**: `"location.lat": "coords.latitude"` — maps `source.coords.latitude` onto `target.location.lat`
- **Array**: `"attributes.tags": "categories[0]"` — first element of the array

### Placement

```
profiles/
└── mon-profil/
    ├── geoleaf.config.json
    └── mapping.json          ← mapping file
```

### Activation in the profile

```jsonc
{
    "layers": [
        {
            "id": "pois-externes",
            "type": "poi",
            "url": "https://api.example.com/pois",
            "normalized": false, // triggers the mapping
            "mappingFile": "mapping.json",
        },
    ],
}
```

---

## Example: integrating an external API

**Raw data returned by the API**:

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

**mapping.json**:

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

**Layer configuration in the profile**:

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

GeoLeaf applies the mapping automatically at load time, with no additional code.

---

## Default behaviour (no mapping)

When neither `dataMapping` nor `mappingFile` is configured:

- **JSON**: GeoLeaf looks for `title`/`name`/`nom`/`label` for the title, and `lat`/`latitude`/`y` and `lng`/`longitude`/`x` for the coordinates
- **GeoJSON**: standard properties (`name`, `title`, `nom`) are mapped automatically; coordinates are extracted from `geometry.coordinates`
- POIs already matching the unified format pass through unchanged

---

## Limitations

- **GPX**: partial support (simple waypoints only; native .gpx import is not implemented)
- **Computed transformations**: concatenations and calculations are not supported in mapping.json
- **Strict validation**: a POI without an `id` or without coordinates after normalisation is ignored (console warning)

---

## See also

- [GeoJSON layer configuration](../geojson/GEOJSON_LAYERS_GUIDE.md) — full layer configuration format
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — structure of the profile files
- [GeoLeaf_Config_README.md](GeoLeaf_Config_README.md) — loading the profile and its companion files
