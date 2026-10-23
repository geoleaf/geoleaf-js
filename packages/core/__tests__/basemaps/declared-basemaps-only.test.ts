/**
 * A profile that declares its basemaps gets those and no other: the built-in defaults
 * (`street`, `topo`, `satellite`) stand in only when nothing is declared. They used to be
 * registered on every `Baselayers.init`, BEFORE the profile's, so a profile that declared two
 * basemaps offered five — among them an imagery served from a host the profile had not chosen.
 *
 * The façade and the registry are real; only the switcher UI of the basemaps module is faked.
 * The layer-manager switcher is real too: its options are read off the registry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/kernel/basemaps/ui.js", () => ({
    createBaseLayerControlsUI: vi.fn(),
    bindUIOnce: vi.fn(),
    refreshUI: vi.fn(),
    destroyUI: vi.fn(),
}));

import { Baselayers } from "../../src/kernel/basemaps/facade.ts";
import { resetBasemapRegistry } from "../../src/kernel/basemaps/registry.ts";
import { _buildAutoBasemapSections } from "../../src/kernel/layer-manager/layer-manager-helpers.ts";
import { BasemapSelector } from "../../src/kernel/layer-manager/basemap-selector.ts";

const DECLARED = {
    plan: { id: "plan", label: "Plan", url: "https://plan.example.com/{z}/{x}/{y}.png" },
    ortho: { id: "ortho", label: "Ortho", url: "https://ortho.example.com/{z}/{x}/{y}.png" },
};

/** Every tile URL the registry could reach, whatever field carries it. */
function reachableUrls(): string[] {
    return Object.values(Baselayers.getBaseLayers()).flatMap((entry) => {
        const def = (entry as { definition: { url?: string; tiles?: string[] } }).definition;
        return [def.url ?? "", ...(def.tiles ?? [])];
    });
}

describe("basemaps — only the declared ones", () => {
    afterEach(() => {
        resetBasemapRegistry();
        document.body.innerHTML = "";
    });

    it("registers the two declared basemaps and no default", () => {
        Baselayers.init({ baselayers: DECLARED, activeKey: "plan" });
        expect(Object.keys(Baselayers.getBaseLayers())).toEqual(["plan", "ortho"]);
        expect(reachableUrls().some((u) => u.includes("arcgisonline.com"))).toBe(false);
    });

    it("offers only the declared basemaps in the layer-manager switcher", () => {
        Baselayers.init({ baselayers: DECLARED, activeKey: "plan" });
        const [section] = _buildAutoBasemapSections({ GeoLeaf: { Baselayers } } as never);
        expect(section).toBeDefined();
        const host = document.createElement("div");
        document.body.appendChild(host);
        BasemapSelector.render(section as NonNullable<typeof section>, host);
        const options = Array.from(host.querySelectorAll("option"), (o) => o.value);
        expect(options).toEqual(["plan", "ortho"]);
        BasemapSelector.destroy();
    });

    it("keeps the defaults when nothing is declared", () => {
        Baselayers.init({});
        expect(Object.keys(Baselayers.getBaseLayers())).toEqual(["street", "topo", "satellite"]);
    });

    it("keeps the defaults when the declaration is empty", () => {
        Baselayers.init({ baselayers: {} });
        expect(Object.keys(Baselayers.getBaseLayers())).toEqual(["street", "topo", "satellite"]);
    });

    it("merges a declared default key that brings no source over that default", () => {
        Baselayers.init({ baselayers: { street: { label: "Rues" } } });
        const street = Baselayers.getBaseLayers().street as {
            label: string;
            definition: { tiles?: string[] };
        };
        expect(Object.keys(Baselayers.getBaseLayers())).toEqual(["street"]);
        expect(street.label).toBe("Rues");
        expect(street.definition.tiles?.[0]).toContain("tile.openstreetmap.org");
    });

    it("takes a declared default key that brings its own url as is", () => {
        // Merged, the default's `tiles` would win over the declared `url`.
        const url = "https://streets.example.com/{z}/{x}/{y}.png";
        Baselayers.init({ baselayers: { street: { label: "Rues", url } } });
        const street = Baselayers.getBaseLayers().street as {
            definition: { url?: string; tiles?: string[] };
        };
        expect(street.definition.url).toBe(url);
        expect(street.definition.tiles).toBeUndefined();
    });
});
