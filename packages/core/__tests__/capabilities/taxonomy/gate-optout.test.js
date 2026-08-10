/**
 * The `enabled` gate — opt-out, and total.
 *
 * Two properties, both of which used to be false:
 *
 * 1. **Opt-out.** `modules.taxonomy.enabled` lives in a profile RESOURCE, loaded
 *    after the boot gate reads config. An opt-in gate therefore read `undefined`
 *    and silenced the capability for every profile — which is exactly why the old
 *    painter never ran once. Absent must mean ON.
 *
 * 2. **Total.** `enabled` used to gate nothing anyone could see: its only readers
 *    were the dead painter and an `isEnabled()` with zero call-sites. Setting it to
 *    `false` in a profile changed nothing at all. Now every reader honours it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: mocks.get },
}));

const { getTaxonomyConfig } = await import("../../../src/capabilities/taxonomy/config.ts");
const { buildPublicApi } = await import("../../../src/capabilities/taxonomy/public-api.ts");

const BLOCK = {
    icons: { spriteUrl: "sprite.svg", symbolPrefix: "t-", defaultIcon: "generic" },
    render: { popup: { showIconCategory: true, colorBadges: true } },
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            categories: {
                culture: {
                    svgId: "building",
                    marker: { fill: "#6a1b9a" },
                    label: "Culture",
                },
            },
            fieldMappings: { fclass: { museum: { categoryId: "culture", subCategoryId: "m" } } },
        },
    },
    layers: { pois: { use: "poi-cat" } },
};

/** Stubs `Config.get("modules.taxonomy")` with the given block (or nothing). */
const withConfig = (block) => {
    mocks.get.mockImplementation((path, dflt) =>
        path === "modules.taxonomy" ? (block ?? dflt) : dflt
    );
    return buildPublicApi();
};

const FEATURE = { layerId: "pois", properties: { categoryId: "culture" } };

beforeEach(() => mocks.get.mockReset());

describe("opt-out — absent means ON", () => {
    it("defaults `enabled` to true when the key is missing", () => {
        withConfig({});
        expect(getTaxonomyConfig().enabled).toBe(true);
    });

    it("a profile that never mentions `enabled` still gets its icons", () => {
        const api = withConfig(BLOCK);
        expect(api.isEnabled()).toBe(true);
        expect(api.resolvePoiIcon(FEATURE).useIcon).toBe(true);
    });

    it("`enabled: true` is of course still honoured", () => {
        expect(withConfig({ ...BLOCK, enabled: true }).isEnabled()).toBe(true);
    });
});

describe("total — `enabled: false` silences every reader", () => {
    /** Every reader a profile can observe, and what "silent" means for each. */
    const READERS = [
        ["resolvePoiIcon", (api) => api.resolvePoiIcon(FEATURE).useIcon, false],
        ["resolveTitleIcon", (api) => api.resolveTitleIcon("pois", FEATURE, "popup"), null],
        ["getIcons", (api) => api.getIcons(), null],
        ["getCategories", (api) => api.getCategories("poi-cat"), {}],
        ["getFieldMappings", (api) => api.getFieldMappings("poi-cat"), {}],
        // Added with the reader itself (C-8): it resolves the binding via
        // resolveLayerBinding, which is a pure lookup and knows nothing about opt-out —
        // so the gate has to be applied by the facade. Listed here so it stays that way.
        ["getLayerCategories", (api) => api.getLayerCategories("pois"), {}],
    ];

    it.each(READERS)("%s goes quiet", (_name, read, silent) => {
        expect(read(withConfig({ ...BLOCK, enabled: false }))).toEqual(silent);
    });

    it.each(READERS)("%s speaks up when enabled", (_name, read, silent) => {
        expect(read(withConfig(BLOCK))).not.toEqual(silent);
    });

    it("the marker disc is not painted", () => {
        const api = withConfig({ ...BLOCK, enabled: false });
        expect(api.resolveMarkerPaint("pois", { "circle-color": "#f00" })).toBeNull();
    });

    it("the pill badges are not coloured", () => {
        const api = withConfig({ ...BLOCK, enabled: false });
        expect(api.resolveBadgeStyle("pois", FEATURE, "popup", "categoryId")).toBeNull();
    });

    it("no tinted variant is registered", () => {
        expect(withConfig({ ...BLOCK, enabled: false }).getIconVariants()).toEqual([]);
    });
});

describe("only an explicit `false` counts", () => {
    it.each([0, "", null, "false"])("%o does not disable the capability", (falsy) => {
        // Strict `=== false`, so a stray falsy value in a profile cannot silently
        // switch the map's icons off.
        expect(withConfig({ ...BLOCK, enabled: falsy }).resolvePoiIcon(FEATURE).useIcon).toBe(true);
    });
});
