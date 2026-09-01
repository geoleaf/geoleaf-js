#!/usr/bin/env node
/*!
 * GeoLeaf — The core's anti-dead-code net
 * © 2026 Mattieu Pottier — MIT
 *
 * ⚠️ WARNING — this script's historical justification is STALE.
 *
 * It was written because "knip is blind on packages/core/src": 0 issues
 * reported over ~470 files, including with a declared `entry` (measured).
 * The observation was right, the diagnosis wrong. The cause was not the
 * registry architecture: it was `"./dist/*": "./dist/*"` in
 * `packages/core/package.json`'s `exports`, which promoted ALL of `src/**`
 * to entry-point rank — and an entry point is never "unused". Subpath
 * removed at the API review; knip then flagged 159 symbols on the core.
 *
 * ⚠️ UPDATE 26/07/2026 — this script is no longer complementary to knip on
 * this angle, it is its SOLE holder. The 159 symbols above were triaged one
 * by one: 116 barrel false positives, 39 intra-file usages, 3 test-only,
 * 1 already exempted, **0 actionable**. `knip.js` therefore now carries
 * `ignoreIssues: { "packages/core/src/**": ["exports", "types"] }` — motive
 * written in place. Direct consequence for here: the 25/07 measure ("23 of
 * the baseline's 74 candidates are seen by knip, the other 51 are this
 * method's own contribution") becomes **74 out of 74**. The overlap is nil,
 * and this file no longer has a net under it.
 *
 * ⚠️ Corollary not to lose: deleting or weakening this script no longer
 * degrades the coverage, it DELETES it on the core's exports. Before that
 * removal one could believe knip redundant here; that is no longer true in
 * any direction.
 *
 * The underlying reason has not changed, and it is what survived the
 * tightening: the two gates do not look for the same thing. knip reasons on
 * the module graph; here we search by token across the whole repo,
 * including the literal VALUES of string-typed `const`s — registry keys,
 * event names — that no import graph can link to their consumer. That
 * method is what already contributed the 51 candidates invisible to knip,
 * and why removing knip's exports category on the core loses nothing verified.
 *
 * For each named export of packages/core/src, it looks for a real consumer
 * ACROSS THE WHOLE MONOREPO (all packages + examples/), not only core: a
 * core export legitimately consumed by a plugin (e.g. `storage-contract.ts`,
 * consumed by plugin-storage/plugin-addpoi) must never become a false
 * positive — precisely the error of a grep scoped to core alone.
 *
 * An export without a consumer (identifier name, or literal value for
 * string-typed `const`s — registry keys, event names) outside its own file
 * and outside any __tests__ folder is a dead candidate.
 *
 * Owned limit: token/string search, not full TypeScript binding resolution
 * — a generic name (`config`, `init`…) redeclared elsewhere can produce a
 * false "alive" (false negative). A deliberate choice: for a CI-blocking
 * gate, a false negative (a dead one missed) is harmless, a false positive
 * (a live export flagged) breaks production at the purge.
 *
 * Baseline (decision, 15/07): the first pass found 224 candidates already
 * present, a debt never seen by knip. Blocking on it at the gate's
 * introduction would have frozen every commit — the "permanently red gate"
 * anti-pattern, already avoided for the audit-dev gate.
 * `check-orphan-exports.baseline.json` thus freezes the known state: the
 * gate only blocks on a NEW dead export. Regenerate with `--update-baseline`
 * once a batch is purged.
 *
 * After the triage, what stays in the baseline is no longer "debt to
 * triage" but the method's STRUCTURAL blind spots — and each entry now
 * carries its class in `CLASSES`, enforced by CLS-01/CLS-02:
 *   - A. intra-file usage (the symbol is used, but never outside its file —
 *        its `export` is superfluous, not the symbol);
 *   - C. structural consumption (duck-typing: the field is read, the TYPE never named);
 *   - D. test seam (exported for `__tests__`, which the corpus excludes by design).
 * What is INTENTIONAL and permanent goes into `ALLOWLIST` below, not the baseline.
 *
 * ⚠️ A 4th class, "string-keyed registry", used to sit here —
 * `setModuleSetup("api", …)` → `runModuleSetup("api")`, the token never
 * appearing at the caller. **It is empty, and its mechanism no longer
 * exists**: the indirection was removed (cf. `globals/globals.core.ts`),
 * the only remaining trace being the comments documenting its removal. It
 * is deleted rather than kept as a precaution: a class no member can belong
 * to any more triages nothing, it gives the illusion of a triage. The 7
 * `globals/globals.*.ts::setup*` it claimed to cover belong to A — they are
 * called IN their own file (e.g. `globals.api.ts`).
 *
 * ⚠️ The classes are NOT disjoint: a type used in its own file to annotate
 * a duck-typed boundary belongs to A AND C. Priority order, most specific
 * to most general: **D > C > A**. Without that order written, two reviewers
 * classify differently and the classification is worth nothing.
 *
 * Usage:
 *   node scripts/check-orphan-exports.cjs                  # gate (blocks on the NEW)
 *   node scripts/check-orphan-exports.cjs --json            # + full JSON dump
 *   node scripts/check-orphan-exports.cjs --update-baseline # regenerates the baseline
 * Exit codes: 0 green (no new candidate) · 1 regression · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
// Through the registry, which throws if the core is unreachable. A literal
// would have let `collectFiles` return an empty list and the gate conclude
// "0 orphan exports".
const CORE_SRC = path.join(require("./lib/packages.cjs").requireByDirName("core").absDir, "src");
const PKG_DIR = path.join(ROOT, "packages");
const EXAMPLES_DIR = path.join(ROOT, "examples");
const BASELINE_PATH = path.join(__dirname, "check-orphan-exports.baseline.json");
const JSON_OUT = process.argv.includes("--json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

/** Relative path normalised to `/` — `path.relative` returns `\` on Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

function candidateKey(c) {
    // ⚠ Normalise: without it, a native Windows run produces
    // `adapters\maplibre\x.ts::Y`, which matches NO baseline key (stored in
    // `/`) — the ~130 known candidates would all resurface as "new". Masked
    // in CI (ubuntu) and by the hook's WSL trampoline, but not locally.
    return `${normPath(c.file)}::${c.name}`;
}

function loadBaseline() {
    try {
        const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
        return new Set(raw.candidates || []);
    } catch {
        return new Set();
    }
}

function writeBaseline(candidates) {
    const keys = candidates.map(candidateKey).sort();
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "Angles morts STRUCTURELS de scripts/check-orphan-exports.cjs — PAS une dette à purger. " +
                    "Ce qui reste ici est ce que la recherche par token ne peut pas voir : usage intra-fichier " +
                    "(A — l'`export` est superflu, pas le symbole), consommation structurelle (C — duck-typing : " +
                    "le champ est lu, le type jamais nommé), et seams de test (D — le corpus exclut __tests__ par " +
                    "conception). CHAQUE entrée doit porter sa classe dans CLASSES (dans le script), sans quoi " +
                    "CLS-01 bloque ; une classe sans entrée correspondante bloque par CLS-02. " +
                    "Ce qui est INTENTIONNEL et permanent va dans ALLOWLIST (dans le script), pas ici. " +
                    "Régénérée via `--update-baseline`. Le gate ne bloque que sur un candidat absent d'ici.",
                generatedCount: keys.length,
                candidates: keys,
            },
            null,
            // 4, not 2 — same reason as check-module-headers.cjs: Prettier owns this
            // file (`tabWidth: 4`) and the commit hook reformatted every line, turning
            // any one-entry change into a whole-file diff.
            4
        ) + "\n"
    );
}

/*
 * ─── Baseline classification ────────────────────────────────────────
 *
 * Each `check-orphan-exports.baseline.json` entry carries ONE class.
 * Without that, the baseline says "here is debt" without saying of what
 * nature: it can neither shrink defensibly, nor be told from an oversight.
 * The three classes are the docblock's, and the priority order **D > C > A**
 * is written there — they are not disjoint.
 *
 * ## How this classification was obtained, and how to REDO it
 *
 * A verdict that cannot be re-measured fossilises. The two criteria are mechanical:
 *
 *   D  the symbol has a real consumer under `__tests__/` and none
 *      elsewhere. Re-measured by a name grep over `packages apps`,
 *      EXCLUDING `dist/`, `deploy/`, `coverage/` and `node_modules/` —
 *      otherwise the emitted `.d.ts` and the `typescript/lib/*.js` copies
 *      count as consumers (measured: `getInternalMap` came out at 35 false positives).
 *   C  a symbol EXPORTED from the same file carries this type in its
 *      signature, and THAT carrier has a consumer outside the file and
 *      outside tests. The caller then builds a literal without ever naming
 *      the type — structural consumption. Holds by TRANSITIVITY:
 *      `ThemeSelectorLike` is carried by `PermalinkGeoLeaf`, itself carried
 *      by `getPermalinkGeoLeaf`, consumed by `permalink-sync.ts`.
 *   A  neither: the symbol is only used in its own file.
 *
 * 25/07/2026 measure: **D 35 · C 32 · A 7 = 74**, and 0 really dead.
 *
 * ⚠️ Two claims this measure refuted, both written here before it:
 *   - the first-pass classification announced "A ~67 · D ~9". It is INVERTED;
 *   - the docblock gave "the 7 `globals/globals.*.ts::setup*` belong to A".
 *     Six out of seven: `setupCoreMap` is imported and called by
 *     `__tests__/core/utils.test.js` and
 *     `__tests__/utils/utils-shape.test.js`, hence **D** by the D > C > A priority.
 */

/** D — test seams: exported for `__tests__/`, which the corpus excludes by design. */
/**
 * U — NOT TRIAGED: the deposit of the 25/08/2026 widening (the net now judges every
 * non-core package's exports). Frozen at the first widened census, SHRINK-ONLY: a triage
 * lot empties entries out of here — to a purge, to ALLOWLIST, or to A/C/D once read.
 * Never add to this list: a new orphan after the widening is a regression, and it must
 * redden as one instead of hiding among the untriaged.
 */
const CLASS_U = [
    "packages/libs/field-renderer/src/lang/index.ts::builtinLangs",
    "packages/libs/field-renderer/src/types/field-media.ts::ACCEPTED_MIME",
    "packages/libs/field-renderer/src/types/image-compress.ts::BASE_QUALITY",
    "packages/libs/field-renderer/src/types/image-compress.ts::CompressionOutcome",
    "packages/libs/field-renderer/src/types/image-compress.ts::MAX_DIMENSION",
    "packages/libs/field-renderer/src/types/image-compress.ts::_fitWithin",
    "packages/libs/field-renderer/src/types/image-compress.ts::compressImage",
    "packages/libs/field-renderer/src/types/image-compress.ts::pickCompressionQuality",
    "packages/plugins/connector/src/entry.ts::_resetAutoBootstrapForTests",
    "packages/plugins/editor/src/add-form/placement-form.ts::AddFormDeps",
    "packages/plugins/editor/src/add-form/placement-form.ts::openAddForm",
    "packages/plugins/editor/src/config.ts::EDITOR_CONFIG_DEFAULTS",
    "packages/plugins/editor/src/drawing/geo-compute.ts::geoCompute",
    "packages/plugins/editor/src/drawing/geo-compute.ts::haversineLength",
    "packages/plugins/editor/src/drawing/geo-compute.ts::shoelaceArea",
    "packages/plugins/editor/src/drawing/placement-api.ts::PublicPlacementOptions",
    "packages/plugins/editor/src/drawing/placement-mode.ts::PlacementOptions",
    "packages/plugins/editor/src/editor-events.ts::EditorEventName",
    "packages/plugins/editor/src/entry.ts::_openEditorForm",
    "packages/plugins/editor/src/events.ts::EDIT_ACTION_OP",
    "packages/plugins/editor/src/history/undo-stack.ts::getRedoDepth",
    "packages/plugins/editor/src/history/undo-stack.ts::getUndoDepth",
    "packages/plugins/editor/src/persistence/conflict-resolution.ts::ConflictResolveContext",
    "packages/plugins/editor/src/persistence/editor-sync-replay.ts::DrainReport",
    "packages/plugins/editor/src/persistence/image-store.ts::RetryReport",
    "packages/plugins/editor/src/persistence/image-store.ts::retryPendingImages",
    "packages/plugins/editor/src/persistence/image-store.ts::uploadImage",
    "packages/plugins/editor/src/persistence/session-export.ts::collectSessionFeatures",
    "packages/plugins/editor/src/persistence/storage-seam.ts::OutboxAccess",
    "packages/plugins/editor/src/persistence/storage-seam.ts::OutboxRow",
    "packages/plugins/editor/src/persistence/storage-seam.ts::StorageWriteFacade",
    "packages/plugins/editor/src/persistence/submit.ts::FeatureSavedDetail",
    "packages/plugins/editor/src/persistence/sync-handler.ts::EditorSyncHandler",
    "packages/plugins/editor/src/persistence/sync-handler.ts::SyncResults",
    "packages/plugins/editor/src/persistence/sync-handler.ts::SyncSummary",
    "packages/plugins/editor/src/selection/host-reconcile.ts::HostMapFacade",
    "packages/plugins/editor/src/selection/host-reconcile.ts::getHiddenHost",
    "packages/plugins/editor/src/types.ts::EditorPoint",
    "packages/plugins/editor/src/types.ts::EditorRenderedFeature",
    "packages/plugins/editor/src/types.ts::MenuPosition",
    "packages/plugins/geocoding/src/provider.ts::AddokProvider",
    "packages/plugins/geocoding/src/provider.ts::CustomProvider",
    "packages/plugins/geocoding/src/provider.ts::NominatimProvider",
    "packages/plugins/geocoding/src/provider.ts::PhotonProvider",
    "packages/plugins/measure/src/annotation-overlays.ts::removeOverlay",
    "packages/plugins/measure/src/floating-menu.ts::destroyMenu",
    "packages/plugins/measure/src/floating-menu.ts::getCurrentTool",
    "packages/plugins/measure/src/floating-menu.ts::getMenuHeight",
    "packages/plugins/measure/src/floating-menu.ts::setMenuPosition",
    "packages/plugins/measure/src/geojson-export.ts::buildGeoJSONBlob",
    "packages/plugins/measure/src/recap-box.ts::renderRecap",
    "packages/plugins/measure/src/tools/tool-custom.ts::getActiveCustomId",
    "packages/plugins/measure/src/types.ts::MeasureGeoJSONSource",
    "packages/plugins/measure/src/types.ts::MeasureLngLat",
    "packages/plugins/measure/src/types.ts::MeasurePoint",
    "packages/plugins/navigation/src/engine/heading.ts::normaliseDegrees",
    "packages/plugins/navigation/src/engine/maneuver.ts::ManeuverAhead",
    "packages/plugins/navigation/src/engine/off-route.ts::OffRouteConfig",
    "packages/plugins/navigation/src/engine/off-route.ts::OffRouteVerdict",
    "packages/plugins/navigation/src/engine/progress.ts::ProgressSample",
    "packages/plugins/navigation/src/engine/runtime.ts::GuidanceConfig",
    "packages/plugins/navigation/src/engine/runtime.ts::GuidanceOptions",
    "packages/plugins/navigation/src/engine/snap.ts::SnapResult",
    "packages/plugins/navigation/src/engine/state-machine.ts::MachineConfig",
    "packages/plugins/navigation/src/engine/state-machine.ts::MachineInput",
    "packages/plugins/navigation/src/platform/geo.ts::GeoWatchFailure",
    "packages/plugins/navigation/src/platform/geo.ts::GeoWatchOptions",
    "packages/plugins/navigation/src/platform/voice.ts::VoiceAnnouncer",
    "packages/plugins/navigation/src/platform/voice.ts::createVoiceAnnouncer",
    "packages/plugins/navigation/src/platform/wake-lock.ts::ScreenWakeLock",
    "packages/plugins/navigation/src/platform/wake-lock.ts::createScreenWakeLock",
    "packages/plugins/navigation/src/public-api.ts::NavigationPublicApi",
    "packages/plugins/navigation/src/ui/camera.ts::FollowCamera",
    "packages/plugins/navigation/src/ui/maneuver-banner.ts::BannerLabels",
    "packages/plugins/navigation/src/ui/maneuver-banner.ts::BannerState",
    "packages/plugins/navigation/src/ui/session-notice.ts::NoticeLabels",
    "packages/plugins/navigation/src/ui/session-notice.ts::SessionNotice",
    "packages/plugins/navigation/src/ui/session-view.ts::ViewSource",
    "packages/plugins/offline-ui/src/cache/corridor-selection.ts::CorridorLever",
    "packages/plugins/offline-ui/src/cache/corridor-selection.ts::CorridorOutcome",
    "packages/plugins/offline-ui/src/cache/corridor-selection.ts::CorridorRefusal",
    "packages/plugins/offline-ui/src/cache/corridor-selection.ts::CorridorSelection",
    "packages/plugins/offline-ui/src/core/engine-signals.ts::unwireEngineSignals",
    "packages/plugins/offline-ui/src/sync/corridor-tiles.ts::TileRef",
    "packages/plugins/offline-ui/src/sync/corridor-tiles.ts::corridorTilesAtZoom",
    "packages/plugins/offline-ui/src/sync/corridor-tiles.ts::densify",
    "packages/plugins/position-share/src/config.ts::ConfigProblem",
    "packages/plugins/position-share/src/config.ts::PositionShareMode",
    "packages/plugins/position-share/src/config.ts::ReceiveConfig",
    "packages/plugins/position-share/src/indicator.ts::isIndicatorVisible",
    "packages/plugins/position-share/src/public-api.ts::PositionSharePublicApi",
    "packages/plugins/print/src/lang/lang-fr.ts::PrintLangDict",
    "packages/plugins/print/src/modal-dom.ts::CheckboxRef",
    "packages/plugins/print/src/page-format.ts::getPageFormat",
    "packages/plugins/print/src/server-fallback.ts::ServerComposeOpts",
    "packages/plugins/print/src/server-fallback.ts::ServerFallbackPayload",
    "packages/plugins/print/src/server-fallback.ts::ServerPageOpts",
    "packages/plugins/realtime-layer/src/public-api.ts::RealtimeLayerPublicAPI",
    "packages/plugins/routing/src/composition.ts::CompositionRefusal",
    "packages/plugins/routing/src/composition.ts::DEFAULT_MAX_WAYPOINTS",
    "packages/plugins/routing/src/config.ts::TravelProfile",
    "packages/plugins/routing/src/entry-point.ts::ActionDetail",
    "packages/plugins/routing/src/entry-point.ts::EntryOutcome",
    "packages/plugins/routing/src/fit-route.ts::Bbox",
    "packages/plugins/routing/src/fit-route.ts::bboxWithin",
    "packages/plugins/routing/src/fit-route.ts::routeBbox",
    "packages/plugins/routing/src/legs.ts::stepNumber",
    "packages/plugins/routing/src/origin.ts::OriginOutcome",
    "packages/plugins/routing/src/origin.ts::OriginRefusal",
    "packages/plugins/routing/src/parse-point.ts::ParsedPoint",
    "packages/plugins/routing/src/polyline.ts::PolylinePrecision",
    "packages/plugins/routing/src/polyline.ts::reencodePolyline",
    "packages/plugins/routing/src/provider.ts::resolveEndpoint",
    "packages/plugins/routing/src/providers/http.ts::FetchOutcome",
    "packages/plugins/routing/src/public-api.ts::RoutingPublicApi",
    "packages/plugins/routing/src/route-cache.ts::clearRouteCache",
    "packages/plugins/routing/src/route-cache.ts::routeCacheSize",
    "packages/plugins/routing/src/route-cache.ts::routeKey",
    "packages/plugins/routing/src/ui/attribution.ts::RouteAttribution",
    "packages/plugins/routing/src/ui/attribution.ts::currentRouteAttribution",
    "packages/plugins/routing/src/ui/itinerary-panel.ts::PanelHandlers",
    "packages/plugins/routing/src/ui/itinerary-panel.ts::PanelRefusal",
    "packages/plugins/routing/src/ui/step-list.ts::StepListProps",
    "packages/plugins/routing/src/ui/waypoint-input.ts::InputRefusal",
    "packages/plugins/routing/src/ui/waypoint-input.ts::WaypointInputHandlers",
    "packages/plugins/table/src/export.ts::buildCSV",
    "packages/plugins/table/src/export.ts::buildGPX",
    "packages/plugins/table/src/export.ts::buildGeoJSONCollection",
    "packages/plugins/table/src/export.ts::buildKML",
    "packages/plugins/table/src/export.ts::downloadFile",
    "packages/plugins/table/src/export.ts::downloadGeoJSON",
    "packages/plugins/table/src/selection-actions.ts::selectRange",
    "packages/plugins/table/src/table-renderer-virtual-scroll.ts::updateVirtualRows",
    "packages/plugins/table/src/table-state.ts::TableEventName",
    "packages/plugins/table/src/types.ts::TableDefaultSort",
    "packages/plugins/table/src/types.ts::TableLayerConfig",
    "packages/plugins/websocket/src/config.ts::HeartbeatConfig",
    "packages/plugins/websocket/src/config.ts::ReconnectConfig",
    "packages/plugins/websocket/src/public-api.ts::GeoLeafWsApi",
];

const CLASS_D = [
    "adapters/maplibre/maplibre-event-subscriptions.ts::trackedCleanupCount",
    "adapters/maplibre/maplibre-hatch-patterns.ts::generateHatchImage",
    "adapters/maplibre/maplibre-primitives.ts::detectGeometryTypes",
    "adapters/maplibre/maplibre-poi-builders.ts::toClusterLayerIds",
    "adapters/maplibre/maplibre-poi-builders.ts::toClusterSourceId",
    "adapters/maplibre/maplibre-style-converter.ts::conditionToExpression",
    "adapters/maplibre/maplibre-style-converter.ts::parseDashArray",
    "capabilities/feature-info/render/lightbox.ts::LightboxManager",
    "capabilities/permalink/share/share-qr.ts::_resetQrLoaderForTests",
    "capabilities/route/apply.ts::endpointsLayerId",
    "capabilities/taxonomy/tint.ts::tintKey",
    "capabilities/theme-selector/theme-selector-secondary.ts::attachDropdownHandler",
    "capabilities/theme-selector/theme-selector-secondary.ts::attachNavButtonHandler",
    "globals/globals.core.ts::setupCoreMap",
    "kernel/api/module-catalog.ts::CATALOG_EXPECTED_ABSENT",
    "kernel/basemaps/hillshade.ts::buildHillshadeSourceSpec",
    "kernel/basemaps/image-source.ts::buildImageSourceSpec",
    "kernel/basemaps/registry.ts::_resetStateForTesting",
    "kernel/basemaps/registry.ts::getInternalMap",
    "kernel/basemaps/terrain.ts::_resetTerrainStateForTesting",
    "kernel/basemaps/terrain.ts::getActiveTerrainBasemapKey",
    "kernel/basemaps/wmts-resolver.ts::_clearWmtsCache",
    "kernel/basemaps/wmts-resolver.ts::_getWmtsCache",
    "kernel/basemaps/wmts-resolver.ts::parseWmtsCapabilities",
    "kernel/config/profile-loader-helpers.ts::validateFilesModules",
    "kernel/geojson/loader/single-layer.ts::applyOgcRefreshedData",
    "kernel/geojson/style-resolver.ts::GeoJSONStyleResolver",
    "kernel/layer-manager/item-controls.ts::renderToggleControls",
    "utils/notify/notify.primitive.ts::createNotifyPrimitive",
    "utils/validators/style-validator-properties.ts::validateCasing",
    "utils/validators/style-validator-properties.ts::validateFillPattern",
    "utils/validators/style-validator-properties.ts::validateFont",
    "utils/validators/style-validator-properties.ts::validateLabelComponent",
    "utils/validators/style-validator-properties.ts::validateStroke",
];

/**
 * C — structural consumption: a carrier exported from the same file
 * transports this type to a consumer that reads its fields without ever
 * naming it (duck-typing). Readable example: `lifecycle.ts` calls
 * `ScaleControl.init(_map, { … })` with a literal and imports
 * `ScaleMapLike`, but never `ScaleControlConfig`.
 */
const CLASS_C = [
    "adapters/maplibre/maplibre-layer-registry.ts::LayerRegistryEntry",
    "adapters/maplibre/maplibre-poi-builders.ts::ClusterSourceOptions",
    "adapters/maplibre/maplibre-poi-builders.ts::PoiEventHandlers",
    "adapters/maplibre/maplibre-style-converter.ts::CirclePaint",
    "adapters/maplibre/maplibre-style-converter.ts::FillExtrusionPaint",
    "adapters/maplibre/maplibre-style-converter.ts::FillPaint",
    "adapters/maplibre/maplibre-style-converter.ts::LinePaint",
    "adapters/maplibre/maplibre-style-transform.ts::OwnedStyleIds",
    "adapters/maplibre/maplibre-style-transform.ts::StyleSpecLike",
    "app/boot-install.ts::BootInstallation",
    "capabilities/filter/types.ts::FilterActionsConfig",
    "capabilities/filter/types.ts::FilterKind",
    "capabilities/permalink/types.ts::PermalinkFilterConfig",
    "capabilities/permalink/types.ts::PermalinkFilterState",
    "capabilities/permalink/types.ts::PermalinkGeoLeaf",
    "capabilities/permalink/types.ts::ThemeSelectorLike",
    "capabilities/scale/scale-control.ts::ScaleControlConfig",
    "kernel/basemaps/basemaps-types.ts::NativeSourceView",
    "kernel/basemaps/basemaps-types.ts::NativeStyleView",
    "kernel/basemaps/ui.ts::BasemapUIConfigInput",
    "kernel/config/geoleaf-config/config-types.ts::DataConfig",
    "kernel/config/geoleaf-config/config-types.ts::LoggingConfig",
    "kernel/config/geoleaf-config/config-types.ts::SecurityConfig",
    "kernel/config/geoleaf-config/config-types.ts::UIConfig",
    "kernel/geojson/core-types.ts::GeoJSONStyleLabelConfig",
    "kernel/geojson/core-types.ts::LayerRegistryLike",
    "kernel/geojson/core-types.ts::MapEventHandler",
    "kernel/geojson/core-types.ts::MapLngLatLike",
    "kernel/geojson/core-types.ts::MapPointLike",
    "kernel/geojson/loader/loader-types.ts::GeoJSONLayerConfigLike",
    "kernel/geojson/loader/loader-types.ts::TaxonomyResolverFeature",
];

/**
 * A — intra-file usage: the symbol lives, its `export` is superfluous. The
 * six `setup*` are called in their own `globals.*.ts` (e.g.
 * `globals.api.ts`); `closeSheet` by its three listeners
 * (`mobile-toolbar-sheet.ts`).
 */
const CLASS_A = [
    "globals/globals.api.ts::setupAPIKernel",
    "globals/globals.config.ts::setupConfig",
    "globals/globals.core.ts::setupSecurity",
    "globals/globals.geojson.ts::setupGeoJSONKernel",
    "globals/globals.storage.ts::setupStorage",
    "globals/globals.ui.ts::setupUIKernel",
    "kernel/ui/mobile/mobile-toolbar-sheet.ts::closeSheet",
];

/**
 * `candidateKey()` key → class. Composed from the three lists above.
 *
 * ⚠️ The composition REFUSES a duplicate. The classes not being disjoint
 * (D > C > A), a key written in two lists would silently take the last
 * one's — the classification would then say something other than what its
 * author believes they wrote.
 */
const CLASSES = (() => {
    // ⚠️ The tuple casts are not decorative: without them, `.map()` infers
    // `string[]` and `new Map(entries)` can no longer resolve its key and
    // value types. The `Map` worked, but it was no longer typed — so
    // `CLASSES.get(...)` returned nothing verifiable.
    const entries = [
        ...CLASS_D.map((k) => /** @type {[string, string]} */ ([k, "D"])),
        ...CLASS_C.map((k) => /** @type {[string, string]} */ ([k, "C"])),
        ...CLASS_A.map((k) => /** @type {[string, string]} */ ([k, "A"])),
        ...CLASS_U.map((k) => /** @type {[string, string]} */ ([k, "U"])),
    ];
    const map = new Map(entries);
    if (map.size !== entries.length) {
        const seen = new Set();
        const dup = entries
            .map(([k]) => k)
            .filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
        console.error(
            `ERROR [check-orphan-exports]: ${[...new Set(dup)].join(", ")} figure(nt) dans ` +
                "plusieurs listes de classe. Priorité D > C > A : n'en garder qu'une."
        );
        process.exit(2);
    }
    return map;
})();

/**
 * CLS-01 / CLS-02 — the classification must cover the baseline, exactly.
 *
 *   CLS-01  a baseline entry without a class → the classification has a hole.
 *   CLS-02  a `CLASSES` key matching no entry → GHOST entry, same defect
 *           `checkAllowlistFresh` hunts on the `ALLOWLIST`: it survives
 *           purges and gives the illusion of a complete triage.
 *
 * Same shape as `checkAllowlistFresh`: returns an array of strings, prints nothing, does not exit.
 */
function checkClassificationComplete(baseline) {
    const problems = [];
    for (const key of [...baseline].sort()) {
        if (!CLASSES.has(key)) problems.push(`${key} — non classé (CLS-01)`);
    }
    for (const key of [...CLASSES.keys()].sort()) {
        if (!baseline.has(key))
            problems.push(`${key} — classé mais absent de la baseline (CLS-02)`);
    }
    return problems;
}

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "coverage", ".turbo", "__tests__"]);
const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

// ─── Allowlist — exports intentionnellement sans consommateur ─────────────────
//
// Key = path relative to `packages/core/src`, in `/`, **exact match** (no
// longer `endsWith`: two files can share a suffix). The case that motivated
// the switch — `dom-helpers.ts` duplicated in `utils/general/` and
// `utils/helpers/` — no longer exists (the facade became
// `utils/general/helpers.ts`, since renamed `helpers-namespace.ts` — the
// other half of that name collision, against `app/app-namespace.ts`, had
// been left intact), but the exact match stays the right rule: robust by
// construction and independent of the absence of homonyms.
//
// Value:
//   "*"   → the whole file is exempted (surface kept as a block);
//   [...] → ONLY these symbols are, the rest of the file stays gated.
//
// Symbol-level is what allows exempting `errors/index.ts`'s 15 public
// members without blinding the file: it ALSO contained two dead types. A
// `"*"` set there would have masked its own dead — and reopened, on a small
// scale, the hole this gate is supposed to close.
//
// `storage-contract.ts` and `geoleaf:popup:action` are NOT here: the
// repo-wide scope finds them alive. Adding them blindly would mask a real
// regression.
//
// ⚠️ This comment said "alive via the PLUGINS", and that was false for the
// second one since its birth: `geoleaf:popup:action`'s only emitter is in
// the CORE (`capabilities/feature-info/render/widget-dispatch.ts`), set on
// 29/07/2026 — no plugin emits or listens to it. The backlog noted the
// contradiction as "premise to re-measure"; measured on 14/08/2026, the
// comment is what was wrong. The CONCLUSION (do not exempt) stays right,
// and that is precisely what made it survive: a false motive under a right
// decision never gets contradicted by a gate.
const ALLOWLIST = {
    // ── An unwire exported FOR THE HARNESS, without which the tests prove nothing ────
    //
    // `unwireEvictionNotice` has no production caller: the core has no
    // teardown path, and `wireEvictionNotice()` is set once and for all by
    // `setupStorage()`. Its consumer is the harness —
    // `__tests__/storage/eviction-notice.test.ts`.
    //
    // ⚠️ **It is not a test comfort, it is what makes the suite
    // falsifiable.» The listener carries a module flag
    // (`_evictionNoticeWired`) that makes any second `wireEvictionNotice()`
    // inoperative — that is the goal: `setupStorage()` is re-callable, and
    // two listeners would show two toasts. Without the unwire, a
    // `beforeEach` could not reset the state: the cases would run on the
    // first one's listener, and the three lifecycle cases (idempotence,
    // unwiring, re-wiring) would come out green **exercising nothing**.
    //
    // The exact case of `unwireEngineSignals` in `offline-ui`, whose survey
    // had concluded "no consumer" — and its de-exporting turned 7 cases red
    // immediately. Same class, same motive: "announced dead ≠ dead".
    "kernel/storage/eviction-notice.ts": ["unwireEvictionNotice"],

    // ── Same class as above — a reset seam the harness needs to make the suite falsifiable.
    //
    // `_resetPmtilesProtocolForTests` clears the module guards of the pmtiles protocol
    // bridge. Without it, the idempotence case (register twice → addProtocol once) would run
    // against the guard set by the PREVIOUS test and prove nothing, and the lazy-loading
    // case could not observe a fresh registration. Production has no unregister path — the
    // protocol lives as long as the page — so no production caller will ever appear.
    "adapters/maplibre/maplibre-pmtiles.ts": ["_resetPmtilesProtocolForTests"],

    // ── A GATE seam: exported to be confronted, not to be called ───────
    //
    // `RENDERED_WIDGETS` is derived from the render table (`Object.keys`),
    // never hand-written, and its only consumer is the parity guard
    // `__tests__/guards/attributes-parity.guard.test.js` — which the corpus
    // excludes by design. Exactly what the arbitration asks: THIS file's
    // decreasing list follows exports and cannot see a declared widget
    // nothing renders, because `AttributeWidget` is a single entry there
    // for the whole union. The seam is what makes the confrontation possible.
    //
    // ⚠️ It therefore does NOT get de-exported: without it, the gate can no
    // longer read what the engine renders, and the latent hole FE-14 cost
    // becomes invisible again.
    "capabilities/feature-info/render/widget-dispatch.ts": ["RENDERED_WIDGETS"],

    // ── A type with no EXTERNAL importer left, and not dead for all that ────
    //
    // `GeoLeafApiController` describes the API controller's shape. Its only
    // out-of-file consumer used to be `kernel/api/geoleaf-api.ts`, which
    // imported it to type its validated accessor — deleted with the
    // duplicate. The gate thus saw it appear as "new export without a consumer".
    //
    // ⚠️ **It is alive, and purging it would be a public-API purge.» Two
    // measures: it types `_APIController` in `GeoLeafApiNamespace` (same
    // file, `:133`) — hence the shape of the object `GeoLeafAPI` exposes —,
    // and it appears on the **published surface**
    // (`docs/reference/API_SURFACE.txt`, `api-types.GeoLeafApiController.*`
    // entries), hence in the integrator's `dist/types/`. Unexported, the
    // published declaration would cite a type nobody can name — the defect
    // already paid for, exactly.
    //
    // The textbook case this gate's message announces: "announced dead ≠ dead".
    "kernel/api/api-types.ts": ["GeoLeafApiController"],

    // ── A PUBLISHED-SURFACE type, without an internal importer by construction ────
    //
    // `SizeByType` is the type of `byType` in the — INFERRED — return of
    // `CacheMetrics.estimateProfileSize()`. It thus ships in `dist/types/`,
    // and it is exported so the integrator can NAME it: unexported, the
    // published declaration cited a type nobody could write.
    //
    // No monorepo file imports it, and none will: its consumer is outside
    // the repo. The very definition of "intentional and permanent", hence
    // ALLOWLIST and not baseline — the baseline is a pending triage, this
    // one is a decision.
    "capabilities/offline/cache/metrics.ts": ["SizeByType"],

    // ── Two TEST seams of the offline report ──────────────────────────────
    //
    // `deriveStatus` carries the truth table of the 5 `LayerOfflineStatus`,
    // and it is this module's only rule that decides without touching the
    // database. Exercising it through `buildSyncReport()` would require
    // manufacturing an IndexedDB state per table row: the assembly would be
    // tested, not the rule — and the row distinguishing
    // `declaredNeverPulled` from "pulled empty" is precisely the one the
    // work exists to hold.
    //
    // `PULL_STATE_KEY` is the `preferences` store's key. It is exported so
    // `layer-pull.test.js` READS it instead of copying it: a duplicated
    // literal would leave the test green the day the production key changed
    // — i.e. the day the marker stopped being reread.
    //
    // ALLOWLIST and not baseline: these are decisions, not a pending triage.
    "capabilities/offline/report/sync-report.ts": ["deriveStatus"],
    "capabilities/offline/report/pull-state.ts": ["PULL_STATE_KEY"],
    // ── `ThemeApplierCore`'s 3 patchers — SIDE-EFFECT modules ────────────
    //
    // Their export has NO consumer, and that is normal: they are not there
    // to be imported by name but to GRAFT 13 methods onto `ThemeApplierCore`
    // at their import (`TA._hideAllLayers = function …`). `core.ts` calls
    // them in `applyTheme()` (`this._hideAllLayers()`,
    // `this._applyLayerConfig(cfg)`, `self._syncLegendVisibility()`)
    // WITHOUT defining them.
    //
    // ⚠️ Inscribed here after a real regression, on 25/07/2026. They were
    // pulled into the graph by the `Object.assign` composing
    // `GeoLeaf._ThemeApplier`; removing that key (no reader) took the
    // patches out with it. THIS GATE, ESLint and human reading then said
    // "dead" in concert — all three right on the letter, wrong on the
    // substance: a side-effect module has no consumer by definition. The
    // suite stayed GREEN (everything touching themes mocks
    // `ThemeApplierCore`); production would have thrown
    // `TypeError: this._hideAllLayers is not a function` at the first theme
    // change.
    //
    // The anchoring is now explicit (`import "…"` in `globals.ui.ts`) and
    // guarded by `__tests__/themes/theme-applier-patching.contract.test.js`.
    "kernel/themes/theme-applier/deferred.ts": ["ThemeApplierDeferred"],
    "kernel/themes/theme-applier/ui-sync.ts": ["ThemeApplierUISync"],
    "kernel/themes/theme-applier/visibility.ts": ["ThemeApplierVisibility"],

    // ── Attribute contract — frozen ONE SPRINT BEFORE its engine ──────────
    // Set on 02/08/2026: the contract and its schema ship BEFORE the engine
    // that reads them. These exports thus have NO consumer by delivery
    // order, not by abandonment — and the `layer-config.schema.json`
    // schema, itself, already applies them.
    //
    // ⚠️ NAMED list and not `"*"`, deliberately: one more export turns the
    // gate red, and it empties entry by entry as the engine consumes them.
    // `checkAllowlistFresh` guards the reverse: an entry whose export
    // vanishes becomes a ghost and blocks. The count is not copied here —
    // it prints at the run.
    //
    // ⚠️ This list was described as "the decreasing baseline of the widget
    // arbitration". It is indeed decreasing and named, but it follows
    // EXPORTS, not WIDGETS: `AttributeWidget` is ONE entry there for the
    // whole union, so a declared widget nothing renders changes nothing
    // there and will never be seen there. What the arbitration wanted to
    // follow is carried by the PARITY guard, which confronts the contract
    // with the render table. Clarified at preflight.
    "contracts/attributes.contract.ts": [
        // `action` widget and `presentation` block — added at preflight
        // (02/08), because the frozen contract could carry neither the
        // action button already emitted nor the profiles' 79 presentation declarations.
        "ActionOptions",
        "AttributeDisplayOnlyWidget",
        "AttributeDisplayPresentation",
        "AttributeEmphasis",
        "AttributeChoice",
        "AttributeComputedSource",
        "AttributeDisplay",
        "AttributeDisplayMode",
        "AttributeEdit",
        "AttributeField",
        "AttributeFieldBase",
        "AttributePrimitive",
        "AttributeSurface",
        "AttributeTableColumn",
        "AttributeWidget",
        "AttributeWidgetOptions",
        "AttributeWidgetPrimitive",
        "BadgeOptions",
        "CheckboxOptions",
        "DateOptions",
        "DropdownOptions",
        "GalleryOptions",
        "GeometryCanonicalType",
        "GeometryDomainName",
        "HoursOptions",
        "ImageOptions",
        // `LayerAttributes` is NOT here: `theme-applier/core.ts` already
        // consumes it. The list is thus at 35 from its laying, not 36 — it
        // can only decrease.
        "LinkOptions",
        "ListOptions",
        "LongtextOptions",
        "MetricOptions",
        "NumberOptions",
        "PlaceholderOnlyOptions",
        "PriceOptions",
        "RadioOptions",
        "RatingOptions",
        "ReviewsOptions",
        "TableOptions",
        "TagsOptions",
        "TextOptions",
    ],

    // ── Sync contract — same regime as the attribute contract ────────────
    // Set on 02/08/2026. The cycle (pull → read local → edit → queue → push
    // → reconcile) is frozen before its implementation; the data foundation
    // comes next, then the cycle itself.
    // `LayerWriteTarget` is NOT here: `theme-applier/core.ts` already consumes it.
    //
    // ⚠️ Named, decreasing list, same contract as above: one more export
    // turns red, and each type leaves the list when its engine consumes it.
    "contracts/sync.contract.ts": [
        "ConflictPolicy",
        "DataOriginDeclaration",
        "DataOriginRole",
        "EvictionClass",
        "FeatureRecord",
        // Per-layer edition permissions — frozen on 02/08, executed at the
        // merge of the two editing plugins.
        "LayerEditionPermissions",
        "LayerOfflineStatus",
        "LayerSyncConfig",
        "LayerSyncMode",
        "LayerSyncReport",
        "LocalId",
        "OutboxEntry",
        "PullGranularity",
        "QuarantineReason",
        "ServerDeletionPolicy",
        "ServerId",
        "StoragePersistenceRegime",
        "SyncOperationKind",
        "SyncState",
        "VersionMarker",
        "WriteAuth",
        "WriteDialect",
    ],

    // ── ✅ THE 4 GLOBAL EXEMPTIONS ARE REMOVED (16/08/2026) ──────────────
    //
    // They covered `api/geoleaf.introspection.ts`,
    // `contracts/introspection.contract.ts`,
    // `contracts/capability.contract.ts` and `kernel/api/plugin-registry.ts`,
    // under the motive "Introspection facade (~850 l., 0 real calls outside
    // JSDoc) — kept for the future SaaS".
    //
    // 🛑 MEASURED: they masked **ZERO** orphans. The 13 exports of these
    // four files all have a real consumer, and none was in the baseline.
    // The motive was right at its date; it no longer is, and neither is its
    // figure — `geoleaf.introspection.ts` is **36 lines**, not 850.
    //
    // ⚠️ AND HERE IS WHY NOBODY COULD SEE IT: `checkAllowlistFresh` carried
    // `if (value === "*") continue;`. **A global exemption was exempted
    // from the staleness check itself.» The only exemption form that could
    // never expire, and exactly why those four survived the purge of their
    // motive.
    //
    // ✅ The wildcard no longer belongs to the vocabulary: the ALLOWLIST
    // accepts ONLY lists of named symbols, and any other value is flagged
    // stale. A fully exempted file must therefore NAME its exports — which
    // makes them visible, hence perishable.
    // ── `GeoLeaf.Errors.*` — alive through the facade, never imported by name ──
    // `kernel-exports.ts` re-exports `Errors`, mounted at boot B1 by
    // `globals.core.ts`. The token-search only sees the aggregate, not its
    // members: canonical example of the "announced dead ≠ dead" trap.
    "utils/errors/errors.ts": [
        "DataError",
        "ErrorCodes",
        "InitializationError",
        "MapError",
        "NetworkError",
        "POIError",
        "RouteError",
        "UIError",
        "createError",
        "createErrorByType",
        "getErrorCode",
        "isErrorType",
        "normalizeError",
        "safeErrorHandler",
        "sanitizeErrorMessage",
    ],

    // ── Anti-prototype-pollution blocklist: the frozen list is test-only ──────
    // `UNSAFE_KEY_LIST` has NO production consumer, and that is wanted: it
    // only exists so `__tests__/guards/prototype-pollution-sinks.guard.test.js`
    // pins the blocklist's content. Having a single source means removing a
    // key weakens the 7 sinks at once, silently — hence a test verifying
    // the list itself, and hence an export whose only reader is that test.
    // The gate excludes `__tests__/` from its scan by design (it measures
    // production consumption), so it cannot see it.
    // Symbol-level and not `"*"`: the file's two other exports,
    // `isUnsafeKey` and `hasUnsafeSegment`, MUST stay gated — the day no
    // sink calls them any more, the guards have gone, and we want to learn
    // it here.
    "utils/general/object-path-guard.ts": ["UNSAFE_KEY_LIST"],

    // ── Duck-typing contracts with the plugins ────────────────────────────
    // These types describe a boundary verified STRUCTURALLY (the plugin
    // declares its own copy): no cross-package import, by design.
    // ── A CONTRACT whose last importer had to abandon it to become publishable ────
    //
    // `GeoLeafAPINamespace` (class **C**, structural consumption) has no
    // importer left since 17/08/2026. Its only consumer was
    // `BootInfoNamespace`, through an `extends`, and it had to be removed:
    // the type had to be publicly EXPORTED (`showBootInfo` published in
    // 3.0.0 but untypeable), yet `contracts/api.contract.js` is NOT in the
    // `exports` map — of the 8 published `./contracts/*` subpaths, it is
    // not there. Keeping the `extends` would have emitted a public
    // declaration referencing a type unresolvable at the consumer's: the
    // `TS2882` class that had just been closed.
    //
    // 🛑 **Why ALLOWLIST and not a purge.» A contract is not consumed by
    // internal imports but by what IMPLEMENTS it: `GeoLeafAPINamespace`
    // describes the shape of the `GeoLeaf` global as the `api/` files read
    // it, and that shape is read **structurally** — the very definition of
    // class C. Removing it would be a contract-surface deletion, a gesture
    // the night does not make and nothing demands.
    //
    // ⚠️ **What this entry admits, and must not be smoothed over**: a
    // contract type whose only importer had to stop using it no longer has
    // a usage witness. If it becomes false, nothing will say so. The
    // subject is filed in the debt register, not closed by this exemption.
    //
    // 🛑 **AND THIS ENTRY WAS NEARLY WRITTEN TWICE.» The first draft of
    // 17/08 added a SECOND `"contracts/api.contract.ts"` key higher in this
    // object; in JS, the last one wins, so the new exemption was
    // **silently overwritten** and the gate kept turning red without saying
    // why. ⚠️ **This sentence said `ALLOWLIST` has NO guard against its own
    // duplicated keys, and that was true on 17/08 and FALSE since**:
    // `checkAllowlistUnique()` exists (see its doc block) and runs on every
    // pass. It is dated rather than deleted, because the motive it carries is
    // what explains the SHAPE of the entry below — merging into the existing
    // entry, rather than duplicating the key, is still the only correct form,
    // and that would be unreadable without the defect that imposed it.
    "contracts/api.contract.ts": ["IGeoLeafAPIConstructors", "IHealthError", "GeoLeafAPINamespace"],
    // ⚠️ `GeoLeafGeolocationStateChangeDetail` is the same case, and
    // particularly literally so: the `geoleaf:geolocation:statechange`
    // event is emitted by the core and read by
    // `plugins/measure/src/tools/tool-gps.ts`, which does not import its
    // type — it reads `e.detail` in duck-typing. The type ships in
    // `dist/types/` so the integrator can NAME it; unexported, the
    // published declaration would cite a type nobody can write. A contract
    // that CROSSES the core → plugin boundary, so "no consumer" is a
    // property there, not a symptom.
    "contracts/event-bus.contract.ts": [
        "GeoLeafFeatureGeometry",
        "GeoLeafLayerAddedDetail",
        "GeoLeafGeolocationStateChangeDetail",
    ],
    // ⚠️ `contracts/sidepanel-renderer.contract.ts` was exempted HERE until
    // 19/08/2026, with the same motive as its neighbours. The file is
    // DELETED: it redeclared, better documented and implemented by nothing,
    // the three `ISidePanelRenderer` members that live in
    // `capabilities/feature-info/types.ts`. Its three own types left with
    // it, at zero importers. 🛑 Its neighbours' motive did NOT apply to it:
    // they are nameable by the integrator through the package's `exports`
    // map, it was not — 36 entries, no wildcard covered it. An embarked but
    // unreachable `.d.ts` is not a public surface, it is tarball weight.
    // **Verify this point BEFORE carrying this motive onto a contract: "it
    // ships in dist/types/" is not enough, a specifier must lead there.**
    // ⚠️ `IProximityCircle` joined this entry on 19/08/2026, and for a
    // motive of ANOTHER nature than its neighbours: it crosses no boundary,
    // it describes the shape of `IProximityState.circle` — a member
    // exported from the SAME file. Its only external importer only served
    // to re-assert an object the assignment target already typed; the
    // assertion removed, the type has no importer left, hence "orphan" in
    // this gate's sense, which counts INTER-FILE consumers.
    // 🛑 The motive is STRUCTURAL and re-verifies in one line:
    // `IProximityCircle` must appear TWICE in
    // `src/contracts/ui-controls.contract.ts` — its declaration and its
    // usage. If only one remains, the exemption fell with its cause and
    // must leave here, because de-exporting it would then become possible
    // without breaking type emission.
    "contracts/ui-controls.contract.ts": ["IGeoLocationControlConfig", "IProximityCircle"],

    // ── Documented shape of the `GeoLeaf.X` objects (integrators / Studio) ────
    // The `buildPublicApi()`s are alive; it is the TYPE of their return
    // that is never imported — it documents the public surface.
    "capabilities/branding/public-api.ts": ["BrandingPublicApi", "BrandingReadApi"],
    "capabilities/coordinates/public-api.ts": ["CoordinatesPublicApi", "CoordinatesReadApi"],
    "capabilities/geolocation/public-api.ts": ["GeolocationStateSnapshot"],
    "capabilities/labels/public-api.ts": ["LabelsPublicApi", "LabelsReadApi"],
    "capabilities/permalink/share/public-api.ts": ["SharePublicApi", "ShareReadApi"],
    "capabilities/scale/public-api.ts": ["ScalePublicApi", "ScaleReadApi"],
    "capabilities/theme-toggle/public-api.ts": ["ThemeTogglePublicApi"],

    // ── Divers, publics par un autre chemin ───────────────────────────────────
    // `CreateElementOptions` types `GeoLeaf.Helpers.createElement`'s
    // option-bag; `LogImplInterface`/`LogLevelName` type `GeoLeaf.Log` and
    // are documented in `log/index.ts` as directly importable (Rollup
    // workaround for the plugins); `PresetId` is the public entry-composition contract.
    "utils/log/logger.ts": ["LogImplInterface", "LogLevelName"],
    "contracts/preset.contract.ts": ["PresetId"],

    // Public through the OBJECT, not a named import.
    // These 3 functions are members of `GeoLeaf.Utils` (mounted by
    // `utils-namespace.ts` via `Object.assign(target, UtilsBase)`). They
    // lost their last *named* production importer when `utils-api.ts` was
    // deleted — an assembler dead since the UMD builds' removal in v2.0.0.
    // The gate reasons on named imports and does not see reach through
    // object property: without this entry it flags them at every run.
    // ⚠️ DO NOT PURGE. `object-utils.ts` already documented this case
    // for `resolveField` ("neither has an internal caller left"): these
    // symbols only subsist through their public exposure, which is exactly
    // their reason for being. Removing them would break `GeoLeaf.Utils` silently.
    "utils/general/utils-base.ts": ["fireMapEvent", "throttle", "resolveField"],

    // ── Named by an inferred signature ────────────────────────────────────────
    // `FetchHelper.getConfig()` returns it and `FetchHelper` is re-exposed
    // on `GeoLeaf.Utils`: de-exporting it breaks `Utils`' declaration (TS4023).
    "utils/general/fetch-helper.ts": ["FetchHelperOptions"],
    // Same constraint: `poiToFeature` is mounted on `GeoLeaf.Utils`
    // (`utils-namespace.ts`) and `PoiToFeatureInput` IS its parameter type
    // — an integrator typing that call needs it, and de-exporting it would
    // break `Utils`' declaration.
    // ⚠️ It became "consumer-less" because its ONLY named importer was the
    // seam copy in `addpoi/src/utils/core-utils.ts`, gone with the merged
    // package. A structural false positive, not a dead export: the
    // function, itself, is called by `e2e/18-security.spec.js` on
    // `deploy-full` — the variant that never carried `addpoi`.
    "utils/general/poi-to-feature.ts": ["PoiToFeatureInput"],
    // Same constraint: `CSRFToken` is part of the barrel's `Security`
    // object, so TypeScript must be able to NAME its type to emit
    // `Security`'s declaration. No consumer imports it by name — a
    // structural false positive, not a dead export.
    "kernel/security/csrf-token.ts": ["CSRFTokenInternal"],

    // Same case, introduced by the `ui/components.ts` split:
    // `_UIComponents` aggregates `_LegendSymbols` + `_UIWidgets` by spread,
    // so its inferred type names these two modules' configs. De-exporting
    // them breaks the aggregate's declaration (TS4023). No named consumer,
    // by design — callers pass literals.
    "kernel/ui/legend-symbols.ts": ["SymbolConfig", "HatchConfig"],
    "kernel/ui/widgets.ts": ["AccordionConfig", "ToggleButtonConfig"],

    // Same TS4023 constraint as `FetchHelperOptions` above:
    // `DOMSecurity.createSVGIcon()` and `.getIcon()` take it as a
    // parameter, and `DOMSecurity` is re-exposed on `GeoLeaf.Utils`
    // (`utils/general/utils-namespace.ts`) — de-exporting it breaks
    // the emission of `Utils`' declaration. The right gesture is thus the
    // ALLOWLIST, NOT the purge.
    //
    // ⚠️ ENTRY STILL INERT — and the note that lived here said the opposite.
    //
    // It was laid PREVENTIVE and without effect: `hasConsumer()` is a token
    // search over the whole monorepo, and `SVGIconOptions` appeared in
    // `packages/plugins/table/src/utils/dom-security.ts` — a LOCAL,
    // unexported COPY that imported nothing from the core. The gate saw a
    // consumer there and held the export alive: the false negative this
    // file's docblock owns.
    //
    // That copy was indeed merged into
    // `@geoleaf/host-runtime/src/core-utils-seam.ts`, and the type was
    // DELIBERATELY renamed `IconOptions` there: keeping it under the same
    // name would have moved the false negative from table to host-runtime
    // instead of lifting it.
    //
    // 🔄 BUT the entry did NOT become active for all that, contrary to what
    // this note asserted from 26/07 to 01/08/2026 ("✅ ENTRY BECOME
    // ACTIVE"). The token survives in `kernel/security/index.ts`, the
    // subsystem's BARREL:
    //     export type { SVGIconOptions } from "./dom-security.js";
    // `collectMonorepoCorpusFiles()` scans every workspace's `<pkg>/src`,
    // hence the core itself, and `hasConsumer()` only skips the DEFINING
    // file. The barrel counts as a consumer. The export is thus never a
    // candidate, and this entry absorbs nothing.
    //
    // Measured by DOUBLE MUTATION on 01/08/2026, not deduced:
    //   1. remove this entry alone            → 0 candidates, gate green  (it absorbs nothing)
    //   2. remove this entry AND line 19      → `SVGIconOptions` resurfaces at
    //      `kernel/security/dom-security.ts`, gate RED, "1 regression"
    // The 2nd branch is what proves the cause; the 1st alone would not
    // have isolated it.
    //
    // The reasoning error, not to repeat: it was VERIFIED that the fork
    // vanished — true — then DEDUCED that the entry bit, without rerunning
    // the check. A lifted obstacle does not prove it was the only one.
    // ⚠️ And `checkAllowlistFresh()` does not catch this class: it verifies
    // the file and symbol still exist, never that the entry SERVES anything.
    //
    // The entry STAYS all the same, and it is not superstition: the TS4023
    // constraint above is real, so the day the barrel stops re-exporting
    // this type, the export becomes orphan for good and this entry is what
    // must absorb it. Removing it now would trade a mute entry for a
    // deferred red gate. Tracked in the debt register.
    "kernel/security/dom-security.ts": ["SVGIconOptions"],

    // Same case again, introduced by the cluster-normalisation
    // mutualisation: `resolveClusteringNormalization()` is exported and
    // returns `ClusteringNormalizationPatch | null`, so TypeScript must be
    // able to NAME that type to emit the function's declaration. No caller
    // imports it by name — both sites pass the result to `Object.assign`.
    "kernel/geojson/loader/clustering-normalize.ts": ["ClusteringNormalizationPatch"],

    // ── The pane registry: one public type, one harness-only teardown ───────────────
    //
    // `PaneHost` is the parameter type of `registerPaneHost()`, which IS exported and
    // consumed (the desktop panel and the mobile sheet each register themselves). TypeScript
    // must be able to NAME the type to emit that function's declaration — the same TS4023
    // constraint as the two entries above. No caller imports it by name: both hosts pass an
    // object literal.
    //
    // `clearPanelPanes` has no production caller, and 🛑 it must NOT acquire one. Panes are
    // declared by plugins whose module body runs ONCE; a `Core.destroy()` that cleared them
    // would leave a later `Core.create()` with no panes at all, because nothing re-imports
    // those bundles. Its consumer is the harness, where it is what makes the suite
    // falsifiable: without it each case would inherit the previous one's registrations.
    //
    // ⚠️ The symmetric mistake was actually MADE while writing this registry: `clearPanelPanes`
    // dropped the hosts too, with a plausible rationale, and three cases of
    // `__tests__/ui/panel-panes.test.ts` went red on the spot. That is the only reason it is
    // not in the shipped bundle — hence the emphasis here.
    "kernel/ui/panel-panes.ts": ["PaneHost", "clearPanelPanes"],
};

/** `"*"` | tableau de symboles | undefined. */
function allowlistFor(relFile) {
    return ALLOWLIST[normPath(relFile)];
}

/**
 * ALW-COND — the exemptions whose motive is VERIFIABLE, and which fall with it.
 *
 * 🛑 Why this table exists. An `ALLOWLIST` entry carries its motive in a
 * comment, and a comment does not fall when its motive falls: the exemption
 * survives its cause and then exempts an export that should be purged.
 * `checkAllowlistFresh` guards the case where the export VANISHES; it can
 * say nothing of the one where the REASON vanishes, the export remaining.
 *
 * Measured on 19/08/2026, on the entry that motivated this table: mutating
 * the cause — removing the internal usage that makes the type
 * non-de-exportable — left the gate GREEN. The written motive was right,
 * and it guarded nothing.
 *
 * An entry is `"<file>::<symbol>"` → predicate over the declaring file's
 * TEXT. The predicate returns `true` when the motive still holds. False ⇒
 * the exemption is REFUSED and the export becomes a candidate again, with
 * the fallen motive named in the output.
 */
const ALLOWLIST_CONDITIONS = {
    // The type names a member exported from its own file — so `tsc` would
    // refuse to emit the declaration if it were not exported. The motive
    // holds as long as that internal usage exists: two occurrences in the
    // file, the declaration and the usage.
    "contracts/ui-controls.contract.ts::IProximityCircle": {
        motif: "le type est encore nommé par un membre exporté de son propre fichier",
        holds: (text) => (text.match(/\bIProximityCircle\b/g) || []).length >= 2,
    },
};

/**
 * ALW-COND-02 — a condition aiming at no exemption is a GHOST condition: it
 * gives the illusion an entry is guarded while the entry was removed. Same
 * defect as CLS-02 on the classification, and it is hunted the same way.
 *
 * @returns {string[]} The problems, empty if the table is aligned with the ALLOWLIST.
 */
function checkAllowlistConditionsFresh() {
    const problems = [];
    for (const key of Object.keys(ALLOWLIST_CONDITIONS).sort()) {
        const [rel, sym] = key.split("::");
        const allow = ALLOWLIST[normPath(rel)];
        if (!allow || !allow.includes(sym)) {
            problems.push(`${key} — condition sans exemption correspondante (ALW-COND-02)`);
        }
    }
    return problems;
}

/**
 * An allowlist entry matching nothing any more is a GHOST entry: it
 * survives purges and silently exempts a file that no longer exists. The
 * project has already been bitten by ghost `sideEffects` entries
 * (PB-1/PB-1bis) — we do not replay that.
 */
/**
 * Hunts the ALLOWLIST's DUPLICATED keys — by rereading the SOURCE, not the object.
 *
 * 🛑 **Why the object cannot answer this question.» In JavaScript, the last
 * key of an object literal silently overwrites the previous one: once
 * `ALLOWLIST` is evaluated, the duplication no longer exists.
 * `Object.keys()` returns a duplicate-free list no matter what. The error's
 * only trace is in the file's TEXT, and that is why this guard goes back to
 * it rather than querying the value.
 *
 * ## What it costs when it happens
 *
 * An exemption added twice is **cancelled** — the first one disappears,
 * while the second is the one just written —, and the gate turns red on a
 * file believed exempted, **without saying why**. Encountered live: you
 * reread your entry, it is there, and the gate keeps refusing.
 *
 * ## Why the neighbouring guard could not see it
 *
 * {@link checkAllowlistFresh} hunts the SYMMETRIC mode: an entry whose
 * target vanished. It starts from the surviving keys and verifies each
 * designates a live file and live exports. A duplicated key points at a
 * **perfectly alive** file — it thus passes that check without reserve.
 * **Guarding against a failure mode does not guard against its
 * symmetric**, and both guards are here because neither subsumes the other.
 *
 * ## The pattern's perimeter, and why it is narrow
 *
 * It only recognises the shape really used in this file: a double-quoted
 * key at the head of a line, followed by `:`. A wider pattern would catch
 * nested objects' keys and comment strings, and return duplicates that are
 * not. The guard thus first delimits the literal, from
 * `const ALLOWLIST = {` to its closing brace, and only looks at the keys of
 * its first indentation level.
 *
 * @returns {string[]} One entry per key seen more than once, with its line
 *          numbers. Empty when all is well — the guard prints nothing and
 *          does not exit by itself.
 */
function checkAllowlistUnique() {
    const src = fs.readFileSync(__filename, "utf8").split("\n");
    const start = src.findIndex((l) => l.startsWith("const ALLOWLIST = {"));
    if (start < 0) {
        // The guard lost its subject: say it, rather than return "no duplicates".
        return ["ALLOWLIST — littéral introuvable dans la source ; la garde n'a rien pu lire."];
    }
    const seen = new Map();
    for (let i = start + 1; i < src.length; i++) {
        if (src[i] === "};") break;
        const m = src[i].match(/^ {4}"([^"]+)"\s*:/);
        if (!m) continue;
        if (!seen.has(m[1])) seen.set(m[1], []);
        seen.get(m[1]).push(i + 1);
    }
    return [...seen.entries()]
        .filter(([, lines]) => lines.length > 1)
        .map(
            ([key, lines]) =>
                `"${key}" — ${lines.length} fois, lignes ${lines.join(", ")}. La dernière écrase ` +
                `les précédentes : l'exemption la plus ancienne est ANNULÉE, en silence.`
        );
}

function checkAllowlistFresh(coreFiles, exportsByFile) {
    const stale = [];
    for (const [rel, value] of Object.entries(ALLOWLIST)) {
        const abs = path.join(CORE_SRC, rel);
        if (!coreFiles.includes(abs)) {
            stale.push(`${rel} — fichier introuvable`);
            continue;
        }
        // 🛑 THE `"*"` WILDCARD NO LONGER EXISTS, and this line said why it
        // had to go. It read `if (value === "*") continue;`: a global
        // exemption was thus **exempted from the staleness check itself**.
        // The four that lived here survived on that account — measured on
        // 16/08/2026, they masked **zero** orphans, and nothing could say
        // so. An exemption that escapes the exemptions' check is the only
        // one that never expires.
        if (!Array.isArray(value)) {
            stale.push(
                `${rel} — valeur non listée (${JSON.stringify(value)}). L'ALLOWLIST n'accepte ` +
                    `QUE des listes de symboles nommés : une exemption globale échapperait à ce ` +
                    `contrôle et survivrait à la purge de sa cible.`
            );
            continue;
        }
        const names = new Set((exportsByFile.get(abs) || []).map((e) => e.name));
        for (const sym of value) {
            if (!names.has(sym)) stale.push(`${rel}::${sym} — export introuvable`);
        }
    }
    return stale;
}

// ─── Collecte de fichiers ──────────────────────────────────────────────────────
function collectFiles(dir, exts, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            collectFiles(full, exts, acc);
        } else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) {
            acc.push(full);
        }
    }
    return acc;
}

function collectCoreSourceFiles() {
    return collectFiles(CORE_SRC, [".ts"], []).filter((f) => !f.endsWith(".d.ts"));
}

/**
 * Widened candidate corpus (25/08/2026): every NON-core workspace package's `src/**\/*.ts`.
 * The net used to judge only the core's exports; the plugins' and libs' own exports were
 * invisible to it — knip sees unreachable FILES there, never a dead export inside a
 * reachable one. First widened census frozen in the baseline (shrink-only); anything
 * intentional-and-permanent goes to ALLOWLIST, as the header rule says.
 */
function collectExtendedSourceFiles() {
    const acc = [];
    for (const pkg of require("./lib/packages.cjs").all()) {
        if (path.basename(pkg.absDir) === "core") continue;
        collectFiles(path.join(pkg.absDir, "src"), [".ts"], acc);
    }
    const files = acc.filter((f) => !f.endsWith(".d.ts"));
    // Anti-vacuity: 390 files at the widening. A collapse below the floor means a broken
    // registry or glob, and "no orphans" from an unscanned corpus must never exit 0.
    if (files.length < 200) {
        throw new Error(
            `check-orphan-exports: extended corpus collapsed (${files.length} files < 200). ` +
                "Refusing to conclude."
        );
    }
    return files;
}

/**
 * Baseline/allowlist key path for a candidate file: core files stay relative to CORE_SRC
 * (compatibility with every existing key), non-core files are repo-relative — the two can
 * never collide, and a plugin path is readable at a glance.
 */
function relOf(file) {
    return file.startsWith(CORE_SRC + path.sep)
        ? path.relative(CORE_SRC, file)
        : path.relative(ROOT, file);
}

function collectMonorepoCorpusFiles() {
    const acc = [];
    // Packages from the workspace registry, and NO swallow.
    //
    // The previous form did `try { readdirSync(PKG_DIR) } catch { pkgEntries = [] }`,
    // which is the most dangerous shape in this file: an unreadable packages/ yielded
    // an EMPTY corpus, and an orphan-export check against an empty corpus finds no
    // orphans and exits 0. The gate reported success precisely when it could not run.
    // A registry failure now propagates.
    for (const pkg of require("./lib/packages.cjs").all()) {
        collectFiles(path.join(pkg.absDir, "src"), [".ts", ".tsx", ".js"], acc);
    }
    collectFiles(EXAMPLES_DIR, [".ts", ".tsx", ".js"], acc);
    if (acc.length === 0) {
        throw new Error(
            "check-orphan-exports: the monorepo corpus is empty. Refusing to report " +
                "'no orphans' from a corpus that could not be built."
        );
    }
    return acc;
}

// ─── Named-export extraction (TypeScript compiler API) ────────────────────────
function modifiersOf(stmt) {
    return ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) || [] : [];
}

function extractExports(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    const found = [];

    for (const stmt of sf.statements) {
        const mods = modifiersOf(stmt);
        const hasExport = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
        const line = sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;

        if (hasExport && !isDefault) {
            if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
                if (stmt.name) found.push({ name: stmt.name.text, line, literal: null });
            } else if (
                ts.isInterfaceDeclaration(stmt) ||
                ts.isTypeAliasDeclaration(stmt) ||
                ts.isEnumDeclaration(stmt)
            ) {
                found.push({ name: stmt.name.text, line, literal: null });
            } else if (ts.isVariableStatement(stmt)) {
                for (const decl of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name)) {
                        const literal =
                            decl.initializer && ts.isStringLiteral(decl.initializer)
                                ? decl.initializer.text
                                : null;
                        found.push({ name: decl.name.text, line, literal });
                    }
                }
            }
        }

        // `export { A, B as C }` (local re-export) and `export * as ns from "./x"`.
        if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
            if (ts.isNamedExports(stmt.exportClause)) {
                for (const spec of stmt.exportClause.elements) {
                    found.push({ name: spec.name.text, line, literal: null });
                }
            } else if (ts.isNamespaceExport(stmt.exportClause)) {
                found.push({ name: stmt.exportClause.name.text, line, literal: null });
            }
        }
    }

    return found;
}

// ─── Corpus (comments stripped, tokenised) ─────────────────────────────────────
function stripComments(text) {
    // Sufficient for this grep, not a real parser: avoids purely-JSDoc
    // false "alive" (the Introspection case); a "//" in a string literal
    // can truncate wrongly, a rare and riskless case (biases towards the
    // false negative, not the false positive).
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadCorpus(files) {
    const corpus = [];
    for (const f of files) {
        let raw;
        try {
            raw = fs.readFileSync(f, "utf8");
        } catch {
            continue;
        }
        const stripped = stripComments(raw);
        const tokens = new Set(stripped.match(IDENTIFIER_RE) || []);
        corpus.push({ file: path.resolve(f), content: stripped, tokens });
    }
    return corpus;
}

function hasConsumer(exp, definingFile, corpus) {
    const defResolved = path.resolve(definingFile);
    for (const entry of corpus) {
        if (entry.file === defResolved) continue;
        if (entry.tokens.has(exp.name)) return true;
        if (exp.literal && entry.content.includes(exp.literal)) return true;
    }
    return false;
}

// ─── Run ────────────────────────────────────────────────────────────────────────
function main() {
    let coreFiles, extendedFiles, corpusFiles;
    try {
        coreFiles = collectCoreSourceFiles();
        extendedFiles = collectExtendedSourceFiles();
        corpusFiles = collectMonorepoCorpusFiles();
    } catch (e) {
        console.error("✖ check-orphan-exports: erreur de collecte des fichiers —", e.message);
        process.exit(2);
    }

    if (coreFiles.length === 0) {
        console.error("✖ check-orphan-exports: aucun fichier trouvé dans packages/core/src.");
        process.exit(2);
    }
    console.log(
        `ℹ check-orphan-exports: corpus jugé — ${coreFiles.length} fichiers core + ` +
            `${extendedFiles.length} fichiers plugins/libs (élargi le 25/08/2026).`
    );

    const corpus = loadCorpus(corpusFiles);
    const candidates = [];
    const fallenExemptions = [];
    const exportsByFile = new Map();

    for (const file of [...coreFiles, ...extendedFiles]) {
        let exportsFound;
        try {
            exportsFound = extractExports(file);
        } catch (e) {
            console.error(`✖ check-orphan-exports: échec de parsing sur ${file} —`, e.message);
            process.exit(2);
        }
        exportsByFile.set(file, exportsFound);

        const relFile = relOf(file);
        const allow = allowlistFor(relFile);
        // No more wildcard: `allow` is either `undefined` or a list of
        // symbols. A fully exempted file thus declares itself by NAMING its
        // exports, which makes them visible to `checkAllowlistFresh` — and
        // hence perishable.

        for (const exp of exportsFound) {
            if (allow && allow.includes(exp.name)) {
                const cond = ALLOWLIST_CONDITIONS[`${normPath(relFile)}::${exp.name}`];
                // No condition = unconditional exemption, as before. A
                // condition that no longer holds does not turn the gate red
                // by itself: it WITHDRAWS the exemption, and the export is
                // judged on the merits like any other.
                if (!cond || cond.holds(fs.readFileSync(file, "utf8"))) continue;
                fallenExemptions.push(`${relFile}::${exp.name} — ${cond.motif}`);
            }
            if (!hasConsumer(exp, file, corpus)) {
                candidates.push({ file: relFile, line: exp.line, name: exp.name });
            }
        }
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ candidates }, null, 2));
    }

    // A duplicated key cancels an exemption without saying so — and it
    // makes the staleness check below uninterpretable, since it will never
    // see the overwritten entry. This check therefore runs FIRST.
    const dupes = checkAllowlistUnique();
    if (dupes.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${dupes.length} clé(s) d'allowlist dupliquée(s) —\n`
        );
        for (const d of dupes) console.error(`  ${d}`);
        console.error(
            "\nFusionner les entrées en une seule, en réunissant leurs symboles. Une clé\n" +
                "dupliquée ne se voit pas à l'exécution : l'objet évalué n'en garde qu'une, et\n" +
                "la gate refuse alors un fichier dont l'exemption est pourtant écrite."
        );
        process.exit(1);
    }

    // ALW-COND-02 — a condition guarding nothing any more, before any verdict.
    const orphanConds = checkAllowlistConditionsFresh();
    if (orphanConds.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${orphanConds.length} condition(s) d'allowlist sans exemption —\n`
        );
        for (const c of orphanConds) console.error(`  ${c}`);
        console.error(
            "\nL'exemption a été retirée mais sa condition est restée. Elle ne garde plus rien\n" +
                "et donne l'illusion qu'une entrée est vérifiée : retirer l'entrée de\n" +
                "`ALLOWLIST_CONDITIONS`."
        );
        process.exit(1);
    }

    // ALW-COND — an exemption whose motive fell no longer applies. SAY it,
    // because an export becoming a candidate again without explanation
    // rereads as a regression.
    if (fallenExemptions.length > 0) {
        console.error(
            `⚠️  check-orphan-exports: ${fallenExemptions.length} exemption(s) NON APPLIQUÉE(S) — ` +
                `leur motif est tombé :\n`
        );
        for (const f of fallenExemptions) console.error(`  ${f}`);
        console.error(
            "\nCes exports sont jugés comme les autres ci-dessous. Si le motif est vraiment\n" +
                "caduc, retirer l'entrée d'`ALLOWLIST` ET sa condition ; s'il a seulement changé\n" +
                "de forme, mettre à jour le prédicat — pas le supprimer.\n"
        );
    }

    // A rotting allowlist exempts silently — verify it BEFORE any verdict.
    const stale = checkAllowlistFresh(coreFiles, exportsByFile);
    if (stale.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${stale.length} entrée(s) d'allowlist obsolète(s) —\n`
        );
        for (const s of stale) console.error(`  ${s}`);
        console.error(
            "\nLa cible a été purgée ou renommée : retirer l'entrée d'`ALLOWLIST`\n" +
                "(scripts/check-orphan-exports.cjs). Une entrée fantôme exempte un fichier\n" +
                "qui n'existe plus et masquera le prochain export mort qui prendra sa place."
        );
        process.exit(1);
    }

    if (UPDATE_BASELINE) {
        writeBaseline(candidates);
        console.log(
            `✓ check-orphan-exports: baseline régénérée (${candidates.length} candidat(s) figé(s) dans ` +
                `${path.relative(ROOT, BASELINE_PATH)}).`
        );
        process.exit(0);
    }

    const baseline = loadBaseline();

    // ⚠️ AFTER the `--update-baseline` block above, and it is structural:
    // placed before it, this check would forbid REGENERATING the baseline
    // at the precise moment a new candidate has no class yet — the gate
    // would lock itself. The correct order is: regenerate, then the next
    // normal run turns red as long as the class is missing.
    const unclassified = checkClassificationComplete(baseline);
    if (unclassified.length > 0) {
        console.error(
            `✖ check-orphan-exports: ${unclassified.length} écart(s) entre la baseline et son ` +
                "classement —\n"
        );
        for (const p of unclassified) console.error(`  ${p}`);
        console.error(
            "\nChaque entrée de la baseline porte UNE classe dans `CLASSES`\n" +
                "(scripts/check-orphan-exports.cjs) : A usage intra-fichier · C consommation\n" +
                "structurelle · D seam de test, priorité D > C > A. Une baseline non classée ne\n" +
                "dit pas de quelle nature est sa dette, donc elle ne peut pas rétrécir ; une clé\n" +
                "classée sans entrée est une entrée fantôme, qui simule un tri complet."
        );
        process.exit(1);
    }

    const known = candidates.filter((c) => baseline.has(candidateKey(c)));
    const fresh = candidates.filter((c) => !baseline.has(candidateKey(c)));

    if (candidates.length === 0) {
        console.log(
            `✓ check-orphan-exports: aucun export orphelin (${coreFiles.length} fichiers core, ` +
                `${corpusFiles.length} fichiers de corpus analysés).`
        );
        process.exit(0);
    }

    if (known.length > 0) {
        console.log(
            `ℹ check-orphan-exports: ${known.length} candidat(s) déjà connu(s) (baseline — ` +
                "non bloquant)."
        );
    }

    if (fresh.length === 0) {
        console.log(
            `✓ check-orphan-exports: aucun NOUVEL export orphelin (${known.length} déjà en baseline, non bloquant).`
        );
        process.exit(0);
    }

    console.error(`✖ check-orphan-exports: ${fresh.length} NOUVEL export(s) sans consommateur :\n`);
    for (const c of fresh) {
        console.error(`  ${c.file}:${c.line}  ${c.name}`);
    }
    console.error(
        `\n${fresh.length} régression(s) — vérifier avant de purger (« annoncé mort ≠ mort »), ` +
            "ajouter à ALLOWLIST si volontaire, ou régénérer la baseline (--update-baseline) " +
            "si c'est un candidat légitime destiné au tri."
    );
    process.exit(1);
}

main();
