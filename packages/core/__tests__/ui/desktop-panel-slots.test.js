/**
 * ui/desktop/desktop-panel-slots.ts — registry-declared tab/icon buttons.
 *
 * Covers the plugin-table bug report (2026-07-02): a registry tab button whose
 * plugin i18n dict was not yet registered at build time must not permanently
 * display the raw i18n key — it self-heals once on geoleaf:app:ready.
 */
const mockConfigGet = vi.hoisted(() => vi.fn((key, def) => def));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: (...args) => mockConfigGet(...args) },
}));

function makeTabsWithModule(mod) {
    globalThis.GeoLeaf = {
        registry: { getAll: () => [mod] },
        plugins: {},
        Config: { get: (...args) => mockConfigGet(...args) },
    };
    const tabs = document.createElement("div");
    document.body.appendChild(tabs);
    return tabs;
}

afterEach(() => {
    delete globalThis.GeoLeaf;
    document.body.innerHTML = "";
    vi.resetModules();
});

describe("appendRegistryTabButtons() — label resolution", () => {
    it("resolves the translated label when registerDict ran before the button was built", async () => {
        const i18n = await import("../../src/utils/i18n/i18n.ts");
        const { appendRegistryTabButtons } =
            await import("../../src/kernel/ui/desktop/desktop-panel-slots.ts");
        i18n.registerDict("table", {
            fr: { "table.toolbar.button": "Tableau" },
            en: { "table.toolbar.button": "Table" },
        });
        const tabs = makeTabsWithModule({
            id: "table",
            ui: {
                desktopTabButton: {
                    icon: "<svg></svg>",
                    labelKey: "table.toolbar.button",
                    action: "table",
                    variant: "tab",
                },
            },
        });

        appendRegistryTabButtons(tabs);

        const btn = tabs.querySelector('[data-gl-desktop-tab="table"]');
        expect(btn).not.toBeNull();
        // ⚠️ THE ACCESSIBLE NAME, no longer `textContent`: a `variant: "tab"` button now
        // renders the icon its slot already declared and this branch used to throw away. The
        // word did not vanish, it changed carrier — the assertion follows the label.
        expect(btn.getAttribute("aria-label")).toBe("Tableau");
        expect(btn.title).toBe("Tableau");
        expect(btn.querySelector("svg")).not.toBeNull();
    });

    it("self-heals the label on geoleaf:app:ready when registerDict races the button build", async () => {
        const i18n = await import("../../src/utils/i18n/i18n.ts");
        const { appendRegistryTabButtons } =
            await import("../../src/kernel/ui/desktop/desktop-panel-slots.ts");
        // registerDict has NOT run yet — getLabel() falls back to the raw key.
        const tabs = makeTabsWithModule({
            id: "table",
            ui: {
                desktopTabButton: {
                    icon: "<svg></svg>",
                    labelKey: "table.toolbar.button",
                    action: "table",
                    variant: "tab",
                },
            },
        });

        appendRegistryTabButtons(tabs);
        const btn = tabs.querySelector('[data-gl-desktop-tab="table"]');
        expect(btn.getAttribute("aria-label")).toBe("table.toolbar.button");

        // The plugin script finishes registering its dict late (race), then boot
        // reaches geoleaf:app:ready — the button must heal without a page reload.
        i18n.registerDict("table", { fr: { "table.toolbar.button": "Tableau" } });
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(btn.getAttribute("aria-label")).toBe("Tableau");
        expect(btn.title).toBe("Tableau");
        // 🛑 And the icon is STILL there. The label healing rewrote `textContent` for every
        // `.gl-rp-tab`: applied to an icon tab it would have REPLACED the glyph with the word
        // — that is, restored the overflow this change just removed.
        expect(btn.querySelector("svg")).not.toBeNull();
    });

    it("does not touch an already-correct label on geoleaf:app:ready", async () => {
        const i18n = await import("../../src/utils/i18n/i18n.ts");
        const { appendRegistryTabButtons } =
            await import("../../src/kernel/ui/desktop/desktop-panel-slots.ts");
        i18n.registerDict("table", { fr: { "table.toolbar.button": "Tableau" } });
        const tabs = makeTabsWithModule({
            id: "table",
            ui: {
                desktopTabButton: {
                    icon: "<svg></svg>",
                    labelKey: "table.toolbar.button",
                    action: "table",
                    variant: "tab",
                },
            },
        });
        appendRegistryTabButtons(tabs);
        const btn = tabs.querySelector('[data-gl-desktop-tab="table"]');
        expect(btn.getAttribute("aria-label")).toBe("Tableau");

        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(btn.getAttribute("aria-label")).toBe("Tableau");
        expect(btn.querySelector("svg")).not.toBeNull();
    });
});
