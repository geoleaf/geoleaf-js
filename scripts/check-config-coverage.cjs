#!/usr/bin/env node
/**
 * check-config-coverage.cjs — coverage guard for the config parameter inventory.
 *
 * Fails (exit 1) if a config key declared in a schema (or a known code-only key) for an
 * ACTIVE inventory family has no row in `inventaire_config_parametres.md`. Realises the
 * point-6 garde-fou of roadmap_config-contract.md: "every code/schema key is inventoried".
 *
 * Checks BOTH directions (S7):
 *   - schema → inventory  (missing rows)      → blocking
 *   - inventory → schema  (stale rows)        → warning; blocking under --fail-stale
 * The reverse direction was unguarded until S7, which is how the inventory kept rows for
 * keys deleted by the POI dissolution, taxonomy v3 and the legacy mapping.json while the
 * gate stayed green. Green on one direction never implied the inventory was accurate.
 *
 * Scope grew family by family across Phase B (S3 → S9). ACTIVE: B1 + B2 + B3 + B4 + B5 + B6 + B7
 * (root: geoleaf.config.json + profile.json ; features: config/core/features.json ;
 * ui: config/core/ui.json ; B4: config/core/{basemaps,themes,taxonomy}.json ;
 * B5: config/core/layers.json + layers/<id>/<id>_config.json ;
 * B6: layers/<id>/styles/<style>.json ;
 * B7: config/plugins/<id>.json → modules.<id> [code-sourced explicitLeaves] + config/core/mapping.json).
 * Phase B complete (B1→B7) → WIRED into the pre-commit gate (.husky/pre-commit, S9). Run manually:
 *     node scripts/check-config-coverage.cjs
 *
 * Testability: set CONFIG_INVENTORY to point at an alternate inventory file.
 */
const fs = require("fs");
const path = require("path");

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "profiles", "schemas");
const INVENTORY = process.env.CONFIG_INVENTORY
    ? path.resolve(process.env.CONFIG_INVENTORY)
    : docsPaths.reference("inventaire_config_parametres.md");

/**
 * Inventory families. Each active family declares: the schema files whose leaf keys must
 * be inventoried (with the top-level keys to skip because they belong to another family),
 * the code-only keys (read by the code but absent from any schema), and the heading that
 * opens the family's section in the inventory.
 */
const FAMILIES = {
    B1: {
        label: "B1 — racine (geoleaf.config.json + profile.json)",
        sectionHeading: "## B1 —",
        schemas: [
            { file: "geoleaf-config.schema.json", excludeTop: ["modules"] },
            {
                file: "profile.schema.json",
                // performance → B2 (features) ; modules → B7.
                // clusteringConfig / poiConfig retirés du schéma (R.45, backlog résiduel S5) :
                // plus de clé à exclure, l'exclusion serait un vestige silencieux.
                excludeTop: ["performance", "modules"],
            },
        ],
        codeOnly: ["data.useProfilePoiMapping", "data.useMapping"],
    },
    B2: {
        label: "B2 — features (config/core/features.json)",
        sectionHeading: "## B2 —",
        schemas: [{ file: "features.schema.json", excludeTop: [] }],
        // Every features.json leaf key is schema-declared: mapOptions lives only here.
        // `performance` is still vestigially declared in profile.schema.json (hence its
        // excludeTop entry in B1); `clusteringConfig` and `poiConfig` no longer are —
        // both blocks were removed (ANO-033 closed by R.45, backlog résiduel S5).
        // Geocoding extracted to modules.geocoding (B7) — extraction roadmap geocoding S4.
        // No code-only keys.
        codeOnly: [],
    },
    B3: {
        label: "B3 — ui (config/core/ui.json)",
        sectionHeading: "## B3 —",
        schemas: [{ file: "ui.schema.json", excludeTop: [] }],
        // ANO-034/036 RÉSOLUS (Archi S3) — showSearch/interactiveShapes ajoutés à ui.schema.json
        // (désormais feuilles de schéma). ANO-035 (showShareButton) migré → modules.permalink.share.enabled (S13 F7)
        // (B7 ; capacité in-core, extraction roadmap share S12). ANO-037 (ui.scaleType) : doublon
        // `ui/scale-control` SUPPRIMÉ. Plus aucune clé code-only en B3.
        codeOnly: [],
    },
    B4: {
        label: "B4 — basemaps + themes (config/core/)",
        sectionHeading: "## B4 —",
        // basemaps/themes describe their entries via $ref + additionalProperties +
        // array items, which flattenLeaves cannot traverse. excludeTop drops the opaque
        // container leaves (basemaps/themes) so the schemas still drive the SHALLOW
        // keys (themes config.* + defaultTheme), while the per-entry leaves are listed
        // explicitly below (explicitLeaves).
        schemas: [
            { file: "basemaps.schema.json", excludeTop: ["basemaps"] },
            { file: "themes.schema.json", excludeTop: ["themes"] },
        ],
        // Per-entry schema leaves (suffix [] = a field of each basemap/theme/category entry).
        explicitLeaves: [
            // basemaps[] (schema)
            "basemaps[].id",
            "basemaps[].label",
            "basemaps[].type",
            "basemaps[].url",
            "basemaps[].tiles",
            "basemaps[].style",
            "basemaps[].fallbackUrl",
            "basemaps[].encoding",
            "basemaps[].attribution",
            "basemaps[].minZoom",
            "basemaps[].maxZoom",
            "basemaps[].subdomains",
            "basemaps[].tileSize",
            "basemaps[].defaultBasemap",
            "basemaps[].offline",
            "basemaps[].offlineBounds",
            "basemaps[].cacheMinZoom",
            "basemaps[].cacheMaxZoom",
            "basemaps[].wmts.getCapabilitiesUrl",
            "basemaps[].wmts.layer",
            "basemaps[].wmts.tileMatrixSet",
            "basemaps[].wmts.format",
            "basemaps[].wms.url",
            "basemaps[].wms.layers",
            "basemaps[].wms.format",
            "basemaps[].wms.version",
            "basemaps[].wms.transparent",
            "basemaps[].imageSource.url",
            "basemaps[].imageSource.coordinates",
            "basemaps[].imageSource.opacity",
            "basemaps[].hillshade.demUrl",
            "basemaps[].hillshade.demEncoding",
            "basemaps[].hillshade.demMaxZoom",
            "basemaps[].hillshade.exaggeration",
            "basemaps[].hillshade.illuminationDirection",
            "basemaps[].hillshade.highlightColor",
            "basemaps[].hillshade.shadowColor",
            "basemaps[].terrain.enabled",
            "basemaps[].terrain.demUrl",
            "basemaps[].terrain.demEncoding",
            "basemaps[].terrain.exaggeration",
            "basemaps[].terrain.default3D",
            "basemaps[].terrain.pitch",
            "basemaps[].terrain.bearing",
            // themes[] (schema)
            "themes[].id",
            "themes[].label",
            "themes[].type",
            "themes[].description",
            "themes[].icon",
            "themes[].layers",
            "themes[].layers[].id",
            "themes[].layers[].visible",
            "themes[].layers[].style",
        ],
        // Keys read by LIVE code but ABSENT from the hardened schemas (additionalProperties:false
        // ⇒ inconfigurable). Consigned ANO-042→047. Each still needs an inventory row.
        codeOnly: [
            "basemaps[].apiKey",
            "basemaps[].apiKeyRequired",
            "basemaps[].demUrl",
            "basemaps[].demEncoding",
            "basemaps[].demMaxZoom",
            "basemaps[].terrain.demMaxZoom",
            "basemaps[].wms.crs",
            "basemaps[].wms.styles",
            "basemaps[].wms.tileSize",
            "config.primaryThemes.compactThreshold",
        ],
    },
    B5: {
        label: "B5 — layers + {id}_config (config/core/layers.json + layers/<id>/<id>_config.json)",
        sectionHeading: "## B5 —",
        // layers.json: layers[]/layerTemplates[] entries are array items ($ref/items
        // not traversed by flattenLeaves) → excludeTop drops the opaque containers and
        // their per-entry fields are listed in explicitLeaves. layer-config.json: its
        // shallow object leaves ARE flattened; the polymorphic array leaves
        // (styles.available, table.columns, tooltip/popup.fields, sidepanelConfig.detailLayout)
        // surface as single leaves and are inventoried as one row each.
        schemas: [
            { file: "layers.schema.json", excludeTop: ["layers", "layerTemplates"] },
            { file: "layer-config.schema.json", excludeTop: [] },
        ],
        explicitLeaves: [
            // layers.json index (layers[] + layerTemplates[] + instances[])
            "layers[].id",
            "layers[].configFile",
            "layers[].layerManagerId",
            "layers[].label",
            "layers[].order",
            "layers[].defaultVisible",
            "layerTemplates[].templateId",
            "layerTemplates[].layerManagerId",
            "layerTemplates[].template",
            "layerTemplates[].instances",
            "layerTemplates[].instances[].id",
            "layerTemplates[].instances[].label",
            "layerTemplates[].instances[].dataFile",
        ],
        // No code-only leaves remain: the `sidepanelFields` root alias (ANO-057) disappeared
        // with the S9 render slice (geojson/loader/profile.ts normalization removed); the
        // legacy `popup`/`tooltip`/`sidepanelConfig`/`tooltipMode` keys were dropped from the
        // schema (rendering now lives under the plugin-owned `capabilities.feature-info`, B7).
        codeOnly: [],
    },
    B6: {
        label: "B6 — styles (layers/<id>/styles/<style>.json)",
        sectionHeading: "## B6 —",
        // style.schema.json: label (oneOf string|object), style (flatStyle $ref) and styleRules
        // (array of $ref styleRule) cannot be traversed by flattenLeaves → excludeTop drops these
        // opaque containers and their leaves are listed in explicitLeaves. The shallow leaves
        // (id, description, scaleConfig.*, labelScale.*, legend.label, legend.items) ARE flattened.
        schemas: [{ file: "style.schema.json", excludeTop: ["label", "style", "styleRules"] }],
        explicitLeaves: [
            // label.* (oneOf object form)
            "label.enabled",
            "label.visibleByDefault",
            "label.field",
            "label.font.family",
            "label.font.sizePt",
            "label.font.weight",
            "label.font.bold",
            "label.font.italic",
            "label.color",
            "label.opacity",
            "label.buffer.enabled",
            "label.buffer.noFill",
            "label.buffer.color",
            "label.buffer.opacity",
            "label.buffer.sizePx",
            // label.background.* + label.offset.* removed from the schema (archi B.5 — dead).
            // style.* (flatStyle $ref)
            "style.extends",
            "style.fillColor",
            "style.fillOpacity",
            "style.color",
            "style.weight",
            "style.opacity",
            "style.lineColor",
            "style.lineOpacity",
            "style.lineWidth",
            "style.dashArray",
            "style.lineCap",
            "style.lineJoin",
            "style.radius",
            "style.shape",
            "style.hatch.enabled",
            "style.hatch.type",
            "style.hatch.spacingPx",
            "style.hatch.angleDeg",
            "style.hatch.renderMode",
            "style.hatch.stroke.color",
            "style.hatch.stroke.opacity",
            "style.hatch.stroke.widthPx",
            "style.casing.enabled",
            "style.casing.color",
            "style.casing.opacity",
            "style.casing.widthPx",
            "style.casing.dashArray",
            "style.casing.lineCap",
            "style.casing.lineJoin",
            "style.paint",
            "style.expressionPaint",
            "style.fillExtrusionColor",
            "style.fillExtrusionOpacity",
            "style.fillExtrusionHeight",
            "style.fillExtrusionBase",
            // styleRules[] (array items $ref styleRule)
            "styleRules[].when.field",
            "styleRules[].when.operator",
            "styleRules[].when.value",
            "styleRules[].when.all",
            "styleRules[].label",
            "styleRules[].style",
            "styleRules[].legend.label",
            "styleRules[].legend.order",
        ],
        // Keys read by LIVE code but ABSENT from the hardened style schema
        // (additionalProperties:false ⇒ inconfigurable). Consigned ANO-060/068/069/072 (S8).
        codeOnly: [
            "layerScale",
            "style.sizePx",
            "style.casing.dashArray",
            "style.casing.lineCap",
            "style.casing.lineJoin",
            "styleRules[].legend.description",
        ],
    },
    B7: {
        label: "B7 — plugins modules.<id> + mapping.json légacy (config/plugins/<id>.json + config/core/mapping.json)",
        sectionHeading: "## B7 —",
        // Plugin configs (modules.<id>.*) have NO schema in profiles/schemas/: each plugin owns
        // its schema and profile.schema.json declares `modules.<id>` as additionalProperties:true
        // (keys delegated to the plugin). So every plugin key is CODE-SOURCED and listed by hand
        // in explicitLeaves (grep coreConfigGet/Config.get + each plugin's *_CONFIG_DEFAULTS, S9).
        // mapping.json DOES have a schema (mapping.schema.json) → its 13 leaves are schema-driven
        // like B1–B6 (flattenLeaves: source/description/coordinateFields.*/filter.*/mapping/
        // categoryMapping/subcategoryMapping/gbif.* — `mapping` opaque additionalProperties = 1 leaf).
        schemas: [{ file: "mapping.schema.json", excludeTop: [] }],
        explicitLeaves: [
            // offline (in-core capability, S14 Phase B) + pwa (in-core capability S14 Phase A ;
            // `app/init.ts` cité ici jusqu'à B.30 n'existe plus — le gate PWA est
            // `capabilities/pwa/lifecycle.ts`, appelé par `shared.module` #7).
            // ⚠ B.30 — `modules.pwa` a DEUX consommateurs, et ces feuilles restent listées ici
            // (elles doivent être inventoriées) mais ne sont pas toutes runtime :
            //   runtime + build : `name`, `short_name` (bannière d'installation + manifest)
            //   build SEUL      : `description`, `theme_color`, `background_color`
            //                     (`scripts/build-deploy.cjs:678-680` → manifest.json déployé ;
            //                      0 lecture dans packages/core/src, où elles ne sont que des
            //                      membres de type). Le split est documenté à la déclaration
            //                      (`pwa-capability.ts`) et figé par
            //                      `__tests__/capabilities/pwa/manifest-only-keys.test.js`.
            "modules.pwa.enabled",
            "modules.pwa.name",
            "modules.pwa.short_name",
            "modules.pwa.description",
            "modules.pwa.theme_color",
            "modules.pwa.background_color",
            "modules.pwa.installPrompt.enabled",
            "modules.pwa.offlineDetector.enabled",
            // ⚠️ AJOUTÉE à la clôture de S3c. La tâche 3.9 a posé la clé au `configSchema`,
            // sa ligne d'inventaire ET son lecteur (`data-origins.ts`, relu par le Service
            // Worker) — mais pas cette feuille-ci. La gate signalait donc la ligne
            // d'inventaire comme PÉRIMÉE, c'est-à-dire qu'elle était **aveugle** à une clé
            // bien vivante : le sens inventaire→schéma ne pouvait pas la voir, et le sens
            // schéma→inventaire non plus. Une famille code-sourcée ne se déclare qu'ici.
            "modules.offline.dataOrigins",
            "modules.offline.cache.enableProfileCache",
            "modules.offline.cache.enableTileCache",
            // maxCacheBytes: lue cache-manager.ts:243 (_enforceCacheQuota), défaut 250 Mo
            // posé cache-manager.ts:108 — B.34 (clé lue mais non déclarée au configSchema).
            "modules.offline.cache.maxCacheBytes",
            // cluster (capabilities/cluster config.ts getClusterConfig — capacité in-core,
            // clustering natif MapLibre, opt-out ; ex-poiConfig.cluster*). La famille entière
            // manquait au gate ET à l'inventaire (découvert en traitant B.34, dont seule
            // clusterStrategies était listée). Défauts radius/max-zoom = constants.ts.
            "modules.cluster.enabled",
            "modules.cluster.clustering",
            "modules.cluster.clusterRadius",
            "modules.cluster.disableClusteringAtZoom",
            "modules.cluster.clusterStrategy",
            "modules.cluster.clusterStrategies",
            // geocoding (plugin-geocoding config.ts getPluginConfig + GeocodingConfig defaults ;
            // migrated from features.json geocodingConfig — extraction roadmap geocoding S4)
            "modules.geocoding.enabled",
            "modules.geocoding.provider",
            "modules.geocoding.countrycodes",
            "modules.geocoding.bbox",
            "modules.geocoding.debounceMs",
            "modules.geocoding.minChars",
            // table (plugin-table config.ts getPluginConfig + TableConfig DEFAULTS ; showButton = slot
            // profileKey in entry.ts read by the core registry ; pageSize/virtualScrolling orphans
            // ANO-038/039 ; migrated from ui.json tableConfig + ui.showTable — extraction roadmap table S4)
            "modules.table.enabled",
            "modules.table.showButton",
            "modules.table.defaultVisible",
            "modules.table.pageSize",
            "modules.table.maxRowsPerLayer",
            "modules.table.enableExportButton",
            "modules.table.virtualScrolling",
            "modules.table.defaultHeight",
            "modules.table.minHeight",
            "modules.table.maxHeight",
            "modules.table.resizable",
            // taxonomy (capabilities/taxonomy — the POINT SYMBOL: icon, iconColor, marker disc,
            // pill badges). `taxonomies` and `layers` are opaque user-data subtrees (named
            // taxonomies / per-layer bindings), 1 leaf each like `mapping` — so `marker` and
            // `iconColor`, which live inside a category, cost nothing here.
            "modules.taxonomy.enabled",
            "modules.taxonomy.icons.spriteUrl",
            "modules.taxonomy.icons.symbolPrefix",
            "modules.taxonomy.icons.defaultIcon",
            "modules.taxonomy.icons.iconSize",
            "modules.taxonomy.icons.showOnMap",
            "modules.taxonomy.taxonomies",
            "modules.taxonomy.layers",
            // render.* — per-surface decorations (resolver.ts → feature-info render seam).
            "modules.taxonomy.render.popup.showIconCategory",
            "modules.taxonomy.render.popup.showIconSubcategory",
            "modules.taxonomy.render.popup.colorBadges",
            "modules.taxonomy.render.tooltip.showIconCategory",
            "modules.taxonomy.render.tooltip.showIconSubcategory",
            "modules.taxonomy.render.tooltip.colorBadges",
            "modules.taxonomy.render.sidepanel.showIconCategory",
            "modules.taxonomy.render.sidepanel.showIconSubcategory",
            "modules.taxonomy.render.sidepanel.colorBadges",
            // feature-info (capabilities/feature-info/config.ts getFeatureInfoConfig — extraction
            // roadmap capacités S2 ; le nom "plugin-feature-info" et l'accesseur "getPluginConfig"
            // étaient deux vestiges de l'ancien plugin, renommés en B.29).
            // Per-layer bindings live under capabilities.feature-info in {id}_config.json (opaque, B5).
            "modules.feature-info.enabled",
            // labels (capabilities/labels config.ts getLabelsConfig — extraction roadmap capacités S4).
            // Capability gate only; per-layer label styling lives in style files (B6, label.*).
            "modules.labels.enabled",
            // filter (capabilities/filter config.ts getFilterConfig — extraction roadmap capacités S5).
            // In-core generic attribute filter; `fields` is an opaque descriptor array (1 leaf, like
            // taxonomies/layers). Migrated from ui.json searchConfig + ui.showFilterPanel (F4).
            // B.22 — `searchPlaceholder` RETIRÉ (schéma, type, 9 profils) : 0 site de lecture,
            // le panneau S5 n'a pas de champ de recherche global ; le placeholder rendu est
            // celui du descripteur `kind:"text"` (`fields[].placeholder`, panel/render.ts:147).
            "modules.filter.enabled",
            "modules.filter.title",
            "modules.filter.fields",
            "modules.filter.actions.applyLabel",
            "modules.filter.actions.resetLabel",
            // toast-renderer (capabilities/toast-renderer config.ts getToastRendererConfig — extraction
            // roadmap capacités S7). Capability gate only; the renderer's layout defaults (position,
            // maxVisible, animations) are code-side, not profile-configurable.
            "modules.toast-renderer.enabled",
            // theme-selector (capabilities/theme-selector — extraction roadmap theme-selector S8/F3).
            // Capability gate only (opt-out); migrated from ui.showThemeSelector. Gated at boot via
            // CapabilityRegistry (full + lite) and late by the selector's _createUI on the merged config.
            "modules.theme-selector.enabled",
            // branding (capabilities/branding config.ts getBrandingConfig — extraction roadmap
            // contrôles carte). App-global (base geoleaf.config.json), opt-in; migrated from the
            // former root `branding` key. Gate + overlay text + position.
            "modules.branding.enabled",
            "modules.branding.text",
            "modules.branding.position",
            // coordinates (capabilities/coordinates config.ts getCoordinatesConfig — extraction
            // roadmap contrôles carte). Profile-level, opt-out; migrated from `ui.showCoordinates`.
            // Default-on covers profiles that don't set it (no config/plugins/coordinates.json).
            "modules.coordinates.enabled",
            "modules.coordinates.position",
            "modules.coordinates.decimals",
            // theme-toggle (capabilities/theme-toggle config.ts getThemeToggleConfig — extraction
            // roadmap contrôles carte). Profile-level, opt-in (default OFF, button gated late);
            // migrated from `ui.showThemeToggle` (code-only flag, never in a profile/schema).
            "modules.theme-toggle.enabled",
            "modules.theme-toggle.position",
            // scale (capabilities/scale config.ts getScaleConfig — extraction roadmap contrôles carte).
            // Profile-level, opt-out; migrated from `ui.showScale` + `scaleConfig`. Defaults reproduce
            // the uniform real-profile scaleConfig (all on) → renders by default, no per-profile file.
            "modules.scale.enabled",
            "modules.scale.scaleGraphic",
            "modules.scale.scaleNumeric",
            "modules.scale.scaleNumericEditable",
            "modules.scale.scaleNivel",
            "modules.scale.position",
            // geolocation (capabilities/geolocation config.ts getGeolocationConfig — extraction
            // roadmap contrôles carte). Profile-level, opt-out; migrated from `ui.showGeolocation`
            // (default-on covers profiles, no config/plugins/geolocation.json). GPS state seam =
            // GeoLeaf.Geolocation.getState().
            "modules.geolocation.enabled",
            "modules.geolocation.position",
            // legend (capabilities/legend config.ts getLegendConfig — extraction roadmap legend S10/F2).
            // Migrated from ui.showLegend + legendConfig. Gated at boot via CapabilityRegistry (opt-out,
            // full + lite) and late by LegendLifecycle on the merged config; config réveillée
            // (title/position/collapsedByDefault désormais actifs — décision option B).
            "modules.legend.enabled",
            "modules.legend.title",
            "modules.legend.position",
            "modules.legend.collapsedByDefault",
            "modules.route.enabled",
            "modules.route.layers",
            // permalink (capabilities/permalink config.ts getPermalinkConfig + permalink-url `mode` ;
            // capacité in-core S13, opt-out, gate seul migrée de ui.permalink — cluster-model sans
            // module, pilotée par 2 hooks boot).
            "modules.permalink.enabled",
            "modules.permalink.mode",
            // fields: lue à 3 sites de prod (permalink-sync.ts:77, permalink-url.ts:146
            // et :257), défaut = DEFAULT_PERMALINK_FIELDS (constants.ts) — B.34.
            "modules.permalink.fields",
            // share = sous-fonction de permalink (S13 F7 : modules.permalink.share, migrée de
            // modules.share / ui.showShareButton). Gate opt-out lu au boot + par le bouton desktop
            // + le pill mobile sur la config mergée.
            "modules.permalink.share.enabled",
            // editor (plugin-editor config.ts getEditorConfig + EditorConfig/EDITOR_CONFIG_DEFAULTS)
            "modules.editor.enabled",
            "modules.editor.showButton",
            // 5.1-e — bouton d'export de session. Sous `modules.editor.*` parce que les deux
            // drapeaux `ui.showPoi*` d'addpoi étaient inatteignables (schéma strict, non
            // déclarés) : leurs boutons ne pouvaient être ni masqués ni affichés.
            "modules.editor.showExport",
            "modules.editor.menuPosition",
            "modules.editor.enabledTools",
            "modules.editor.snapPx",
            // 5.1-a — garde-fou de doublon à la saisie, en MÈTRES (à ne pas confondre avec
            // snapPx, qui est un confort de tracé en pixels). Absorbé d'addpoi, où il vivait
            // en `layer.snapTolerance` — clé qu'aucun schéma ne déclare, sur un schéma
            // `additionalProperties: false` : elle était donc INATTEIGNABLE.
            "modules.editor.poiSnapMeters",
            "modules.editor.vertexHandleSize",
            "modules.editor.midpointHandleSize",
            "modules.editor.minVerticesLineString",
            "modules.editor.minVerticesPolygon",
            "modules.editor.api.baseUrl",
            "modules.editor.api.authHeader",
            "modules.editor.api.timeoutMs",
            "modules.editor.api.geometryProperty",
            "modules.editor.persistence.mode",
            "modules.editor.persistence.dialect",
            "modules.editor.persistence.conflictResolution",
            "modules.editor.undoStackSize",
            "modules.editor.modal.desktopBreakpointPx",
            "modules.editor.modal.maxWidthPx",
            "modules.editor.confirmDelete",
            "modules.editor.confirmCancelOnDirty",
            "modules.editor.defaultLayer",
            "modules.editor.eventNamespace",
            // print (plugin-print PRINT_CONFIG_DEFAULTS — 0 profile loads it, ANO-081)
            "modules.print.enabled",
            "modules.print.showButton",
            "modules.print.position",
            "modules.print.defaultFormat",
            "modules.print.availableFormats",
            "modules.print.dpi",
            "modules.print.availableDpi",
            "modules.print.margins.top",
            "modules.print.margins.right",
            "modules.print.margins.bottom",
            "modules.print.margins.left",
            "modules.print.includeLegend",
            "modules.print.includeScale",
            "modules.print.includeNorthArrow",
            "modules.print.includeAnnotations",
            "modules.print.title",
            "modules.print.exportFormats",
            "modules.print.jpgQuality",
            "modules.print.serverEndpoint",
            "modules.print.serverHeaders",
            "modules.print.forceServer",
            "modules.print.maxCanvasPxMobile",
            // measure (plugin-measure MEASURE_CONFIG_DEFAULTS — 0 profile loads it, ANO-081)
            "modules.measure.enabled",
            "modules.measure.showButton",
            "modules.measure.position",
            "modules.measure.menuPosition",
            "modules.measure.defaultDistanceUnit",
            "modules.measure.defaultAreaUnit",
            "modules.measure.snapPx",
            "modules.measure.circleSteps",
            "modules.measure.enabledTools",
            "modules.measure.tooltipDefaultSize.width",
            "modules.measure.tooltipDefaultSize.height",
            "modules.measure.labelMaxChars",
            "modules.measure.persist",
            "modules.measure.storageKey",
            "modules.measure.maxFeatures",
            "modules.measure.gpsCloseThresholdM",
            "modules.measure.gpsMaxJumpMps",
            "modules.measure.decimals.distance",
            "modules.measure.decimals.area",
            "modules.measure.exportFileName",
        ],
        // mapping.json keys read by code but absent from mapping.schema.json: none (the only
        // consumed key, `mapping`, IS a schema leaf — normalization.ts:192).
        codeOnly: [],
    },
};
const ACTIVE = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"];

/**
 * Stale rows are reported but never block by default: the reverse direction was unguarded
 * until S7, so the pre-existing backlog would have frozen every commit — the same
 * "permanently red gate" anti-pattern already avoided for check-orphan-exports and
 * audit-dev-report. Pass --fail-stale once the backlog is cleared to close the ratchet.
 */
const FAIL_STALE = process.argv.includes("--fail-stale");

/** Flatten a JSON-schema object into dotted leaf paths (a leaf has no nested `properties`). */
function flattenLeaves(schema, prefix, excludeTop) {
    const out = [];
    const props = (schema && schema.properties) || {};
    for (const [key, val] of Object.entries(props)) {
        if (key.startsWith("$")) continue; // JSON-schema meta-keys ($schema, $id…) are not config params
        if (prefix === "" && excludeTop.includes(key)) continue;
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === "object" && val.properties) {
            out.push(...flattenLeaves(val, dotted, []));
        } else {
            out.push(dotted);
        }
    }
    return out;
}

/**
 * A `###` sub-section whose heading is struck through (`~~…~~`) is a migration archive:
 * it deliberately keeps the rows of a retired structure so the old→new mapping stays
 * readable (e.g. B4 `taxonomy.json`, retired 11/07, kept as the taxonomy-v3 migration
 * record). Those rows describe keys that no longer exist by design — they must neither
 * satisfy coverage nor be reported as stale.
 */
function isArchivedHeading(line) {
    return line.startsWith("###") && line.includes("~~");
}

/**
 * Extract the keys listed (column 2, backtick-wrapped) in a family's inventory section.
 * Rows under a struck-through sub-section are skipped (see isArchivedHeading).
 */
function inventoryKeys(md, heading) {
    const start = md.indexOf(heading);
    if (start === -1) return null;
    const after = md.indexOf("\n## ", start + heading.length);
    const section = md.slice(start, after === -1 ? undefined : after);
    const keys = new Set();
    let archived = false;
    for (const line of section.split("\n")) {
        if (line.startsWith("###")) archived = isArchivedHeading(line);
        if (archived || !line.startsWith("|")) continue;
        // cells: ["", Fichier, Clé, …] → column index 2 is the key cell.
        const cell = (line.split("|").map((c) => c.trim())[2] || "").match(/^`([^`]+)`$/);
        if (cell) keys.add(cell[1]);
    }
    return keys;
}

function main() {
    const md = fs.readFileSync(INVENTORY, "utf8");
    let failures = 0;
    let staleTotal = 0;

    for (const fam of ACTIVE) {
        const cfg = FAMILIES[fam];
        const expected = new Set(cfg.codeOnly);
        // explicitLeaves: keys whose schema position ($ref / additionalProperties / array
        // items) flattenLeaves cannot reach — listed by hand (B4+). No-op for B1–B3.
        for (const k of cfg.explicitLeaves || []) expected.add(k);
        for (const s of cfg.schemas) {
            const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, s.file), "utf8"));
            for (const leaf of flattenLeaves(schema, "", s.excludeTop)) expected.add(leaf);
        }
        const found = inventoryKeys(md, cfg.sectionHeading);
        if (found === null) {
            console.error(
                `✗ [${fam}] section "${cfg.sectionHeading}" introuvable dans l'inventaire`
            );
            failures++;
            continue;
        }
        const missing = [...expected].filter((k) => !found.has(k)).sort();
        if (missing.length) {
            console.error(`✗ [${cfg.label}] ${missing.length} clé(s) sans ligne d'inventaire :`);
            for (const k of missing) console.error(`    - ${k}`);
            failures++;
        } else {
            console.log(`✓ [${cfg.label}] ${expected.size} clés couvertes`);
        }

        // Reverse direction: an inventory row whose key is neither schema-declared nor
        // code-only. Three distinct causes, only the first is a purge candidate:
        //   1. stale row — the key was dropped from the schema (POI-era, legacy mapping.json)
        //   2. orphan — the key IS read by the code but was never schema-declared (an
        //      anomaly tracked in archives/registre_anomalies_config.md, NOT dead weight)
        //   3. intermediate node — a parent key listed for readability above its own leaves
        // Triage is required before removing anything: "annoncé mort ≠ mort".
        const stale = [...found].filter((k) => !expected.has(k)).sort();
        if (stale.length) {
            staleTotal += stale.length;
            console.warn(
                `⚠ [${cfg.label}] ${stale.length} ligne(s) sans clé de schéma ni codeOnly :`
            );
            for (const k of stale) console.warn(`    - ${k}`);
        }
    }

    if (staleTotal) {
        const verdict = FAIL_STALE ? "Échec" : "Avertissement";
        console.warn(
            `\n${verdict} lignes périmées : ${staleTotal} ligne(s) d'inventaire sans clé correspondante.`
        );
        if (!FAIL_STALE) {
            console.warn("  (non bloquant — trier avant de purger ; --fail-stale pour bloquer)");
        }
    }

    if (failures) {
        console.error(`\nÉchec couverture config : ${failures} famille(s) incomplète(s).`);
        process.exit(1);
    }
    if (staleTotal && FAIL_STALE) process.exit(1);
    console.log(`\nCouverture config OK (familles actives : ${ACTIVE.join(", ")}).`);
}

main();
