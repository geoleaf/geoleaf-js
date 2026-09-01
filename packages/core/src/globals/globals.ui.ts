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
 * Lifecycle extraction: the imperative body is extracted into the
 * re-callable {@link setupUIKernel} and registered under the `ui` id. It runs once at
 * import time (golden master unchanged); `UIModule.init()` re-invokes it via the
 * registry (guarded no-op until S3/S4).
 *
 * Presets build: the share block is gone — `GeoLeaf.Share` is assigned by
 * the permalink installer and `ShareLifecycle.init()` is called by `ShareModule.init()`
 * alone. The old eager call here predated the extraction (this body ran at import time); it
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
// `ThemeLoader` is imported for ONE public entry point: `GeoLeaf.Config.clearThemesCache`
// ⚠️ It is mounted from HERE, and not from `globals.config.ts`, on a
// measured constraint: `kernel/themes/**` already imports `kernel/config/**` (three sites in
// `theme-applier/*`), so wiring the reverse edge would close a directory cycle. This file
// already depends on `kernel/themes/**` — the mount costs no new edge.
import { ThemeLoader } from "../kernel/themes/theme-loader.js";

// ⚠️ SIDE-EFFECT IMPORTS — DO NOT REMOVE, AND DO NOT BELIEVE THEM DEAD.
//
// These three modules export nothing consumed here: they MONKEY-PATCH
// `ThemeApplierCore` at import (`TA._hideAllLayers = function …`,
// `TA._applyLayerConfig`, `TA._syncLegendVisibility`, `TA._scheduleLayerConfig`,
// `TA._updateStyleSelector`, `TA._fitBoundsOnAllLayers` — 13 methods in total).
// `core.ts` CALLS them in `applyTheme()` (`this._hideAllLayers()`,
// `this._applyLayerConfig(cfg)`, `self._syncLegendVisibility()`), without defining
// them.
//
// They used to be pulled into the graph by the `Object.assign` composing
// `GeoLeaf._ThemeApplier`. That key left the namespace (no reader) — but its
// removal nearly took the patches with it: `applyTheme()` would have thrown
// `TypeError: this._hideAllLayers is not a function`, SILENTLY on the test side,
// which mocks `ThemeApplierCore`. The `import "…"` form makes the anchoring
// explicit instead of leaving it to depend on a readerless global write.
//
// Guarded by `__tests__/themes/theme-applier-patching.contract.test.js`.
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
import { registerPanelPane, openPane, closePane } from "../kernel/ui/panel-panes.js";
import { setImmersive, isImmersive } from "../kernel/ui/immersive.js";
import {
    initDesktopPanel,
    activateDesktopPanel,
    destroyDesktopPanel,
    openPanel,
    closePanel,
    getOpenPanel,
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
    // The five members `UI.Notifications` publishes beyond the four levels. This
    // view was NARROWER than the class it describes (`NotificationSystem` exposes
    // thirteen), which had no consequence as long as nothing called them —
    // precisely the case while `ui-api.ts`'s block stayed dead. Widened to what is
    // really delegated, and no further: this type says what the kernel CONSUMES,
    // not what the capability offers.
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
    // Four `_` keys left the namespace here: `_LayerManagerBasemapSelector`,
    // `_LayerManagerRenderer`, `_ThemeLoader` and `_ThemeApplier`. None had a
    // reader. `_ThemeApplier` composed an object (`Object.assign` of four modules)
    // expressly to set it on the global: nobody ever read it, so the composition
    // itself existed only for that write.
    //
    // The removal therefore left the loader's cache with NO public door: the body
    // of `ThemeLoader.clearCache` existed, and nothing could call it from outside
    // any more. That is the hole the next line closes.
    //
    // Why on `Config` and nowhere else — the four refusals are measured:
    //   • `GeoLeaf.Themes` does not exist — the facade was removed, motive in the
    //     CHANGELOG.
    //   • `GeoLeaf.ThemeCache` is a trap homonym: it is the IndexedDB cache of
    //     LAYER DATA, not of `themes.json`.
    //   • `GeoLeaf.ThemeSelector` is the UI; the engine stays kernel.
    //   • a ROOT key never moves without a break, where a method can deprecate.
    // And `Config` is one of the 23 `DEPTH2_FACADES`: the symbol is BORN FROZEN,
    // where any other anchor would be born in the surface freeze's blind spot.
    if (!_gl.Config) _gl.Config = {};
    (_gl.Config as Record<string, unknown>).clearThemesCache = (profileId?: string): void =>
        ThemeLoader.clearCache(profileId);

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

    // ── The SAME calendar trap, on the neighbouring block ─────────────────────
    //
    // `ui-api.ts` also built `UI.Notifications` and six `UI.show*` shortcuts,
    // behind a MODULE-BODY `if (_g.GeoLeaf._UINotifications)`. The only writer of
    // `_UINotifications` is the `toast-renderer` installer, called by
    // `registerGlobals()` AT BOOT — hence strictly after every module body has
    // evaluated. The condition was **always false**, and the seven members never
    // existed.
    //
    // ⚠️ The THEME block just above suffered exactly the same defect; it was caught
    // up here (see its comment), and that catch-up is what masked the second one:
    // `UI.applyTheme` worked, so nothing suggested a twin block stayed dead just
    // below. Both `ui-api.ts` blocks are now removed — they could do nothing.
    //
    // LAZY delegation, like `ui.notify` above and for the same reason: a build
    // that leaves the capability out has no writer, and each call degrades to a
    // silent no-op (`?.`) instead of throwing at assignment.
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
    // Driving the panel from the host. ⚠️ `openPanel` does NOT toggle, where a
    // click on the open tab closes it: that is the only difference between the
    // two, and it is what avoids reproducing the toggle trap on a public
    // surface.
    ui.openPanel = openPanel;
    ui.closePanel = closePanel;
    ui.getOpenPanel = getOpenPanel;
    // Hosting a panel surface the kernel does not name. ⚠️ `openPane` is NOT a synonym of
    // `openPanel`: the latter drives the desktop panel and answers false below 1440px, where
    // the same content belongs in the mobile sheet. A plugin reacting to a click on a feature
    // has no business knowing which surface the current width implies — so it calls this one.
    ui.registerPanelPane = registerPanelPane;
    ui.openPane = openPane;
    ui.closePane = closePane;
    // Stripping the chrome for one task. ⚠️ The kernel never learns WHO asked — that is what
    // keeps `no-plugin-in-core` intact while a plugin drives an application-wide UI mode.
    ui.setImmersive = setImmersive;
    ui.isImmersive = isImmersive;
    // Share (`GeoLeaf.Share` + ShareLifecycle wiring) migrated to
    // capabilities/permalink/install.ts + ShareModule.init() — S2 Lot 6.
}

// ── PHASE A — see the rationale in `globals.config.ts`. ──────────────────────────────────────
//
// Posts the UI FACADES only (`GeoLeaf.UI.*`, renderers, theme cache). It builds no DOM and
// touches no map: that is `UIModule.init()`'s job, which still runs at registry time with the
// adapter and the merged config — and bails out cleanly ("Map not available") without one.
setupUIKernel();
