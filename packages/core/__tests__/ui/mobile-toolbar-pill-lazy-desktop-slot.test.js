/**
 * Regression (bug report 2026-07-02) — a lazy plugin's icon (e.g. table)
 * stayed visible in the left pill toolbar on desktop while its equivalent
 * tab already exists in the right tab strip (desktop-panel-slots.ts).
 *
 * mobile-toolbar-pill.ts::_appendRegistryIcons() hardcoded
 * `hasDesktopTabButton: false` for the lazy-plugin loop (getLazyUISlots()),
 * while the slot does carry `desktopTabButton` (case of `table`/`print`,
 * registered via `registerLazyForAction` with both descriptors) — the pill
 * button therefore never received the `data-gl-desktop-slot` attribute that
 * triggers the CSS masking
 * `@media (min-width: 1440px) { [data-gl-desktop-slot] { display: none } }`
 * (geoleaf-desktop-panel.css), unlike the "eager" modules (registry.getAll())
 * which did compute `!!mod.ui.desktopTabButton` correctly.
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
        const { createToolbarDom } =
            await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.ts");
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
        const { createToolbarDom } =
            await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.ts");
        const toolbar = createToolbarDom();
        const btn = toolbar.querySelector('[data-gl-sheet="measure"]');
        expect(btn).not.toBeNull();
        expect(btn.hasAttribute("data-gl-desktop-slot")).toBe(false);
    });
});

/**
 * The `gateOnModuleEnabled` opt-in at RENDER — and why it is an opt-in.
 *
 * 🛑 THIS BLOCK EXISTS BECAUSE THE UNIFORM RULE WAS WRITTEN THEN RETRACTED,
 * on 20/08/2026. Applying the `modules.<id>.enabled` guard to ALL lazy slots
 * looks right, and is wrong: of the six plugins concerned, **only three**
 * carry the same `!== false` in their `entry.ts` (`print`, `measure`,
 * `editor`). The other three register unconditionally, and
 * `profiles/tourism` says why — it declares
 * `position-share: { enabled: false, showButton: true }`: for that plugin
 * `enabled` governs EMISSION, and the button IS the switch that turns it
 * on. The uniform rule masked a button the profile explicitly asks for, and
 * removed the only way to activate the feature. Measured: the
 * `position-share` button had vanished from all four shipped variants.
 */
describe("mobile-toolbar-pill — garde `enabled` des créneaux paresseux (opt-in)", () => {
    /** Config that only knows the keys provided. */
    const setup = (lazySlots, config) => {
        globalThis.GeoLeaf = {
            registry: { getAll: () => [] },
            plugins: { getLazyUISlots: () => lazySlots },
            Config: { get: (k, d) => (k in config ? config[k] : d) },
        };
    };
    const slot = (id, extra) => ({
        id,
        pluginName: id,
        mobileIcon: { icon: _ICON, labelKey: `${id}.toolbar.button`, action: id },
        ...extra,
    });
    const build = async () => {
        const { createToolbarDom } =
            await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.ts");
        return createToolbarDom();
    };

    it("masque le créneau qui DEMANDE la garde quand le module est désactivé", async () => {
        setup([slot("print", { gateOnModuleEnabled: true })], { "modules.print.enabled": false });
        expect((await build()).querySelector('[data-gl-sheet="print"]')).toBeNull();
    });

    // 🛑 THE TEST THAT WOULD HAVE CAUGHT THE MISTAKE. Without opt-in, this slot vanished.
    it("LAISSE le créneau qui ne demande PAS la garde, même module désactivé (position-share)", async () => {
        setup([slot("position-share")], { "modules.position-share.enabled": false });
        expect((await build()).querySelector('[data-gl-sheet="position-share"]')).not.toBeNull();
    });

    it("laisse le créneau gardé quand le profil ne déclare pas le module (opt-out)", async () => {
        setup([slot("print", { gateOnModuleEnabled: true })], {});
        expect((await build()).querySelector('[data-gl-sheet="print"]')).not.toBeNull();
    });

    it("interroge la clé du plugin PORTEUR, pas celle de l'action (poi-add → editor)", async () => {
        const poiAdd = {
            id: "poi-add",
            pluginName: "editor",
            gateOnModuleEnabled: true,
            mobileIcon: { icon: _ICON, labelKey: "editor.toolbar.poi_add", action: "poi-add" },
        };
        setup([poiAdd], { "modules.editor.enabled": false });
        expect((await build()).querySelector('[data-gl-sheet="poi-add"]')).toBeNull();
    });
});
