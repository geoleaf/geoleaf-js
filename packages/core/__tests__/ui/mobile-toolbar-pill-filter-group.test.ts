/**
 * The pill's filter group exists whenever the filter panel is on, whatever fixed buttons the
 * configuration turns off.
 *
 * ## The defect
 *
 * `_buildToolbarButton()` appended the filter group when the loop over the fixed buttons reached
 * INDEX 6. That list is not fixed: fullscreen, zoom in, zoom out and proximity are always there,
 * but geolocation, the theme selector and the layer manager each follow their own flag. Turn any
 * one of them off and the list stops at six entries — index 6 is never reached, and the filter
 * group (`.gl-map-toolbar__group`, carrying `[data-gl-sheet="filters"]`) is never created. No
 * error, no warning: the panel is on, its button simply does not exist.
 *
 * The 6 had drifted before it broke: it was set when the search button was still in the list,
 * to mean "after proximity, before themes". The search left the list, every index moved by one,
 * and the group slid between themes and layers without anyone deciding it.
 *
 * ## What the gate demands
 *
 * The group is anchored on a NAMED neighbour — immediately before the layers button, or after
 * the last fixed button when there is none — so no flag combination can lose it. A full bar keeps
 * today's layout: themes, filters, layers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { MobileToolbarOptions } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: (k: string) => k,
}));

const globalView = globalThis as unknown as { GeoLeaf?: unknown };

const _ICON = '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="1" height="1"/></svg>';

/** A registry module carrying a `mobileIcon`, as `registry.getAll()` returns it. */
function mod(id: string) {
    return {
        id,
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: `${id}.label`,
                profileKey: `modules.${id}.enabled`,
                defaultVisible: true,
            },
        },
    };
}

/**
 * Builds the pill under the given toolbar options.
 *
 * ⚠️ `domState` is imported AFTER `vi.resetModules()` and before the pill, in the same module
 * graph: an import hoisted to the top of the file would set the options on a `domState` the
 * freshly loaded pill never reads.
 */
async function renderPill(
    options: Partial<MobileToolbarOptions>,
    modules: ReturnType<typeof mod>[] = []
): Promise<HTMLElement> {
    globalView.GeoLeaf = {
        registry: { getAll: () => modules },
        plugins: { getLazyUISlots: () => [] },
    };
    const { domState } = await import("../../src/kernel/ui/mobile/mobile-toolbar-state.js");
    domState.options = { glMain: document.createElement("div"), ...options };
    const { createToolbarDom } = await import("../../src/kernel/ui/mobile/mobile-toolbar-pill.js");
    return createToolbarDom();
}

/** The pill's direct children, one label each: the group reads `[filters]`. */
function layout(toolbar: HTMLElement): (string | null)[] {
    const scroll = toolbar.querySelector(".gl-map-toolbar__scroll");
    if (!scroll) throw new Error("the pill has no .gl-map-toolbar__scroll");
    return [...scroll.children].map((el) =>
        el.classList.contains("gl-map-toolbar__group")
            ? "[filters]"
            : el.getAttribute("data-gl-sheet") || el.getAttribute("data-gl-toolbar-action")
    );
}

afterEach(() => {
    delete globalView.GeoLeaf;
    document.body.innerHTML = "";
    vi.resetModules();
});

describe("mobile-toolbar-pill — groupe de filtre quel que soit le nombre de boutons fixes", () => {
    it("barre complète (7 boutons fixes) : position inchangée, entre thèmes et couches", async () => {
        const toolbar = await renderPill({});

        expect(layout(toolbar)).toEqual([
            "fullscreen",
            "zoom-in",
            "zoom-out",
            "geoloc",
            "proximity",
            "themes",
            "[filters]",
            "layers",
        ]);
    });

    it.each<[string, Partial<MobileToolbarOptions>, string[]]>([
        [
            "sélecteur de thèmes éteint",
            { showThemeSelector: false },
            ["fullscreen", "zoom-in", "zoom-out", "geoloc", "proximity", "[filters]", "layers"],
        ],
        [
            "géolocalisation éteinte",
            { showGeolocation: false },
            ["fullscreen", "zoom-in", "zoom-out", "proximity", "themes", "[filters]", "layers"],
        ],
        [
            "gestionnaire de couches éteint",
            { showLayerManager: false },
            ["fullscreen", "zoom-in", "zoom-out", "geoloc", "proximity", "themes", "[filters]"],
        ],
        [
            "les trois éteints",
            { showGeolocation: false, showThemeSelector: false, showLayerManager: false },
            ["fullscreen", "zoom-in", "zoom-out", "proximity", "[filters]"],
        ],
    ])(
        "%s : le groupe existe, avant couches ou après le dernier bouton fixe",
        async (_, options, expected) => {
            const toolbar = await renderPill(options);

            const group = toolbar.querySelector(".gl-map-toolbar__group");
            expect(group).not.toBeNull();
            expect(group?.querySelector('[data-gl-sheet="filters"]')).not.toBeNull();
            expect(layout(toolbar)).toEqual(expected);
        }
    );

    it("le groupe suit le dernier bouton FIXE, pas la fin de la barre : il précède les icônes du registre", async () => {
        const toolbar = await renderPill({ showLayerManager: false }, [mod("legend")]);

        expect(layout(toolbar)).toEqual([
            "fullscreen",
            "zoom-in",
            "zoom-out",
            "geoloc",
            "proximity",
            "themes",
            "[filters]",
            "legend",
        ]);
    });

    it.each<[string, Partial<MobileToolbarOptions>]>([
        ["barre complète", {}],
        ["sélecteur de thèmes éteint", { showThemeSelector: false }],
    ])("showFilterPanel: false (%s) : aucun groupe", async (_, options) => {
        const toolbar = await renderPill({ ...options, showFilterPanel: false });

        expect(toolbar.querySelector(".gl-map-toolbar__group")).toBeNull();
        expect(toolbar.querySelector('[data-gl-sheet="filters"]')).toBeNull();
    });
});
