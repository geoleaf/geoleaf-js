/**
 * Did the mobile toolbar survive `Core.destroy()`?
 *
 * 🛑 This file exists for the same reason `desktop-panel-teardown.test.ts` does, and it
 * has to make the same choice: a test calling `destroyMobileToolbar()` DIRECTLY comes out
 * green and proves nothing about the wiring. The assertions go through `Core.destroy()`,
 * the only path that runs `runLifecycleTeardowns()`.
 *
 * The four witness mutations, each discriminating and each seen red before this file was
 * kept. Case names below are the English gloss of the French `it()` titles.
 *
 *   1. Put `registerLifecycleTeardown(clearFilterCheckInterval)` back on the registration
 *      line of `mobile-toolbar.ts` → the four-nodes case goes red, and the interval keeps
 *      being cleared. Proves this suite is about the TEARDOWN, not about a registration
 *      merely existing.
 *   2. Move `domState.restoreOnClose = []` ABOVE the `closeSheet()` call in
 *      `destroyMobileToolbar` → the shared-node case (filter panel survives a destroy with
 *      the sheet open) goes red, alone.
 *      WARNING: not the mutation one reaches for first. Swapping `closeSheet()` and the
 *      `remove()` calls comes out GREEN, because `insertBefore` pulls a node out of
 *      whatever parent it currently has. What matters is restore-before-clear.
 *   3. Replace the ownership guard with the desktop two-state one,
 *      `if (document.querySelector(".gl-map-toolbar-wrapper")) return;` — or with
 *      `mounted.isConnected`, which fails identically → the two-live-shells case goes red,
 *      alone, under both.
 *      WARNING: the obvious case does NOT discriminate. Remounting AFTER the shell is
 *      dropped stays green under a presence guard, because a wrapper sitting in a detached
 *      subtree is not in the document either, so the wrong guard rebuilds by accident.
 *      Only two LIVE shells separate ownership from presence, and that case was added
 *      after the first version of this suite came out green under mutation 3.
 *   4. Comment out the `fullscreenchange` removal, or `resizeObserver?.disconnect()` → the
 *      two counting cases go red. The geoloc handler has no observable effect once
 *      `domState.toolbar` is null, so counting is the only oracle available for it.
 */
"use strict";

import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

// A class declared in the factory, not `vi.fn().mockImplementation(class {...})`: the
// latter is what the desktop teardown suite uses and it carries a TS2345 that only sleeps
// because that file predates TTC's baseline — a new suite has to compile. An arrow
// factory does not work either: the adapter is built with `new`.
vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: class {
        init = vi.fn();
        destroy = vi.fn();
        getNativeMap = vi.fn(() => null);
    },
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

// Counts `disconnect()` on every ResizeObserver built during the test. The pill sets one
// on its scroll container and, before this work, nothing could ever reach it again.
const roDisconnectSpy = vi.fn();
const NativeResizeObserver = globalThis.ResizeObserver;
class CountingResizeObserver extends NativeResizeObserver {
    override disconnect() {
        roDisconnectSpy();
        return super.disconnect();
    }
}
globalThis.ResizeObserver = CountingResizeObserver;

// `document.removeEventListener` is the only oracle for the fullscreen handler: its
// effects are all writes onto nodes the teardown has already removed.
const docRemoveSpy = vi.spyOn(document, "removeEventListener");

type CoreFacade = (typeof import("../../src/kernel/map/facade.js"))["Core"];
type ToolbarModule = typeof import("../../src/kernel/ui/mobile/mobile-toolbar.js");
type SheetModule = typeof import("../../src/kernel/ui/mobile/mobile-toolbar-sheet.js");

let Core: CoreFacade;
let initMobileToolbar: ToolbarModule["initMobileToolbar"];
let openSheet: SheetModule["openSheet"];

beforeAll(async () => {
    ({ Core } = await import("../../src/kernel/map/facade.js"));
    ({ initMobileToolbar } = await import("../../src/kernel/ui/mobile/mobile-toolbar.js"));
    ({ openSheet } = await import("../../src/kernel/ui/mobile/mobile-toolbar-sheet.js"));
});

/** The four nodes `initMobileToolbar` appends to `glMain`, by selector. */
const APPENDED = [
    ".gl-map-toolbar-wrapper",
    ".gl-toolbar-tooltip",
    ".gl-proximity-bar",
    ".gl-sheet-overlay",
];

/** A map stub whose container counts the listeners put on it and taken off it. */
function makeMapStub() {
    const container = document.createElement("div");
    const added: string[] = [];
    const removed: string[] = [];
    const nativeAdd = container.addEventListener.bind(container);
    const nativeRemove = container.removeEventListener.bind(container);
    container.addEventListener = ((type: string, ...rest: unknown[]) => {
        added.push(type);
        return (nativeAdd as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof container.addEventListener;
    container.removeEventListener = ((type: string, ...rest: unknown[]) => {
        removed.push(type);
        return (nativeRemove as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof container.removeEventListener;
    return {
        added,
        removed,
        map: {
            getContainer: () => container,
            getZoom: () => 10,
            zoomIn: () => undefined,
            zoomOut: () => undefined,
        },
    };
}

function mountShell(): HTMLElement {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    return glMain;
}

/** One full cycle: a map plus a mounted mobile toolbar. Returns the shell it built. */
function bootToolbar(mapId: string, stub = makeMapStub()): HTMLElement {
    const glMain = mountShell();
    (Core.init as (o: Record<string, unknown>) => unknown)({
        mapId,
        container: document.createElement("div"),
    });
    initMobileToolbar({ glMain, map: stub.map });
    return glMain;
}

afterEach(() => {
    for (const id of Core.listMaps()) Core.destroy(id);
    document.body.innerHTML = "";
    roDisconnectSpy.mockClear();
    docRemoveSpy.mockClear();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = NativeResizeObserver;
    docRemoveSpy.mockRestore();
});

describe("Core.destroy() démonte la pilule mobile", () => {
    it("🛑 les quatre nœuds appendés dans .gl-main ont disparu après Core.destroy()", () => {
        bootToolbar("mobile-teardown-1");
        for (const sel of APPENDED) {
            expect(document.querySelector(sel), `monté : ${sel}`).not.toBeNull();
        }

        Core.destroy("mobile-teardown-1");

        for (const sel of APPENDED) {
            expect(document.querySelector(sel), `démonté : ${sel}`).toBeNull();
        }
    });

    it("🛑 `#gl-filter-panel` survit à un destroy feuille OUVERTE", () => {
        const glMain = bootToolbar("mobile-teardown-2");
        const panel = document.createElement("div");
        panel.id = "gl-filter-panel";
        glMain.appendChild(panel);

        // The sheet MOVES the panel into its body rather than cloning it.
        openSheet("filters");
        expect(panel.closest(".gl-sheet-overlay"), "déplacé dans la feuille").not.toBeNull();

        Core.destroy("mobile-teardown-2");

        expect(document.getElementById("gl-filter-panel"), "rendu, pas emporté").not.toBeNull();
        expect(document.querySelector(".gl-sheet-overlay")).toBeNull();
    });

    it("le ResizeObserver de la pilule est déconnecté", () => {
        // Guards against a vacuous pass: no ResizeObserver in the environment would mean
        // the pill never built one and this test asserted nothing.
        expect(typeof globalThis.ResizeObserver, "l'environnement fournit RO").toBe("function");
        bootToolbar("mobile-teardown-3");
        roDisconnectSpy.mockClear();

        Core.destroy("mobile-teardown-3");

        expect(roDisconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("les écouteurs `fullscreenchange` et geoloc sont retirés", () => {
        const stub = makeMapStub();
        bootToolbar("mobile-teardown-4", stub);
        expect(stub.added).toContain("geoleaf:geolocation:statechange");
        docRemoveSpy.mockClear();

        Core.destroy("mobile-teardown-4");

        expect(docRemoveSpy).toHaveBeenCalledWith(
            "fullscreenchange",
            expect.any(Function),
            ...([] as unknown[])
        );
        expect(stub.removed).toContain("geoleaf:geolocation:statechange");
    });

    it("le cycle destroy → init ne laisse qu'UNE pilule", () => {
        bootToolbar("mobile-teardown-5");
        Core.destroy("mobile-teardown-5");
        expect(document.querySelector(".gl-map-toolbar-wrapper")).toBeNull();

        bootToolbar("mobile-teardown-5");

        expect(document.querySelectorAll(".gl-map-toolbar-wrapper")).toHaveLength(1);
    });

    it("un remontage après démontage de la coquille reconstruit la pilule", () => {
        // The shell is dropped and rebuilt with no destroy in between. ⚠️ This case does
        // NOT discriminate the guard — a presence guard reads `null` here too, because
        // the wrapper left the document inside the detached subtree, and rebuilds by
        // accident. Kept because it is the host's nominal path; the case that actually
        // separates the two guards is the next one.
        const first = bootToolbar("mobile-teardown-6");
        first.remove();

        const second = mountShell();
        initMobileToolbar({ glMain: second, map: makeMapStub().map });

        expect(second.querySelector(".gl-map-toolbar-wrapper"), "reconstruite").not.toBeNull();
        expect(document.querySelectorAll(".gl-map-toolbar-wrapper")).toHaveLength(1);
    });

    it("🛑 un second glMain monté pendant que le premier VIT reconstruit quand même", () => {
        // The case the ownership predicate exists for, and the only one that tells the two
        // guards apart. A host that mounts the new view BEFORE unmounting the old leaves
        // both shells attached: a presence guard FINDS the old wrapper, no-ops, and the
        // new view gets no toolbar at all. `isConnected` answers "true" here and fails the
        // same way. Ownership is what says "connected, but not to MY shell".
        const first = bootToolbar("mobile-teardown-9");
        const second = mountShell();

        initMobileToolbar({ glMain: second, map: makeMapStub().map });

        expect(second.querySelector(".gl-map-toolbar-wrapper"), "montée dans le 2e").not.toBeNull();
        expect(first.querySelector(".gl-map-toolbar-wrapper"), "retirée du 1er").toBeNull();
        expect(document.querySelectorAll(".gl-map-toolbar-wrapper")).toHaveLength(1);
    });

    it("un second init sur le MÊME glMain ne duplique pas la pilule", () => {
        const glMain = bootToolbar("mobile-teardown-7");

        initMobileToolbar({ glMain, map: makeMapStub().map });

        expect(document.querySelectorAll(".gl-map-toolbar-wrapper")).toHaveLength(1);
    });

    it("le teardown est idempotent — un second Core.destroy ne jette pas", () => {
        bootToolbar("mobile-teardown-8");
        Core.destroy("mobile-teardown-8");

        expect(() => Core.destroy("mobile-teardown-8")).not.toThrow();
        expect(document.querySelector(".gl-map-toolbar-wrapper")).toBeNull();
    });
});
