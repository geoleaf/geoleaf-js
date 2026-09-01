<!-- GÉNÉRÉ — ne pas éditer à la main. -->

# Référence des schémas de profil — GÉNÉRÉE

> **Source unique : `profiles/schemas/*.json`.** Ce fichier est produit par
> `npm run gen:profile-schema` et vérifié à l'octet près par `npm run gen:profile-schema:check`
> (câblé dans `ci:local` et `ci.yml`). Ne pas l'éditer : la prochaine génération écrase.
>
> **Pour corriger une description, éditer le SCHÉMA**, pas ce document. C'est le seul endroit
> où la phrase ne peut pas diverger de ce que le validateur applique.
>
> Ce fichier ne porte ni date ni numéro de version, à dessein : c'est ce qui en fait une
> fonction pure de ses schémas, donc gatable. Les décomptes s'obtiennent par
> `npm run gen:profile-schema`, qui les imprime.

## `basemaps.schema.json`

_GeoLeaf Basemaps_

basemaps.json — basemap tile source definitions for a GeoLeaf profile. Hardened in Sprint S1 (PRF-SCHEMA). Alternate source types (wmts, wms, imageSource, hillshade) present in real profiles were added. The `type` enum was hardened in S6 to the 7 runtime-mapped values; the runtime-support audit confirmed all types (incl. image/hillshade/wmts/wms) are rendered. See anomaly registry ANO-017.

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `basemaps` | object | oui | — | — | Map of basemap entries keyed by basemap ID. |
| `basemaps.{id}.attribution` | string | — | — | — | HTML attribution string. |
| `basemaps.{id}.cacheMaxZoom` | number | — | — | — | — |
| `basemaps.{id}.cacheMinZoom` | number | — | — | — | — |
| `basemaps.{id}.defaultBasemap` | boolean | — | — | — | Set to true to make this the active basemap on startup. |
| `basemaps.{id}.encoding` | string | — | — | — | Tile encoding hint (e.g. for raster-dem sources). |
| `basemaps.{id}.fallbackUrl` | string | — | — | — | Raster tile URL fallback when MapLibre GL is unavailable. |
| `basemaps.{id}.hillshade` | object | — | — | — | Hillshade (raster-dem) source configuration. |
| `basemaps.{id}.hillshade.accentColor` | string | — | — | — | Accent colour of the hillshade layer (`hillshade-accent-color`). Any CSS colour. |
| `basemaps.{id}.hillshade.demEncoding` | string | — | `"terrarium"` | "terrarium" \| "mapbox" | — |
| `basemaps.{id}.hillshade.demMaxZoom` | number | — | — | — | — |
| `basemaps.{id}.hillshade.demUrl` | string | — | — | — | — |
| `basemaps.{id}.hillshade.exaggeration` | number | — | — | — | — |
| `basemaps.{id}.hillshade.highlightColor` | string | — | — | — | — |
| `basemaps.{id}.hillshade.illuminationAnchor` | string | — | — | "viewport" \| "map" | Whether the light source follows the viewport or is anchored to the map. MapLibre default: `viewport`. |
| `basemaps.{id}.hillshade.illuminationDirection` | number | — | — | — | — |
| `basemaps.{id}.hillshade.shadowColor` | string | — | — | — | — |
| `basemaps.{id}.id` | string | oui | — | — | Basemap ID (mirrors the key in the parent object). |
| `basemaps.{id}.imageSource` | object | — | — | — | Static image overlay source (georeferenced by coordinates). |
| `basemaps.{id}.imageSource.coordinates` | array | — | — | — | — |
| `basemaps.{id}.imageSource.opacity` | number | — | — | — | — |
| `basemaps.{id}.imageSource.url` | string | — | — | — | — |
| `basemaps.{id}.label` | string | — | — | — | Display label. |
| `basemaps.{id}.maxZoom` | number | — | — | — | — |
| `basemaps.{id}.minZoom` | number | — | — | — | — |
| `basemaps.{id}.offline` | boolean | — | — | — | Whether this basemap supports offline tile caching. |
| `basemaps.{id}.offlineBounds` | object | — | — | — | Geographic bounds for offline caching. |
| `basemaps.{id}.offlineBounds.east` | number | oui | — | — | — |
| `basemaps.{id}.offlineBounds.north` | number | oui | — | — | — |
| `basemaps.{id}.offlineBounds.south` | number | oui | — | — | — |
| `basemaps.{id}.offlineBounds.west` | number | oui | — | — | — |
| `basemaps.{id}.style` | string | — | — | — | MapLibre GL style URL. Only for type: "maplibre". |
| `basemaps.{id}.subdomains` | oneOf | — | — | — | Tile subdomains. |
| `basemaps.{id}.terrain` | object | — | — | — | 3D terrain / raster-dem configuration. Only valid when basemap type is "maplibre" or tiles-based. |
| `basemaps.{id}.terrain.bearing` | number | — | `0` | — | Initial camera bearing in degrees applied when 3D terrain is activated. |
| `basemaps.{id}.terrain.default3D` | boolean | — | `false` | — | When true, 3D terrain activates automatically when this basemap is selected. |
| `basemaps.{id}.terrain.demEncoding` | string | — | `"terrarium"` | "terrarium" \| "mapbox" | Tile encoding format for elevation data. |
| `basemaps.{id}.terrain.demMaxZoom` | number | — | — | — | Maximum zoom of the DEM tile source. Falls back to 15 when absent. |
| `basemaps.{id}.terrain.demUrl` | string | — | — | — | URL template for the raster-dem tile source (may contain {z}/{x}/{y} placeholders). Required when enabled is true. |
| `basemaps.{id}.terrain.enabled` | boolean | oui | — | — | Enables 3D terrain rendering for this basemap. |
| `basemaps.{id}.terrain.exaggeration` | number | — | `1.5` | — | Vertical exaggeration factor. Recommended range: 1.0–3.0. |
| `basemaps.{id}.terrain.pitch` | number | — | `45` | — | Initial camera pitch in degrees applied when 3D terrain is activated. |
| `basemaps.{id}.tiles` | array | — | — | — | Explicit tile URL array for MapLibre raster sources. Overrides url + subdomains expansion. |
| `basemaps.{id}.tileSize` | number | — | `256` | — | — |
| `basemaps.{id}.type` | string | — | — | "tile" \| "raster" \| "maplibre" \| "image" \| "hillshade" \| "wmts" \| "wms" | Source type. Enum hardened in S6 to the 7 runtime-mapped values (registry.ts `_resolveBasemapType` + dispatch). `raster` is a runtime alias of `tile` (default raster path). When omitted, defaults to the raster path. See anomaly registry ANO-017. |
| `basemaps.{id}.url` | string | — | — | — | Tile URL template with {s}, {z}, {x}, {y} placeholders. |
| `basemaps.{id}.wms` | object | — | — | — | WMS source configuration. |
| `basemaps.{id}.wms.crs` | string | — | — | — | Coordinate reference system requested from the WMS server (e.g. `EPSG:3857`). |
| `basemaps.{id}.wms.format` | string | — | — | — | — |
| `basemaps.{id}.wms.layers` | string | — | — | — | — |
| `basemaps.{id}.wms.styles` | string | — | — | — | WMS `STYLES` parameter. Empty string requests the server default. |
| `basemaps.{id}.wms.tileSize` | number | — | — | — | Tile size in pixels requested from the WMS server. Falls back to 256 when absent. |
| `basemaps.{id}.wms.transparent` | boolean | — | — | — | — |
| `basemaps.{id}.wms.url` | string | — | — | — | — |
| `basemaps.{id}.wms.version` | string | — | — | — | — |
| `basemaps.{id}.wmts` | object | — | — | — | WMTS source configuration (GetCapabilities-driven). |
| `basemaps.{id}.wmts.format` | string | — | — | — | — |
| `basemaps.{id}.wmts.getCapabilitiesUrl` | string | — | — | — | — |
| `basemaps.{id}.wmts.layer` | string | — | — | — | — |
| `basemaps.{id}.wmts.tileMatrixSet` | string | — | — | — | — |

## `features.schema.json`

_GeoLeaf Core Features_

config/core/features.json — core feature configuration (map options). The POI subsystem was dissolved in S9 (a POI is now a generic point layer styled by taxonomy/cluster/feature-info); the top-level poiConfig key was removed. Cluster configuration was extracted to the in-core cluster capability (modules.cluster, config/plugins/cluster.json, family B7) in the S3 cluster-capability extraction; the dead top-level clusteringConfig key was purged (never read at runtime — ANO-027/ANO-031 regression-locks retired with the key). Address geocoding moved out of the core to the @geoleaf-plugins/geocoding plugin namespace (modules.geocoding, config/plugins/geocoding.json).

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `mapOptions` | object | — | — | — | Pass-through MapLibre map options exposed at profile level. |
| `mapOptions.preserveDrawingBuffer` | boolean | — | — | — | — |

## `geoleaf-config.schema.json`

_GeoLeaf Root Config_

geoleaf.config.json — root configuration file loaded at application startup. Hardened in Sprint S1 (Profile Contract v1, PRF-SCHEMA). modules.<id> blocks stay open (plugin-owned, INV-CONFIG).

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `data` | object | — | — | — | Profile and data configuration. |
| `data.activeProfile` | string | — | — | — | Name of the active profile to load (must match a directory in profiles/). |
| `data.availableProfiles` | array | — | — | — | INJECTÉE PAR LE BUILD, jamais écrite à la main : inventaire des profils réellement embarqués dans la variante, récolté au moment de la copie et lu par le sélecteur de profil. ⚠️ Elle n'a de sens que dans un artefact déployé — la source ne sait pas ce qu'une variante embarquera. Déclarée ici parce que le bloc est `additionalProperties: false` et que la configuration déployée doit valider. |
| `data.availableProfiles[].displayLabel` | string | oui | — | — | Libellé court du sélecteur. Le build le dérive de `displayLabel`, à défaut `label`, à défaut l'identifiant — il est donc toujours présent. |
| `data.availableProfiles[].icon` | string | — | — | — | Emoji facultatif rendu devant le libellé. Omis, et non vide, quand le profil n'en déclare pas. |
| `data.availableProfiles[].id` | string | oui | — | — | Identifiant du profil, égal au nom de son répertoire sous `profiles/`. |
| `data.enableProfilePoiMapping` | boolean | — | `false` | — | Enable POI data normalization via mapping.json. |
| `data.profileBundle` | object | — | — | — | The active profile handed over in memory instead of being fetched. Carries both on-disk artefacts: `profile` (profile.json) and `bundle` (profile-bundle.json). Present, no HTTP request is issued for the profile configuration; absent, the cascade stays the default path. |
| `data.profilesBasePath` | string | — | `"profiles"` | — | Base path to the profiles directory. |
| `debug` | boolean | — | `false` | — | Enable verbose debug logging and cache-bust (?t=timestamp) on config requests. |
| `logging` | object | — | — | — | Logging verbosity. |
| `logging.level` | string | — | `"info"` | "debug" \| "info" \| "warn" \| "error" \| "production" | Minimum log level displayed in console. |
| `modules` | object | — | — | — | Per-plugin configuration blocks, keyed by module id (Plugin Contract v1, INV-CONFIG). Usually declared in the profile — see profile.schema.json for the known module ids. |

## `layer-config.schema.json`

_GeoLeaf Layer Config_

Per-layer configuration file (layers/*/[name]_config.json). Defines data source, styles, popup, table, clustering. Hardened in Sprint S1 (PRF-SCHEMA). Polymorphic / plugin-extended blocks (data, popup.fields, sidepanelConfig.detailLayout, realtimeLayer, write) stay permissive — see PROFILE_CONTRACT_SPEC §7. ⚠️ `formSchema` was in that list until task 7.2 and is GONE, key and all: it was a second field list, parallel to `attributes.fields[]` and reconciled with it by nothing. Capture is now a projection of the single list (`attributes.fields[].edit`), which is strict rather than permissive. Aliases geometryType↔geometry and tooltipMode↔tooltip.mode are tolerated and flagged in the anomaly registry.

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `attributes` | object | — | — | — | The layer's attribute model: one list of fields, two projections (`display` for reading, `edit` for capture). Lives at the layer root rather than under `capabilities` so the edition rule below stays pure JSON Schema and no entry can outlive its layer. Types mirror contracts/attributes.contract.ts. |
| `attributes.fields` | array | oui | — | — | The fields, in declaration order. |
| `attributes.fields[].computed` | string | — | — | "geometry.length" \| "geometry.area" \| "geometry.centroid" \| "geometry.vertexCount" | Fills the value from the drawn geometry instead of from user input. |
| `attributes.fields[].display` | object | — | — | — | Reading projection. Omitted when the field is capture-only. |
| `attributes.fields[].display.mode` | string | — | `"rendered"` | "rendered" \| "raw" | There is deliberately no mode delegating reading to field-renderer: capture is its role, reading belongs to the core. |
| `attributes.fields[].display.presentation` | object | — | — | — | Presentation modifiers that belong to the SURFACE, not to the value — which is why they are not per-widget options. |
| `attributes.fields[].display.presentation.accordion` | boolean | — | — | — | Wraps the field in a collapsible section. Side panel only. |
| `attributes.fields[].display.presentation.defaultOpen` | boolean | — | — | — | Whether that collapsible section starts open. Meaningless without `accordion`. |
| `attributes.fields[].display.presentation.emphasis` | string | — | — | "title" \| "category" \| "subcategory" | The ONLY three values the render code branches on, out of the 29 the legacy `FieldStyle` union declared. The other 26 produced neither a branch nor a CSS class — measured, and the reason they are not carried over. |
| `attributes.fields[].display.presentation.hero` | boolean | — | — | — | Lifts an image out of the field flow, as a header image. `image` widget, side panel only. |
| `attributes.fields[].display.surfaces` | array | oui | — | — | The three surfaces are addressable one by one. A single 'displayed yes/no' boolean is refused: it could not express 'in the side panel, not in the tooltip'. |
| `attributes.fields[].edit` | object | — | — | — | Capture projection. Declaring it on ANY field triggers the A14 rule at layer level. `widget` and `options` are OVERRIDES: absent, the capture reuses the field-level pair — true for 10 of the 11 fields migrated at task 7.2, which is why they are optional rather than required. |
| `attributes.fields[].edit.options` | `attributeOptions` | — | — | — | Options of the CAPTURE widget. `dependencies` above makes `widget` mandatory alongside it — an options bag with no capture widget would be typed by the reading widget, that is, by something other than what it configures. |
| `attributes.fields[].edit.options.actionId` | string | — | — | — | `action` only — identifier carried in the emitted event. Opaque to the core: never interpreted, only forwarded. |
| `attributes.fields[].edit.options.addLabel` | string | — | — | — | — |
| `attributes.fields[].edit.options.columns` | array | — | — | — | — |
| `attributes.fields[].edit.options.columns[].key` | string | oui | — | — | — |
| `attributes.fields[].edit.options.columns[].label` | string | oui | — | — | — |
| `attributes.fields[].edit.options.confirm` | string | — | — | — | `action` only — literal confirmation text shown before the event is emitted. |
| `attributes.fields[].edit.options.confirmKey` | string | — | — | — | `action` only — i18n key of the confirmation text. Takes precedence over `confirm`. |
| `attributes.fields[].edit.options.currencies` | array | — | — | — | — |
| `attributes.fields[].edit.options.emptyLabel` | string | — | — | — | — |
| `attributes.fields[].edit.options.fetchOptions` | string | — | — | — | — |
| `attributes.fields[].edit.options.firstDay` | string | — | — | "mon" \| "tue" \| "wed" \| "thu" \| "fri" \| "sat" \| "sun" | — |
| `attributes.fields[].edit.options.format` | string | — | — | "integer" \| "decimal" | — |
| `attributes.fields[].edit.options.halfStars` | boolean | — | — | — | — |
| `attributes.fields[].edit.options.locale` | string | — | — | — | — |
| `attributes.fields[].edit.options.max` | number \| string | — | — | — | — |
| `attributes.fields[].edit.options.maxCount` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxItems` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxLength` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxReviews` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxRows` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxSizeMb` | number | — | — | — | Taille VISÉE après compression, en Mo (défaut 5). Une image plus lourde est redimensionnée et recompressée pour tenir sous cette borne ; elle n'est refusée que si elle dépasse 5 fois cette valeur AVANT compression, ou si elle dépasse encore après. ⚠️ Ce n'était un plafond de refus sec que jusqu'à la tâche 5.1-d — une photo de téléphone (4 à 12 Mo) était alors refusée sans recours. |
| `attributes.fields[].edit.options.maxStars` | number | — | — | — | — |
| `attributes.fields[].edit.options.maxTags` | number | — | — | — | — |
| `attributes.fields[].edit.options.min` | number \| string | — | — | — | — |
| `attributes.fields[].edit.options.minItems` | number | — | — | — | — |
| `attributes.fields[].edit.options.minTags` | number | — | — | — | — |
| `attributes.fields[].edit.options.multiple` | boolean | — | — | — | — |
| `attributes.fields[].edit.options.options` | array | — | — | — | — |
| `attributes.fields[].edit.options.options[].label` | string | oui | — | — | — |
| `attributes.fields[].edit.options.options[].value` | string | oui | — | — | — |
| `attributes.fields[].edit.options.ordered` | boolean | — | — | — | — |
| `attributes.fields[].edit.options.payloadFields` | array | — | — | — | `action` only — whitelist of properties joined to the emitted event. ⚠️ Without it, NO property is joined: the event is a document event any script on the page can listen to, so the default goes to confidentiality. |
| `attributes.fields[].edit.options.placeholder` | string | — | — | — | — |
| `attributes.fields[].edit.options.prefix` | string | — | — | — | — |
| `attributes.fields[].edit.options.requiresPlugin` | string | — | — | — | `action` only — the button is NOT rendered when the named plugin is absent. |
| `attributes.fields[].edit.options.restricted` | boolean | — | — | — | — |
| `attributes.fields[].edit.options.rows` | number | — | — | — | — |
| `attributes.fields[].edit.options.showLabel` | boolean | — | — | — | — |
| `attributes.fields[].edit.options.step` | number | — | — | — | — |
| `attributes.fields[].edit.options.suffix` | string | — | — | — | — |
| `attributes.fields[].edit.options.unit` | string | — | — | — | — |
| `attributes.fields[].edit.options.uploadEndpoint` | string | — | — | — | — |
| `attributes.fields[].edit.required` | boolean | — | — | — | — |
| `attributes.fields[].edit.widget` | string | — | — | "badge" \| "checkbox" \| "coordinates" \| "date" \| "dropdown" \| "email" \| "gallery" \| "hours" \| "image" \| "link" \| "list" \| "longtext" \| "metric" \| "number" \| "phone" \| "price" \| "radio" \| "rating" \| "reviews" \| "table" \| "tags" \| "text" \| "url" | Capture widget, when it differs from the reading one. `action` is absent from this list on purpose: field-renderer registers no action component, so it has no capture form at all. |
| `attributes.fields[].field` | string | oui | — | — | Dotted path to the value inside the feature (e.g. "properties.statut"). |
| `attributes.fields[].label` | string | oui | — | — | — |
| `attributes.fields[].options` | `attributeOptions` | — | — | — | — |
| `attributes.fields[].options.actionId` | string | — | — | — | `action` only — identifier carried in the emitted event. Opaque to the core: never interpreted, only forwarded. |
| `attributes.fields[].options.addLabel` | string | — | — | — | — |
| `attributes.fields[].options.columns` | array | — | — | — | — |
| `attributes.fields[].options.columns[].key` | string | oui | — | — | — |
| `attributes.fields[].options.columns[].label` | string | oui | — | — | — |
| `attributes.fields[].options.confirm` | string | — | — | — | `action` only — literal confirmation text shown before the event is emitted. |
| `attributes.fields[].options.confirmKey` | string | — | — | — | `action` only — i18n key of the confirmation text. Takes precedence over `confirm`. |
| `attributes.fields[].options.currencies` | array | — | — | — | — |
| `attributes.fields[].options.emptyLabel` | string | — | — | — | — |
| `attributes.fields[].options.fetchOptions` | string | — | — | — | — |
| `attributes.fields[].options.firstDay` | string | — | — | "mon" \| "tue" \| "wed" \| "thu" \| "fri" \| "sat" \| "sun" | — |
| `attributes.fields[].options.format` | string | — | — | "integer" \| "decimal" | — |
| `attributes.fields[].options.halfStars` | boolean | — | — | — | — |
| `attributes.fields[].options.locale` | string | — | — | — | — |
| `attributes.fields[].options.max` | number \| string | — | — | — | — |
| `attributes.fields[].options.maxCount` | number | — | — | — | — |
| `attributes.fields[].options.maxItems` | number | — | — | — | — |
| `attributes.fields[].options.maxLength` | number | — | — | — | — |
| `attributes.fields[].options.maxReviews` | number | — | — | — | — |
| `attributes.fields[].options.maxRows` | number | — | — | — | — |
| `attributes.fields[].options.maxSizeMb` | number | — | — | — | Taille VISÉE après compression, en Mo (défaut 5). Une image plus lourde est redimensionnée et recompressée pour tenir sous cette borne ; elle n'est refusée que si elle dépasse 5 fois cette valeur AVANT compression, ou si elle dépasse encore après. ⚠️ Ce n'était un plafond de refus sec que jusqu'à la tâche 5.1-d — une photo de téléphone (4 à 12 Mo) était alors refusée sans recours. |
| `attributes.fields[].options.maxStars` | number | — | — | — | — |
| `attributes.fields[].options.maxTags` | number | — | — | — | — |
| `attributes.fields[].options.min` | number \| string | — | — | — | — |
| `attributes.fields[].options.minItems` | number | — | — | — | — |
| `attributes.fields[].options.minTags` | number | — | — | — | — |
| `attributes.fields[].options.multiple` | boolean | — | — | — | — |
| `attributes.fields[].options.options` | array | — | — | — | — |
| `attributes.fields[].options.options[].label` | string | oui | — | — | — |
| `attributes.fields[].options.options[].value` | string | oui | — | — | — |
| `attributes.fields[].options.ordered` | boolean | — | — | — | — |
| `attributes.fields[].options.payloadFields` | array | — | — | — | `action` only — whitelist of properties joined to the emitted event. ⚠️ Without it, NO property is joined: the event is a document event any script on the page can listen to, so the default goes to confidentiality. |
| `attributes.fields[].options.placeholder` | string | — | — | — | — |
| `attributes.fields[].options.prefix` | string | — | — | — | — |
| `attributes.fields[].options.requiresPlugin` | string | — | — | — | `action` only — the button is NOT rendered when the named plugin is absent. |
| `attributes.fields[].options.restricted` | boolean | — | — | — | — |
| `attributes.fields[].options.rows` | number | — | — | — | — |
| `attributes.fields[].options.showLabel` | boolean | — | — | — | — |
| `attributes.fields[].options.step` | number | — | — | — | — |
| `attributes.fields[].options.suffix` | string | — | — | — | — |
| `attributes.fields[].options.unit` | string | — | — | — | — |
| `attributes.fields[].options.uploadEndpoint` | string | — | — | — | — |
| `attributes.fields[].primitive` | string | oui | — | "string" \| "number" \| "boolean" \| "string[]" \| "object" \| "object[]" | What the value IS in the GeoJSON. ⚠️ `badge`, `link` and `price` hold OBJECTS, not scalars — handing one to a plain text renderer is what produces `[object Object]`. |
| `attributes.fields[].widget` | string | oui | — | "action" \| "badge" \| "checkbox" \| "coordinates" \| "date" \| "dropdown" \| "email" \| "gallery" \| "hours" \| "image" \| "link" \| "list" \| "longtext" \| "metric" \| "number" \| "phone" \| "price" \| "radio" \| "rating" \| "reviews" \| "table" \| "tags" \| "text" \| "url" | 23 components registered by field-renderer, plus `action` — which is NOT one: field-renderer has no action component. It is a core-only reading widget, a button emitting `geoleaf:popup:action`. This list is the reference vocabulary; the core render tables align on it. |
| `attributes.titleField` | string | — | — | — | Dotted path of the field whose value titles the popup and the side panel. |
| `capabilities` | object | — | — | — | Plugin capability bindings keyed by capability id. `feature-info` is typed below because it is the LEGACY attribute model, superseded by the root `attributes` block: it stays valid for the migration window (both shapes are live) and disappears with the dry switch. Any other capability id stays opaque and plugin-owned. |
| `clustering` | object | — | — | — | Point clustering configuration. |
| `clustering.disableClusteringAtZoom` | number | — | — | — | — |
| `clustering.enabled` | boolean | — | — | — | — |
| `clustering.maxClusterRadius` | number | — | — | — | — |
| `data` | object | — | — | — | Data source configuration. Extensible block (local GeoJSON, remote URL, vector tiles, realtime, OGC…) — kept permissive; full inventory in B5/B7. |
| `data.autoRefresh` | boolean \| number | — | — | — | — |
| `data.dataUrl` | string | — | — | — | Remote GeoJSON URL fetched by the core loader (WFS, opendata APIs). Read by geojson/loader/profile.ts:81 and theme-applier/deferred.ts:270. |
| `data.directory` | string | — | — | — | Relative directory containing data files (local layers). |
| `data.file` | string | — | — | — | GeoJSON filename. |
| `data.format` | string | — | — | — | — |
| `data.headers` | object | — | — | — | Arbitrary HTTP headers for remote fetches. |
| `data.itemsPath` | string | — | — | — | Dot-path to the items array inside a non-array response (e.g. "results" for the GBIF Occurrence API). Used with `mapping` when the raw response wraps the array. |
| `data.licence` | string | — | — | — | Data licence label. |
| `data.limit` | number | — | — | — | — |
| `data.mapping` | oneOf | — | — | — | Name of a per-source block declared in mapping.json (string, e.g. "gbif"). When set, raw fetched data is normalized to the GeoLeaf POI shape via that block before rendering. (A legacy inline object form is tolerated.) |
| `data.mappingFile` | string | — | — | — | — |
| `data.ogcApi` | object | — | — | — | OGC API Features source — when present, the layer is loaded from an OGC API Features endpoint (single-layer.ts → _loadFromOgcApi). |
| `data.ogcApi.autoRefresh` | boolean | — | — | — | Re-fetch on moveend (viewport bbox). Default false. |
| `data.ogcApi.autoRefreshDebounce` | number | — | — | — | Debounce (ms) for moveend refreshes. Default 300. |
| `data.ogcApi.bbox` | array | — | — | — | BBox filter [minLon, minLat, maxLon, maxLat] (WGS-84). |
| `data.ogcApi.collectionId` | string | — | — | — | Collection id appended as /collections/{id}/items when `url` lacks the items path. |
| `data.ogcApi.cursorPath` | string | — | — | — | Dot-path to the next-page cursor in the response envelope (e.g. "pagination.next_cursor"). Consulted before the standard links[rel=next] relation; when absent, that relation drives pagination alone. The resolved value must be an absolute http(s) URL — anything else stops pagination with a warning. |
| `data.ogcApi.headers` | object | — | — | — | Additional HTTP request headers (e.g. Authorization). |
| `data.ogcApi.limit` | number | — | — | — | Features per page (limit query param). Default 1000. |
| `data.ogcApi.maxFeatures` | number | — | — | — | Max features accumulated across pages (anti-DoS). Default 10000. |
| `data.ogcApi.url` | string | oui | — | — | Base endpoint URL of the OGC API Features service (may include the collection items path). |
| `data.realtime` | object | — | — | — | Realtime data block (realtime-layer/websocket plugins) — kept permissive (plugin-owned). |
| `data.url` | string | — | — | — | Source URL of a PLUGIN-BACKED layer (e.g. flatgeobuf), resolved by the plugin rather than the core loader. ⚠️ NOT an alias of `dataUrl`, despite having been described as one until 02/08/2026: theme-applier/deferred.ts:265 reads it ONLY when `plugin` is set, and falls through to `dataUrl` otherwise. The two keys select two different loaders — merging them would break the plugin path. Convergence tracked in the backlog, not done in passing. |
| `data.vectorTiles` | object | — | — | — | Optional vector tile source (MVT). |
| `data.vectorTiles.enabled` | boolean | — | — | — | — |
| `data.vectorTiles.interactive` | boolean | — | — | — | — |
| `data.vectorTiles.layerName` | string | — | — | — | — |
| `data.vectorTiles.maxNativeZoom` | number | — | — | — | — |
| `data.vectorTiles.maxZoom` | number | — | — | — | — |
| `data.vectorTiles.minZoom` | number | — | — | — | — |
| `data.vectorTiles.scheme` | string | — | — | "xyz" \| "tms" | Tile grid scheme (vector-tiles.ts). "xyz" (MapLibre default, y-down) or "tms" (y-up — e.g. IGN Géoplateforme). |
| `data.vectorTiles.tilesDirectory` | string | — | — | — | — |
| `data.vectorTiles.tilesUrl` | string | — | — | — | Remote tile URL — MVT template ({z}/{x}/{y}) or .pmtiles file. |
| `editableGeometryTypes` | array | — | — | — | Allowed geometry types for edition, in CANONICAL GeoJSON casing. ⚠️ This is NOT the same vocabulary as `geometry`/`geometryType`, which are domain lowercase — the two are deliberately kept apart (contracts/attributes.contract.ts: GeometryCanonicalType vs GeometryDomainName). The editor maps a drawing mode back to this casing (editor mode-names.ts geometryTypeForMode), so a lowercase value here matches nothing and drops the layer out of the edition picker with no error. The enum is what makes that failure loud. |
| `edition` | object | — | — | — | What this layer permits, PER OPERATION. Replaces the pair `enableEdition`/`enableEditionFull`: the second name did not mean what it said — it was read once usefully, as `canDelete()`, so "full edition" was in fact the right to DELETE. ⚠️ ABSENT MEANS REFUSED, and so does an empty object: declaring the block grants nothing. Each key is independent — `update` does not imply `delete`, `create` does not imply `update`. Deriving one from another is the exact mechanism by which the old pair acquired a name that lied. ✅ Since 07/08/2026 the permission is enforced on EVERY write path, online included: the editor's persistence factory wraps all four of its outputs with a gate that consults `GeoLeaf.Storage.mayEdit()` before choosing a route, so `online`, `offline`, `auto` and the `collection` dialect are all covered. It was previously enforced on the offline path only, and a connected user could delete from a layer declaring `delete: false`. ⚠️ Still true: the editor toolbar gates its delete TOOL on its own `enabledTools`, never on the layer — the button may be offered where the write is refused. |
| `edition.create` | boolean | — | — | — | Right to create a feature. Absent or false = refused. |
| `edition.delete` | boolean | — | — | — | Right to delete a feature — what `enableEditionFull` actually gated. |
| `edition.update` | boolean | — | — | — | Right to modify an existing feature. Absent or false = refused. |
| `geometry` | string | — | — | "polygon" \| "polyline" \| "line" \| "point" \| "multipolygon" \| "multiline" \| "multipoint" \| "fill-extrusion" | Geometry type of this layer's features. |
| `geometryType` | string | — | — | "polygon" \| "polyline" \| "line" \| "point" \| "multipolygon" \| "multiline" \| "multipoint" \| "fill-extrusion" | Root-level alias of `geometry`. Canonical form READ BY THE CODE (editor layer-dropdown.ts, storage data-fetching.ts) — do NOT migrate (ANO-007). Enum mirrors `geometry` (gate-safe: profile values ⊆ enum). |
| `id` | string | oui | — | — | Unique layer identifier. Must match the key in layers.json. |
| `interactiveShape` | boolean | — | — | — | Whether features are clickable/hoverable. |
| `label` | string | — | — | — | Display label shown in the layer manager. |
| `legends` | object | — | — | — | Legend file references for this layer (unused by current profiles). |
| `legends.default` | string | — | — | — | Filename of the default legend. |
| `legends.directory` | string | — | `"legends"` | — | Relative directory containing legend JSON files. |
| `offline` | object | — | — | — | Per-layer offline READ declaration (task 4.3). `enabled: true` makes the layer loader read its entities from the IndexedDB `features` store instead of refetching. ⚠️ Declares a READ, never write access: contract invariant S6 — pull never grants editability, which is decided by the layer's online edition flags alone. A layer whose store is empty falls back to the network, so declaring is safe before the first pull. |
| `offline.enabled` | boolean | oui | — | — | Gate. When false or absent the layer always loads from the network. |
| `offline.maxAgeMs` | integer | — | — | — | Staleness threshold in milliseconds (task 4.8). A layer whose last successful pull is older than this is reported `pulledStale` by GeoLeaf.Storage.getSyncReport(). ⚠️ Deliberately WITHOUT a default: absent means a pulled layer is reported `pulled` forever. Inventing a default would make the report raise staleness warnings no integrator asked for and none could silence — a status that cannot be computed is not guessed. |
| `offline.maxFeatures` | integer | — | — | — | Hard cap on entities pulled for this layer (LayerSyncConfig.maxFeatures). Enforced by the pull as a HARD truncation: the OGC loader stops only after accumulating a whole page and never truncates, so without this cut a cap of 15 with a server page of 10 would store 20. |
| `offline.source` | object | — | — | — | Where `GeoLeaf.Storage.pullLayer()` fetches this layer's entities — an OGC API Features collection. 🛑 Deliberately NOT `data.ogcApi`, and the reason is measured: `data.*` is the DISPLAY source, and the loader's `data.ogcApi` early exit returns before the local-read branch of task 4.3, silently bypassing the very store this pull fills. `loader/profile.ts` also drops a layer whose only source is `ogcApi`. After a pull, the display source IS the local store — the two are different by nature. |
| `offline.source.collectionId` | string | — | — | — | Collection to pull. Defaults to the layer id when absent. |
| `offline.source.url` | string | oui | — | — | Landing URL of the OGC API Features service (e.g. https://host/ogc). The collection path is appended from `collectionId`. |
| `offline.source.versionProperty` | string | — | — | — | Feature property carrying the per-entity freshness marker recorded as VersionMarker (kind `timestamp`), which task 4.6 compares. Defaults to `updated_at`. Declarable because it varies by backend — the sync contract names `updated_at` and `write_date` among the forms it has seen. |
| `plugin` | string | — | — | — | Optional plugin tag associated with this layer. |
| `realtimeLayer` | object | — | — | — | Per-layer realtime plugin block (realtime-layer/websocket) — plugin-owned, kept permissive. Architectural question (per-layer block vs modules.<id>) tracked in B7. |
| `showIconsOnMap` | boolean | — | — | — | Show custom icons on the map (requires taxonomy icon config). |
| `styles` | object | — | — | — | Style references for this layer. |
| `styles.available` | array | — | — | — | All available styles for this layer. |
| `styles.available[].file` | string | oui | — | — | — |
| `styles.available[].id` | string | oui | — | — | — |
| `styles.available[].label` | string | — | — | — | — |
| `styles.default` | string | oui | — | — | Filename of the default style (e.g. "defaut.json"). |
| `styles.directory` | string | oui | — | — | Relative directory containing style JSON files. |
| `table` | object | — | — | — | Data table panel configuration. |
| `table.columns` | array | — | — | — | — |
| `table.columns[].field` | string | oui | — | — | — |
| `table.columns[].label` | string | — | — | — | — |
| `table.columns[].sortable` | boolean | — | — | — | — |
| `table.columns[].width` | string | — | — | — | — |
| `table.defaultSort` | object | — | — | — | — |
| `table.defaultSort.field` | string | — | — | — | — |
| `table.defaultSort.order` | string | — | — | "asc" \| "desc" | — |
| `table.enabled` | boolean | — | — | — | — |
| `table.searchFields` | array | — | — | — | — |
| `type` | string | — | — | — | Optional layer type tag (semantics under inventory — see anomaly registry). |
| `write` | object | — | — | — | Per-layer write target: where this layer's edits are pushed. Declared per layer because on many backends each layer is a distinct collection. ⚠️ Was `additionalProperties: true` and set by 0 layers on 48 until 02/08/2026 — a block with no shape that nobody filled. Shape mirrors contracts/sync.contract.ts (LayerWriteTarget) and what the persistence adapters actually read. |
| `write.auth` | string | — | — | "csrf" \| "bearer" \| "none" | How the endpoint is authenticated. |
| `write.dialect` | string | — | `"rest"` | "rest" \| "collection" | `rest`: POST {poi, timestamp} envelope, CSRF header. `collection`: flat {...properties, geom} body (OGC API Features style), auth delegated to the connector. Exactly the two the code dispatches on — a third value would be indistinguishable from a typo. |
| `write.enabled` | boolean | oui | — | — | Gate. A layer whose write target is disabled has no outbox. |
| `write.endpoint` | string | — | — | — | URL edits are pushed to. |
| `write.geometryProperty` | string | — | `"geom"` | — | Property key carrying the geometry in a `collection` body. |
| `write.properties` | array | — | — | — | Whitelist of property keys sent in a `collection` body. |
| `zIndex` | number | — | — | — | Rendering z-order. Higher values render on top. |

## `layers.schema.json`

_GeoLeaf Layers Index_

layers.json — index of all layers loaded for a GeoLeaf profile. Hardened in Sprint S1 (PRF-SCHEMA). layerTemplates[].template/.instances stay permissive (partial layer-config, merged at runtime — see PROFILE_CONTRACT_SPEC §7).

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `layers` | array | — | — | — | Individual layer references. Each entry points to a layer config file. |
| `layers[].configFile` | string | — | — | — | Relative path to the layer config JSON file. |
| `layers[].defaultVisible` | boolean | — | — | — | Whether the layer is visible on load. |
| `layers[].id` | string | oui | — | — | Unique layer identifier. |
| `layers[].label` | string | — | — | — | Optional display label override (otherwise read from the layer config). |
| `layers[].layerManagerId` | string | — | — | — | Layer manager section this layer belongs to. |
| `layers[].order` | number | — | — | — | Optional ordering hint within the layer manager section. |
| `layerTemplates` | array | — | — | — | Layer templates: one template expanded into N individual layer configs at runtime. |
| `layerTemplates[].instances` | array | oui | — | — | One entry per expanded layer. Merged with template at runtime — kept permissive (per-instance layer-config overrides). |
| `layerTemplates[].instances[].dataFile` | string | oui | — | — | Data file name relative to the template's data.directory. |
| `layerTemplates[].instances[].id` | string | oui | — | — | Unique layer ID for this instance. |
| `layerTemplates[].instances[].label` | string | oui | — | — | Display label for this instance. |
| `layerTemplates[].layerManagerId` | string | — | — | — | Layer manager section for all instances. |
| `layerTemplates[].template` | object | oui | — | — | Base layer config shared by all instances. Partial layer-config — kept permissive (additionalProperties:true) because it carries arbitrary layer-config keys merged at runtime. |
| `layerTemplates[].template.clustering` | object | — | — | — | — |
| `layerTemplates[].template.clustering.disableClusteringAtZoom` | number | — | — | — | — |
| `layerTemplates[].template.clustering.enabled` | boolean | — | — | — | — |
| `layerTemplates[].template.clustering.maxClusterRadius` | number | — | — | — | — |
| `layerTemplates[].template.data` | object | — | — | — | — |
| `layerTemplates[].template.data.directory` | string | — | — | — | — |
| `layerTemplates[].template.geometry` | string | — | — | "polygon" \| "line" \| "point" \| "multipolygon" | — |
| `layerTemplates[].template.styles` | object | — | — | — | — |
| `layerTemplates[].template.styles.available` | array | — | — | — | — |
| `layerTemplates[].template.styles.default` | string | — | — | — | — |
| `layerTemplates[].template.styles.directory` | string | — | — | — | — |
| `layerTemplates[].template.table` | object | — | — | — | — |
| `layerTemplates[].template.table.enabled` | boolean | — | — | — | — |
| `layerTemplates[].template.zIndex` | number | — | — | — | — |
| `layerTemplates[].templateId` | string | oui | — | — | Identifier for this template group. |

## `mapping.schema.json`

_GeoLeaf Data Mapping_

mapping.json — POI data normalization contract consumed by ConfigNormalizer.normalizePoiWithMapping. ALWAYS multi-source: an object of named per-source blocks { <sourceId>: { mapping, ... } }. A single source is simply one block — there is NO special-case top-level form. Each `mapping` is a FLAT object { normalizedField : "rawSourceField" } — keys are normalized GeoLeaf fields with dotted paths allowed (e.g. "id", "title", "location.lat", "attributes.kind"), values are raw source field names (strings). Per-source contract finalized in Archi S2 — ANO-083.

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |

## `profile.schema.json`

_GeoLeaf Profile_

profile.json — core profile metadata and configuration. UI, basemaps, search and table config live in separate files referenced via the Files section. Hardened in Sprint S1 (Profile Contract v1, PRF-SCHEMA): additionalProperties:false on fixed-shape objects, _comment* tolerated. modules.<id> blocks stay open (plugin-owned, INV-CONFIG).

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `bundleFile` | string | — | — | — | INJECTÉE PAR LE BUILD, jamais écrite à la main : nom du bundle de configuration agrégé, déposé à côté de ce fichier par l'étape de groupage. ⚠️ Elle n'existe que dans les profils DÉPLOYÉS ; un profil de `profiles/` qui la porte est le signe qu'un artefact a été recopié vers la source. Déclarée ici parce que le schéma est `additionalProperties: false` et que le profil déployé doit valider — sans quoi le build produit, à chaque exécution, un artefact que le schéma du dépôt interdit. |
| `description` | string | — | — | — | Profile description. |
| `displayLabel` | string | — | — | — | Short label shown in the profile switcher (capability `profile-switcher`). Optional — falls back to `label`, then to the profile id. Kept separate from `label` because the latter is descriptive ('Réseau ferroviaire France') where a selector needs to be terse ('France Rail'). |
| `Files` | object | — | — | — | Relative paths to companion config files loaded at startup (profile layout v2: config/core/*.json + config/plugins/<moduleId>.json). |
| `Files.basemapsFile` | string | — | — | — | Path to the basemaps file (layout v2: config/core/basemaps.json). |
| `Files.featuresFile` | string | — | — | — | Path to the core features file (mapOptions…) — spread at the merged profile root (layout v2: config/core/features.json). |
| `Files.layersFile` | string | — | — | — | Path to the layers registry (layout v2: config/core/layers.json). |
| `Files.mappingFile` | string | — | — | — | Path to the POI data normalization mapping (multi-source named blocks — layout v2: config/core/mapping.json). Consumed by ConfigNormalizer for layers declaring data.mapping. |
| `Files.modules` | object | — | — | — | Module id -> plugin config file path (layout v2: config/plugins/<moduleId>.json). Each file content is merged into modules.<id> (Plugin Contract v1, INV-CONFIG). |
| `Files.themesFile` | string | — | — | — | Path to the themes file (layout v2: config/core/themes.json). |
| `Files.uiFile` | string | — | — | — | Path to the UI config file (layout v2: config/core/ui.json). |
| `icon` | string | — | — | — | Emoji shown before the label in the profile switcher. Optional — absent renders the label alone. |
| `id` | string | oui | — | — | Unique profile identifier. Must match the directory name. |
| `label` | string | — | — | — | Human-readable profile label. |
| `map` | object | — | — | — | Map view configuration. |
| `map.bounds` | array | — | — | — | Geographic bounds [[south, west], [north, east]]. |
| `map.boundsMargin` | number | — | — | — | — |
| `map.center` | array | — | — | — | — |
| `map.initialMaxZoom` | number | — | — | — | Alias for maxZoom (legacy). |
| `map.maxPitch` | number | — | — | — | Maximum map pitch in degrees (0-85). MapLibre default: 60. |
| `map.maxZoom` | number | — | — | — | — |
| `map.minZoom` | number | — | — | — | — |
| `map.padding` | oneOf | — | — | — | Map padding — array [vertical, horizontal] or object {top, right, bottom, left}. |
| `map.padding.bottom` | number | — | — | — | — |
| `map.padding.left` | number | — | — | — | — |
| `map.padding.right` | number | — | — | — | — |
| `map.padding.top` | number | — | — | — | — |
| `map.positionFixed` | boolean | — | — | — | — |
| `map.zoom` | number | — | — | — | — |
| `modules` | object | — | — | — | Per-plugin configuration blocks, keyed by module id (Plugin Contract v1, INV-CONFIG). The keys inside each block are owned and validated by the plugin, not by the core — each block stays additionalProperties:true on purpose. |
| `modules.cog` | object | — | — | — | Owned by @geoleaf-plugins/cog — keys validated by the plugin, not the core. |
| `modules.connector` | object | — | — | — | Owned by @geoleaf-plugins/connector — keys validated by the plugin, not the core. |
| `modules.editor` | object | — | — | — | Owned by @geoleaf-plugins/editor — keys validated by the plugin, not the core. |
| `modules.fileImport` | object | — | — | — | Owned by @geoleaf-plugins/file-import — keys validated by the plugin, not the core. |
| `modules.flatgeobuf` | object | — | — | — | Owned by @geoleaf-plugins/flatgeobuf — keys validated by the plugin, not the core. |
| `modules.geocoding` | object | — | — | — | Owned by @geoleaf-plugins/geocoding — keys validated by the plugin, not the core. |
| `modules.measure` | object | — | — | — | Owned by @geoleaf-plugins/measure — keys validated by the plugin, not the core. |
| `modules.offline` | object | — | — | — | In-core offline capability (S14 Phase B) — modules.offline.{enabled,cache}. Kept additionalProperties:true (opaque to the schema). |
| `modules.print` | object | — | — | — | Owned by @geoleaf-plugins/print — keys validated by the plugin, not the core. |
| `modules.realtimeLayer` | object | — | — | — | Owned by @geoleaf-plugins/realtime-layer — keys validated by the plugin, not the core. |
| `modules.routing` | object | — | — | — | Owned by @geoleaf-plugins/routing — keys validated by the plugin, not the core. ⚠️ `labelField` names a feature property that must ALSO appear in the `payloadFields` of the `action` widget declaring the entry-point button: the two are a cross-file rule no schema expresses, and a profile valid on both sides can still render a panel with no destination name. |
| `modules.websocket` | object | — | — | — | Owned by @geoleaf-plugins/websocket — keys validated by the plugin, not the core. |
| `version` | string | — | — | — | Profile version (SemVer). |

## `style.schema.json`

_GeoLeaf Layer Style_

Style definition for a GeoLeaf layer (flat format). Used in layers/*/styles/*.json. Hardened in Sprint S1 (PRF-SCHEMA). `id` is no longer required (filename acts as id for ~20% of style files). The MapLibre pass-through key is `paint` (kept open); `style.extends` enables style inheritance. Known anomalies tolerated-but-flagged: `condition` alias of `when`, and root-level `paint`/`type` (misplaced) — see anomaly registry. (`labelScale` is NOT a duplicate of `scaleConfig`: same unit, but it gates the labels, not the layer.)

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `description` | string | — | — | — | Optional description for this style. |
| `id` | string | — | — | — | Unique identifier for this style (optional — defaults to the file name). |
| `label` | oneOf | — | — | — | — |
| `label.buffer` | object | — | — | — | — |
| `label.buffer.color` | string | — | `"#ffffff"` | — | — |
| `label.buffer.enabled` | boolean | — | `false` | — | — |
| `label.buffer.noFill` | boolean | — | — | — | — |
| `label.buffer.opacity` | number | — | `1` | — | — |
| `label.buffer.sizePx` | number | — | `2` | — | — |
| `label.color` | string | — | `"#000000"` | — | — |
| `label.enabled` | boolean | oui | — | — | Enable/disable labels for this style. |
| `label.field` | string | — | — | — | GeoJSON properties field name to display as label text. |
| `label.font` | object | — | — | — | — |
| `label.font.bold` | boolean | — | `false` | — | — |
| `label.font.family` | string | — | `"Arial"` | — | — |
| `label.font.italic` | boolean | — | `false` | — | — |
| `label.font.sizePt` | number | — | `12` | — | Label text size in points — LIVE (mapped to MapLibre text-size via _buildLabelSymbolLayout). The other font.* keys are not consumed by the MapLibre renderer. |
| `label.font.weight` | number | — | `50` | — | — |
| `label.opacity` | number | — | `1` | — | — |
| `label.visibleByDefault` | boolean | — | `false` | — | Labels visible on layer load without user action. |
| `labelScale` | object | — | — | — | Label visibility by scale range — LIVE feature (isScaleInRange in scale-utils.ts, consumed by labels.ts). minScale/maxScale are scale denominators, same unit as scaleConfig, but scoped to the layer's labels rather than the layer itself — NOT a duplicate. Cleanup of no-op {null,null} + reconciliation in S8. |
| `labelScale.maxScale` | number \| null | — | — | — | — |
| `labelScale.minScale` | number \| null | — | — | — | — |
| `legend` | object | — | — | — | Legend entry for this style. |
| `legend.label` | string | — | — | — | — |
| `scaleConfig` | object | — | — | — | Layer visibility by scale range. Bounds are SCALE DENOMINATORS (the X in 1:X), NOT MapLibre zoom levels — a denominator grows as you zoom OUT, so minScale is the widest view allowed and must be the LARGER number. Optional: omit for no constraint. Consumed by updateLayerVisibilityByZoom via isScaleInRange (scale-utils.ts). Replaces the retired `zoomConfig`, whose minZoom/maxZoom naming led authors to write zoom levels that the engine read as denominators — hiding those layers at every zoom (measured before the rename). |
| `scaleConfig.maxScale` | number \| null | — | — | — | Closest view allowed, as a scale denominator (e.g. 2252 for 1:2 252 ≈ zoom 18 at lat 4°). Hidden when zoomed in past it. null or 0 = no upper bound. |
| `scaleConfig.minScale` | number \| null | — | — | — | Widest view allowed, as a scale denominator (e.g. 9222148 for 1:9 222 148 ≈ zoom 6 at lat 4°). Hidden when zoomed out past it. null or 0 = no lower bound. |
| `style` | `flatStyle` | — | — | — | — |
| `style.casing` | object | — | — | — | Double-line casing effect (thick outline rendered behind the main stroke). |
| `style.casing.color` | string | — | — | — | — |
| `style.casing.dashArray` | string \| null | — | — | — | Dash pattern for the casing, e.g. "2 2". null = solid. |
| `style.casing.enabled` | boolean | — | — | — | — |
| `style.casing.lineCap` | string | — | — | "butt" \| "round" \| "square" | Casing line cap style. |
| `style.casing.lineJoin` | string | — | — | "bevel" \| "miter" \| "round" | Casing line join style. |
| `style.casing.opacity` | number | — | — | — | — |
| `style.casing.widthPx` | number | — | — | — | — |
| `style.color` | string | — | — | — | Stroke/line color (hex/CSS). |
| `style.dashArray` | string \| null | — | — | — | Dash pattern, e.g. "5 10". null = solid line. |
| `style.expressionPaint` | object | — | — | — | Native MapLibre GL paint properties (expression form) passed through as-is. |
| `style.extends` | string | — | — | — | Style id this rule-style inherits from (style inheritance). |
| `style.fillColor` | string | — | — | — | Fill color (hex/CSS). Polygon layers. |
| `style.fillExtrusionBase` | oneOf | — | — | — | Fill-extrusion base height in metres. Default: 0. |
| `style.fillExtrusionColor` | string | — | — | — | Fill-extrusion face color (hex/CSS). Required for fill-extrusion layers. |
| `style.fillExtrusionHeight` | oneOf | — | — | — | Fill-extrusion height in metres. Number = fixed value, string = feature field name. Required for fill-extrusion layers. |
| `style.fillExtrusionOpacity` | number | — | — | — | Fill-extrusion global opacity (0–1). Default: 1.0. |
| `style.fillOpacity` | number | — | — | — | Fill opacity (0–1). |
| `style.hatch` | object | — | — | — | Canvas-based hatch fill pattern. |
| `style.hatch.angleDeg` | number \| null | — | — | — | — |
| `style.hatch.enabled` | boolean | — | — | — | — |
| `style.hatch.renderMode` | string | — | — | "overlay" \| "pattern_only" | — |
| `style.hatch.spacingPx` | number | — | — | — | — |
| `style.hatch.stroke` | object | — | — | — | — |
| `style.hatch.stroke.color` | string | — | — | — | — |
| `style.hatch.stroke.opacity` | number | — | — | — | — |
| `style.hatch.stroke.widthPx` | number | — | — | — | — |
| `style.hatch.type` | string | — | — | — | — |
| `style.lineCap` | string | — | — | "butt" \| "round" \| "square" | Line cap style. |
| `style.lineJoin` | string | — | — | "bevel" \| "miter" \| "round" | Line join style. |
| `style.opacity` | number | — | — | — | Stroke opacity (0–1). |
| `style.paint` | object | — | — | — | Native MapLibre GL paint properties passed through as-is. Keys are MapLibre property names (e.g. "fill-color", "circle-radius"). |
| `style.radius` | number | — | — | — | Circle radius in pixels. Point layers. |
| `style.shape` | string | — | — | "circle" | Point shape. ONLY "circle" is supported. The key is currently inert — nothing reads it — and is kept as a reserved extension point. Previously typed as free-form text advertising "square", which the engine never rendered: MapLibre's `circle` layer draws circles only, and a square would require a whole second render path (a `symbol` layer over a generated SDF icon), plus re-implementing taxonomy paint, the pending-sync badge and styleRules on that path. Restricted so the schema stops promising a capability that does not exist. |
| `style.weight` | number | — | — | — | Stroke width in pixels. |
| `styleRules` | array | — | — | — | Data-driven style rules applied in order. First matching rule wins. |
| `styleRules[].label` | string | — | — | — | Optional human-readable rule label. |
| `styleRules[].legend` | object | — | — | — | — |
| `styleRules[].legend.label` | string | — | — | — | — |
| `styleRules[].legend.order` | number | — | — | — | — |
| `styleRules[].style` | `flatStyle` | oui | — | — | — |
| `styleRules[].style.casing` | object | — | — | — | Double-line casing effect (thick outline rendered behind the main stroke). |
| `styleRules[].style.casing.color` | string | — | — | — | — |
| `styleRules[].style.casing.dashArray` | string \| null | — | — | — | Dash pattern for the casing, e.g. "2 2". null = solid. |
| `styleRules[].style.casing.enabled` | boolean | — | — | — | — |
| `styleRules[].style.casing.lineCap` | string | — | — | "butt" \| "round" \| "square" | Casing line cap style. |
| `styleRules[].style.casing.lineJoin` | string | — | — | "bevel" \| "miter" \| "round" | Casing line join style. |
| `styleRules[].style.casing.opacity` | number | — | — | — | — |
| `styleRules[].style.casing.widthPx` | number | — | — | — | — |
| `styleRules[].style.color` | string | — | — | — | Stroke/line color (hex/CSS). |
| `styleRules[].style.dashArray` | string \| null | — | — | — | Dash pattern, e.g. "5 10". null = solid line. |
| `styleRules[].style.expressionPaint` | object | — | — | — | Native MapLibre GL paint properties (expression form) passed through as-is. |
| `styleRules[].style.extends` | string | — | — | — | Style id this rule-style inherits from (style inheritance). |
| `styleRules[].style.fillColor` | string | — | — | — | Fill color (hex/CSS). Polygon layers. |
| `styleRules[].style.fillExtrusionBase` | oneOf | — | — | — | Fill-extrusion base height in metres. Default: 0. |
| `styleRules[].style.fillExtrusionColor` | string | — | — | — | Fill-extrusion face color (hex/CSS). Required for fill-extrusion layers. |
| `styleRules[].style.fillExtrusionHeight` | oneOf | — | — | — | Fill-extrusion height in metres. Number = fixed value, string = feature field name. Required for fill-extrusion layers. |
| `styleRules[].style.fillExtrusionOpacity` | number | — | — | — | Fill-extrusion global opacity (0–1). Default: 1.0. |
| `styleRules[].style.fillOpacity` | number | — | — | — | Fill opacity (0–1). |
| `styleRules[].style.hatch` | object | — | — | — | Canvas-based hatch fill pattern. |
| `styleRules[].style.hatch.angleDeg` | number \| null | — | — | — | — |
| `styleRules[].style.hatch.enabled` | boolean | — | — | — | — |
| `styleRules[].style.hatch.renderMode` | string | — | — | "overlay" \| "pattern_only" | — |
| `styleRules[].style.hatch.spacingPx` | number | — | — | — | — |
| `styleRules[].style.hatch.stroke` | object | — | — | — | — |
| `styleRules[].style.hatch.stroke.color` | string | — | — | — | — |
| `styleRules[].style.hatch.stroke.opacity` | number | — | — | — | — |
| `styleRules[].style.hatch.stroke.widthPx` | number | — | — | — | — |
| `styleRules[].style.hatch.type` | string | — | — | — | — |
| `styleRules[].style.lineCap` | string | — | — | "butt" \| "round" \| "square" | Line cap style. |
| `styleRules[].style.lineJoin` | string | — | — | "bevel" \| "miter" \| "round" | Line join style. |
| `styleRules[].style.opacity` | number | — | — | — | Stroke opacity (0–1). |
| `styleRules[].style.paint` | object | — | — | — | Native MapLibre GL paint properties passed through as-is. Keys are MapLibre property names (e.g. "fill-color", "circle-radius"). |
| `styleRules[].style.radius` | number | — | — | — | Circle radius in pixels. Point layers. |
| `styleRules[].style.shape` | string | — | — | "circle" | Point shape. ONLY "circle" is supported. The key is currently inert — nothing reads it — and is kept as a reserved extension point. Previously typed as free-form text advertising "square", which the engine never rendered: MapLibre's `circle` layer draws circles only, and a square would require a whole second render path (a `symbol` layer over a generated SDF icon), plus re-implementing taxonomy paint, the pending-sync badge and styleRules on that path. Restricted so the schema stops promising a capability that does not exist. |
| `styleRules[].style.weight` | number | — | — | — | Stroke width in pixels. |
| `styleRules[].when` | `styleCondition` | — | — | — | — |
| `styleRules[].when.all` | array | — | — | — | Compound AND condition. |
| `styleRules[].when.field` | string | — | — | — | Feature property path, e.g. "properties.type". |
| `styleRules[].when.operator` | string | — | — | "==" \| "===" \| "eq" \| "!=" \| "!==" \| "neq" \| ">" \| ">=" \| "<" \| "<=" \| "contains" \| "startsWith" \| "endsWith" \| "in" \| "notIn" \| "between" | Comparison operator. |
| `styleRules[].when.value` | — | — | — | — | Value to compare against. Can be string, number, boolean, or array (for in/notIn/between). |

## `themes.schema.json`

_GeoLeaf Themes_

themes.json — layer visibility presets (themes) for a GeoLeaf profile. Hardened in Sprint S1 (PRF-SCHEMA). Note: the canonical default-theme key is the root-level `defaultTheme`; the legacy/typo `config.defautTheme` is tolerated but flagged in the anomaly registry.

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `config` | object | — | — | — | Global theme configuration. |
| `config.defautTheme` | string | — | — | — | LEGACY/TYPO of defaultTheme (present in one profile). Use the root-level defaultTheme. See anomaly registry. |
| `config.primaryThemes` | object | — | — | — | — |
| `config.primaryThemes.enabled` | boolean | — | — | — | Show primary themes UI. |
| `config.primaryThemes.position` | string | — | — | "top-map" \| "top-layermanager" | Position of primary themes control. |
| `config.secondaryThemes` | object | — | — | — | — |
| `config.secondaryThemes.enabled` | boolean | — | — | — | Show secondary themes UI. |
| `config.secondaryThemes.placeholder` | string | — | — | — | Placeholder text for secondary theme selector. |
| `config.secondaryThemes.position` | string | — | — | "top-map" \| "top-layermanager" | Position of secondary themes control. |
| `config.secondaryThemes.showNavigationButtons` | boolean | — | — | — | Show prev/next navigation buttons. |
| `defaultTheme` | string | — | — | — | ID of the theme active on startup (canonical, root-level). |
| `themes` | array | — | — | — | Theme definitions. |
| `themes[].description` | string | — | — | — | Theme description. |
| `themes[].icon` | string | — | — | — | Emoji or icon name. |
| `themes[].id` | string | oui | — | — | Unique theme identifier. |
| `themes[].label` | string | — | — | — | Display label (defaults to id). |
| `themes[].layers` | array | — | — | — | Layer visibility settings for this theme. |
| `themes[].layers[].id` | string | oui | — | — | Layer ID (must match layers.json). |
| `themes[].layers[].style` | string | — | — | — | Style ID to apply in this theme. |
| `themes[].layers[].visible` | boolean | — | — | — | Layer visibility in this theme. |
| `themes[].type` | string | — | `"secondary"` | "primary" \| "secondary" | Theme type. Affects UI placement. |

## `ui.schema.json`

_GeoLeaf UI Config_

ui.json — UI controls, search/filter panel, layer manager and scale configuration. The data table panel config moved to modules.table (plugin-table, extraction roadmap table S4). The theme selector flag moved to modules.theme-selector (in-core capability, extraction roadmap theme-selector S8/F3). The legend config (showLegend + legendConfig) moved to modules.legend (in-core capability, extraction roadmap legend S10/F2). The share button flag (showShareButton) moved to modules.permalink.share (sub-feature of the in-core permalink capability, extraction roadmap share S12 → permalink S13/F7). Hardened in Sprint S1 (PRF-SCHEMA). The real search section key is `searchConfig` (the previous `search` was a never-matched ghost — corrected here). Filter items stay permissive (polymorphic by type).

| Chemin | Type | Requis | Défaut | Valeurs | Description |
| ------ | ---- | ------ | ------ | ------- | ----------- |
| `$schema` | string | — | — | — | — |
| `layerManagerConfig` | object | — | — | — | Layer manager panel configuration. |
| `layerManagerConfig.collapsedByDefault` | boolean | — | — | — | — |
| `layerManagerConfig.sections` | array | — | — | — | — |
| `layerManagerConfig.sections[].collapsedByDefault` | boolean | — | — | — | — |
| `layerManagerConfig.sections[].id` | string | oui | — | — | — |
| `layerManagerConfig.sections[].label` | string | — | — | — | — |
| `layerManagerConfig.sections[].order` | number | — | — | — | — |
| `layerManagerConfig.title` | string | — | — | — | — |
| `ui` | object | — | — | — | UI control visibility flags and global settings. |
| `ui.interactiveShapes` | boolean | — | — | — | Make GeoJSON shapes / accuracy circle interactive (clickable). Default false. Read by the GeoJSON style resolver, geolocation accuracy layer and route layers. |
| `ui.language` | string | — | — | — | — |
| `ui.showBaseLayerControls` | boolean | — | — | — | — |
| `ui.showCacheButton` | boolean | — | — | — | — |
| `ui.showCredentialButton` | boolean | — | — | — | — |
| `ui.showEditor` | boolean | — | — | — | — |
| `ui.showLayerManager` | boolean | — | — | — | — |
| `ui.theme` | string | — | — | "light" \| "dark" \| "auto" | — |

