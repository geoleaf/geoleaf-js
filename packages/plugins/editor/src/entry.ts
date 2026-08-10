/*!
 * @geoleaf-plugins/editor — Entry point
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import "./css/geoleaf-editor.css";
import { buildPublicApi, toggleEditorMenu, setDestroyHook } from "./public-api.js";
import { getEditorConfig } from "./config.js";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { EditorConfig, EditorMap } from "./types.js";
import {
    initEditorMenu,
    updateUndoRedoState,
    updatePendingQueueCount,
    getEditorActiveTool,
    deactivateActiveTool,
} from "./sub-menu/floating-menu.js";
import { openPendingQueueModal } from "./sub-menu/pending-queue-modal.js";
import { createEditorFormModal } from "./modal/editor-form-modal.js";
import type { ModalOpenOptions } from "./modal/editor-form-modal.js";
import { createLayerDropdown } from "./modal/layer-dropdown.js";
import { attributesToFormSchema } from "./modal/attributes-to-form.js";
import { dispatchEditorEvent } from "./editor-events.js";
import { createTerraDrawAdapter } from "./drawing/terra-draw-adapter.js";
import type { TerraDrawAdapterInstance } from "./drawing/terra-draw-adapter.js";
import { adapterCallbacks, initEventsBridge, dispatchFeatureConflict } from "./events.js";
import type { EditorWiringContext } from "./events.js";
import { initLayerPicker, destroyLayerPicker } from "./selection/layer-picker.js";
import { getSelection, clearSelection } from "./selection/selection-state.js";
import { createPersistenceAdapter, createOnlineAdapter } from "./persistence/adapter-factory.js";
import {
    initSyncReplay,
    destroySyncReplay,
    flushNow,
    getPendingCount,
    listPendingEditorEntries,
} from "./persistence/editor-sync-replay.js";
import { registerSyncHandler } from "./persistence/sync-handler.js";
import { initImageUpload, destroyImageUpload } from "./persistence/image-store.js";
import {
    exportSessionFeatures,
    sessionFeatureCount,
    resetSessionTracking,
} from "./persistence/session-export.js";
import { initAddForm, destroyAddForm, startPoiCapture } from "./add-form/placement-form.js";
import type { EditorPersistenceAdapter } from "./persistence/adapter-interface.js";
import type { ConflictStrategy } from "./persistence/conflict-resolution.js";
import {
    hideHostFeature,
    showHostFeature,
    commitHostGeometry,
    removeHostFeature,
    resetHostReconcile,
    type HostReconcileDeps,
} from "./selection/host-reconcile.js";
import {
    initUndoStack,
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    topUndoType,
    topRedoType,
} from "./history/undo-stack.js";
import { attachShortcuts, detachShortcuts } from "./history/shortcuts.js";
import {
    _getNativeMap,
    _getBaseLayers,
    _setExclusiveMode,
    _getMapFacade,
    _notify,
    _getLabel,
} from "./internal.js";
import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
import langEs from "./lang/lang-es.js";
import langPt from "./lang/lang-pt.js";
import langIt from "./lang/lang-it.js";
import langDe from "./lang/lang-de.js";
import { registerBuiltinComponents, type FieldConfig } from "@geoleaf/field-renderer";
// W3 / A4″ (S6b) — la plomberie UI appartient à `host-runtime`, la saisie à `field-renderer`.
import { confirmDialog } from "@geoleaf/host-runtime";

// Forme du seam toolbar importée du contrat publié (API publique S3) au lieu d'une
// re-déclaration locale : les 7 plugins en portaient 4 formes divergentes.
import type { GeoLeafRawEventMap } from "@geoleaf/core";
// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

/**
 * Returns the capture form of a profile layer, projected from `attributes.fields[]`.
 *
 * ⚠️ Read `formSchema` until task 7.2. That key was a SECOND list of fields, parallel to
 * `attributes.fields[]` and reconciled with it by nothing — the projection lives in
 * {@link attributesToFormSchema}, this stays a lookup.
 */
function _getSchemaForLayer(layerId: string): FieldConfig[] {
    const profile = getGeoLeaf()?.Config?.getActiveProfile?.() as Record<string, unknown> | null;
    const layers = (profile?.layers ?? []) as Record<string, unknown>[];
    const layer = layers.find((l) => l["id"] === layerId);
    return attributesToFormSchema(layer?.["attributes"]);
}

/**
 * Builds the form-modal options. Shared by both creation sites (lazy open +
 * boot) so they cannot drift — notably `getSchemaForLayer`, without which the
 * modal renders an empty form.
 */
function _buildModalOpts(cfg: EditorConfig) {
    return {
        ...(cfg.modal?.desktopBreakpointPx !== undefined && {
            desktopBreakpointPx: cfg.modal.desktopBreakpointPx,
        }),
        ...(cfg.modal?.maxWidthPx !== undefined && { maxWidthPx: cfg.modal.maxWidthPx }),
        ...(cfg.confirmCancelOnDirty !== undefined && {
            confirmCancelOnDirty: cfg.confirmCancelOnDirty,
        }),
        createHeaderSlot: (geomType: string | undefined) => createLayerDropdown(cfg, geomType),
        getSchemaForLayer: _getSchemaForLayer,
    };
}

// Lazy instances — created on geoleaf:ready to avoid impacting TTI.
let _formModal: ReturnType<typeof createEditorFormModal> | null = null;
let _adapter: TerraDrawAdapterInstance | null = null;
// Memoised loader promise so concurrent first-tool clicks load Terra Draw once.
let _adapterPromise: Promise<TerraDrawAdapterInstance | null> | null = null;
let _persistence: EditorPersistenceAdapter | null = null;
// Per-init context promoted to module scope so the extracted lifecycle helpers
// below can read it at call time (closure on the variable, never a frozen value).
let _cfg: EditorConfig | null = null;
let _reconcileDeps: HostReconcileDeps | null = null;

/**
 * Builds the persistence + host-reconciliation wiring handed to the events
 * bridge. Reconcile callbacks no-op when the map facade is unavailable.
 */
function _buildWiring(
    cfg: EditorConfig,
    adapter: EditorPersistenceAdapter,
    deps: HostReconcileDeps | null
): EditorWiringContext {
    return {
        adapter,
        strategy: (cfg.persistence?.conflictResolution ?? "prompt") as ConflictStrategy,
        hideHost: (layerId, featureId) => {
            if (deps) hideHostFeature(deps, layerId, featureId);
        },
        showHost: (layerId) => {
            if (deps) showHostFeature(deps, layerId);
        },
        commitHost: (layerId, featureId, geometry) => {
            if (deps) commitHostGeometry(deps, layerId, featureId, geometry);
        },
        removeHost: (layerId, featureId) => {
            if (deps) removeHostFeature(deps, layerId, featureId);
        },
        reloadFeature: (serverData, layerId) => _reloadHostFeature(deps, layerId, serverData),
    };
}

/** server-wins repaint: applies the server geometry to the host, or restores it. */
function _reloadHostFeature(
    deps: HostReconcileDeps | null,
    layerId: string,
    serverData: unknown
): void {
    if (!deps) return;
    const sd = serverData as {
        id?: string | number;
        geometry?: unknown;
        properties?: { id?: unknown };
    } | null;
    const fid =
        sd?.id != null ? String(sd.id) : sd?.properties?.id != null ? String(sd.properties.id) : "";
    if (fid && sd?.geometry) commitHostGeometry(deps, layerId, fid, sd.geometry);
    else showHostFeature(deps, layerId);
}

/** Internal entry point for S7 Terra Draw integration — opens the attribute form. */
export function _openEditorForm(options: ModalOpenOptions): void {
    if (!_formModal) {
        _formModal = createEditorFormModal(_buildModalOpts(getEditorConfig()));
    }
    _formModal.open(options);
}

// ── Editor lifecycle ────────────────────────────────────────────────────────
// Extracted from _initOnMapReady. ALL of these are module-level `function`
// declarations (hoisted across the whole module), never `const … = () =>`, so
// the synchronous lazy-load path (which calls startEditor() before some of them
// appear lexically) can reference them without hitting the temporal dead zone.
// They read module-level state (_adapter/_persistence/_cfg/_reconcileDeps/…) at
// call time rather than capturing a snapshot.

// Pushes button-state + dynamic tooltips to the floating menu.
function _refreshHistoryUI(): void {
    updateUndoRedoState(canUndo(), canRedo(), topUndoType(), topRedoType());
}

// Pushes the offline pending-queue count to the floating menu badge.
function _refreshQueueBadge(): void {
    void getPendingCount()
        .then(updatePendingQueueCount)
        .catch(() => {
            /* Storage unavailable — leave the badge as-is. */
        });
}

// Opens the pending-operations detail modal (badge click).
function _openQueueDetail(): void {
    void listPendingEditorEntries().then((entries) =>
        openPendingQueueModal(entries, { onRetry: () => void flushNow() })
    );
}

function _doDelete(): void {
    const snap = getSelection();
    if (!snap || !_adapter) return;
    // Capture the feature snapshot before removal so undo can re-add it.
    const feature = _adapter.getFeature(snap.terradrawId);
    _adapter.removeFeatures([snap.terradrawId]);
    const { featureId, layerId } = snap;
    if (feature) {
        pushOperation({
            type: "delete",
            terradrawId: snap.terradrawId,
            featureId,
            layerId,
            feature,
            ts: Date.now(),
        });
    }
    // Persist the deletion for an existing host feature; on success remove the
    // host original, on failure restore it (undo can re-add).
    if (featureId && layerId && _persistence) {
        _persistence
            .delete(featureId, layerId)
            .then(() => {
                if (_reconcileDeps) removeHostFeature(_reconcileDeps, layerId, featureId);
                _notify("success", _getLabel("editor.toast.deleted"));
            })
            .catch(() => {
                _notify("error", _getLabel("editor.error.server"));
                if (_reconcileDeps) showHostFeature(_reconcileDeps, layerId);
            });
    }
    clearSelection();
    dispatchEditorEvent("geoleaf:editor:feature-deleted", { featureId, layerId });
}

function _onDelete(): void {
    if (!getSelection()) return;
    if (_cfg?.confirmDelete === false) {
        _doDelete();
        return;
    }
    // 5.2 — `confirmDialog` de la lib partagée remplace une réimplémentation locale de
    // 97 lignes au DOM et aux classes identiques. ⚠️ Le contrat change de forme : une
    // promesse à usage unique au lieu d'une poignée `open/close/destroy`. Il n'y a donc
    // plus d'instance à détruire au démontage — la modale ne survit pas à sa réponse.
    void confirmDialog({
        title: _getLabel("editor.modal.delete.title"),
        message: _getLabel("editor.modal.delete.body"),
        confirmLabel: _getLabel("editor.modal.btn.deleteConfirm"),
        cancelLabel: _getLabel("editor.modal.btn.cancel"),
    }).then((ok) => {
        if (ok) _doDelete();
    });
}

function _handleDeleteKey(e: KeyboardEvent): void {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (!getSelection()) return;
    // Prevent browser back navigation on Backspace when no text is focused.
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    e.preventDefault();
    _onDelete();
}

function _handleEnterKey(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    // Scoped to select mode only: drawing modes already bind Enter to "finish"
    // (keyEvents in modes.ts), so we must not intercept it there.
    if (getEditorActiveTool() !== "select") return;
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    e.preventDefault();
    // Disarm select → onToolSelect(null) → setMode(null) + restore popups.
    deactivateActiveTool();
}

function _registerKeyHandlers(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("keydown", _handleDeleteKey);
    document.addEventListener("keydown", _handleEnterKey);
}

// Keeps the offline badge in sync with the queue. Stable identity so the destroy
// hook's removeEventListener matches the addEventListener below.
function _onQueueChanged(): void {
    _refreshQueueBadge();
}

function _initQueueBadgeSync(): void {
    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:editor:feature-sync-queued", _onQueueChanged);
        document.addEventListener("geoleaf:editor:feature-sync-flushed", _onQueueChanged);
    }
    // Show the initial count after the listeners are registered.
    _refreshQueueBadge();
}

function _initMenu(): void {
    initEditorMenu(_cfg!, {
        onToolSelect: (tool) => {
            // Suppress core layer popups/tooltips while any editor tool is armed;
            // restore them when no tool is active (tool === null on toggle-off/close).
            _setExclusiveMode(tool != null);
            // First activation lazy-loads Terra Draw (separate chunk); subsequent
            // calls resolve instantly. Arm the mode once the adapter is ready.
            void _ensureAdapter().then((adapter) => adapter?.setMode(tool ?? null));
        },
        onUndo: undo,
        onRedo: redo,
        onDelete: _onDelete,
        onPendingBadgeClick: _openQueueDetail,
    });
}

// Lazily loads Terra Draw + creates and starts the adapter on first tool use.
// Declared as a `function` statement (not a const arrow) so the menu's
// onToolSelect closure can reference it regardless of textual position
// (TDZ guard — see the lifecycle note above). Memoised via `_adapterPromise`
// so concurrent first-tool clicks load the engine only once.
function _ensureAdapter(): Promise<TerraDrawAdapterInstance | null> {
    if (_adapterPromise) return _adapterPromise;
    _adapterPromise = _loadAdapter();
    return _adapterPromise;
}

async function _loadAdapter(): Promise<TerraDrawAdapterInstance | null> {
    const map = _getNativeMap();
    if (!map || !_cfg) return null;
    const adapter = await createTerraDrawAdapter(map, _cfg, adapterCallbacks);
    _adapter = adapter;
    await _startAdapter(adapter, map, _buildWiring(_cfg, _persistence!, _reconcileDeps));
    return adapter;
}

// Activates the adapter once the map style is stable. Terra Draw is only loaded
// on first tool activation — long after geoleaf:app:ready — so the map is
// virtually always loaded; the idle await covers the rare in-flight style case.
async function _startAdapter(
    adapter: TerraDrawAdapterInstance,
    map: EditorMap,
    wiring: EditorWiringContext
): Promise<void> {
    if (typeof map.loaded === "function" && !map.loaded()) {
        await new Promise<void>((resolve) => map.once("idle", () => resolve()));
    }
    adapter.start();
    initEventsBridge(adapter, _openEditorForm, wiring);
    initLayerPicker(adapter, map, {
        onHostFeatureSelected: (layerId, featureId) => wiring.hideHost(layerId, featureId),
    });
    // Undo/redo: custom stack drives the UI; shortcuts dispatch to it.
    initUndoStack(adapter, _cfg!, _refreshHistoryUI);
    attachShortcuts({ onUndo: undo, onRedo: redo });
    // Defensive: if the raster basemap source was lost in the boot race
    // (deferred setBaseLayer vs Terra Draw layers), re-apply it now that the
    // style is stable.
    try {
        _getBaseLayers()?.refreshBasemap?.();
    } catch {
        /* older core */
    }
}

function _initTerraDraw(): void {
    const map = _getNativeMap();
    const facade = _getMapFacade();
    _reconcileDeps = facade && map ? { facade, nativeMap: map } : null;
    if (!map) return;
    _persistence = createPersistenceAdapter(_cfg!, {
        onConflict: dispatchFeatureConflict,
    });
    // Offline replay reuses the online adapter (same conflict wiring) to flush
    // `editor.*` queue entries on reconnect — the editor owns its offline
    // lifecycle (addpoi's handler is POI-only). Runs eagerly so reconnection
    // works even before the user touches a drawing tool; the drawing engine
    // itself is loaded lazily on first tool activation (_ensureAdapter).
    initSyncReplay({
        rest: createOnlineAdapter(_cfg!, { onConflict: dispatchFeatureConflict }),
        onChange: _refreshQueueBadge,
    });
    // 5.1-b — le handler du seam `Sync`, que le bouton de rejeu d'`offline-ui` lit sous
    // l'identifiant `"poi"`. ⚠️ 5.1-f l'a rendu INCONDITIONNEL : il cédait la place à
    // `addpoi`, et la reprise vivait dans le pont, qui est parti avec lui. Motif complet
    // sur `registerSyncHandler`.
    registerSyncHandler();
    // 5.1-d — la stratégie de téléversement d'image (réseau, puis stockage local en secours)
    // et la reprise au retour du réseau. ⚠️ La reprise reçoit ICI son premier appelant : chez
    // `addpoi` elle n'en avait aucun, donc les photos mises de côté n'étaient jamais renvoyées.
    initImageUpload();
    // 5.1-f — le flux « ajouter un POI ». ⚠️ Le câblage est passé par un FOURNISSEUR, jamais
    // par une valeur : il se reconstruit à l'appel depuis `_cfg` / `_persistence` /
    // `_reconcileDeps`, dont les deux derniers viennent d'être posés ci-dessus. Un instantané
    // pris ici figerait l'état d'un boot où la carte n'est pas encore là.
    initAddForm({
        openForm: _openEditorForm,
        getWiring: () =>
            _cfg && _persistence ? _buildWiring(_cfg, _persistence, _reconcileDeps) : null,
    });
}

function _registerDestroyHook(): void {
    setDestroyHook(() => {
        if (typeof document !== "undefined") {
            document.removeEventListener("keydown", _handleDeleteKey);
            document.removeEventListener("keydown", _handleEnterKey);
            document.removeEventListener("geoleaf:editor:feature-sync-queued", _onQueueChanged);
            document.removeEventListener("geoleaf:editor:feature-sync-flushed", _onQueueChanged);
        }
        // Restore core popups/tooltips if the editor is destroyed while a tool is armed.
        _setExclusiveMode(false);
        detachShortcuts();
        destroySyncReplay();
        destroyImageUpload();
        destroyAddForm();
        resetSessionTracking();
        clearHistory();
        destroyLayerPicker();
        resetHostReconcile();
        _adapter?.destroy();
        _formModal?.destroy();
        _adapter = null;
        _adapterPromise = null;
        _formModal = null;
        _persistence = null;
        _reconcileDeps = null;
        _cfg = null;
    });
}

// 0 — Register all field-renderer components.
//
// One call, not 23 (backlog B.9). The registry is a module singleton, so hand-rolled
// per-plugin lists made the available field types depend on WHICH PLUGINS were loaded:
// this plugin listed all 23, plugin-addpoi listed 10, and an addpoi form silently fell
// back to `text` for the other 13 unless the editor happened to be loaded too.
registerBuiltinComponents();

// 1 — Register i18n dictionaries FIRST so labels resolve during boot (pill button).
getGeoLeaf()?.I18n?.registerDict?.("editor", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

// 2 — Mount GeoLeaf.Editor namespace (only when the core is present).
const _gl = getGeoLeaf();
if (_gl) {
    _gl.Editor = buildPublicApi();
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("editor", {
    version: _VERSION,
    requires: [],
    optional: ["offline-ui"],
    label: "Éditeur géométrique",
    healthCheck: () => typeof getGeoLeaf()?.Editor === "object",
});

// Pencil + square icon (~22 px, stroke currentColor) — sanitised by core DOMSecurity.setSafeHTML.
const _EDITOR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
    "</svg>";

/** Flèche montante vers un plateau — le pictogramme d'export. */
const _EXPORT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>' +
    "</svg>";

// 5.1-f — le pictogramme du bouton « ajouter un POI ». Repris trait pour trait de celui que
// le core dessinait (`mobile-toolbar-pill.ts`) : le bouton change de propriétaire, pas
// d'apparence, et un utilisateur ne doit pas voir la fusion.
const _POI_ADD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2 C 6.5 2 2 6.5 2 12 C 2 17.5 6.5 22 12 22 C 17.5 22 22 17.5 22 12' +
    ' C 22 6.5 17.5 2 12 2 M12 8 L12 16 M8 12 L16 12"/>' +
    "</svg>";

// 4 & 5 — Register toolbar slot + wire event listeners (skipped if enabled === false).
if (getEditorConfig().enabled !== false) {
    getGeoLeaf()?.registry?.register?.({
        id: "editor",
        dependencies: [],
        init: () => {},
        destroy: () => {},
        ui: {
            mobileIcon: {
                icon: _EDITOR_ICON,
                labelKey: "editor.toolbar.button",
                profileKey: "ui.showEditor",
                requiresPlugin: "editor",
                action: "editor",
            },
        },
    });

    // 5.1-e — bouton d'export de la session. ⚠️ Son `profileKey` est sous `modules.editor.*`
    // et non `ui.*` : les deux drapeaux équivalents d'`addpoi` n'étaient déclarés dans AUCUN
    // schéma, alors que `ui.schema.json` est `additionalProperties: false` — ils étaient donc
    // inatteignables, et leurs boutons ni masquables ni affichables (R19).
    //
    // 🛑 CET ENREGISTREMENT NE SUFFIT PAS À FAIRE APPARAÎTRE LE BOUTON, et c'est mesuré.
    // La barre d'outils est bâtie AU BOOT ; ce plugin est PARESSEUX et ne s'évalue qu'au
    // premier clic. Sonde navigateur sur `deploy-full` : module enregistré `true`, boutons
    // dans le DOM `0`. Le créneau visible est déclaré par `registerLazyForAction` dans
    // `apps/geoleaf-app/init.js`, AVANT le chargement — c'est là qu'il faut le poser.
    // Celui-ci reste pour l'hôte qui charge le plugin en EAGER, où il est le seul chemin.
    if (getEditorConfig().showExport !== false) {
        getGeoLeaf()?.registry?.register?.({
            id: "editor-export-session",
            dependencies: [],
            init: () => {},
            destroy: () => {},
            ui: {
                mobileIcon: {
                    icon: _EXPORT_ICON,
                    labelKey: "editor.export.session",
                    profileKey: "modules.editor.showExport",
                    defaultVisible: true,
                    requiresPlugin: "editor",
                    action: "editor-export-session",
                },
            },
        });
    }

    // 5.1-f — le créneau « ajouter un POI », repris du core. Mêmes remarques que ci-dessus :
    // celui-ci ne sert que l'hôte qui charge le plugin en EAGER ; le créneau visible au boot
    // est déclaré par `registerLazyForAction` dans `apps/geoleaf-app/init.js`.
    if (getEditorConfig().showAddPoi !== false) {
        getGeoLeaf()?.registry?.register?.({
            id: "poi-add",
            dependencies: [],
            init: () => {},
            destroy: () => {},
            ui: {
                mobileIcon: {
                    icon: _POI_ADD_ICON,
                    labelKey: "editor.toolbar.poi_add",
                    profileKey: "modules.editor.showAddPoi",
                    defaultVisible: true,
                    requiresPlugin: "editor",
                    action: "poi-add",
                },
            },
        });
    }

    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
            const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
            if (ce.detail?.action === "editor") {
                toggleEditorMenu(ce.detail?.element);
            }
            if (ce.detail?.action === "poi-add") {
                // ⚠️ L'état visuel du bouton est rendu au flux : `startPoiCapture` ne le
                // relâche que si la capture se termine SANS ouvrir le formulaire. Le core
                // faisait la même chose avec `aria-disabled`, mais depuis le kernel.
                const el = ce.detail?.element as HTMLElement | undefined;
                el?.classList.add("gl-map-toolbar__btn--active");
                startPoiCapture(null, () => el?.classList.remove("gl-map-toolbar__btn--active"));
            }
            if (ce.detail?.action === "editor-export-session") {
                // ⚠️ Le message d'« aucune entité » passe par l'i18n. La source le codait en
                // dur, en français, dans un plugin publié en six langues.
                if (sessionFeatureCount() === 0) {
                    _notify("info", _getLabel("editor.export.empty"));
                    return;
                }
                void exportSessionFeatures().then((n) => {
                    _notify(
                        "success",
                        _getLabel("editor.export.done").replace("{count}", String(n))
                    );
                });
            }
        });

        // Extracted as a named function so it can also run as a lazy-load fallback
        // (when the plugin loads after geoleaf:map:ready has already fired). The
        // drawing engine is no longer started here — it loads on first tool use
        // (_ensureAdapter) — so the eager/lazy boot timing no longer matters for
        // Terra Draw; only the menu / persistence / queue wiring is set up.
        function _initOnMapReady(): void {
            _cfg = getEditorConfig();
            _formModal = createEditorFormModal(_buildModalOpts(_cfg));
            _initTerraDraw();
            _registerKeyHandlers();
            _initMenu();
            _initQueueBadgeSync();
            _registerDestroyHook();
        }

        // Normal boot path: listen for map:ready (eager — app:ready not yet fired).
        document.addEventListener("geoleaf:map:ready", () => _initOnMapReady(), {
            once: true,
        });
        // Lazy-load fallback: if loaded after geoleaf:map:ready has already fired,
        // _getNativeMap() is non-null — set up the editor wiring immediately.
        if (_getNativeMap()) {
            _initOnMapReady();
        }
    }
}
