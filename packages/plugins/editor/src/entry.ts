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
import { DEFAULT_CONFLICT_STRATEGY } from "./persistence/conflict-strategies.js";
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
// UI plumbing belongs to `host-runtime`, capture to `field-renderer`.
import { confirmDialog } from "@geoleaf/host-runtime";

// Toolbar seam shape imported from the published contract instead of a local
// re-declaration: the 7 plugins carried 4 diverging shapes of it.
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
        strategy: cfg.persistence?.conflictResolution ?? DEFAULT_CONFLICT_STRATEGY,
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
    // The shared lib's `confirmDialog` replaces a 97-line local reimplementation
    // with identical DOM and classes. ⚠️ The contract changes shape: a
    // single-use promise instead of an `open/close/destroy` handle. There is
    // thus no instance left to destroy at teardown — the modal does not outlive
    // its answer.
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
    // The `Sync` seam handler, which `offline-ui`'s replay button reads under
    // the `"poi"` identifier. ⚠️ Made UNCONDITIONAL: it used to yield to
    // `addpoi`, and the takeover lived in the bridge, which left with it. Full
    // motive on `registerSyncHandler`.
    registerSyncHandler();
    // The image upload strategy (network, then local storage as backup) and the
    // retry on network return. ⚠️ The retry receives its first caller HERE: in
    // `addpoi` it had none, so photos set aside were never re-sent.
    initImageUpload();
    // The "add a POI" flow. ⚠️ Wiring goes through a PROVIDER, never a value: it
    // rebuilds at call time from `_cfg` / `_persistence` / `_reconcileDeps`, the
    // last two just set above. A snapshot taken here would freeze the state of a
    // boot where the map is not there yet.
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

/** Upward arrow to a tray — the export pictogram. */
const _EXPORT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>' +
    "</svg>";

// The "add a POI" button's pictogram. Taken stroke for stroke from the one the
// core drew (`mobile-toolbar-pill.ts`): the button changes owner, not
// appearance, and a user must not see the merge.
const _POI_ADD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2 C 6.5 2 2 6.5 2 12 C 2 17.5 6.5 22 12 22 C 17.5 22 22 17.5 22 12' +
    ' C 22 6.5 17.5 2 12 2 M12 8 L12 16 M8 12 L16 12"/>' +
    "</svg>";

// 4 & 5 — Register toolbar slot + wire event listeners (skipped if enabled === false).
// The three slots below are declared only on the EAGER path — before `boot()`, where these calls
// are the ONLY declaration (an integrator has no `init.js`). After `init()` the toolbar is already
// built: they would be stored, never drawn, and each would log a warning whose intended reader has
// already done what it recommends elsewhere. `!== true` so a host without `isInitialized` still
// gets its slots.
if (getEditorConfig().enabled !== false) {
    // ── The SLOT DECLARATIONS only — guarded since 21/08/2026 (eager path is their only
    // reader: after init() the toolbar is built and a stored slot is never drawn). `!== true`
    // so a host without `isInitialized` still gets its slots.
    // ⚠️ Scope fixed on 25/08/2026: this guard once wrapped the WHOLE block below — listeners
    // and map-ready wiring included — so on the LAZY path (isInitialized === true) the plugin
    // mounted its API and never wired its UI: no root, no handler, no error. The guard must
    // cover the registers alone; everything after it runs on BOTH paths.
    if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
        getGeoLeaf()?.registry?.register?.({
            id: "editor",
            dependencies: [],
            init: () => {},
            destroy: () => {},
            ui: {
                mobileIcon: {
                    icon: _EDITOR_ICON,
                    labelKey: "editor.toolbar.button",
                    profileKey: "modules.editor.showButton",
                    legacyProfileKey: "ui.showEditor",
                    requiresPlugin: "editor",
                    action: "editor",
                },
            },
        });

        // Session export button. ⚠️ Its `profileKey` is under `modules.editor.*`
        // and not `ui.*`: `addpoi`'s two equivalent flags were declared in NO
        // schema, while `ui.schema.json` is `additionalProperties: false` — they
        // were thus unreachable, and their buttons could neither be hidden nor
        // shown.
        //
        // 🛑 THIS REGISTRATION IS NOT ENOUGH TO MAKE THE BUTTON APPEAR, and it is
        // measured. The toolbar is built AT BOOT; this plugin is LAZY and only
        // evaluates at the first click. Browser probe on `deploy-full`: module
        // registered `true`, buttons in the DOM `0`. The visible slot is
        // declared by `registerLazyForAction` in `apps/geoleaf-app/init.js`,
        // BEFORE loading — that is where it must be set. This one stays for the
        // host loading the plugin EAGERLY, where it is the only path.
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

        // The "add a POI" slot, taken over from the core. Same remarks as above:
        // this one only serves the host loading the plugin EAGERLY; the slot
        // visible at boot is declared by `registerLazyForAction` in
        // `apps/geoleaf-app/init.js`.
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
    }

    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
            const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
            if (ce.detail?.action === "editor") {
                toggleEditorMenu(ce.detail?.element);
            }
            if (ce.detail?.action === "poi-add") {
                // ⚠️ The button's visual state is handed to the flow:
                // `startPoiCapture` only releases it when capture ends WITHOUT
                // opening the form. The core did the same with `aria-disabled`,
                // but from the kernel.
                const el = ce.detail?.element as HTMLElement | undefined;
                el?.classList.add("gl-map-toolbar__btn--active");
                startPoiCapture(null, () => el?.classList.remove("gl-map-toolbar__btn--active"));
            }
            if (ce.detail?.action === "editor-export-session") {
                // ⚠️ The "no entity" message goes through i18n. The source
                // hard-coded it, in French, in a plugin published in six
                // languages.
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
