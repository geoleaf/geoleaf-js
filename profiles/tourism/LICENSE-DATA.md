# LICENSE-DATA — Tourism Demo Profile

> Licensing and attribution for geographic datasets used in the GeoLeaf
> tourism demonstration profile (`profiles/tourism/`).

---

## 1. OpenStreetMap (OSM)

| Field        | Value |
|-------------|-------|
| **Source**   | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |
| **License**  | Open Data Commons Open Database License (ODbL) v1.0 |
| **URL**      | <https://opendatacommons.org/licenses/odbl/1-0/> |
| **Used for** | Road networks, place names, POI locations, base cartography |
| **Attribution** | © OpenStreetMap contributors |

Data extracted via Overpass API / QGIS and converted to GeoJSON.

---

## 2. World Database on Protected Areas (WDPA)

| Field        | Value |
|-------------|-------|
| **Source**   | UNEP-WCMC & IUCN |
| **License**  | Non-commercial use, with attribution |
| **URL**      | <https://www.protectedplanet.net/en/thematic-areas/wdpa> |
| **Used for** | National parks, nature reserves boundaries |
| **Attribution** | UNEP-WCMC and IUCN (year), Protected Planet: The World Database on Protected Areas (WDPA). Cambridge, UK: UNEP-WCMC and IUCN. Available at: www.protectedplanet.net |

---

## 3. Instituto Geográfico Nacional (IGN Argentina)

| Field        | Value |
|-------------|-------|
| **Source**   | IGN — República Argentina |
| **License**  | Open data under Decreto 117/2016. Free use with attribution. |
| **URL**      | <https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG> |
| **Used for** | Administrative boundaries, provincial limits, elevation data |
| **Attribution** | Instituto Geográfico Nacional de la República Argentina |

---

## 4. Sistema de Información de Biodiversidad (SIB) / APN

| Field        | Value |
|-------------|-------|
| **Source**   | Administración de Parques Nacionales (APN) — Argentina |
| **License**  | Open data. Free use with attribution. |
| **URL**      | <https://sib.gob.ar/portada> |
| **Used for** | National protected areas (SIB layer), biodiversity zones |
| **Attribution** | Sistema de Información de Biodiversidad – Administración de Parques Nacionales |

---

## 5. Ecoregiones de Argentina

| Field        | Value |
|-------------|-------|
| **Source**   | Various academic publications & government agencies |
| **License**  | Public domain / academic use |
| **Used for** | Eco-region boundaries overlay |
| **Attribution** | Ecoregiones de Argentina — compilación basada en Burkart et al. |

---

## 6. WorldClim / Bio-climatic Data

| Field        | Value |
|-------------|-------|
| **Source**   | [WorldClim](https://www.worldclim.org/) |
| **License**  | Creative Commons Attribution 4.0 (CC BY 4.0) |
| **URL**      | <https://www.worldclim.org/data/worldclim21.html> |
| **Used for** | Climate indicators, temperature/precipitation rasters (converted to vector for demo) |
| **Attribution** | Fick, S.E. and R.J. Hijmans, 2017. WorldClim 2: new 1km spatial resolution climate surfaces for global land areas. International Journal of Climatology 37 (12): 4302-4315. |

---

## 7. Natural Earth

| Field        | Value |
|-------------|-------|
| **Source**   | [Natural Earth](https://www.naturalearthdata.com/) |
| **License**  | Public domain |
| **URL**      | <https://www.naturalearthdata.com/about/terms-of-use/> |
| **Used for** | Country borders, coastlines, physical features |
| **Attribution** | Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com |

---

## 8. Cities / Localidades Compilation

| Field        | Value |
|-------------|-------|
| **Source**   | Compiled from OSM + IGN Argentina + GeoNames |
| **License**  | ODbL (OSM portion), open data (IGN portion), CC BY 4.0 (GeoNames) |
| **Used for** | City points, population data |
| **Attribution** | See individual sources above |

---

## Enrichment Sources (images, descriptions)

| Source | License | Usage |
|--------|---------|-------|
| Wikipedia / Wikidata | CC BY-SA 3.0 / 4.0 | POI descriptions, metadata |
| Wikimedia Commons | Varies per file (CC BY-SA, public domain) | POI thumbnail images |
| Pexels | Pexels License (free commercial use) | Placeholder / fallback images |

---

## Summary Table

| Dataset | License | Commercial OK? | Attribution Required? |
|---------|---------|:--------------:|:--------------------:|
| OpenStreetMap | ODbL 1.0 | ✅ | ✅ |
| WDPA | Non-commercial | ❌ | ✅ |
| IGN Argentina | Open (Decreto 117/2016) | ✅ | ✅ |
| SIB / APN | Open | ✅ | ✅ |
| Ecoregiones | Public domain | ✅ | ⚠️ Recommended |
| WorldClim | CC BY 4.0 | ✅ | ✅ |
| Natural Earth | Public domain | ✅ | ⚠️ Recommended |
| Cities compilation | Mixed (ODbL / Open / CC BY) | ✅ | ✅ |

---

## Notes

- **WDPA data** is restricted to non-commercial use. The demo profile uses it
  for educational/demonstration purposes only. If you deploy this profile
  commercially, replace or remove the WDPA layers.
- All GeoJSON files may have been simplified (vertex reduction) for
  performance. They are **not** authoritative geographic references.
- If you redistribute these datasets, you must comply with each
  individual license.

---

*Last updated: 2026-02-14*
