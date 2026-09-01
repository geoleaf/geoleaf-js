/**
 * Config-contract Phase C / C4 — B5 {id}_config.json styles.* / legends.* / search.
 *
 * Read path: geojson/layer-config-manager.ts (LayerConfigManager) exposes the exported
 * seams that read styles.{directory,default} (loadDefaultStyle) and legends.{directory,default}
 * (loadLayerLegend → Legend module). styles.available (layer-manager/style-selector.ts) and
 * search.indexingFields (ui/filter-panel/applier.ts) are DOM/state-coupled readers exercised
 * end-to-end by e2e/cfg-c4 — locked here as it.todo with their consumer site so coverage is
 * traceable. (The per-layer `table.*` binding is now consumed by the `@geoleaf-plugins/table`
 * plugin and covered by its own suites — no longer a core reader.)
 *
 * Consumer: packages/core/src/kernel/geojson/layer-config-manager.ts. Inventory B5.
 */

import { LayerConfigManager } from "../../src/kernel/geojson/layer-config-manager.js";
import { installConfig, resetConfig } from "./_helpers/config-harness.js";
import { styleCache } from "../../src/utils/loaders/style-cache.js";

/**
 * Minimal style file that satisfies the GeoLeaf schema.
 *
 * ⚠️ The fixtures here were `{ circle: { radius: 4 } }` and `{}`. Neither is a
 * style this codebase can consume — the schema requires a `style` or `defaultStyle` block —
 * and they passed only because this read path did not validate. It does now (it delegates to
 * the shared loader), so a fixture has to be a real style. The URL assertions, which are what
 * these cases exist for, are untouched.
 */
const VALID_STYLE = { style: { color: "#3388ff", weight: 2 } };

describe("config B5 — styles.default / styles.directory (LayerConfigManager.loadDefaultStyle)", () => {
    beforeEach(() => installConfig({ data: { profilesBasePath: "profiles" } }));
    afterEach(() => {
        resetConfig();
        vi.restoreAllMocks();
        // The shared style cache outlives a test — without this, a case that seeded a key
        // makes the next one assert against a cache hit instead of a fetch.
        styleCache.clear();
    });

    it("missing styles.default → throws 'No default style defined'", async () => {
        await expect(LayerConfigManager.loadDefaultStyle("rp", { styles: {} })).rejects.toThrow(
            "No default style"
        );
    });

    it("missing _profileId/_layerDirectory metadata → throws", async () => {
        await expect(
            LayerConfigManager.loadDefaultStyle("rp", { styles: { default: "defaut.json" } })
        ).rejects.toThrow("Missing metadata");
    });

    it("styles.default + default directory → fetches '<base>/styles/defaut.json'", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true, status: 200, json: async () => VALID_STYLE });
        const style = await LayerConfigManager.loadDefaultStyle("rp", {
            styles: { directory: "styles", default: "defaut.json" },
            _profileId: "_reference",
            _layerDirectory: "layers/reference-points",
        });
        expect(style).toEqual(VALID_STYLE);
        expect(fetchSpy.mock.calls[0][0]).toContain(
            "_reference/layers/reference-points/styles/defaut.json"
        );
    });

    it("styles.directory override changes the fetched path", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true, status: 200, json: async () => VALID_STYLE });
        await LayerConfigManager.loadDefaultStyle("rp", {
            styles: { directory: "custom-styles", default: "alt.json" },
            _profileId: "_reference",
            _layerDirectory: "layers/reference-points",
        });
        expect(fetchSpy.mock.calls[0][0]).toContain("/custom-styles/alt.json");
    });
});

describe("config B5 — legends.* (LayerConfigManager.loadLayerLegend)", () => {
    let legendSpy;
    beforeEach(() => {
        installConfig({ data: { profilesBasePath: "profiles" } });
        legendSpy = vi.fn();
        globalThis.GeoLeaf.Legend = { loadLayerLegend: legendSpy };
    });
    afterEach(() => {
        delete globalThis.GeoLeaf.Legend;
        resetConfig();
    });

    it("layer with a legends block → Legend module invoked (id, activeStyle, def)", () => {
        const def = {
            id: "reference-points",
            legends: { directory: "legends", default: "defaut.legend.json" },
        };
        LayerConfigManager.loadLayerLegend({ id: "_reference" }, def);
        expect(legendSpy).toHaveBeenCalledWith("reference-points", "default", def);
    });

    it("layer.style selects the active style passed to the Legend module", () => {
        const def = { id: "rp", style: "par_categorie", legends: { directory: "legends" } };
        LayerConfigManager.loadLayerLegend({ id: "_reference" }, def);
        expect(legendSpy).toHaveBeenCalledWith("rp", "par_categorie", def);
    });

    it("no legends block → Legend module NOT invoked", () => {
        LayerConfigManager.loadLayerLegend({ id: "_reference" }, { id: "rp" });
        expect(legendSpy).not.toHaveBeenCalled();
    });
});

describe("config B5 — DOM/state-coupled readers (covered by e2e/cfg-c4 + plugin suites)", () => {
    it.todo(
        "styles.available → alternate-style selector (layer-manager/style-selector.ts:56) — e2e style switch"
    );
    it.todo(
        "search.indexingFields → GeoJSON layer search index (ui/filter-panel/applier.ts:28) — e2e filter"
    );
});
