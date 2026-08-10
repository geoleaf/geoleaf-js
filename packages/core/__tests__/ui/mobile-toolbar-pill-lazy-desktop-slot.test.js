/**
 * Regression (bug report 2026-07-02) — l'icône d'un plugin lazy (ex. table) restait
 * visible dans le pill toolbar gauche en desktop alors que son onglet équivalent
 * existe déjà dans la bande d'onglets droite (desktop-panel-slots.ts).
 *
 * mobile-toolbar-pill.ts::_appendRegistryIcons() codait `hasDesktopTabButton: false`
 * en dur pour la boucle des plugins lazy (getLazyUISlots()), alors que le slot porte
 * bien `desktopTabButton` (cas de `table`/`print`, enregistrés via
 * `registerLazyForAction` avec les deux descripteurs) — le bouton pill ne recevait
 * donc jamais l'attribut `data-gl-desktop-slot` qui déclenche le masquage CSS
 * `@media (min-width: 1440px) { [data-gl-desktop-slot] { display: none } }`
 * (geoleaf-desktop-panel.css), contrairement aux modules "eager" (registry.getAll())
 * qui, eux, calculaient correctement `!!mod.ui.desktopTabButton`.
 */
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (k) => k,
}));

const _ICON = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="1" height="1"/></svg>';

function setupGeoLeaf(lazySlots) {
    globalThis.GeoLeaf = {
        registry: { getAll: () => [] },
        plugins: { getLazyUISlots: () => lazySlots },
    };
}

afterEach(() => {
    delete globalThis.GeoLeaf;
    document.body.innerHTML = "";
    vi.resetModules();
});

describe("mobile-toolbar-pill — lazy plugin slot desktop-hide attribute", () => {
    it("sets data-gl-desktop-slot on a lazy plugin's pill icon when it also has a desktopTabButton (table/print)", async () => {
        setupGeoLeaf([
            {
                id: "table",
                mobileIcon: { icon: _ICON, labelKey: "table.toolbar.button", action: "table" },
                desktopTabButton: {
                    icon: _ICON,
                    labelKey: "table.toolbar.button",
                    action: "table",
                    variant: "tab",
                },
            },
        ]);
        const { createToolbarDom } = await import(
            "../../src/kernel/ui/mobile/mobile-toolbar-pill.ts"
        );
        const toolbar = createToolbarDom();
        const btn = toolbar.querySelector('[data-gl-sheet="table"]');
        expect(btn).not.toBeNull();
        expect(btn.hasAttribute("data-gl-desktop-slot")).toBe(true);
    });

    it("does NOT set data-gl-desktop-slot on a lazy plugin's pill icon with no desktopTabButton (measure/editor)", async () => {
        setupGeoLeaf([
            {
                id: "measure",
                mobileIcon: { icon: _ICON, labelKey: "measure.toolbar.button", action: "measure" },
            },
        ]);
        const { createToolbarDom } = await import(
            "../../src/kernel/ui/mobile/mobile-toolbar-pill.ts"
        );
        const toolbar = createToolbarDom();
        const btn = toolbar.querySelector('[data-gl-sheet="measure"]');
        expect(btn).not.toBeNull();
        expect(btn.hasAttribute("data-gl-desktop-slot")).toBe(false);
    });
});
