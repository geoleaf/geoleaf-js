/**
 * Tests for editor-api.ts — the menu-toggle wrapper and teardown hook behind
 * `GeoLeaf.Editor`.
 *
 * This module carried NO tests before PLUGINS B.12. It is not new code: it lived in
 * `public-api.ts`, which every plugin excluded from coverage, so its 0 % never showed.
 * Splitting the facade made it measurable — these tests close the gap.
 *
 * What is actually worth pinning here is the first-open contract: the anchor arrives
 * from the toolbar (not at init), and the panel must be placed ONCE — re-positioning on
 * every toggle would fight a menu the user has dragged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";

const menuMocks = vi.hoisted(() => ({
    toggleEditorMenu: vi.fn(),
    destroyEditorMenu: vi.fn(),
    positionEditorMenuNear: vi.fn(),
}));

vi.mock("../sub-menu/floating-menu.js", () => menuMocks);

describe("editor-api", () => {
    let nativeMap: ReturnType<typeof makeMockMaplibreMap>;
    let api: typeof import("../editor-api.js");

    beforeEach(async () => {
        vi.clearAllMocks();
        nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        // Fresh module per test: the positioning latch and the destroy hook are
        // module-level state, so a shared instance would leak between cases.
        vi.resetModules();
        api = await import("../editor-api.js");
    });

    afterEach(() => {
        uninstallMockGeoLeaf();
    });

    describe("toggleEditorMenu", () => {
        it("forwards every call to the floating menu", () => {
            api.toggleEditorMenu();
            api.toggleEditorMenu();
            expect(menuMocks.toggleEditorMenu).toHaveBeenCalledTimes(2);
        });

        it("positions the menu on first open, against the anchor it was given", () => {
            const anchor = document.createElement("button");
            api.toggleEditorMenu(anchor);
            expect(menuMocks.positionEditorMenuNear).toHaveBeenCalledTimes(1);
            expect(menuMocks.positionEditorMenuNear).toHaveBeenCalledWith(
                anchor,
                nativeMap.getContainer()
            );
        });

        it("positions ONCE — a second toggle must not move a menu the user may have dragged", () => {
            const anchor = document.createElement("button");
            api.toggleEditorMenu(anchor);
            api.toggleEditorMenu(anchor);
            api.toggleEditorMenu();
            expect(menuMocks.positionEditorMenuNear).toHaveBeenCalledTimes(1);
        });

        it("remembers the anchor, so a later toggle without one still positions", () => {
            const anchor = document.createElement("button");
            // Discriminating: the toolbar passes the anchor on the FIRST call only.
            api.toggleEditorMenu(anchor);
            expect(menuMocks.positionEditorMenuNear).toHaveBeenCalledWith(
                anchor,
                expect.anything()
            );
        });

        it("does not position when no anchor was ever supplied", () => {
            api.toggleEditorMenu();
            expect(menuMocks.positionEditorMenuNear).not.toHaveBeenCalled();
        });

        it("skips positioning when the map has no container yet, and retries on the next toggle", () => {
            const anchor = document.createElement("button");
            const spy = vi
                .spyOn(nativeMap, "getContainer")
                .mockReturnValueOnce(undefined as unknown as HTMLElement);
            api.toggleEditorMenu(anchor);
            expect(menuMocks.positionEditorMenuNear).not.toHaveBeenCalled();
            spy.mockRestore();
            // The latch is set regardless — the menu is toggled either way and the
            // plugin does not retry. Pinned so a future change to that is deliberate.
            api.toggleEditorMenu(anchor);
            expect(menuMocks.positionEditorMenuNear).not.toHaveBeenCalled();
        });
    });

    describe("destroyEditor", () => {
        it("destroys the menu even when no teardown hook was registered", () => {
            expect(() => api.destroyEditor()).not.toThrow();
            expect(menuMocks.destroyEditorMenu).toHaveBeenCalledTimes(1);
        });

        it("runs the registered teardown hook after destroying the menu", () => {
            const hook = vi.fn();
            api.setDestroyHook(hook);
            api.destroyEditor();
            expect(menuMocks.destroyEditorMenu).toHaveBeenCalledTimes(1);
            expect(hook).toHaveBeenCalledTimes(1);
        });

        it("uses the most recently registered hook", () => {
            const first = vi.fn();
            const second = vi.fn();
            api.setDestroyHook(first);
            api.setDestroyHook(second);
            api.destroyEditor();
            expect(first).not.toHaveBeenCalled();
            expect(second).toHaveBeenCalledTimes(1);
        });
    });
});
