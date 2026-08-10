/**
 * Phase 60 — Step 1.4: src/globals/globals.api.ts (0% → 60%)
 * Teste les assignations et methods public (init, loadConfig, getNamespace, etc.)
 */
const mockLog = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../../src/utils/log/index.ts", () => ({ Log: mockLog }));
vi.mock("../../src/kernel/api/controller.ts", () => ({ APIController: {} }));
vi.mock("../../src/kernel/api/factory-manager.ts", () => ({ APIFactoryManager: {} }));
vi.mock("../../src/kernel/api/initialization-manager.ts", () => ({
    APIInitializationManager: {},
}));
vi.mock("../../src/kernel/api/module-manager.ts", () => ({ APIModuleManager: {} }));
vi.mock("../../src/kernel/api/boot-info.ts", () => ({ BootInfo: {} }));
vi.mock("../../src/kernel/api/plugin-registry.ts", () => ({
    PluginRegistry: { register: vi.fn() },
}));
const mockBaselayers = vi.hoisted(() => ({}));
const mockCore = vi.hoisted(() => ({}));
const mockHelpers = vi.hoisted(() => ({}));
const mockLayerManager = vi.hoisted(() => ({}));
const mockLegend = vi.hoisted(() => ({}));
const mockPOI = vi.hoisted(() => ({ init: true }));
const mockUI = vi.hoisted(() => ({}));
const mockValidators = vi.hoisted(() => ({}));
const mockFieldRenderers = vi.hoisted(() => ({}));
const mockMediaRenderers = vi.hoisted(() => ({}));
vi.mock("../../src/api/geoleaf.baselayers.ts", () => ({ Baselayers: mockBaselayers }));
vi.mock("../../src/api/geoleaf.core.ts", () => ({ Core: mockCore }));
vi.mock("../../src/api/geoleaf.helpers.ts", () => ({ Helpers: mockHelpers }));
vi.mock("../../src/api/geoleaf.layer-manager.ts", () => ({ LayerManager: mockLayerManager }));
vi.mock("../../src/api/geoleaf.legend.ts", () => ({ Legend: mockLegend }));
vi.mock("../../src/api/geoleaf.poi.ts", () => ({ POI: mockPOI }));
vi.mock("../../src/api/geoleaf.ui.ts", () => ({ UI: mockUI }));
vi.mock("../../src/api/geoleaf.validators.ts", () => ({ Validators: mockValidators }));
vi.mock("../../src/kernel/poi/renderers/field-renderers.ts", () => ({
    FieldRenderers: mockFieldRenderers,
}));
vi.mock("../../src/kernel/poi/renderers/media-renderers.ts", () => ({
    MediaRenderers: mockMediaRenderers,
}));
vi.mock("../../src/api/geoleaf.permalink.ts", () => ({ Permalink: {} }));
vi.mock("../../src/api/geoleaf.pwa.ts", () => ({ PWA: {} }));
vi.mock("../../src/api/geoleaf.events.ts", () => ({ Events: {} }));

import "../../src/globals/globals.api.js";

describe("globals/globals.api (step 1.4)", () => {
    it("expose GeoLeaf.API, Core, plugins", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf.API).toBeDefined();
        expect(globalThis.GeoLeaf.Core).toBe(mockCore);
        expect(globalThis.GeoLeaf.plugins).toBeDefined();
    });

    it("getNamespace retourne le namespace ou null", () => {
        expect(globalThis.GeoLeaf.getNamespace("Core")).toBe(mockCore);
        expect(globalThis.GeoLeaf.getNamespace("Inexistant")).toBeNull();
        expect(globalThis.GeoLeaf.getNamespace()).toBeNull();
    });

    it("loadConfig throws TypeError for invalid input", () => {
        expect(() => globalThis.GeoLeaf.loadConfig(123)).toThrow(TypeError);
        expect(() => globalThis.GeoLeaf.loadConfig(null)).toThrow(TypeError);
    });

    it("getMap et createMap retournent null sans controller", () => {
        expect(globalThis.GeoLeaf.getMap("id")).toBeNull();
        expect(globalThis.GeoLeaf.createMap("id", {})).toBeNull();
    });

    it("getAllMaps retourne un tableau vide sans controller", () => {
        expect(globalThis.GeoLeaf.getAllMaps()).toEqual([]);
    });

    it("hasModule et getModule sans controller", () => {
        expect(globalThis.GeoLeaf.hasModule("x")).toBe(false);
        expect(globalThis.GeoLeaf.getModule("x")).toBeNull();
    });
});
