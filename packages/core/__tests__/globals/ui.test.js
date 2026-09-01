/**
 * globals.ui.ts branch coverage (B6+B7+B9)
 *
 * Targets (B6):
 *   - _LayerManagerBasemapSelector, _LayerManagerControl,
 *     _LayerManagerRenderer, _LayerManagerStyleSelector
 *
 * Targets (B7):
 *   - ThemeCache, _ThemeLoader (theme engine — kernel)
 *   - _ThemeApplier as Object.assign of 4 sub-modules
 *
 * Targets (B9):
 *   - GeoLeaf.UI namespace guard + Branding, CoordinatesDisplay, ScaleControl
 *   - _UIComponents, _UIEventDelegation
 *   - GeoLeaf.UI.notify (info/warn/error/success/dismiss) — kernel adapter, stays here
 *     (the toast-renderer globals moved to capabilities/toast-renderer/install.ts — S2 Lot 4)
 *   - _UITheme + UI.applyTheme, setTheme, toggleTheme, initThemeToggle, initAutoTheme, getCurrentTheme
 *   - _ContentBuilder (Core, Helpers, Shared, Templates, Assemblers)
 *   - Filter-panel: _UIFilterPanelShared, _UIFilterPanelStateReader, _UIFilterPanelApplier,
 *     _UIFilterPanelRenderer, _UIFilterPanelProximity, _UIFilterPanelLazyLoader,
 *     _UIFilterPanelAccordion, _UIFilterPanel, FilterPanel
 *   - Toolbar: UI.initMobileToolbar, UI.initDesktopPanel, UI.activateDesktopPanel, UI.destroyDesktopPanel
 *
 * Strategy: vi.hoisted() + vi.mock(). ESM static import ensures Istanbul
 * instruments globals.ui.ts.
 */

const mocks = vi.hoisted(() => {
    // B6 — labels
    const LabelButtonManager = { show: vi.fn() };
    const LabelRenderer = { render: vi.fn() };
    const Labels = { init: vi.fn() };
    // B6 — layer-manager
    const BasemapSelector = { select: vi.fn() };
    const LMControl = { init: vi.fn() };
    const LMRenderer = { render: vi.fn() };
    const StyleSelector = { select: vi.fn() };

    // B7 — themes
    const ThemeCache = { get: vi.fn() };
    // `clearCache`: read by `globals.ui.ts`, which mounts
    // `GeoLeaf.Config.clearThemesCache` on it.
    const ThemeLoader = { load: vi.fn(), clearCache: vi.fn() };
    const ThemeSelector = { select: vi.fn() };
    const ThemeApplierCore = { applyTheme: vi.fn(), setTheme: vi.fn() };
    const ThemeApplierDeferred = { deferApply: vi.fn() };
    const ThemeApplierUISync = { syncUI: vi.fn() };
    const ThemeApplierVisibility = { toggleTheme: vi.fn() };

    // B9 — ui
    const Branding = { init: vi.fn() };
    const _UIComponents = { render: vi.fn() };
    const CoordinatesDisplay = { show: vi.fn() };
    const _UIEventDelegation = { on: vi.fn() };
    const _buildFilterControl = vi.fn();
    const infoFn = vi.fn();
    const warnFn = vi.fn();
    const errorFn = vi.fn();
    const successFn = vi.fn();
    const dismissFn = vi.fn();
    const _UINotifications = {
        info: infoFn,
        warning: warnFn,
        error: errorFn,
        success: successFn,
        dismiss: dismissFn,
    };
    const NotificationSystem = { create: vi.fn() };
    const applyTheme = vi.fn();
    const toggleTheme = vi.fn();
    const initThemeToggle = vi.fn();
    const initAutoTheme = vi.fn();
    const getCurrentTheme = vi.fn(() => "light");
    const _UITheme = { applyTheme, toggleTheme, initThemeToggle, initAutoTheme, getCurrentTheme };

    // B9 — content-builder
    // B9 — filter-panel
    const FilterPanelShared = { getShared: vi.fn() };
    const FilterPanelStateReader = { read: vi.fn() };
    const FilterPanelApplier = { apply: vi.fn() };
    const FilterPanelRenderer = { render: vi.fn() };
    const FilterPanelProximity = { check: vi.fn() };
    const FilterPanelLazyLoader = { load: vi.fn() };
    const FilterPanel = { open: vi.fn() };
    const loadAccordionContentIfNeeded = vi.fn();
    const FilterPanelAggregator = { toggle: vi.fn() };

    // B9 — toolbar
    const initMobileToolbar = vi.fn();
    const initDesktopPanel = vi.fn();
    const activateDesktopPanel = vi.fn();
    const destroyDesktopPanel = vi.fn();
    const openPanel = vi.fn();
    const closePanel = vi.fn();
    const getOpenPanel = vi.fn();

    return {
        openPanel,
        closePanel,
        getOpenPanel,
        LabelButtonManager,
        LabelRenderer,
        Labels,
        BasemapSelector,
        LMControl,
        LMRenderer,
        StyleSelector,
        ThemeCache,
        ThemeLoader,
        ThemeSelector,
        ThemeApplierCore,
        ThemeApplierDeferred,
        ThemeApplierUISync,
        ThemeApplierVisibility,
        Branding,
        _UIComponents,
        CoordinatesDisplay,
        _UIEventDelegation,
        _buildFilterControl,
        _UINotifications,
        NotificationSystem,
        infoFn,
        warnFn,
        errorFn,
        successFn,
        dismissFn,
        _UITheme,
        applyTheme,
        toggleTheme,
        initThemeToggle,
        initAutoTheme,
        getCurrentTheme,
        FilterPanelShared,
        FilterPanelStateReader,
        FilterPanelApplier,
        FilterPanelRenderer,
        FilterPanelProximity,
        FilterPanelLazyLoader,
        FilterPanel,
        loadAccordionContentIfNeeded,
        FilterPanelAggregator,
        initMobileToolbar,
        initDesktopPanel,
        activateDesktopPanel,
        destroyDesktopPanel,
    };
});

// B6 mocks (labels → capabilities/labels/install.ts ; legend → capabilities/legend/install.ts
// — both asserted in their installer tests, no longer imported by globals.ui.ts)
vi.mock("../../src/kernel/layer-manager/basemap-selector.js", () => ({
    BasemapSelector: mocks.BasemapSelector,
}));
vi.mock("../../src/kernel/layer-manager/control.js", () => ({
    LMControl: mocks.LMControl,
}));
vi.mock("../../src/kernel/layer-manager/renderer.js", () => ({
    LMRenderer: mocks.LMRenderer,
}));
vi.mock("../../src/kernel/layer-manager/style-selector.js", () => ({
    StyleSelector: mocks.StyleSelector,
}));

// B7 mocks
vi.mock("../../src/kernel/themes/theme-cache.js", () => ({
    ThemeCache: mocks.ThemeCache,
}));
vi.mock("../../src/kernel/themes/theme-loader.js", () => ({
    ThemeLoader: mocks.ThemeLoader,
}));
// theme-selector migrated to capabilities/theme-selector/install.ts (S2 Lot 8) — the
// theme ENGINE below stays kernel.
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: mocks.ThemeApplierCore,
}));
vi.mock("../../src/kernel/themes/theme-applier/deferred.js", () => ({
    ThemeApplierDeferred: mocks.ThemeApplierDeferred,
}));
vi.mock("../../src/kernel/themes/theme-applier/ui-sync.js", () => ({
    ThemeApplierUISync: mocks.ThemeApplierUISync,
}));
vi.mock("../../src/kernel/themes/theme-applier/visibility.js", () => ({
    ThemeApplierVisibility: mocks.ThemeApplierVisibility,
}));

// B9 mocks
vi.mock("../../src/api/geoleaf.branding.js", () => ({ Branding: mocks.Branding }));
vi.mock("../../src/kernel/ui/components.js", () => ({
    _UIComponents: mocks._UIComponents,
}));
vi.mock("../../src/api/geoleaf.coordinates.js", () => ({
    Coordinates: mocks.CoordinatesDisplay,
}));
vi.mock("../../src/kernel/ui/event-delegation.js", () => ({
    _UIEventDelegation: mocks._UIEventDelegation,
}));
vi.mock("../../src/kernel/ui/filter-state-manager.js", () => ({}));
// toast-renderer (S7): globals.ui.ts no longer imports the renderer module — `ui.notify`
// reads `GeoLeaf._UINotifications` back lazily, mirroring the installer's `registerGlobals`.
// The B9 describe block below sets it directly on `GL` before exercising `notify.*`.
vi.mock("../../src/kernel/ui/theme.js", () => ({ _UITheme: mocks._UITheme }));
// filter panel: owned by the in-core `filter` capability (F4.4); `_UIFilterPanel*`
// are lazy shims installed by capabilities/filter/compat.ts, not globals.ui.
// toolbar
vi.mock("../../src/kernel/ui/mobile/mobile-toolbar.js", () => ({
    initMobileToolbar: mocks.initMobileToolbar,
}));
vi.mock("../../src/kernel/ui/desktop/desktop-panel.js", () => ({
    initDesktopPanel: mocks.initDesktopPanel,
    activateDesktopPanel: mocks.activateDesktopPanel,
    destroyDesktopPanel: mocks.destroyDesktopPanel,
    // The panel's three public entries.
    openPanel: mocks.openPanel,
    closePanel: mocks.closePanel,
    getOpenPanel: mocks.getOpenPanel,
}));

// Side-effect import: triggers all B6+B7+B9 assignments
import "../../src/globals/globals.ui.ts";
// Trigger explicitly (ESM import — same module instance as globals.ui.ts).

const GL = globalThis.GeoLeaf;

describe("globals.ui.ts — B6 registrations (LayerManager)", () => {
    // Labels (_LabelButtonManager / _LabelRenderer / Labels) migrated to
    // capabilities/labels/install.ts (S2 Lot 1) — asserted in install.test.js.
    // Legend (_LegendControl / _LegendGenerator) migrated to
    // capabilities/legend/install.ts (S2 Lot 4) — asserted in multi-layer-installers.test.js.

    it("registers GeoLeaf._LayerManagerControl", () => {
        expect(GL._LayerManagerControl).toBe(mocks.LMControl);
    });

    it("registers GeoLeaf._LayerManagerStyleSelector", () => {
        expect(GL._LayerManagerStyleSelector).toBe(mocks.StyleSelector);
    });
});

describe("globals.ui.ts — B7 registrations (Themes)", () => {
    it("registers GeoLeaf.ThemeCache", () => {
        expect(GL.ThemeCache).toBe(mocks.ThemeCache);
    });

    // GeoLeaf.ThemeSelector migrated to capabilities/theme-selector/install.ts (S2 Lot 8)
    // — asserted in __tests__/capabilities/ui-installers.test.js.
});

describe("globals.ui.ts — B9 registrations (UI components)", () => {
    it("creates GeoLeaf.UI namespace", () => {
        expect(GL.UI).toBeDefined();
        expect(typeof GL.UI).toBe("object");
    });

    // Branding / Coordinates migrated to their capabilities/<cap>/install.ts (S2).

    it("registers GeoLeaf._UIComponents", () => {
        expect(GL._UIComponents).toBe(mocks._UIComponents);
    });

    it("registers GeoLeaf._UIEventDelegation", () => {
        expect(GL._UIEventDelegation).toBe(mocks._UIEventDelegation);
    });

    // _UINotifications / NotificationSystem / Notifications migrated to
    // capabilities/toast-renderer/install.ts (S2 Lot 4) — asserted in
    // multi-layer-installers.test.js. The `ui.notify` adapter below stays KERNEL, but (S7)
    // it no longer imports the singleton: it reads `GeoLeaf._UINotifications` back lazily,
    // exactly like the toast-renderer installer's `registerGlobals` would write it in prod.

    // ── UI.notify proxy (kernel primitive adapter) ────────────────────────────

    beforeEach(() => {
        GL._UINotifications = mocks._UINotifications;
    });

    it("registers GeoLeaf.UI.notify.info delegating to _UINotifications.info", () => {
        GL.UI.notify.info("test message", {});
        expect(mocks.infoFn).toHaveBeenCalledWith("test message", {});
    });

    it("registers GeoLeaf.UI.notify.warn delegating to _UINotifications.warning", () => {
        GL.UI.notify.warn("test warn", {});
        expect(mocks.warnFn).toHaveBeenCalledWith("test warn", {});
    });

    it("registers GeoLeaf.UI.notify.error delegating to _UINotifications.error", () => {
        GL.UI.notify.error("test error", {});
        expect(mocks.errorFn).toHaveBeenCalledWith("test error", {});
    });

    it("registers GeoLeaf.UI.notify.success delegating to _UINotifications.success", () => {
        GL.UI.notify.success("test ok", {});
        expect(mocks.successFn).toHaveBeenCalledWith("test ok", {});
    });

    it("registers GeoLeaf.UI.notify.dismiss delegating to _UINotifications.dismiss", () => {
        GL.UI.notify.dismiss("notif-id");
        expect(mocks.dismissFn).toHaveBeenCalledWith("notif-id");
    });

    // ── UITheme wiring ────────────────────────────────────────────────────────

    it("registers GeoLeaf._UITheme", () => {
        expect(GL._UITheme).toBe(mocks._UITheme);
    });

    it("wires GeoLeaf.UI.applyTheme = _UITheme.applyTheme", () => {
        expect(GL.UI.applyTheme).toBe(mocks.applyTheme);
    });

    it("wires GeoLeaf.UI.setTheme = _UITheme.applyTheme (alias)", () => {
        expect(GL.UI.setTheme).toBe(mocks.applyTheme);
    });

    it("wires GeoLeaf.UI.toggleTheme = _UITheme.toggleTheme", () => {
        expect(GL.UI.toggleTheme).toBe(mocks.toggleTheme);
    });

    it("wires GeoLeaf.UI.initThemeToggle", () => {
        expect(GL.UI.initThemeToggle).toBe(mocks.initThemeToggle);
    });

    it("wires GeoLeaf.UI.initAutoTheme", () => {
        expect(GL.UI.initAutoTheme).toBe(mocks.initAutoTheme);
    });

    it("wires GeoLeaf.UI.getCurrentTheme", () => {
        expect(GL.UI.getCurrentTheme).toBe(mocks.getCurrentTheme);
    });

    // Filter-panel `_UIFilterPanel*` registrations moved to the in-core `filter`
    // capability (lazy shims via capabilities/filter/compat.ts, F4.4) — see
    // __tests__/capabilities/filter/lifecycle.test.js.

    // ── Toolbar ───────────────────────────────────────────────────────────────

    it("registers GeoLeaf.UI.initMobileToolbar", () => {
        expect(GL.UI.initMobileToolbar).toBe(mocks.initMobileToolbar);
    });

    it("registers GeoLeaf.UI.initDesktopPanel", () => {
        expect(GL.UI.initDesktopPanel).toBe(mocks.initDesktopPanel);
    });

    it("registers GeoLeaf.UI.activateDesktopPanel", () => {
        expect(GL.UI.activateDesktopPanel).toBe(mocks.activateDesktopPanel);
    });

    it("registers GeoLeaf.UI.destroyDesktopPanel", () => {
        expect(GL.UI.destroyDesktopPanel).toBe(mocks.destroyDesktopPanel);
    });
});
