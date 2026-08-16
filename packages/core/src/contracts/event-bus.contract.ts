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

/** Detail payload for `geoleaf:poi:click` */
export interface GeoLeafPoiClickDetail {
    poiId: string;
    layerId: string;
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
 * 🛑 **Ce n'est PAS le même panneau que `geoleaf:poi:panel:*` ci-dessus, et les deux paires
 * se ressemblent assez pour être confondues.** Celle-ci décrit le **panneau latéral à
 * onglets** du bureau (`kernel/ui/desktop/desktop-panel.ts` — couches, filtres, thèmes) ;
 * celle-là décrit le panneau d'**information d'une entité**, ouvert par un clic sur un POI.
 * L'une est identifiée par un onglet, l'autre par un POI — d'où deux charges distinctes
 * plutôt qu'une charge commune qui aurait rendu l'amalgame indolore.
 */
export interface GeoLeafPanelToggleDetail {
    /** Identifiant de l'onglet — `"layers"`, `"filter"`, `"themes"`… selon le profil. */
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
// ⚠️ Ces dix formes ne sont PAS exportées, contrairement aux `*Detail` du dessus — et
// l'asymétrie est mesurée, pas stylistique. Les leurs ont de vrais consommateurs nommés ;
// celles-ci n'en auraient aucun : le plugin les atteint par `GeoLeafEventMap[K]`, et un
// intégrateur en fait autant (`GeoLeafEventMap["geoleaf:editor:feature-saved"]`), un
// accès indexé qui ne peut pas diverger de la map. Les exporter aurait ajouté dix noms
// publics que personne n'appelle — `check-orphan-exports` les a d'ailleurs rendus en dix
// régressions à la pose. Même arbitrage qu'`AttributeCaptureWidget` à la tâche 7.2.

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
     * ⚠️ Optionnel STRICT, pas `| undefined`. `@types/geojson` déclare bien
     * `id?: string | number | undefined` sur `Feature`, et le mirer ici compilait — mais
     * `check-exact-optional-debt` (EOD-01) l'a refusé avec le bon argument : la clé
     * pourrait alors être PRÉSENTE en valant `undefined`, et écraser un défaut dans un
     * merge par spread. Le site d'émission insère donc `id` conditionnellement
     * (`editor/src/events.ts`), ce qui rend aussi la charge fidèle à ce que le round-trip
     * JSON en ferait — `JSON.stringify` supprime un `undefined`, il ne le transporte pas.
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
 * Charge de `geoleaf:geolocation:statechange` — la veille de position a démarré ou s'est arrêtée.
 *
 * ⚠️ **Émis sur le CONTENEUR DE CARTE, pas par le bus** (`capabilities/geolocation/geolocation.ts`),
 * avec `bubbles: true` — il remonte donc jusqu'à `document`, et s'écoute des deux façons.
 *
 * 🛑 Il s'est appelé `gl:geoloc:statechange` jusqu'au 16/08/2026, et ce nom le rendait
 * **invisible à EM-01**, dont la reconnaissance est ancrée sur `^geoleaf:`. Ce n'était pas une
 * dette enregistrée quelque part : c'était un angle mort qui ne se comptait nulle part. La
 * fiche `docs/specs/capacites/geolocation.md` le documentait pourtant comme délibéré — un fait
 * exact peut décrire une cécité sans la corriger.
 */
export interface GeoLeafGeolocationStateChangeDetail {
    /** `true` quand la veille démarre, `false` quand elle s'arrête. */
    active: boolean;
}

/**
 * Detail payload for `geoleaf:cache:evicted` — a cache made room for itself.
 *
 * 🛑 IL Y A **DEUX** PRODUCTEURS, ET C'EST DÉLIBÉRÉ. Le patron que B-155 recommande — un point
 * d'émission unique gardé par un test, précédent `editor-events.ts` — n'est pas atteignable
 * ici : les deux magasins évincent depuis des contextes différents, et aucun code ne peut être
 * partagé entre eux.
 *
 * | Producteur | Magasin | Ce qui déclenche |
 * |---|---|---|
 * | `capabilities/offline/cache/cache-manager.ts` (`_enforceCacheQuota`) | IndexedDB | fin de téléchargement de profil, budget `maxCacheBytes` dépassé |
 * | `kernel/storage/sw-core.js` → `kernel/storage/sw-register.ts` | Cache API | pression du quota d'origine, ou refus d'écriture pour quota |
 *
 * Le second passe par un `postMessage` : un Service Worker n'a pas de `document`, et il est
 * copié tel quel dans les variantes de déploiement — il ne peut importer ni ce contrat ni le
 * bus. `sw-register.ts` est le seul endroit qui rétablit le signal sur `document`.
 *
 * ⚠️ `freedBytes` est **absent côté Cache API**, et ce n'est pas un oubli : la Cache API
 * n'expose la taille d'aucune entrée. `offline-ui` omet déjà la taille quand elle manque —
 * fabriquer un nombre serait pire que se taire.
 */
export interface GeoLeafCacheEvictedDetail {
    /** Nombre d'enregistrements RÉELLEMENT retirés. */
    evicted: number;
    /** Octets récupérés — connu du seul côté IndexedDB. */
    freedBytes?: number;
    /** Taille du magasin avant éviction (octets côté IndexedDB, entrées côté Cache API). */
    totalBefore?: number;
    /** Taille du magasin après éviction, même unité que {@link totalBefore}. */
    totalAfter?: number;
    /** Quel magasin a évincé. Absent = IndexedDB, la forme historique. */
    store?: "indexeddb" | "cache-api";
    /**
     * Pourquoi. `pressure` = le quota d'ORIGINE est proche de la saturation ; `quota` = une
     * écriture a été refusée. Le trim de routine du worker n'émet pas — il tourne à chaque
     * panoramique, et un toast par déplacement de carte apprend à ne plus les lire.
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
 *     if (d.actionId !== "odoo:create-request") return;
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

// ── Table seam (plugin-emitted, Sprint 4 du contrat inverse) ─────────────────
//
// Même arbitrage d'export que le seam éditeur ci-dessus : ces formes ne sont PAS exportées.
// Le plugin les atteint par `GeoLeafEventMap[K]` — son `fireEvent` est générique sur la map,
// donc chaque site d'émission est vérifié contre elle — et un intégrateur en fait autant.
//
// 🛑 **Ces neuf noms sont un cas à part dans ce fichier, et il faut le savoir pour les lire.**
// Jusqu'au 13/08/2026 ils étaient INVISIBLES à toutes les gates d'événements du dépôt :
// `fireEvent` composait le nom à l'exécution (`map.fire("geoleaf:" + eventName)`), donc aucun
// littéral complet n'existait en source, donc `EVENT-MAP` ne pouvait rien exiger et
// `CONSUMER-CONTRACT` devait les déclarer hors de portée de la mesure. Deux d'entre eux
// (`opened`, `closed`) ont même été classés « cassés » dans le manifeste aval sur la foi de
// cette cécité, alors qu'ils étaient émis ET écoutés. Le typage ci-dessous n'est donc pas
// l'objet du geste : il en est la CONSÉQUENCE. L'objet était de rendre la gate voyante.
//
// ⚠️ **Les neuf partent sur les DEUX bus** — `document.dispatchEvent` ET `map.fire`
// (`plugins/table/src/table-state.ts`). Un abonné doit en choisir un ; s'abonner aux deux
// livre chaque événement en double. C'est écrit sur chaque clé, parce que c'est le piège que
// l'intégrateur rencontrera, pas celui que le mainteneur rencontre.

/** Vue structurelle minimale d'une entité telle que le plugin `table` la transporte. */
interface GeoLeafTableFeature {
    id?: string | number;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Formats d'export du plugin `table`.
 *
 * ⚠️ Miroir structurel de son `ExportFormat` (`plugins/table/src/export.ts`), pas un import :
 * `packages/core/src/` ne référence jamais `@geoleaf-plugins/*`. Le miroir ne peut pas dériver
 * en silence — le plugin émet contre `GeoLeafEventMap[K]`, donc un format ajouté là-bas sans
 * l'être ici ne compile pas.
 */
type GeoLeafTableExportFormat = "geojson" | "csv" | "kml" | "gpx" | "excel";

/** Detail payload for `geoleaf:table:layerChanged`. `null` = plus aucune couche affichée. */
interface GeoLeafTableLayerChangedDetail {
    layerId: string | null;
}

/**
 * Detail payload for `geoleaf:table:sortChanged`.
 *
 * ⚠️ `direction` est `string | null` et non `"asc" | "desc" | null` : le `SortState` du plugin
 * la déclare ainsi, et la charge est émise telle quelle. Resserrer ici mentirait sur ce qui
 * arrive réellement à l'abonné — `defaultSort.order` d'un profil y verse une valeur non
 * validée. Le resserrement est un geste de plugin, à faire là-bas d'abord.
 */
interface GeoLeafTableSortChangedDetail {
    field: string | null;
    direction: string | null;
}

/** Detail payload for `geoleaf:table:selectionChanged` et `geoleaf:table:zoomToSelection`. */
interface GeoLeafTableSelectionDetail {
    layerId: string | null;
    selectedIds: string[];
}

/** Detail payload for `geoleaf:table:highlightSelection`. */
interface GeoLeafTableHighlightDetail {
    layerId: string | null;
    selectedIds: string[];
    /** `false` = la surbrillance vient d'être retirée. */
    active: boolean;
}

/** Detail payload for `geoleaf:table:exportSelection`. */
interface GeoLeafTableExportSelectionDetail {
    /** `""` quand aucune couche n'est courante — le plugin replie sur la chaîne vide. */
    layerId: string;
    format: GeoLeafTableExportFormat;
    selectedIds: string[];
    /** Les entités exportées, telles qu'elles partent au téléchargement. */
    rows: GeoLeafTableFeature[];
}

/** Detail payload for `geoleaf:table:exportLayer`. */
interface GeoLeafTableExportLayerDetail {
    layerId: string;
    format: GeoLeafTableExportFormat;
    /** Nombre d'entités exportées — la couche entière, pas la sélection. */
    count: number;
}

// ── Connector seam (plugin-emitted, Sprint 4 du contrat inverse) ─────────────
//
// Même arbitrage d'export que les seams `editor` et `table` : formes non exportées, atteintes
// par `GeoLeafEventMap[K]`.
//
// 🛑 **Ces six noms ont vécu HORS du domaine de nommage jusqu'au 13/08/2026** — ils
// s'appelaient `connector:*`, sans le préfixe `geoleaf:`. Le relevé d'événements du dépôt est
// ancré sur `^geoleaf:`, donc les six étaient **structurellement invisibles** à EM-01 : pas
// une exemption qu'on aurait accordée, une cécité que personne n'avait choisie (B-207). Les
// préfixer les a fait entrer dans le champ de mesure, et EM-01 les a réclamés tous les six du
// même coup — ce qui est la seule démonstration possible que la cécité était réelle.
//
// ⚠️ **Ils ne transitent PAS par `dispatchGeoLeafEvent`**, et deux d'entre eux ne le peuvent
// pas : `signup-requested` et `forgot-password-requested` sont `cancelable`, leurs émetteurs
// lisent le retour de `dispatchEvent` pour appeler `preventDefault()` sur le lien. Le bus
// assaini construit ses événements sans `cancelable` et rend `void` — les y faire passer
// tuerait l'annulation en silence. Ils gardent donc un `CustomEvent` brut, et ce contrat les
// type sans prétendre les porter (cf. l'avertissement de `GeoLeafEventMap` : ce qui décide de
// l'appartenance est la CHARGE, pas le transporteur).
//
// ⚠️ **Le namespace `geoleaf:connector:*` est désormais PARTAGÉ.** Le consommateur aval
// maintient un plugin propriétaire qui émet six autres noms sous ce même préfixe (`ready`,
// `bbox-loading`, `bbox-loaded`, `data-version-changed`, `error`, `auth-required`). Vérifié le
// 13/08/2026 : aucun recouvrement avec les six ci-dessous. Mais rien, d'aucun côté, n'empêche
// une collision future — un nom ajouté ici doit être confronté à cette liste.

/** Detail payload for `geoleaf:connector:token-refreshed` et `:authenticated`. */
interface GeoLeafConnectorBaseUrlDetail {
    /** Racine du backend concerné — plusieurs connecteurs peuvent coexister. */
    baseUrl: string;
}

/** Detail payload for `geoleaf:connector:auth-error`. */
interface GeoLeafConnectorAuthErrorDetail {
    baseUrl: string;
    /** Message d'erreur, déjà aplati en chaîne par l'émetteur. */
    error: string;
}

/** Detail payload for `geoleaf:connector:credential-button-clicked`. */
interface GeoLeafConnectorCredentialClickDetail {
    baseUrl: string;
    /** État au moment du clic — `true` = un jeton valide était déjà présent. */
    authenticated: boolean;
}

/**
 * Detail payload for `geoleaf:connector:signup-requested` et `:forgot-password-requested`.
 *
 * ⚠️ Ces deux événements sont **annulables** : `preventDefault()` sur eux empêche la
 * navigation vers `url`, ce qui est le moyen prévu pour qu'un hôte ouvre sa propre page.
 */
interface GeoLeafConnectorLinkRequestDetail {
    /** Cible configurée (`auth.signupUrl` / `auth.forgotPasswordUrl`). */
    url: string;
}

// ── Event map ────────────────────────────────────────────────────────────────

/**
 * Map of the GeoLeaf custom DOM events whose payload is **JSON-serialisable**.
 *
 * The membership criterion is the PAYLOAD, not the carrier — that is what makes this map's
 * boundary a real one and not a stylistic split. `dispatchGeoLeafEvent` deep-clones every
 * payload through `JSON.parse(JSON.stringify(detail))` (`kernel/events/event-bus.ts:48-68`);
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
    // ⚠️ `geoleaf:popup:action` vivait ICI jusqu'au 14/08/2026. Il est passé dans
    // {@link GeoLeafRawEventMap} quand son detail a reçu `button` / `setBusy` / `close` : la
    // sanitisation les aurait rendus, respectivement, `{}` et `undefined`. Les ABONNÉS ne
    // voient pas la différence (la façade `Events` accepte les clés des deux maps) ; ce qui
    // change est que l'émettre par `dispatchGeoLeafEvent` est désormais type-illégal.
    "geoleaf:layer:toggle": GeoLeafLayerToggleDetail;
    "geoleaf:layer:added": GeoLeafLayerAddedDetail;
    "geoleaf:feature:click": GeoLeafFeatureClickDetail;
    "geoleaf:feature:hover": GeoLeafFeatureHoverDetail;
    "geoleaf:filter:apply": GeoLeafFilterApplyDetail;
    "geoleaf:filter:reset": GeoLeafFilterResetDetail;
    "geoleaf:map:move": GeoLeafMapMoveDetail;
    "geoleaf:map:zoom": GeoLeafMapZoomDetail;
    /**
     * Une couche a changé de visibilité — **forme HISTORIQUE**.
     *
     * ⚠️ **`geoleaf:layer:toggle` est l'événement CANONIQUE**, et il porte la même charge.
     * Celui-ci lui préexiste, il a des abonnés internes (`permalink-sync.ts`, le plugin
     * `table`) et un consommateur aval déclaré — il est donc typé pour ce qu'il est, pas
     * promu. Un intégrateur qui écrit du neuf prend `geoleaf:layer:toggle`.
     *
     * 🛑 **Les deux bus ne portent pas la même chose, et c'est mesuré, pas supposé.**
     * `visibility-manager.ts` émet sur la carte à CHAQUE changement, mais ne le redispatche
     * sur `document` que si `source !== "zoom"` — filtre délibéré, pour ne pas noyer les
     * abonnés pendant un recalcul de zoom. Un abonné via `Events.on` (donc `document`) ne
     * verra donc **jamais** `source: "zoom"`, là où `map.on` le voit.
     *
     * Le type garde quand même l'union complète : elle est exacte sur la carte, et seulement
     * trop large sur le document. L'inverse — resserrer à trois valeurs — deviendrait FAUX au
     * premier assouplissement du filtre, et le ferait silencieusement, un `switch` exhaustif
     * de l'intégrateur cessant de couvrir un cas qu'il reçoit.
     */
    "geoleaf:geojson:visibility-changed": GeoLeafLayerToggleDetail;
    /**
     * Le panneau latéral à onglets vient d'ouvrir un onglet.
     *
     * Émis par les DEUX chemins — le clic sur un onglet et l'appel programmatique
     * `GeoLeaf.UI.openPanel(tabId)` —, parce qu'un événement qui ne décrirait que la voie
     * programmatique serait un demi-contrat : l'utilisateur ouvre à la souris.
     */
    "geoleaf:panel:opened": GeoLeafPanelToggleDetail;
    /**
     * Le panneau latéral à onglets vient de fermer un onglet.
     *
     * ⚠️ **Un changement d'onglet rend `closed` PUIS `opened`**, dans cet ordre : l'ancien
     * est bien fermé. Une ouverture alors que rien n'était ouvert ne rend qu'`opened` — il
     * n'y a pas de `closed` à vide.
     */
    "geoleaf:panel:closed": GeoLeafPanelToggleDetail;
    // Filters (applied state change, no structured payload)
    "geoleaf:filters:applied": Record<string, never>;
    // Service worker
    "geoleaf:sw:updated": Record<string, never>;
    // Stockage — un cache a fait de la place. DEUX producteurs, voir le type (tâche 1.4).
    // Typé ici plutôt que laissé dans la baseline `event-map-coverage` : un intégrateur ne
    // peut ni découvrir ni contrôler la charge utile d'un événement non typé, et celui-ci
    // devient un signal d'INTERFACE le jour où il déclenche un toast. Ferme une des 39 lignes
    // de B-155 (baseline 39 → 38).
    "geoleaf:cache:evicted": GeoLeafCacheEvictedDetail;
    // ── Entrés dans le domaine au S2 de R9 (B-207) — ils s'appelaient `gl:` et `print:` ────
    //
    // 🛑 Ces trois-là n'étaient pas « non typés » : ils étaient **structurellement invisibles**.
    // `EVENT_LITERAL_RE` est ancré sur `^geoleaf:`, donc EM-01 ne pouvait ni les réclamer ni
    // les compter — un nom hors préfixe n'apparaissait dans aucune mesure, ni comme dette, ni
    // comme manque. Les renommer les fait ENTRER dans le dispositif ; c'est le geste qui les
    // type, pas cette table.
    //
    // ⚠️ `geoleaf:geolocation:statechange` est émis sur le **conteneur de carte** avec
    // `bubbles: true`, et non par le bus — il remonte donc jusqu'à `document`. Ses consommateurs
    // sont `kernel/ui/mobile/mobile-toolbar.ts` (teinte de la pastille) et
    // `plugins/measure/src/tools/tool-gps.ts` : **il franchit la frontière core → plugin**,
    // donc c'est un contrat public, quel que soit le nom qu'il portait.
    "geoleaf:geolocation:statechange": GeoLeafGeolocationStateChangeDetail;
    // Impression — encadrent un rendu hors écran, et pilotent le spinner de la modale.
    "geoleaf:print:render:start": Record<string, never>;
    "geoleaf:print:render:end": Record<string, never>;
    // Plugins
    "geoleaf:plugin:loaded": GeoLeafPluginLoadedDetail;
    "geoleaf:plugin:lazy-loaded": GeoLeafPluginLazyLoadedDetail;
    "geoleaf:plugin:failed": GeoLeafPluginFailedDetail;
    // Editor seam (task 7.3) — the FIRST plugin-emitted events typed here, and the
    // precedent for the 39 that remain in `event-map-coverage`'s baseline. Seven of the
    // nine have no listener in this repo, which is exactly what made them a C2 reserve
    // (B-142): an emitter without a listener is legitimate ONLY as public API, and an
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
    // Table seam (Sprint 4 du contrat inverse) — les neuf noms que la composition à
    // l'exécution rendait invisibles à toutes les gates. Voir le bloc de formes ci-dessus
    // pour ce que le typage a coûté et ce qu'il a découvert.
    //
    // ⚠️ Les neuf sont émis sur `document` ET sur le bus MapLibre — ne pas s'abonner deux fois.
    "geoleaf:table:opened": Record<string, never>;
    "geoleaf:table:closed": Record<string, never>;
    "geoleaf:table:layerChanged": GeoLeafTableLayerChangedDetail;
    "geoleaf:table:sortChanged": GeoLeafTableSortChangedDetail;
    "geoleaf:table:selectionChanged": GeoLeafTableSelectionDetail;
    "geoleaf:table:zoomToSelection": GeoLeafTableSelectionDetail;
    "geoleaf:table:highlightSelection": GeoLeafTableHighlightDetail;
    "geoleaf:table:exportSelection": GeoLeafTableExportSelectionDetail;
    "geoleaf:table:exportLayer": GeoLeafTableExportLayerDetail;
    // Connector seam (Sprint 4 du contrat inverse) — six noms qui vivaient hors du préfixe
    // `geoleaf:`, donc hors du champ de mesure d'EM-01. Voir le bloc de formes ci-dessus :
    // ils sont émis en `CustomEvent` BRUT, et deux d'entre eux ne peuvent pas faire autrement.
    "geoleaf:connector:token-refreshed": GeoLeafConnectorBaseUrlDetail;
    "geoleaf:connector:authenticated": GeoLeafConnectorBaseUrlDetail;
    "geoleaf:connector:auth-error": GeoLeafConnectorAuthErrorDetail;
    "geoleaf:connector:credential-button-clicked": GeoLeafConnectorCredentialClickDetail;
    /** ⚠️ **Annulable** — `preventDefault()` empêche la navigation vers `url`. */
    "geoleaf:connector:signup-requested": GeoLeafConnectorLinkRequestDetail;
    /** ⚠️ **Annulable** — `preventDefault()` empêche la navigation vers `url`. */
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
 * repo already go out of their way to warn about — `kernel/ui/desktop/desktop-tabs-seam.ts:17-19`
 * and `kernel/layer-manager/item-controls-seam.ts:19` both describe themselves as *mirroring the
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
     * The plugin ↔ toolbar seam. Emitted by `kernel/ui/toolbar-dispatch.ts:20-27` (mobile pill,
     * desktop tab strip).
     *
     * ⚠️ **This seam is one-way, and the direction matters.** Plugins and capabilities LISTEN;
     * they do not dispatch. The kernel-side helper `dispatchToolbarAction(action, element)` is
     * the entry point *for the kernel's own emitters* — it is deliberately NOT exported: absent
     * from `kernel/ui/index.ts`, from `kernel-exports.ts`, from the global namespace, and from
     * every published `exports` subpath. Reaching it from `capabilities/**` is refused by the
     * R.8 boundary (`eslint.config.mjs`), and widening the barrel to reach it would drag
     * `components.js` + `pill-search.js` + `theme.js` into the importer's bundle closure. That
     * trade was measured, then declined, and the decision is written up as **D-18** in
     * `_docs_projet/registres/dette_technique.md` — do not re-litigate it from this line.
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
 * ⚠️ Deux autres seams bruts existent et ne sont **délibérément pas** listés ci-dessus —
 * `geoleaf:desktop-panel:tabs-ready` (`kernel/ui/desktop/desktop-tabs-seam.ts`) et
 * `geoleaf:layer-item:controls` (`kernel/layer-manager/item-controls-seam.ts`). Ils portent
 * bien un `HTMLElement` vivant et se décrivent eux-mêmes comme calqués sur `toolbar:action`,
 * mais deux mesures les distinguent :
 *
 *   1. Ils sont **core-internes** — leurs seuls abonnés en production sont les capacités
 *      `share` et `labels`. Aucun plugin ne les écoute, là où `toolbar:action` est le seam
 *      que `_plugin-template` impose à TOUT nouveau plugin.
 *   2. Ils sont **déjà typés à l'émetteur** : `DesktopTabsReadyDetail` et
 *      `LayerItemControlsDetail` sont exportés à côté de leur `dispatchEvent`, et leurs
 *      formes réelles (`{ tabs }` · `{ layerId, controlsContainer, toggleable }`) ne sont pas
 *      celles qu'on devinerait.
 *
 * Les recopier ici en créerait une seconde description à tenir à la main — précisément la
 * classe de défaut que l'API publique S3 corrige. Les faire pointer sur les modules d'origine
 * inverserait la couche (`contracts/` est une feuille : il n'importe que `contracts/`). Le
 * geste correct est de déplacer ces deux interfaces DANS le contrat et de les ré-exporter
 * depuis les seams — décision de couche à part entière, versée au backlog, pas à 3.3.
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
