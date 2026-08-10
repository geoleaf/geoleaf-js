/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B6 + B7 + B9 — Labels, Legend, Layer Manager, Themes, and UI.
 *
 * This runtime initialization module registers all UI-related services on
 * `globalThis.GeoLeaf`. It is imported as a side-effect by `globals.ts`.
 *
 * Registers:
 *   - **B6** — Labels (`LabelButtonManager`, `LabelRenderer`, `Labels`),
 *     Legend (`LegendControl`, `LegendGenerator`, `LegendRenderer`),
 *     Layer Manager (`BasemapSelector`, `LMControl`, `LMRenderer`,
 *     `StyleSelector`)
 *   - **B7** — Theme engine (`ThemeCache`, `ThemeLoader`, `ThemeApplier*`)
 *   - **B9** — UI components (`Branding`, `CoordinatesDisplay`, `NotificationSystem`),
 *     filter panel sub-modules, mobile/desktop toolbar
 *
 * Sprint S2 (boot-di-lifecycle): the imperative body is extracted into the
 * re-callable {@link setupUI} and registered under the `ui` id. It runs once at
 * import time (golden master unchanged); `UIModule.init()` re-invokes it via the
 * registry (guarded no-op until S3/S4).
 *
 * Presets build (S2 Lot 6): the share block is gone — `GeoLeaf.Share` is assigned by
 * the permalink installer and `ShareLifecycle.init()` is called by `ShareModule.init()`
 * alone. The old eager call here predated S1.3 (when this body ran at import time); it
 * now runs *inside* `UIModule.init()`, i.e. AFTER `ShareModule.init()` (share has no
 * dependencies → it is dequeued 2nd, six modules before UI builds the panels), so it
 * was pure redundancy.
 *
 * S7: the toast-renderer singleton import (the `ui.notify` closure) and the geolocation
 * `mobile-toolbar.ts` state import are also gone — both now resolve their capability
 * lazily through the global namespace, same template as vector-tiles (S5). This file has
 * no remaining static kernel → capability import.
 *
 * @see globals for the orchestrator and import order
 */

// B6 : layer-manager (labels — S2 Lot 1 — and legend — S2 Lot 4 — migrated to their
// capabilities/<cap>/install.ts)
import { LMControl } from "../kernel/layer-manager/control.js";
import { StyleSelector } from "../kernel/layer-manager/style-selector.js";
// B7 : theme ENGINE (kernel) — the theme-selector BAR migrated to its installer (S2 Lot 8)
import { ThemeCache } from "../kernel/themes/theme-cache.js";

// ⚠️ IMPORTS D'EFFET DE BORD — NE PAS RETIRER, ET NE PAS LES CROIRE MORTS.
//
// Ces trois modules n'exportent rien qui soit consommé ici : ils MONKEY-PATCHENT
// `ThemeApplierCore` à l'import (`TA._hideAllLayers = function …`, `TA._applyLayerConfig`,
// `TA._syncLegendVisibility`, `TA._scheduleLayerConfig`, `TA._updateStyleSelector`,
// `TA._fitBoundsOnAllLayers` — 13 méthodes au total). `core.ts` les APPELLE dans
// `applyTheme()` (`this._hideAllLayers()`, `this._applyLayerConfig(cfg)`,
// `self._syncLegendVisibility()`), sans les définir.
//
// Ils étaient jusqu'ici tirés dans le graphe par l'`Object.assign` qui composait
// `GeoLeaf._ThemeApplier`. Cette clé est partie à l'API S4.3 (aucun lecteur) — mais son
// retrait a failli emporter les patches avec elle : `applyTheme()` aurait levé
// `TypeError: this._hideAllLayers is not a function`, EN SILENCE côté tests, qui mockent
// `ThemeApplierCore`. La forme `import "…"` rend l'ancrage explicite au lieu de le laisser
// dépendre d'une écriture globale sans lecteur.
//
// Gardé par `__tests__/themes/theme-applier-patching.contract.test.js`.
import "../kernel/themes/theme-applier/deferred.js";
import "../kernel/themes/theme-applier/ui-sync.js";
import "../kernel/themes/theme-applier/visibility.js";
// B9 : ui — files directs (branding/coordinates/theme-toggle/scale/geolocation
// migrated to their capabilities/<cap>/install.ts — S2 Lot 2)
import { _UIComponents } from "../kernel/ui/components.js";
import { _UIEventDelegation } from "../kernel/ui/event-delegation.js";
// toast-renderer (S2 Lot 4 + S7): the 3 namespace writes (`_UINotifications`,
// `NotificationSystem`, `Notifications`) are assigned by capabilities/toast-renderer/install.ts.
// The kernel `ui.notify` adapter below (S7) reads `_gl._UINotifications` back lazily instead
// of importing the singleton — an entry that leaves the capability out simply has no writer,
// and each method call degrades to a silent no-op (`?.`), same as before.
import { _UITheme } from "../kernel/ui/theme.js";
// The filter panel is owned by the in-core `filter` capability (S5): it mounts the
// panel on `geoleaf:app:ready` (capabilities/filter/lifecycle.ts). Consumers read the
// `GeoLeaf.Filter` contract (S13 — the former `_UIFilterPanel*` shims + the
// `ui/filter-panel/**` builder were removed).
import { initMobileToolbar } from "../kernel/ui/mobile/mobile-toolbar.js";
import {
    initDesktopPanel,
    activateDesktopPanel,
    destroyDesktopPanel,
} from "../kernel/ui/desktop/desktop-panel.js";
// Share (capability `permalink`, sub-feature): both `GeoLeaf.Share` and the lifecycle
// wiring left the kernel in S2 Lot 6 — see capabilities/permalink/install.ts.
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";
import type { NotifyOptions } from "../capabilities/toast-renderer/types.js";

/** Structural shape of the `_UINotifications` singleton, read lazily off the namespace (S7). */
interface NotificationRendererLike {
    info?: (msg: string, opts?: number | NotifyOptions) => unknown;
    warning?: (msg: string, opts?: number | NotifyOptions) => unknown;
    error?: (msg: string, opts?: number | NotifyOptions) => unknown;
    success?: (msg: string, opts?: number | NotifyOptions) => unknown;
    dismiss?: (id: HTMLElement) => unknown;
    // B-60 — les cinq membres que `UI.Notifications` publie en plus des quatre niveaux.
    // Cette vue était plus ÉTROITE que la classe qu'elle décrit (`NotificationSystem` en expose
    // treize), ce qui n'avait aucune conséquence tant que rien ne les appelait — précisément le
    // cas tant que le bloc de `ui-api.ts` restait mort. Élargie à ce qui est réellement délégué,
    // et pas au-delà : ce type dit ce que le kernel CONSOMME, pas ce que la capacité offre.
    show?: (...args: unknown[]) => unknown;
    clearAll?: () => unknown;
    enable?: () => unknown;
    disable?: () => unknown;
    getStatus?: () => unknown;
}

/**
 * B6 + B7 + B9 — the UI **kernel** surface: layer manager, theme engine, UI primitives,
 * the `ui.notify` adapter, the theme methods and the mobile/desktop toolbar entry points.
 * Every capability that used to be assigned here now owns a `capabilities/<cap>/install.ts`
 * (S2) — hence the `Kernel` suffix. Re-callable; bound to the `ui` module lifecycle
 * (the registry id stays `"ui"`).
 */
export function setupUIKernel(): void {
    // Dynamic namespace registration: write through a bag view. The ambient
    // `GeoLeafGlobal` declares loose/aspirational member shapes that concrete
    // modules don't structurally satisfy; typed reads happen at consumer sites.
    const _gl = ensureGeoLeaf() as unknown as Record<string, unknown>;
    // -- B6 assignations (labels + legend migrated to their installers — S2) ---
    _gl._LayerManagerControl = LMControl;
    _gl._LayerManagerStyleSelector = StyleSelector;

    // -- B7 assignations : theme ENGINE only ----------------------------------
    // (`GeoLeaf.ThemeSelector` — the switch bar — is assigned by its installer, S2 Lot 8.
    //  The engine below stays kernel: ThemeEngineModule applies the profile's default
    //  theme unconditionally, and the selector's facade consumes it.)
    _gl.ThemeCache = ThemeCache;
    // API publique S4.3 — quatre clés `_` ont quitté le namespace ici :
    // `_LayerManagerBasemapSelector`, `_LayerManagerRenderer`, `_ThemeLoader` et
    // `_ThemeApplier`. Aucune n'avait de lecteur. `_ThemeApplier` composait un objet
    // (`Object.assign` de quatre modules) exprès pour le poser sur le global : personne ne
    // l'a jamais lu, donc la composition elle-même n'existait que pour cette écriture.

    // -- B9 assignations : ui -------------------------------------------------
    if (!_gl.UI) _gl.UI = {};
    const ui = _gl.UI as Record<string, unknown>;
    // Branding / Coordinates / ThemeToggle / Scale / Geolocation (B9) migrated to their
    // capabilities/<cap>/install.ts (S2 Lot 2): `GeoLeaf.<Cap>` is assigned by the boot
    // preset loop (registerGlobals), not here.
    _gl._UIComponents = _UIComponents;
    _gl._UIEventDelegation = _UIEventDelegation;
    // `_UINotifications` / `NotificationSystem` / `Notifications` are assigned by the
    // toast-renderer installer. The `ui.notify` adapter below is KERNEL: it is the
    // rich `notify()` surface (anchor B2) and stays here — but it no longer imports the
    // renderer singleton (S7). It reads `_gl._UINotifications` back lazily, so a build
    // that leaves the capability out simply has no writer and every call degrades to a
    // silent no-op (`?.`), exactly as before.
    const getNotifications = () => _gl._UINotifications as NotificationRendererLike | undefined;
    ui.notify = {
        info: (msg: string, opts?: number | NotifyOptions) => getNotifications()?.info?.(msg, opts),
        warn: (msg: string, opts?: number | NotifyOptions) =>
            getNotifications()?.warning?.(msg, opts),
        error: (msg: string, opts?: number | NotifyOptions) =>
            getNotifications()?.error?.(msg, opts),
        success: (msg: string, opts?: number | NotifyOptions) =>
            getNotifications()?.success?.(msg, opts),
        dismiss: (id: HTMLElement) => getNotifications()?.dismiss?.(id),
    };
    _gl._UITheme = _UITheme;
    // Wire theme methods directly onto UI (geoleaf.ui.js body runs at import time,
    // before globals.js body assigns _g.GeoLeaf._UITheme, so its conditional block
    // was skipped — we re-apply here to ensure applyTheme/setTheme exist at boot)
    ui.applyTheme = _UITheme.applyTheme;
    ui.setTheme = _UITheme.applyTheme;
    ui.toggleTheme = _UITheme.toggleTheme;
    ui.initThemeToggle = _UITheme.initThemeToggle;
    ui.initAutoTheme = _UITheme.initAutoTheme;
    ui.getCurrentTheme = _UITheme.getCurrentTheme;

    // ── B-60 — le MÊME piège de calendrier, sur le bloc voisin ─────────────────
    //
    // `ui-api.ts` construisait aussi `UI.Notifications` et six raccourcis `UI.show*`, derrière un
    // `if (_g.GeoLeaf._UINotifications)` de CORPS DE MODULE. L'unique écrivain de `_UINotifications`
    // est l'installeur de `toast-renderer`, appelé par `registerGlobals()` AU BOOT — donc
    // strictement après l'évaluation de tous les corps de modules. La condition était **toujours
    // fausse**, et les sept membres n'ont jamais existé.
    //
    // ⚠️ Le bloc THÈME juste au-dessus souffrait exactement du même défaut ; il a été rattrapé ici
    // (voir son commentaire), et c'est ce rattrapage qui a masqué le second : `UI.applyTheme`
    // fonctionnait, donc rien ne suggérait qu'un bloc jumeau restait mort. Les deux blocs de
    // `ui-api.ts` sont désormais retirés — ils ne pouvaient rien faire.
    //
    // Délégation PARESSEUSE, comme `ui.notify` ci-dessus et pour la même raison : un build qui
    // laisse la capacité de côté n'a pas d'écrivain, et chaque appel dégrade en no-op silencieux
    // (`?.`) au lieu de jeter à l'assignation.
    ui.Notifications = {
        show: (...a: unknown[]) => getNotifications()?.show?.(...(a as [string])),
        success: (...a: unknown[]) => getNotifications()?.success?.(...(a as [string])),
        error: (...a: unknown[]) => getNotifications()?.error?.(...(a as [string])),
        warning: (...a: unknown[]) => getNotifications()?.warning?.(...(a as [string])),
        info: (...a: unknown[]) => getNotifications()?.info?.(...(a as [string])),
        clearAll: () => getNotifications()?.clearAll?.(),
        enable: () => getNotifications()?.enable?.(),
        disable: () => getNotifications()?.disable?.(),
        getStatus: () => getNotifications()?.getStatus?.(),
    };
    ui.showNotification = (...a: unknown[]) => getNotifications()?.show?.(...(a as [string]));
    ui.showSuccess = (...a: unknown[]) => getNotifications()?.success?.(...(a as [string]));
    ui.showError = (...a: unknown[]) => getNotifications()?.error?.(...(a as [string]));
    ui.showWarning = (...a: unknown[]) => getNotifications()?.warning?.(...(a as [string]));
    ui.showInfo = (...a: unknown[]) => getNotifications()?.info?.(...(a as [string]));
    ui.clearNotifications = () => getNotifications()?.clearAll?.();
    // filter-panel: the in-core `filter` capability mounts the panel on
    // `geoleaf:app:ready`; the mobile toolbar reads the `GeoLeaf.Filter` contract (S13).
    ui.initMobileToolbar = initMobileToolbar;
    ui.initDesktopPanel = initDesktopPanel;
    ui.activateDesktopPanel = activateDesktopPanel;
    ui.destroyDesktopPanel = destroyDesktopPanel;
    // Share (`GeoLeaf.Share` + ShareLifecycle wiring) migrated to
    // capabilities/permalink/install.ts + ShareModule.init() — S2 Lot 6.
}

// ── PHASE A — see the rationale in `globals.config.ts`. ──────────────────────────────────────
//
// Posts the UI FACADES only (`GeoLeaf.UI.*`, renderers, theme cache). It builds no DOM and
// touches no map: that is `UIModule.init()`'s job, which still runs at registry time with the
// adapter and the merged config — and bails out cleanly ("Map not available") without one.
setupUIKernel();
