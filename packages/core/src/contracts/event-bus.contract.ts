/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — EventBus (public type boundary)
 *
 * Formal TypeScript types for the GeoLeaf DOM event bus.
 * The implementation lives in `kernel/events/event-bus.ts`.
 */

// ── Detail payload types ─────────────────────────────────────────────────────

/**
 * Detail payload for `geoleaf:poi:click`.
 *
 * 🛑 **DECLARED, NEVER EMITTED — the only key of the map in that state.** Measured on
 * 17/08/2026: of the 49 events in `GeoLeafEventMap`, 48 are named by emitting code;
 * this one is named by none. Subscribing to `geoleaf:poi:click` therefore triggers
 * nothing today, whatever the interaction.
 *
 * ⚠️ **The `source` field has no referent anymore.** Its two values used to distinguish a
 * click coming from a popup from a direct click on the marker; the POI subsystem was
 * dissolved and nobody computes that distinction anymore. **It is not removed** — the
 * interface has been published on npm since 12/08/2026, and removal would break any
 * consumer reading `e.detail.source`. It is **documented as referent-less**, which is
 * reversible where deletion is not.
 *
 * 📌 To react to a POI click today, the event that actually fires is
 * `geoleaf:poi:panel:open` (see {@link GeoLeafPoiPanelOpenDetail}).
 *
 * Re-measure rather than copy — this sentence becomes false the day an emitter is
 * wired. The command, written WITHOUT a directory glob on purpose:
 *
 * ```bash
 * grep -rn --include=*.ts "geoleaf:poi:click" packages
 * ```
 *
 * ⚠️ Do not reintroduce a path like `packages/<star>/src` here: the star-slash
 * sequence **closes the block comment**, and the file stops compiling. Measured in this
 * very file on 17/08/2026 — 14 gates fell at once, all cascading from `Build`, because
 * a sentence documenting a re-measure command had terminated itself.
 */
export interface GeoLeafPoiClickDetail {
    poiId: string;
    layerId: string;
    /** ⚠️ Referent-less since the POI subsystem was dissolved. See the header above. */
    source: "popup" | "direct";
}

/** Detail payload for `geoleaf:poi:panel:open` */
export interface GeoLeafPoiPanelOpenDetail {
    poiId: string;
    poiName: string;
}

/** Detail payload for `geoleaf:poi:panel:close` */
export interface GeoLeafPoiPanelCloseDetail {
    poiId: string;
}

/**
 * Detail payload for `geoleaf:panel:opened` and `geoleaf:panel:closed`.
 *
 * 🛑 **This is NOT the same panel as `geoleaf:poi:panel:*` above, and the two pairs
 * look alike enough to be confused.** This one describes the desktop **tabbed side
 * panel** (`kernel/ui/desktop/desktop-panel.ts` — layers, filters, themes); that one
 * describes the **feature-information** panel, opened by clicking a POI. One is
 * identified by a tab, the other by a POI — hence two distinct payloads rather than a
 * shared payload that would have made the confusion painless.
 */
export interface GeoLeafPanelToggleDetail {
    /** Tab identifier — `"layers"`, `"filter"`, `"themes"`… depending on the profile. */
    tabId: string;
}

/** Detail payload for `geoleaf:layer:toggle` */
export interface GeoLeafLayerToggleDetail {
    layerId: string;
    visible: boolean;
    source: "user" | "theme" | "zoom" | "system";
}

/**
 * Detail payload for `geoleaf:layer:added`.
 *
 * Dispatched once per GeoLeaf layer right after its MapLibre source + sub-layers
 * are created (GeoJSON layers and POI cluster groups). Lets capability plugins
 * (e.g. taxonomy) apply per-layer paint/layout once the layer exists, without polling.
 */
export interface GeoLeafLayerAddedDetail {
    /** GeoLeaf layer id that was just added to the map. */
    layerId: string;
    /** MapLibre source id backing the layer (`gl-src-<layerId>` by default). */
    sourceId: string;
    /**
     * GeoJSON geometry-type vocabulary present on the layer
     * (e.g. `["Polygon"]`, `["Point"]`, `["LineString", "Polygon"]`).
     */
    geometryTypes: readonly string[];
}

/**
 * Minimal structural view of a GeoJSON geometry carried on feature-interaction
 * events. Kept structural (not the full `GeoJSONGeometry` union) so the contract
 * stays dependency-free and the payload survives the event bus' JSON clone.
 */
export interface GeoLeafFeatureGeometry {
    /** Geometry type, e.g. `"Point"`, `"LineString"`, `"Polygon"`. */
    type: string;
    /** Raw coordinate array (shape depends on `type`). */
    coordinates?: unknown;
}

/**
 * Detail payload for `geoleaf:feature:click`.
 *
 * Dispatched when a user clicks an interactive GeoJSON / vector-tile feature.
 * Cluster aggregates and POI markers are excluded (POI emits `geoleaf:poi:click`).
 * Lets the `feature-info` capability open the popup / side-panel without the
 * kernel knowing how attributes are rendered.
 */
export interface GeoLeafFeatureClickDetail {
    /** GeoLeaf layer id the feature belongs to. */
    layerId: string;
    /** Stable feature id, or `null` when the source has none. */
    featureId: string | number | null;
    /** Feature properties (attribute bag). */
    properties: Record<string, unknown>;
    /** Feature geometry, or `null` when unavailable. */
    geometry: GeoLeafFeatureGeometry | null;
    /** Geographic position of the click. */
    lngLat: { lat: number; lng: number };
    /** Pixel coordinates within the map container at the click point. */
    point: { x: number; y: number };
}

/**
 * Detail payload for `geoleaf:feature:hover`.
 *
 * Dispatched on pointer move (`phase: "move"`) and leave (`phase: "leave"`) over
 * an interactive GeoJSON / vector-tile feature. `zIndex` lets a consumer show
 * only the topmost overlapping layer's tooltip. On `"leave"`, feature fields are
 * reset (`featureId: null`, empty `properties`).
 */
export interface GeoLeafFeatureHoverDetail {
    /** GeoLeaf layer id the feature belongs to. */
    layerId: string;
    /** Stable feature id, or `null`. */
    featureId: string | number | null;
    /** Feature properties (empty on `"leave"`). */
    properties: Record<string, unknown>;
    /** Pointer position. */
    lngLat: { lat: number; lng: number };
    /** Pixel coordinates within the map container at the pointer position. */
    point: { x: number; y: number };
    /** Layer stacking order — for tooltip priority across overlapping layers. */
    zIndex: number;
    /** `"move"` while hovering, `"leave"` when the pointer exits the feature. */
    phase: "move" | "leave";
}

/** Detail payload for `geoleaf:filter:apply` */
export interface GeoLeafFilterApplyDetail {
    layerIds: string[];
    geometryType?: string;
    activeCount: number;
}

/** Detail payload for `geoleaf:filter:reset` */
export interface GeoLeafFilterResetDetail {
    layerIds?: string[];
}

/** Detail payload for `geoleaf:map:move` */
export interface GeoLeafMapMoveDetail {
    center: { lat: number; lng: number };
    zoom: number;
}

/** Detail payload for `geoleaf:map:zoom` */
export interface GeoLeafMapZoomDetail {
    zoom: number;
    oldZoom: number;
    center: { lat: number; lng: number };
}

/** Detail payload for `geoleaf:plugin:loaded` */
export interface GeoLeafPluginLoadedDetail {
    name: string;
    version: string | null;
}

/** Detail payload for `geoleaf:plugin:lazy-loaded` */
export interface GeoLeafPluginLazyLoadedDetail {
    name: string;
}

/** Detail payload for `geoleaf:plugin:failed` */
export interface GeoLeafPluginFailedDetail {
    name: string;
    error: string;
}

// ── Editor seam (plugin-emitted, task 7.3) ───────────────────────────────────
//
// ⚠️ These ten shapes are NOT exported, unlike the `*Detail` types above — and the
// asymmetry is measured, not stylistic. Those have real, named consumers; these would
// have none: the plugin reaches them through `GeoLeafEventMap[K]`, and an integrator
// does the same (`GeoLeafEventMap["geoleaf:editor:feature-saved"]`), an indexed access
// that cannot diverge from the map. Exporting them would have added ten public names
// nobody calls — `check-orphan-exports` indeed reported them as ten regressions when
// tried. Same arbitration as `AttributeCaptureWidget` in the capture contract.

/**
 * Minimal structural view of a feature as the editor plugin hands it around.
 *
 * ⚠️ Structural rather than imported: `packages/core/src/` must never reference
 * `@geoleaf-plugins/*` (règle `no-plugin-in-core`), and `contracts/` is a type-only
 * surface. The plugin's own `EditorFeature` / `SavedFeature` stay assignable to these
 * shapes — and that is not left to goodwill: the editor IMPORTS these types rather than
 * re-declaring them, the same move `entry.ts` already makes for the toolbar seam after
 * seven plugins carried four divergent forms of it.
 */
interface GeoLeafEditorFeature {
    /** Host-layer feature id. Absent for a brand-new feature (assigned on save). */
    id?: string;
    geometry: GeoLeafFeatureGeometry;
    /** Attribute bag from the capture form. */
    properties: Record<string, unknown>;
}

/**
 * A feature as it comes off the DRAWING engine, before any attribute is captured.
 *
 * ⚠️ Distinct from {@link GeoLeafEditorFeature}, and the distinction is MEASURED, not
 * stylistic: `geoleaf:editor:feature-created` carries a full GeoJSON `Feature` whose `id`
 * is `string | number` (the drawing engine's own identifier), whereas the persistence
 * shape carries a host-layer id that is always a string. The first draft of this contract
 * used one type for both — the compiler refused it on the first typecheck, which is the
 * whole point of typing the emitters against the map rather than beside it.
 */
interface GeoLeafEditorDrawnFeature {
    type: "Feature";
    /**
     * Drawing-engine identifier — NOT the host-layer feature id.
     *
     * ⚠️ STRICT optional, not `| undefined`. `@types/geojson` does declare
     * `id?: string | number | undefined` on `Feature`, and mirroring that compiled — but
     * `check-exact-optional-debt` (EOD-01) refused it with the right argument: the key
     * could then be PRESENT while holding `undefined`, and overwrite a default in a
     * spread merge. The emission site therefore inserts `id` conditionally
     * (`editor/src/events.ts`), which also keeps the payload faithful to what a JSON
     * round-trip would do — `JSON.stringify` drops an `undefined`, it does not carry it.
     */
    id?: string | number;
    geometry: GeoLeafFeatureGeometry;
    properties: Record<string, unknown>;
}

/** Detail payload for `geoleaf:editor:feature-created`. */
interface GeoLeafEditorFeatureCreatedDetail {
    /** The freshly drawn feature, before any attribute is captured. */
    feature: GeoLeafEditorDrawnFeature;
    /** Canonical GeoJSON geometry type, e.g. `"Point"`. */
    geometryType: string;
}

/** Detail payload for `geoleaf:editor:feature-saved`. */
interface GeoLeafEditorFeatureSavedDetail {
    featureId: string;
    layerId: string;
    /** The feature as CONFIRMED by the backend — may differ from what was sent. */
    saved: GeoLeafEditorFeature & {
        id: string;
        layerId: string;
        /** Optimistic-concurrency token, when the backend exposes one. */
        version?: string | number;
    };
    /** `false` for a creation, `true` for a modification. */
    isUpdate: boolean;
}

/** Detail payload for `geoleaf:editor:feature-deleted`. */
interface GeoLeafEditorFeatureDeletedDetail {
    featureId: string;
    layerId: string;
}

/**
 * Detail payload for `geoleaf:editor:feature-conflict`.
 *
 * Emitted when the backend answers 409: the local edit and the server state are both
 * carried so a host can arbitrate without re-fetching.
 */
interface GeoLeafEditorFeatureConflictDetail {
    featureId: string;
    layerId: string;
    /** The local edit the user attempted to persist. */
    localFeature: GeoLeafEditorFeature;
    /** The server's current state of the feature (parsed 409 body). */
    serverData: unknown;
}

/** Detail payload for `geoleaf:editor:feature-moved`. */
interface GeoLeafEditorFeatureMovedDetail {
    featureId: string;
    layerId: string;
    /** Geometry captured at selection time — what an undo would restore. */
    oldGeom: GeoLeafFeatureGeometry;
    newGeom: GeoLeafFeatureGeometry;
}

/** Detail payload for `geoleaf:editor:vertex-added` and `geoleaf:editor:vertex-deleted`. */
interface GeoLeafEditorVertexChangedDetail {
    featureId: string;
    layerId: string;
    /** Vertex count AFTER the change. */
    vertexCount: number;
    newGeom: GeoLeafFeatureGeometry;
}

/** Detail payload for `geoleaf:editor:feature-sync-queued`. */
interface GeoLeafEditorSyncQueuedDetail {
    /** Operation kind — `"create"`, `"update"` or `"delete"`. */
    kind: string;
    layerId: string;
    /** Identifier of the queue entry, for correlation with the flush report. */
    entryId: string;
}

/** Detail payload for `geoleaf:editor:feature-sync-flushed`. */
interface GeoLeafEditorSyncFlushedDetail {
    pushed: number;
    failed: number;
}

/**
 * Payload of `geoleaf:geolocation:statechange` — the position watch started or stopped.
 *
 * ⚠️ **Emitted on the MAP CONTAINER, not through the bus** (`capabilities/geolocation/geolocation.ts`),
 * with `bubbles: true` — it therefore bubbles up to `document` and can be listened to both ways.
 *
 * 🛑 It was named `gl:geoloc:statechange` until 16/08/2026, and that name made it
 * **invisible to EM-01**, whose recognition is anchored on `^geoleaf:`. This was not a
 * debt recorded anywhere: it was a blind spot that showed up in no count. The
 * `docs/specs/capacites/geolocation.md` sheet even documented it as deliberate — an
 * accurate fact can describe a blindness without fixing it.
 */
export interface GeoLeafGeolocationStateChangeDetail {
    /** `true` when the watch starts, `false` when it stops. */
    active: boolean;
}

/**
 * Detail payload for `geoleaf:cache:evicted` — a cache made room for itself.
 *
 * 🛑 THERE ARE **TWO** PRODUCERS, AND THAT IS DELIBERATE. The pattern recommended
 * elsewhere — a single emission point guarded by a test, precedent `editor-events.ts` —
 * is not reachable here: the two stores evict from different contexts, and no code can
 * be shared between them.
 *
 * | Producer | Store | What triggers it |
 * |---|---|---|
 * | `capabilities/offline/cache/cache-manager.ts` (`_enforceCacheQuota`) | IndexedDB | end of a profile download, `maxCacheBytes` budget exceeded |
 * | `kernel/storage/sw-core.js` → `kernel/storage/sw-register.ts` | Cache API | origin-quota pressure, or a write refused for quota |
 *
 * The second goes through a `postMessage`: a Service Worker has no `document`, and it is
 * copied verbatim into the deploy variants — it can import neither this contract nor the
 * bus. `sw-register.ts` is the only place that re-establishes the signal on `document`.
 *
 * ⚠️ `freedBytes` is **absent on the Cache API side**, and that is not an oversight: the
 * Cache API exposes no entry size. `offline-ui` already omits the size when missing —
 * fabricating a number would be worse than staying silent.
 */
export interface GeoLeafCacheEvictedDetail {
    /** Number of records ACTUALLY removed. */
    evicted: number;
    /** Bytes reclaimed — known on the IndexedDB side only. */
    freedBytes?: number;
    /** Store size before eviction (bytes on IndexedDB, entry count on Cache API). */
    totalBefore?: number;
    /** Store size after eviction, same unit as {@link totalBefore}. */
    totalAfter?: number;
    /** Which store evicted. Absent = IndexedDB, the historical shape. */
    store?: "indexeddb" | "cache-api";
    /**
     * Why. `pressure` = the ORIGIN quota is close to saturation; `quota` = a write was
     * refused. The worker's routine trim does not emit — it runs on every pan, and one
     * toast per map move teaches users to stop reading them.
     */
    reason?: "pressure" | "quota";
}

/**
 * Detail payload for `geoleaf:popup:action`.
 *
 * Dispatched when a user clicks a popup or side-panel action button (`type: "action"` in
 * `popup.fields`). Listen via `GeoLeaf.events.on("geoleaf:popup:action", …)`.
 *
 * ## The payload is NOT JSON — and that is the point
 *
 * Five fields are plain data; `button`, `setBusy` and `close` are a live DOM node and two
 * closures. The key therefore lives in {@link GeoLeafRawEventMap}, not in the sanitising bus,
 * which would have delivered them as `{}` and `undefined` **without any error**.
 *
 * ⚠️ **Consequence for subscribers, and it is the only breaking part of this change:**
 * `JSON.stringify(e.detail)` now **throws** (circular DOM reference), and passing the detail to
 * `postMessage` / a `Worker` throws `DataCloneError`. Copy the fields you need instead:
 * `const { actionId, layerId, featureId, properties } = e.detail;`
 *
 * ## Attack surface, stated rather than implied
 *
 * This is a `document` event: any script on the page can hear it, and therefore any script can
 * now call `close()` or `setBusy()` on the popup. That is a real widening — and an acceptable
 * one, because the same script can already do
 * `document.querySelector(".gl-poi-popup__action").click()`. The confidentiality rule on
 * `properties` below is what actually guards this channel, and it is unchanged.
 *
 * @example Handle an action, showing progress and closing on success. Subscribe with
 * `GeoLeaf.Events.on("geoleaf:popup:action", (e) => onPopupAction(e.detail))`.
 * ```ts
 * function onPopupAction(d: GeoLeafPopupActionDetail): void {
 *     if (d.actionId !== "tickets:create-request") return;
 *     d.setBusy(true);
 *     void createRequest(d.featureId)
 *         .then(() => d.close())
 *         .finally(() => d.setBusy(false));
 * }
 * ```
 */
export interface GeoLeafPopupActionDetail {
    /** Opaque action identifier from the button config. */
    actionId: string;
    /** Layer the feature belongs to. */
    layerId: string;
    /** Feature/POI identifier (null when the source has no stable id). */
    featureId: string | number | null;
    /**
     * Whitelisted subset of feature properties, per the `payloadFields` option of the button.
     *
     * ⚠️ **Without `payloadFields`, this is `{}`** — the default goes to confidentiality, not
     * convenience, because this is a document event any script on the page can hear. There is
     * no "send everything" mode, and adding one is not a configuration gap.
     */
    properties: Record<string, unknown>;
    /** Geographic position of the popup, when available. */
    lngLat?: { lat: number; lng: number };
    /**
     * The button that was clicked, for host-owned visual state.
     *
     * Live node, not a copy: mutating it mutates what the user sees. Prefer {@link setBusy} for
     * the pending state — it keeps the busy convention in one place.
     */
    button: HTMLElement;
    /**
     * Toggles the button's pending state: `disabled`, `aria-busy`, and the
     * `gl-poi-popup__action--busy` modifier.
     *
     * Safe to call after the surface has closed — it writes to a detached node, which is inert.
     * That is why a `.finally(() => d.setBusy(false))` needs no guard.
     *
     * @param busy - `true` to enter the pending state, `false` to leave it.
     */
    setBusy(busy: boolean): void;
    /**
     * Closes the surface the button was rendered in — the popup **or** the side panel, never
     * both.
     *
     * ⚠️ This is deliberately narrower than `GeoLeaf.FeatureInfo.close()`, which closes both
     * surfaces unconditionally and emits `geoleaf:poi:panel:close` as it goes. A popup button
     * calling that would have closed an unrelated side panel and announced a panel close nobody
     * performed.
     *
     * Idempotent: closing an already-closed surface does nothing.
     */
    close(): void;
}

// ── Table seam (plugin-emitted) ──────────────────────────────────────────────
//
// Same export arbitration as the editor seam above: these shapes are NOT exported.
// The plugin reaches them through `GeoLeafEventMap[K]` — its `fireEvent` is generic over
// the map, so every emission site is checked against it — and an integrator does the same.
//
// 🛑 **These nine names are a special case in this file, and you need to know it to read
// them.** Until 13/08/2026 they were INVISIBLE to every event gate of the repo:
// `fireEvent` composed the name at runtime (`map.fire("geoleaf:" + eventName)`), so no
// complete literal existed in source, so `EVENT-MAP` could demand nothing and
// `CONSUMER-CONTRACT` had to declare them out of measurement reach. Two of them
// (`opened`, `closed`) were even classified "broken" in the downstream manifest on the
// strength of that blindness, while they were emitted AND listened to. The typing below
// is therefore not the point of the change: it is its CONSEQUENCE. The point was to make
// the gate seeing.
//
// ⚠️ **All nine go out on BOTH buses** — `document.dispatchEvent` AND `map.fire`
// (`plugins/table/src/table-state.ts`). A subscriber must pick one; subscribing to both
// delivers every event twice. This is written on each key because it is the trap the
// integrator will hit, not the one the maintainer hits.

/** Minimal structural view of a feature as the `table` plugin carries it around. */
interface GeoLeafTableFeature {
    id?: string | number;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Export formats of the `table` plugin.
 *
 * ⚠️ Structural mirror of its `ExportFormat` (`plugins/table/src/export.ts`), not an import:
 * `packages/core/src/` never references `@geoleaf-plugins/*`. The mirror cannot drift
 * silently — the plugin emits against `GeoLeafEventMap[K]`, so a format added there
 * without being added here does not compile.
 */
type GeoLeafTableExportFormat = "geojson" | "csv" | "kml" | "gpx" | "excel";

/** Detail payload for `geoleaf:table:layerChanged`. `null` = no layer displayed anymore. */
interface GeoLeafTableLayerChangedDetail {
    layerId: string | null;
}

/**
 * Detail payload for `geoleaf:table:sortChanged`.
 *
 * ⚠️ `direction` is `string | null`, not `"asc" | "desc" | null`: the plugin's `SortState`
 * declares it that way and the payload is emitted as-is. Narrowing here would lie about
 * what actually reaches the subscriber — a profile's `defaultSort.order` pours an
 * unvalidated value into it. Narrowing is a plugin-side change, to be made there first.
 */
interface GeoLeafTableSortChangedDetail {
    field: string | null;
    direction: string | null;
}

/** Detail payload for `geoleaf:table:selectionChanged` and `geoleaf:table:zoomToSelection`. */
interface GeoLeafTableSelectionDetail {
    layerId: string | null;
    selectedIds: string[];
}

/** Detail payload for `geoleaf:table:highlightSelection`. */
interface GeoLeafTableHighlightDetail {
    layerId: string | null;
    selectedIds: string[];
    /** `false` = the highlight was just removed. */
    active: boolean;
}

/** Detail payload for `geoleaf:table:exportSelection`. */
interface GeoLeafTableExportSelectionDetail {
    /** `""` when no layer is current — the plugin falls back to the empty string. */
    layerId: string;
    format: GeoLeafTableExportFormat;
    selectedIds: string[];
    /** The exported features, exactly as they go to the download. */
    rows: GeoLeafTableFeature[];
}

/** Detail payload for `geoleaf:table:exportLayer`. */
interface GeoLeafTableExportLayerDetail {
    layerId: string;
    format: GeoLeafTableExportFormat;
    /** Number of exported features — the whole layer, not the selection. */
    count: number;
}

// ── Connector seam (plugin-emitted) ──────────────────────────────────────────
//
// Same export arbitration as the `editor` and `table` seams: shapes not exported,
// reached through `GeoLeafEventMap[K]`.
//
// 🛑 **These six names lived OUTSIDE the naming domain until 13/08/2026** — they were
// called `connector:*`, without the `geoleaf:` prefix. The repo's event survey is
// anchored on `^geoleaf:`, so all six were **structurally invisible** to EM-01: not an
// exemption anyone granted, a blindness nobody chose. Prefixing them brought them into
// the measured field, and EM-01 claimed all six at once — which is the only possible
// demonstration that the blindness was real.
//
// ⚠️ **They do NOT go through `dispatchGeoLeafEvent`**, and two of them cannot:
// `signup-requested` and `forgot-password-requested` are `cancelable`; their emitters
// read the return of `dispatchEvent` to call `preventDefault()` on the link. The
// sanitising bus builds its events without `cancelable` and returns `void` — routing
// them through it would kill cancellation silently. They therefore keep a raw
// `CustomEvent`, and this contract types them without claiming to carry them (cf. the
// `GeoLeafEventMap` warning: what decides membership is the PAYLOAD, not the carrier).
//
// ⚠️ **The `geoleaf:connector:*` namespace is now SHARED.** The downstream consumer
// maintains a proprietary plugin emitting six other names under this same prefix
// (`ready`, `bbox-loading`, `bbox-loaded`, `data-version-changed`, `error`,
// `auth-required`). Verified on 13/08/2026: no overlap with the six below. But nothing,
// on either side, prevents a future collision — a name added here must be checked
// against that list.

/** Detail payload for `geoleaf:connector:token-refreshed` and `:authenticated`. */
interface GeoLeafConnectorBaseUrlDetail {
    /** Root of the backend concerned — several connectors can coexist. */
    baseUrl: string;
}

/** Detail payload for `geoleaf:connector:auth-error`. */
interface GeoLeafConnectorAuthErrorDetail {
    baseUrl: string;
    /** Error message, already flattened to a string by the emitter. */
    error: string;
}

/** Detail payload for `geoleaf:connector:credential-button-clicked`. */
interface GeoLeafConnectorCredentialClickDetail {
    baseUrl: string;
    /** State at click time — `true` = a valid token was already present. */
    authenticated: boolean;
}

/**
 * Detail payload for `geoleaf:connector:signup-requested` and `:forgot-password-requested`.
 *
 * ⚠️ Both events are **cancelable**: calling `preventDefault()` on them prevents the
 * navigation to `url`, which is the intended way for a host to open its own page.
 */
interface GeoLeafConnectorLinkRequestDetail {
    /** Configured target (`auth.signupUrl` / `auth.forgotPasswordUrl`). */
    url: string;
}

// ── Event map ────────────────────────────────────────────────────────────────

/**
 * Map of the GeoLeaf custom DOM events whose payload is **JSON-serialisable**.
 *
 * The membership criterion is the PAYLOAD, not the carrier — that is what makes this map's
 * boundary a real one and not a stylistic split. `dispatchGeoLeafEvent` deep-clones every
 * payload through `JSON.parse(JSON.stringify(detail))` (`kernel/events/event-bus.ts`);
 * a detail holding a DOM node, a function or a `Map` does not survive that round-trip, and
 * belongs in {@link GeoLeafRawEventMap} instead. The two maps state one rule from both ends.
 *
 * The `Events` facade subscribes to both maps (`kernel/events/facade.ts`); only emission
 * through the sanitising bus is restricted to this one.
 *
 * ⚠️ **Being listed here does NOT mean the event travels through that bus** — it means it
 * COULD. This sentence read « events carried by the sanitising bus » until task 7.3, which
 * was narrower than the rule the two maps actually enforce, and it had no answer for the
 * nine `geoleaf:editor:*` events: their payloads clone perfectly, but the editor dispatches
 * them as raw `CustomEvent`s and `dispatchGeoLeafEvent` is exported to no plugin. Reading
 * the criterion as the carrier would have pushed them into the raw map, whose own warning —
 * « adding a key here is a statement that the payload CANNOT be JSON-cloned » — they
 * contradict. Arbitré par Mattieu : the payload decides, and the carrier is a separate
 * question this contract deliberately does not type.
 */
export interface GeoLeafEventMap {
    // Lifecycle
    "geoleaf:app:ready": { version?: string; timestamp?: number };
    "geoleaf:map:ready": undefined;
    /** Emitted once when the legend control is first mounted on the map (S10 F2). */
    "geoleaf:legend:ready": { position?: string; layerCount?: number };
    "geoleaf:basemap:change": { key: string; previousKey?: string | null };
    "geoleaf:theme:applied": { themeName?: string; layerCount?: number };
    /**
     * Emitted when the accent palette changes (capability `theme-palette`).
     * Distinct from `geoleaf:theme:applied` (MAP themes) and from
     * `geoleaf:ui-theme-changed` (light/dark) — the three axes are orthogonal.
     */
    "geoleaf:palette-changed": { palette: string };
    // User interaction
    "geoleaf:poi:click": GeoLeafPoiClickDetail;
    "geoleaf:poi:panel:open": GeoLeafPoiPanelOpenDetail;
    "geoleaf:poi:panel:close": GeoLeafPoiPanelCloseDetail;
    // ⚠️ `geoleaf:popup:action` lived HERE until 14/08/2026. It moved to
    // {@link GeoLeafRawEventMap} when its detail gained `button` / `setBusy` / `close`:
    // sanitisation would have delivered them as `{}` and `undefined` respectively.
    // SUBSCRIBERS see no difference (the `Events` facade accepts keys of both maps);
    // what changes is that emitting it through `dispatchGeoLeafEvent` is now type-illegal.
    "geoleaf:layer:toggle": GeoLeafLayerToggleDetail;
    "geoleaf:layer:added": GeoLeafLayerAddedDetail;
    "geoleaf:feature:click": GeoLeafFeatureClickDetail;
    "geoleaf:feature:hover": GeoLeafFeatureHoverDetail;
    "geoleaf:filter:apply": GeoLeafFilterApplyDetail;
    "geoleaf:filter:reset": GeoLeafFilterResetDetail;
    "geoleaf:map:move": GeoLeafMapMoveDetail;
    "geoleaf:map:zoom": GeoLeafMapZoomDetail;
    /**
     * A layer's visibility changed — **HISTORICAL form**.
     *
     * ⚠️ **`geoleaf:layer:toggle` is the CANONICAL event**, and it carries the same payload.
     * This one predates it, has internal subscribers (`permalink-sync.ts`, the `table`
     * plugin) and a declared downstream consumer — so it is typed for what it is, not
     * promoted. An integrator writing new code takes `geoleaf:layer:toggle`.
     *
     * 🛑 **The two buses do not carry the same thing, and that is measured, not assumed.**
     * `visibility-manager.ts` fires on the map on EVERY change, but re-dispatches on
     * `document` only when `source !== "zoom"` — a deliberate filter, to avoid flooding
     * subscribers during a zoom recalculation. A subscriber via `Events.on` (thus
     * `document`) will therefore **never** see `source: "zoom"`, where `map.on` does.
     *
     * The type still keeps the full union: it is exact on the map, and only too wide on
     * the document. The opposite — narrowing to three values — would become FALSE at the
     * first loosening of the filter, and silently so, an integrator's exhaustive `switch`
     * ceasing to cover a case it receives.
     */
    "geoleaf:geojson:visibility-changed": GeoLeafLayerToggleDetail;
    /**
     * The tabbed side panel just opened a tab.
     *
     * Emitted on BOTH paths — the tab click and the programmatic call
     * `GeoLeaf.UI.openPanel(tabId)` — because an event describing only the programmatic
     * path would be half a contract: users open with the mouse.
     */
    "geoleaf:panel:opened": GeoLeafPanelToggleDetail;
    /**
     * The tabbed side panel just closed a tab.
     *
     * ⚠️ **A tab switch yields `closed` THEN `opened`**, in that order: the old tab is
     * really closed. Opening while nothing was open yields only `opened` — there is no
     * empty `closed`.
     */
    "geoleaf:panel:closed": GeoLeafPanelToggleDetail;
    // Filters (applied state change, no structured payload)
    "geoleaf:filters:applied": Record<string, never>;
    // Service worker
    "geoleaf:sw:updated": Record<string, never>;
    // Storage — a cache made room for itself. TWO producers, see the type.
    // Typed here rather than left in the `event-map-coverage` baseline: an integrator can
    // neither discover nor check the payload of an untyped event, and this one becomes an
    // INTERFACE signal the day it triggers a toast. One fewer entry in the untyped
    // baseline (39 → 38).
    "geoleaf:cache:evicted": GeoLeafCacheEvictedDetail;
    // ── Entered the domain after renaming — they were called `gl:` and `print:` ──────────
    //
    // 🛑 These three were not "untyped": they were **structurally invisible**.
    // `EVENT_LITERAL_RE` is anchored on `^geoleaf:`, so EM-01 could neither claim nor
    // count them — an off-prefix name appeared in no measure, neither as debt nor as a
    // gap. Renaming them brings them INTO the apparatus; that move is what types them,
    // not this table.
    //
    // ⚠️ `geoleaf:geolocation:statechange` is emitted on the **map container** with
    // `bubbles: true`, not through the bus — so it bubbles up to `document`. Its consumers
    // are `kernel/ui/mobile/mobile-toolbar.ts` (pill tint) and
    // `plugins/measure/src/tools/tool-gps.ts`: **it crosses the core → plugin boundary**,
    // so it is a public contract, whatever name it used to carry.
    "geoleaf:geolocation:statechange": GeoLeafGeolocationStateChangeDetail;
    // Print — bracket an off-screen render, and drive the modal's spinner.
    "geoleaf:print:render:start": Record<string, never>;
    "geoleaf:print:render:end": Record<string, never>;
    // Plugins
    "geoleaf:plugin:loaded": GeoLeafPluginLoadedDetail;
    "geoleaf:plugin:lazy-loaded": GeoLeafPluginLazyLoadedDetail;
    "geoleaf:plugin:failed": GeoLeafPluginFailedDetail;
    // Editor seam (task 7.3) — the FIRST plugin-emitted events typed here, and the
    // precedent for the 39 that remain in `event-map-coverage`'s baseline. Seven of the
    // nine have no listener in this repo, which is exactly what put them on reserve:
    // an emitter without a listener is legitimate ONLY as public API, and an
    // untyped event is not public API — the integrator can neither discover it nor check
    // its payload. Typing them is what turns that defence from an intention into a fact.
    "geoleaf:editor:feature-created": GeoLeafEditorFeatureCreatedDetail;
    "geoleaf:editor:feature-saved": GeoLeafEditorFeatureSavedDetail;
    "geoleaf:editor:feature-deleted": GeoLeafEditorFeatureDeletedDetail;
    "geoleaf:editor:feature-conflict": GeoLeafEditorFeatureConflictDetail;
    "geoleaf:editor:feature-moved": GeoLeafEditorFeatureMovedDetail;
    "geoleaf:editor:vertex-added": GeoLeafEditorVertexChangedDetail;
    "geoleaf:editor:vertex-deleted": GeoLeafEditorVertexChangedDetail;
    "geoleaf:editor:feature-sync-queued": GeoLeafEditorSyncQueuedDetail;
    "geoleaf:editor:feature-sync-flushed": GeoLeafEditorSyncFlushedDetail;
    // Table seam — the nine names that runtime composition kept invisible to every
    // gate. See the shape block above for what typing them cost and what it uncovered.
    //
    // ⚠️ All nine are emitted on `document` AND on the MapLibre bus — do not subscribe twice.
    "geoleaf:table:opened": Record<string, never>;
    "geoleaf:table:closed": Record<string, never>;
    "geoleaf:table:layerChanged": GeoLeafTableLayerChangedDetail;
    "geoleaf:table:sortChanged": GeoLeafTableSortChangedDetail;
    "geoleaf:table:selectionChanged": GeoLeafTableSelectionDetail;
    "geoleaf:table:zoomToSelection": GeoLeafTableSelectionDetail;
    "geoleaf:table:highlightSelection": GeoLeafTableHighlightDetail;
    "geoleaf:table:exportSelection": GeoLeafTableExportSelectionDetail;
    "geoleaf:table:exportLayer": GeoLeafTableExportLayerDetail;
    // Connector seam — six names that lived outside the `geoleaf:` prefix, thus outside
    // EM-01's measured field. See the shape block above: they are emitted as RAW
    // `CustomEvent`s, and two of them cannot do otherwise.
    "geoleaf:connector:token-refreshed": GeoLeafConnectorBaseUrlDetail;
    "geoleaf:connector:authenticated": GeoLeafConnectorBaseUrlDetail;
    "geoleaf:connector:auth-error": GeoLeafConnectorAuthErrorDetail;
    "geoleaf:connector:credential-button-clicked": GeoLeafConnectorCredentialClickDetail;
    /** ⚠️ **Cancelable** — `preventDefault()` prevents the navigation to `url`. */
    "geoleaf:connector:signup-requested": GeoLeafConnectorLinkRequestDetail;
    /** ⚠️ **Cancelable** — `preventDefault()` prevents the navigation to `url`. */
    "geoleaf:connector:forgot-password-requested": GeoLeafConnectorLinkRequestDetail;
}

// ── Raw event map (DOM-carrying seams) ───────────────────────────────────────

/**
 * Map of the GeoLeaf DOM events that carry a **live `HTMLElement`** and are therefore
 * dispatched as raw `CustomEvent`s, never through `dispatchGeoLeafEvent`.
 *
 * ## Why a second map rather than three more keys in {@link GeoLeafEventMap}
 *
 * `dispatchGeoLeafEvent` sanitises through `JSON.parse(JSON.stringify(detail))`. Put
 * `geoleaf:toolbar:action` in the sanitised map and `dispatchGeoLeafEvent("geoleaf:toolbar:action",
 * { action, element })` becomes **type-legal and runtime-wrong**: `element` arrives at every
 * listener as `{}`. The type system would be actively inviting the bug that two files in this
 * repo already go out of their way to warn about — `kernel/ui/desktop/desktop-tabs-seam.ts`
 * and `kernel/layer-manager/item-controls-seam.ts` both describe themselves as *mirroring the
 * existing `geoleaf:toolbar:action` seam* for precisely this reason.
 *
 * Splitting the map keeps both halves honest: listening is typed for everyone (the `Events`
 * facade accepts keys of both maps), and emission stays impossible to get wrong.
 *
 * ⚠ Adding a key here is a statement that **at least one field** of the payload cannot survive
 * `JSON.parse(JSON.stringify(…))`. If every field can, it belongs in {@link GeoLeafEventMap},
 * where it also gets a typed emitter.
 *
 * ⚠️ This sentence read "the payload **cannot** be JSON-cloned" until 14/08/2026, and
 * `geoleaf:popup:action` is the first key that makes the difference matter: five of its eight
 * fields are plain JSON, three are not (`button`, `setBusy`, `close`). The all-or-nothing wording
 * would have argued for splitting one event into two — a JSON half and a DOM half — which is
 * exactly the shape the CDC asked us not to build. **The criterion is the field, not the payload.**
 *
 * @see GeoLeafEventMap — the sanitised bus.
 */
export interface GeoLeafRawEventMap {
    /**
     * The layer-manager panel seam. Emitted by `kernel/layer-manager/control.ts`
     * once the panel structure is built, so capabilities (e.g. `profile-switcher`)
     * can insert their own controls without the kernel importing them.
     *
     * Lives HERE, not in {@link GeoLeafEventMap}: the detail carries live DOM nodes,
     * which the sanitising bus (JSON-only) would destroy.
     *
     * ⚠️ Fires again on every panel rebuild (destroy → recreate): subscribers must be
     * idempotent.
     */
    "geoleaf:layer-manager:panel": {
        container: HTMLElement;
        mainWrapper: HTMLElement;
        headerWrapper: HTMLElement;
    };
    /**
     * The plugin ↔ toolbar seam. Emitted by `kernel/ui/toolbar-dispatch.ts` (mobile pill,
     * desktop tab strip).
     *
     * ⚠️ **This seam is one-way, and the direction matters.** Plugins and capabilities LISTEN;
     * they do not dispatch. The kernel-side helper `dispatchToolbarAction(action, element)` is
     * the entry point *for the kernel's own emitters* — it is deliberately NOT exported: absent
     * from `kernel/ui/index.ts`, from `kernel-exports.ts`, from the global namespace, and from
     * every published `exports` subpath. Reaching it from `capabilities/**` is refused by the
     * R.8 boundary (`eslint.config.mjs`), and widening the barrel to reach it would drag
     * `components.js` + `pill-search.js` + `theme.js` into the importer's bundle closure. That
     * trade was measured, then declined, and the decision is recorded as accepted debt in
     * the workshop's debt register — do not re-litigate it from this line.
     *
     * ⚠️ This comment called that helper "the canonical entry point" until 09/08/2026, with no
     * qualifier. The sentence was true for the kernel and false for every other reader of this
     * contract — who cannot reach it at all. A contract that names an entry point its audience
     * cannot call sends that audience looking for an export that was withheld on purpose.
     *
     * `element` is the button that was clicked — plugins read it to anchor a floating menu
     * (`editor`, `measure`, `geocoding` all do). Both fields are always set by the emitter, so
     * neither is optional here even though several listeners historically declared them so.
     */
    "geoleaf:toolbar:action": { action: string; element: HTMLElement };
    /**
     * The popup/side-panel action seam. Emitted by
     * `capabilities/feature-info/render/widget-dispatch.ts` when a user clicks a button
     * declared as `type: "action"` in `popup.fields[]`.
     *
     * **Moved here from {@link GeoLeafEventMap} on 14/08/2026**, when the detail gained
     * `button`, `setBusy()` and `close()` — the three members `GeoLeaf.Popup.registerActionHandler`
     * used to provide before ADR-07 removed it. Through the sanitising bus, `button` arrived as
     * `{}` and the two functions as `undefined`, silently: measured on the real path before the
     * move, not reasoned about.
     *
     * ⚠️ **Subscribers are unaffected** — the `Events` facade accepts keys of both maps. What the
     * move buys is that `dispatchGeoLeafEvent("geoleaf:popup:action", …)` no longer compiles.
     *
     * @see GeoLeafPopupActionDetail — the payload, and the confidentiality rule on `properties`.
     */
    "geoleaf:popup:action": GeoLeafPopupActionDetail;
}

/*
 * ⚠️ Two other raw seams exist and are **deliberately not** listed above —
 * `geoleaf:desktop-panel:tabs-ready` (`kernel/ui/desktop/desktop-tabs-seam.ts`) and
 * `geoleaf:layer-item:controls` (`kernel/layer-manager/item-controls-seam.ts`). They do
 * carry a live `HTMLElement` and describe themselves as modelled on `toolbar:action`,
 * but two measurements set them apart:
 *
 *   1. They are **core-internal** — their only production subscribers are the `share`
 *      and `labels` capabilities. No plugin listens to them, whereas `toolbar:action` is
 *      the seam `_plugin-template` imposes on EVERY new plugin.
 *   2. They are **already typed at the emitter**: `DesktopTabsReadyDetail` and
 *      `LayerItemControlsDetail` are exported next to their `dispatchEvent`, and their
 *      real shapes (`{ tabs }` · `{ layerId, controlsContainer, toggleable }`) are not
 *      the ones you would guess.
 *
 * Copying them here would create a second hand-maintained description — precisely the
 * defect class the public-API work fixes. Pointing at the origin modules would invert
 * the layering (`contracts/` is a leaf: it imports only `contracts/`). The correct move
 * is to relocate both interfaces INTO the contract and re-export them from the seams — a
 * layering decision in its own right, recorded separately.
 */

// ── IEventBus interface ──────────────────────────────────────────────────────

/**
 * Formal typed interface for the GeoLeaf DOM event bus.
 *
 * The type parameter `TMap` maps event names to their detail payloads.
 * Defaults to `GeoLeafEventMap` for the built-in bus.
 */
export interface IEventBus<TMap = GeoLeafEventMap> {
    /**
     * Dispatches a typed custom event on `document`.
     * @param name - Event name (key of `TMap`).
     * @param detail - Typed payload matching the event's entry in `TMap`.
     */
    dispatch<K extends keyof TMap>(name: K, detail: TMap[K]): void;

    /**
     * Subscribes to a typed custom event.
     * @param event - Event name (key of `TMap`).
     * @param handler - Handler receiving a `CustomEvent` with the typed detail.
     * @returns Unsubscribe function.
     */
    on<K extends keyof TMap>(event: K, handler: (e: CustomEvent<TMap[K]>) => void): () => void;

    /**
     * Unsubscribes a previously registered handler.
     * @param event - Event name (key of `TMap`).
     * @param handler - The exact handler reference passed to `on()`.
     */
    off<K extends keyof TMap>(event: K, handler: (e: CustomEvent<TMap[K]>) => void): void;
}
