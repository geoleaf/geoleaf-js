/**
 * Phase 60 — Step 1.10: src/globals/globals.ui.ts (0% → 60%)
 */
const stub = vi.hoisted(() => ({}));
const fn = vi.hoisted(() => () => {});
vi.mock("../../src/capabilities/labels/label-button-manager.ts", () => ({
    LabelButtonManager: stub,
}));
vi.mock("../../src/capabilities/labels/label-renderer.ts", () => ({ LabelRenderer: stub }));
vi.mock("../../src/capabilities/labels/labels.ts", () => ({ Labels: stub }));
// legend migrated to capabilities/legend/install.ts (S2 Lot 4) — no longer imported here.
vi.mock("../../src/kernel/layer-manager/basemap-selector.ts", () => ({
    BasemapSelector: stub,
}));
vi.mock("../../src/kernel/layer-manager/control.ts", () => ({ LMControl: stub }));
vi.mock("../../src/kernel/layer-manager/renderer.ts", () => ({ LMRenderer: stub }));
vi.mock("../../src/kernel/layer-manager/style-selector.ts", () => ({
    StyleSelector: stub,
}));
vi.mock("../../src/kernel/themes/theme-cache.ts", () => ({ ThemeCache: stub }));
vi.mock("../../src/kernel/themes/theme-loader.ts", () => ({ ThemeLoader: stub }));
// theme-selector migrated to capabilities/theme-selector/install.ts.
// ⚠️ Same case as in `globals-geojson.test.js`: `ThemeApplierCore` is
// imported by the module under test, the empty mock returned it `undefined`
// through the `require()` shim, and the native mocker refuses an undeclared
// export. The empty mock's intent is to neutralise.
vi.mock("../../src/kernel/themes/theme-applier/core.ts", () => ({
    ThemeApplierCore: undefined,
}));
vi.mock("../../src/kernel/themes/theme-applier/deferred.ts", () => ({
    ThemeApplierDeferred: undefined,
}));
vi.mock("../../src/kernel/themes/theme-applier/ui-sync.ts", () => ({
    ThemeApplierUISync: undefined,
}));
vi.mock("../../src/kernel/themes/theme-applier/visibility.ts", () => ({
    ThemeApplierVisibility: undefined,
}));
vi.mock("../../src/api/geoleaf.branding.ts", () => ({ Branding: stub }));
vi.mock("../../src/kernel/ui/components.ts", () => ({ _UIComponents: stub }));
vi.mock("../../src/api/geoleaf.coordinates.ts", () => ({ Coordinates: stub }));
vi.mock("../../src/kernel/ui/event-delegation.ts", () => ({ _UIEventDelegation: stub }));
vi.mock("../../src/kernel/ui/filter-control-builder.ts", () => ({
    _buildFilterControl: fn,
}));
vi.mock("../../src/kernel/ui/filter-state-manager.ts", () => ({}));
vi.mock("../../src/capabilities/toast-renderer/notifications.ts", () => ({
    NotificationSystem: stub,
    _UINotifications: { info: fn, warn: fn, error: fn, success: fn, dismiss: fn },
}));
vi.mock("../../src/kernel/ui/theme.ts", () => ({
    _UITheme: { applyTheme: fn, toggleTheme: fn, initThemeToggle: fn, getCurrentTheme: fn },
}));
// `ui/filter-panel/**` was removed in S13 (the panel belongs to the `filter`
// capability); its 8 mocks stood here until 4.3, stubbing paths that no longer exist.

import "../../src/globals/globals.ui.js";

describe("globals/globals.ui (step 1.10)", () => {
    // Labels (S2 Lot 1) and Legend (S2 Lot 4) migrated to their capabilities/<cap>/install.ts
    // — no longer set by setupUI (asserted in their installer tests).
    it("attache LayerManager, UI, le moteur de thème au namespace", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf._LayerManagerControl).toBe(stub);
        expect(globalThis.GeoLeaf.UI).toBeDefined();
        expect(globalThis.GeoLeaf.ThemeCache).toBe(stub);
    });
});
