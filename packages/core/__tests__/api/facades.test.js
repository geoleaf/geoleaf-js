/**
 * src/api/geoleaf.*.ts facades — Phase 7 coverage (0% funcs)
 */
vi.mock("../../src/kernel/basemaps/facade.js", () => ({ Baselayers: { init: vi.fn() } }));
vi.mock("../../src/kernel/ui/ui-api.js", () => ({ UI: { init: vi.fn() } }));
vi.mock("../../src/kernel/api/geoleaf-api.js", () => ({ GeoLeafAPI: {} }));
vi.mock("../../src/kernel/layer-manager/layer-manager-api.js", () => ({
    // `registerLayer` removed on 20/08/2026: absent from `LayerManager`'s
    // real surface (2 members — `init`, `refresh`) and from every source. Nothing asserted it.
    LayerManager: { getLayerById: vi.fn() },
}));
vi.mock("../../src/capabilities/legend/public-api.js", () => ({
    // `getSections` removed on 20/08/2026: the `Legend` facade has no "sections" family.
    Legend: { init: vi.fn() },
}));
import { GeoLeafAPI } from "../../src/api/geoleaf.api.js";
import { Baselayers } from "../../src/api/geoleaf.baselayers.js";
import { UI } from "../../src/api/geoleaf.ui.js";
import { LayerManager } from "../../src/api/geoleaf.layer-manager.js";
import { Legend } from "../../src/api/geoleaf.legend.js";

describe("api/geoleaf facades", () => {
    it("geoleaf.api exports GeoLeafAPI", () => {
        expect(GeoLeafAPI).toBeDefined();
    });
    it("geoleaf.baselayers exports Baselayers", () => {
        expect(Baselayers).toBeDefined();
        expect(Baselayers.init).toBeDefined();
    });
    it("geoleaf.ui exports UI", () => {
        expect(UI).toBeDefined();
    });
    // `geoleaf.utils.ts` was removed at KERNEL S14: it re-exported the dead `utils-api.ts`
    // assembler and had no importer since the UMD builds went away in v2.0.0. The live
    // `Utils` surface is asserted by `__tests__/utils/utils-shape.test.js`.
    it("geoleaf.layer-manager exports LayerManager", () => {
        expect(LayerManager).toBeDefined();
        expect(typeof LayerManager.getLayerById).toBe("function");
    });
    it("geoleaf.legend exports Legend", () => {
        expect(Legend).toBeDefined();
        expect(typeof Legend.init).toBe("function");
    });
});
