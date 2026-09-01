/**
 * Did the desktop panel survive `Core.destroy()`?
 *
 * 🛑 This file exists because a test calling `destroyDesktopPanel()`
 * DIRECTLY comes out green and proves nothing: that is already what
 * `desktop-panel-branches.test.js` does, and the function did its job
 * correctly. The defect was not in the function, it was that **nobody
 * called it** — none of `kernel/shared/lifecycle.ts`'s registrants.
 *
 * The assertion must therefore go through `Core.destroy()`, the only path
 * that triggers `runLifecycleTeardowns()`. Red before the fix, green after,
 * and the witness mutation is removing the `registerLifecycleTeardown(...)`
 * line from `desktop-panel.ts`.
 */
"use strict";

import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: vi.fn().mockImplementation(
        class {
            constructor() {
                return { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
            }
        }
    ),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

// ── matchMedia: the panel only activates above the desktop breakpoint ────────────────────
const mockMql = {
    matches: true,
    media: "(min-width: 1440px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
};
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mockMql),
});

// Counts the `disconnect()`s of ALL MutationObservers built during the test.
// `desktop-panel.ts` sets three: `_filterObserver`, `_legendObserver`, `_themeObserver`.
const disconnectSpy = vi.fn();
const NativeMutationObserver = globalThis.MutationObserver;
class CountingMutationObserver extends NativeMutationObserver {
    disconnect() {
        disconnectSpy();
        return super.disconnect();
    }
}
globalThis.MutationObserver = CountingMutationObserver;

type CoreFacade = (typeof import("../../src/kernel/map/facade.js"))["Core"];
type PanelModule = typeof import("../../src/kernel/ui/desktop/desktop-panel.js");

let Core: CoreFacade;
let initDesktopPanel: PanelModule["initDesktopPanel"];
let activateDesktopPanel: PanelModule["activateDesktopPanel"];

beforeAll(async () => {
    ({ Core } = await import("../../src/kernel/map/facade.js"));
    ({ initDesktopPanel, activateDesktopPanel } =
        await import("../../src/kernel/ui/desktop/desktop-panel.js"));
});

/** Mounts the DOM shell `initDesktopPanel` expects, plus the 3 observers' targets. */
function mountShell() {
    document.body.innerHTML = "";
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    return glMain;
}

/** Un cycle complet : carte + panneau desktop actif. */
function bootPanel(mapId: string): void {
    const glMain = mountShell();
    (Core.init as (o: Record<string, unknown>) => unknown)({
        mapId,
        container: document.createElement("div"),
    });
    initDesktopPanel({ glMain });
    activateDesktopPanel();
}

afterEach(() => {
    for (const id of Core.listMaps()) Core.destroy(id);
    document.body.innerHTML = "";
    disconnectSpy.mockClear();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.MutationObserver = NativeMutationObserver;
});

describe("Core.destroy() démonte le panneau desktop (tâches 2.9 / 2.8)", () => {
    it("🛑 `#gl-right-panel` a disparu du DOM après Core.destroy()", () => {
        bootPanel("map-teardown-1");
        expect(document.getElementById("gl-right-panel")).not.toBeNull();

        Core.destroy("map-teardown-1");

        expect(document.getElementById("gl-right-panel")).toBeNull();
    });

    it("les 3 MutationObserver du panneau sont déconnectés", () => {
        bootPanel("map-teardown-2");
        disconnectSpy.mockClear(); // ignore the activation phase's self-disconnects

        Core.destroy("map-teardown-2");

        expect(disconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it("le cycle init → destroy → init ne laisse qu'UN seul panneau", () => {
        bootPanel("map-teardown-3");
        Core.destroy("map-teardown-3");
        expect(document.getElementById("gl-right-panel")).toBeNull();

        bootPanel("map-teardown-3");

        expect(document.querySelectorAll("#gl-right-panel")).toHaveLength(1);
    });

    it("le teardown est idempotent — un second Core.destroy ne jette pas", () => {
        bootPanel("map-teardown-4");
        Core.destroy("map-teardown-4");

        expect(() => Core.destroy("map-teardown-4")).not.toThrow();
        expect(document.getElementById("gl-right-panel")).toBeNull();
    });
});
