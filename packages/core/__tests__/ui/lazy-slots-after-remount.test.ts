/**
 * A lazy plugin keeps its toolbar button once its bundle is loaded.
 *
 * ## The defect
 *
 * Both toolbars are rebuilt at every boot, from two lists: the module registry, and the slots
 * declared with `GeoLeaf.plugins.registerLazyForAction()`. The second list left out the plugins
 * already LOADED — it was read as « the buttons shown before the bundle downloads ». A plugin
 * loaded after the first boot is in neither: its bundle evaluates once the toolbar is built, so
 * it declares no slot to the module registry. `GeoLeaf.mount()` rebuilding the toolbars, every
 * plugin the user had opened lost its button at the next mount (measured in a real browser:
 * `table`, `editor`, `measure`, `print`, `position-share`).
 *
 * ## What is pinned
 *
 * Driven through the REAL plugin registry and the REAL module registry — both lists as the
 * renderers read them, not a stub of `getLazyUISlots()`:
 *
 * - a slot is drawn before the bundle loads, and again once it is loaded;
 * - a slot the module registry declares under the same id is left to the registry: the plugin
 *   loaded before the boot, and its own guards decide. Offered twice, a button its declaration
 *   hides (`defaultVisible: false`) came back through the lazy path, which defaults to visible;
 * - a click on the button of a loaded plugin is not a lazy action any more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (k: string) => k,
}));

const ICON = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="1" height="1"/></svg>';

/** The two registries, fresh, wired on the global the renderers read. */
async function setup() {
    const { PluginRegistry } = await import("../../src/kernel/api/plugin-registry.ts");
    const { ModuleRegistry } = await import("../../src/app/module-registry.ts");
    const registry = new ModuleRegistry();
    (globalThis as Record<string, unknown>)["GeoLeaf"] = {
        registry,
        plugins: PluginRegistry,
        Config: { get: (_key: string, fallback?: unknown) => fallback },
    };
    PluginRegistry.registerLazy("table", () => Promise.resolve());
    PluginRegistry.registerLazyForAction("table", "table", {
        mobileIcon: { icon: ICON, labelKey: "table.button", action: "table" },
        desktopTabButton: { icon: ICON, labelKey: "table.button", action: "table" },
    });
    return { PluginRegistry, registry };
}

/** Builds both toolbars, as a boot does, and says whether each shows the `table` button. */
async function drawn(): Promise<{ pill: boolean; tab: boolean }> {
    const { createToolbarDom } = await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.ts");
    const { appendRegistryTabButtons } =
        await import("../../src/kernel/ui/desktop/desktop-panel-slots.ts");
    const toolbar = createToolbarDom();
    const tabs = document.createElement("div");
    appendRegistryTabButtons(tabs);
    return {
        pill: toolbar.querySelector('[data-gl-sheet="table"]') !== null,
        tab: tabs.querySelector('[data-gl-desktop-tab="table"]') !== null,
    };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    document.body.innerHTML = "";
    vi.resetModules();
});

describe("a lazy plugin's toolbar slot, before and after its bundle loads", () => {
    it("🛑 is drawn again once the plugin is loaded — the toolbar of the next mount", async () => {
        const { PluginRegistry } = await setup();
        expect(await drawn(), "before the bundle loads").toEqual({ pill: true, tab: true });

        // The bundle evaluated after the boot: it is loaded, and declared no slot of its own.
        PluginRegistry.register("table", {});
        expect(PluginRegistry.isLoaded("table")).toBe(true);

        expect(await drawn(), "the toolbar rebuilt by the next mount").toEqual({
            pill: true,
            tab: true,
        });
    });

    it("the button of a loaded plugin emits its action at once — it is no lazy action", async () => {
        const { PluginRegistry } = await setup();
        expect(PluginRegistry.isLazyAction("table")).toBe(true);
        PluginRegistry.register("table", {});
        expect(PluginRegistry.isLazyAction("table")).toBe(false);
        expect(PluginRegistry.getLazyUISlots().map((slot) => slot.id)).toEqual(["table"]);
    });

    it("🛑 a slot the module registry declares is judged by the registry alone", async () => {
        const { PluginRegistry, registry } = await setup();
        // Loaded BEFORE the boot: the plugin declared its own slot, hidden unless the profile
        // says otherwise. The lazy path defaults to visible — it must not answer too.
        PluginRegistry.register("table", {});
        registry.register({
            id: "table",
            ui: {
                mobileIcon: {
                    icon: ICON,
                    labelKey: "table.button",
                    profileKey: "modules.table.showButton",
                    defaultVisible: false,
                    action: "table",
                },
                desktopTabButton: {
                    icon: ICON,
                    labelKey: "table.button",
                    profileKey: "modules.table.showButton",
                    defaultVisible: false,
                    action: "table",
                },
            },
        } as never);

        expect(await drawn()).toEqual({ pill: false, tab: false });
    });

    it("a lifecycle module without a slot does not take the button away", async () => {
        const { PluginRegistry, registry } = await setup();
        // What a plugin loaded on demand registers: its teardown, and no slot.
        PluginRegistry.register("table", {});
        registry.register({ id: "table", dependencies: [], init: () => {}, destroy: () => {} });

        expect(await drawn()).toEqual({ pill: true, tab: true });
    });

    it("a slot whose plugin has no lazy resolver is not offered", async () => {
        const { PluginRegistry } = await setup();
        PluginRegistry.registerLazyForAction("orphan", "nobody", {
            mobileIcon: { icon: ICON, labelKey: "orphan.button", action: "orphan" },
        });
        expect(PluginRegistry.getLazyUISlots().map((slot) => slot.id)).toEqual(["table"]);
    });
});
