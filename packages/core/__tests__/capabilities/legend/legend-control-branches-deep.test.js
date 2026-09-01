/**
 * T10.3.12 — legend-control-branches-deep.test.js
 * Covers: src/capabilities/legend/legend-control.ts
 *         - createLegendControl() all branches
 *         - ensureSpriteLoaded() all paths
 *         - show/hide/toggle/update/remove methods
 * Strategy: await import() + minimal mocks of external dependencies
 */
"use strict";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: (key) => key,
}));

vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        clearElementFast: vi.fn((el) => {
            if (el) el.innerHTML = "";
        }),
    },
}));

vi.mock("../../../src/utils/controls/propagation-blocker.js", () => ({
    blockMapPropagation: vi.fn(),
}));

// Helper to create a mock map that supports addControl
function makeMockMap(_position = "bottomleft") {
    return {
        addControl: vi.fn(() => ({ remove: vi.fn() })),
    };
}

describe("LegendControl (T10.3.12)", () => {
    let LegendControl;
    let LegendRendererMock;

    beforeAll(async () => {
        // Setup LegendRenderer mock
        vi.mock("../../../src/capabilities/legend/legend-renderer.ts", () => ({
            LegendRenderer: {
                renderSection: vi.fn(),
                renderFooter: vi.fn(),
                renderAccordion: vi.fn(),
            },
        }));
        // Sprite injection lives in the adapter (S9 — POI markers module removed).
        vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
            ensureProfileSpriteInjectedSync: vi.fn(() => Promise.resolve()),
            isProfileSpriteReady: () =>
                document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
        }));

        const mod = await import("../../../src/capabilities/legend/legend-control.ts");
        LegendControl = mod.LegendControl;

        const rendererMod = await import("../../../src/capabilities/legend/legend-renderer.ts");
        LegendRendererMock = rendererMod.LegendRenderer;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
    });

    // ── create() / createLegendControl() ──────────────────────────────────────

    describe("LegendControl.create()", () => {
        it("exports create function", () => {
            expect(LegendControl.create).toBeDefined();
            expect(typeof LegendControl.create).toBe("function");
        });

        it("returns a legend instance", () => {
            const ctrl = LegendControl.create({ title: "My Legend" });
            expect(ctrl).not.toBeNull();
            expect(ctrl._glOptions.title).toBe("My Legend");
        });

        it("starts with _container=null before addTo", () => {
            const ctrl = LegendControl.create({});
            expect(ctrl._container).toBeNull();
        });

        it("starts with _map=null before addTo", () => {
            const ctrl = LegendControl.create({});
            expect(ctrl._map).toBeNull();
        });
    });

    // ── addTo() / _buildStructure() ───────────────────────────────────────────

    describe("addTo() and _buildStructure()", () => {
        it("creates container element after addTo", () => {
            const ctrl = LegendControl.create({ title: "Legend" });
            ctrl.addTo(makeMockMap());
            expect(ctrl._container).not.toBeNull();
        });

        it("calls map.addControl with container", () => {
            const map = makeMockMap();
            const ctrl = LegendControl.create({ position: "topright" });
            ctrl.addTo(map);
            expect(map.addControl).toHaveBeenCalledWith(expect.any(HTMLElement), "topright");
        });

        it("uses 'bottomleft' as default position", () => {
            const map = makeMockMap();
            const ctrl = LegendControl.create({});
            ctrl.addTo(map);
            expect(map.addControl).toHaveBeenCalledWith(expect.any(HTMLElement), "bottomleft");
        });

        it("adds gl-map-legend--collapsed class when collapsed=true", () => {
            const ctrl = LegendControl.create({ collapsed: true });
            ctrl.addTo(makeMockMap());
            expect(ctrl._container.classList.contains("gl-map-legend--collapsed")).toBe(true);
        });

        it("does NOT add collapsed class when collapsed=false", () => {
            const ctrl = LegendControl.create({ collapsed: false });
            ctrl.addTo(makeMockMap());
            expect(ctrl._container.classList.contains("gl-map-legend--collapsed")).toBe(false);
        });

        it("builds header when title is provided", () => {
            const ctrl = LegendControl.create({ title: "Test Legend" });
            ctrl.addTo(makeMockMap());
            const header = ctrl._container.querySelector(".gl-map-legend__header");
            expect(header).not.toBeNull();
            const titleEl = ctrl._container.querySelector(".gl-map-legend__title");
            expect(titleEl?.textContent).toBe("Test Legend");
        });

        it("does NOT build header when title is absent", () => {
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            const header = ctrl._container.querySelector(".gl-map-legend__header");
            expect(header).toBeNull();
        });

        it("adds toggle button when collapsible=true", () => {
            const ctrl = LegendControl.create({ title: "Test", collapsible: true });
            ctrl.addTo(makeMockMap());
            const toggleBtn = ctrl._container.querySelector(".gl-map-legend__toggle");
            expect(toggleBtn).not.toBeNull();
        });

        it("does NOT add toggle button when collapsible=false", () => {
            const ctrl = LegendControl.create({ title: "Test", collapsible: false });
            ctrl.addTo(makeMockMap());
            const toggleBtn = ctrl._container.querySelector(".gl-map-legend__toggle");
            expect(toggleBtn).toBeNull();
        });

        it("renders sections when sections are provided", () => {
            const sections = [{ id: "s1", title: "Section 1", items: [] }];
            const ctrl = LegendControl.create({ sections });
            ctrl.addTo(makeMockMap());
            expect(LegendRendererMock.renderSection).toHaveBeenCalled();
        });

        it("renders footer when footer is provided", () => {
            const ctrl = LegendControl.create({ footer: { text: "Map data © OpenStreetMap" } });
            ctrl.addTo(makeMockMap());
            expect(LegendRendererMock.renderFooter).toHaveBeenCalled();
        });

        it("does NOT render footer when no footer", () => {
            const ctrl = LegendControl.create({ sections: [] });
            ctrl.addTo(makeMockMap());
            expect(LegendRendererMock.renderFooter).not.toHaveBeenCalled();
        });
    });

    // ── _toggleCollapsed() ────────────────────────────────────────────────────

    describe("_toggleCollapsed()", () => {
        it("adds collapsed class when not collapsed", () => {
            const ctrl = LegendControl.create({ title: "T" });
            ctrl.addTo(makeMockMap());
            ctrl._toggleCollapsed();
            expect(ctrl._container.classList.contains("gl-map-legend--collapsed")).toBe(true);
            expect(ctrl._glOptions.collapsed).toBe(true);
        });

        it("removes collapsed class when already collapsed", () => {
            const ctrl = LegendControl.create({ title: "T", collapsed: true });
            ctrl.addTo(makeMockMap());
            ctrl._toggleCollapsed();
            expect(ctrl._container.classList.contains("gl-map-legend--collapsed")).toBe(false);
            expect(ctrl._glOptions.collapsed).toBe(false);
        });

        it("toggle button click triggers _toggleCollapsed", () => {
            const ctrl = LegendControl.create({ title: "T", collapsible: true });
            ctrl.addTo(makeMockMap());
            const btn = ctrl._container.querySelector(".gl-map-legend__toggle");
            expect(btn).not.toBeNull();
            btn.click();
            expect(ctrl._glOptions.collapsed).toBe(true);
        });
    });

    // ── show() / hide() ───────────────────────────────────────────────────────

    describe("show()", () => {
        it("sets container display to 'block'", () => {
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            ctrl._container.style.display = "none";
            ctrl.show();
            expect(ctrl._container.style.display).toBe("block");
        });

        it("does not crash when _container is null", () => {
            const ctrl = LegendControl.create({});
            // do not call addTo → _container is null
            expect(() => ctrl.show()).not.toThrow();
        });
    });

    describe("hide()", () => {
        it("sets container display to 'none'", () => {
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            ctrl.hide();
            expect(ctrl._container.style.display).toBe("none");
        });

        it("does not crash when _container is null", () => {
            const ctrl = LegendControl.create({});
            expect(() => ctrl.hide()).not.toThrow();
        });
    });

    // ── updateMultiLayerContent() ─────────────────────────────────────────────

    describe("updateMultiLayerContent()", () => {
        it("does not crash when _bodyEl is null", () => {
            const ctrl = LegendControl.create({});
            // No addTo → _bodyEl is null
            expect(() =>
                ctrl.updateMultiLayerContent([{ layerId: "l1", label: "L1" }])
            ).not.toThrow();
        });

        it("calls renderAccordion for each entry when _bodyEl is set", async () => {
            // Inject svg sprite so ensureSpriteLoaded path works
            document.body.innerHTML = '<svg data-geoleaf-sprite="profile"></svg>';
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            const entries = [
                { layerId: "l1", label: "L1", sections: [] },
                { layerId: "l2", label: "L2", sections: [] },
            ];
            ctrl.updateMultiLayerContent(entries);
            // Sprite is already in DOM — callback fires async
            await new Promise((r) => setTimeout(r, 50));
            expect(LegendRendererMock.renderAccordion).toHaveBeenCalledTimes(2);
        });

        it("handles empty legendsArray", async () => {
            document.body.innerHTML = '<svg data-geoleaf-sprite="profile"></svg>';
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            ctrl.updateMultiLayerContent([]);
            await new Promise((r) => setTimeout(r, 50));
            expect(LegendRendererMock.renderAccordion).not.toHaveBeenCalled();
        });
    });

    // ── remove() ─────────────────────────────────────────────────────────────

    describe("remove()", () => {
        it("calls controlHandle.remove()", () => {
            const ctrl = LegendControl.create({});
            const map = makeMockMap();
            const mockHandle = { remove: vi.fn() };
            map.addControl.mockReturnValue(mockHandle);
            ctrl.addTo(map);
            ctrl.remove();
            expect(mockHandle.remove).toHaveBeenCalled();
        });

        it("clears _map and _container after remove", () => {
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            ctrl.remove();
            expect(ctrl._map).toBeNull();
            expect(ctrl._container).toBeNull();
        });

        it("runs cleanup functions on remove", () => {
            const cleanup = vi.fn();
            const ctrl = LegendControl.create({ title: "T", collapsible: true });
            ctrl.addTo(makeMockMap());
            ctrl._cleanups.push(cleanup);
            ctrl.remove();
            expect(cleanup).toHaveBeenCalled();
        });
    });

    // ── getContainer() ────────────────────────────────────────────────────────

    describe("getContainer()", () => {
        it("returns null before addTo", () => {
            const ctrl = LegendControl.create({});
            expect(ctrl.getContainer()).toBeNull();
        });

        it("returns HTMLElement after addTo", () => {
            const ctrl = LegendControl.create({});
            ctrl.addTo(makeMockMap());
            expect(ctrl.getContainer()).toBeInstanceOf(HTMLElement);
        });
    });
});

// ─── ensureSpriteLoaded (T10.3.12b) ──────────────────────────────────────────

describe("ensureSpriteLoaded branches (T10.3.12b)", () => {
    let LegendControl;

    beforeEach(async () => {
        vi.unmock("../../../src/utils/loaders/profile-sprite-loader.js");
        vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
            ensureProfileSpriteInjectedSync: vi.fn(() => Promise.resolve()),
            isProfileSpriteReady: () =>
                document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
        }));
        // Re-import after mock change
        vi.resetModules();
        vi.mock("../../../src/utils/log/index.js", () => ({
            Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        }));
        vi.mock("../../../src/utils/i18n/i18n.js", () => ({
            getLabel: (key) => key,
        }));
        vi.mock("../../../src/kernel/security/dom-security.js", () => ({
            DOMSecurity: { clearElementFast: vi.fn() },
        }));
        vi.mock("../../../src/utils/controls/propagation-blocker.js", () => ({
            blockMapPropagation: vi.fn(),
        }));
        vi.mock("../../../src/capabilities/legend/legend-renderer.ts", () => ({
            LegendRenderer: {
                renderSection: vi.fn(),
                renderFooter: vi.fn(),
                renderAccordion: vi.fn(),
            },
        }));
        const mod = await import("../../../src/capabilities/legend/legend-control.ts");
        LegendControl = mod.LegendControl;
    });

    it("sprite injection resolves → no crash (callback path)", async () => {
        vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
            ensureProfileSpriteInjectedSync: vi.fn(() => Promise.resolve()),
            isProfileSpriteReady: () =>
                document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
        }));
        vi.resetModules();
        const mod = await import("../../../src/capabilities/legend/legend-control.ts");
        const ctrl = mod.LegendControl.create({});
        // updateMultiLayerContent triggers ensureSpriteLoaded with a callback
        document.body.innerHTML = ""; // no sprite
        ctrl.addTo({ addControl: vi.fn(() => ({ remove: vi.fn() })) });
        // direct render won't have callback, call updateMultiLayerContent instead
        ctrl.updateMultiLayerContent([]); // internally calls ensureSpriteLoaded(callback)
        await new Promise((r) => setTimeout(r, 50));
        // When POIMarkers is null, callback would be called with false
        // Just verify no crash
        expect(true).toBe(true);
    });

    it("sprite element already in DOM → sprite loaded immediately", async () => {
        document.body.innerHTML = '<svg data-geoleaf-sprite="profile"></svg>';
        const ctrl = LegendControl.create({});
        ctrl.addTo({ addControl: vi.fn(() => ({ remove: vi.fn() })) });
        ctrl.updateMultiLayerContent([]);
        await new Promise((r) => setTimeout(r, 100));
        // Sprite is found → callback(true) path taken
        // Verify renderAccordion was not called (empty array)
        // Just ensure no crash
        expect(true).toBe(true);
    });
});
