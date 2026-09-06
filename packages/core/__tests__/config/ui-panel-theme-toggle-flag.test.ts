/**
 * Config-contract B3 — `ui.showPanelThemeToggle`, resolved per value.
 *
 * ⚠️ This cannot live in `s11-ui-flags-init.test.js`: that harness mocks `init-features.js`
 * WHOLESALE, so `_buildDesktopPanelOptions` never runs there. And that builder is not
 * exported. The only honest observation surface is therefore the real `initUIPanels`, with
 * `GeoLeaf.UI.initDesktopPanel` spied — assert the bag it receives.
 *
 * What this pins that the DOM tests cannot: that the JSON key reaches the kernel option at
 * all, and that an ABSENT key resolves to `true`. AJV injects no `default`, so `!== false`
 * is the only thing making "absent ≡ shown" true — and a reader written as
 * `=== true` would pass every DOM test in the suite while hiding the button for every
 * profile that never mentions the key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { initUIPanels } from "../../src/app/init-features.js";

function run(ui: Record<string, unknown>) {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);

    const initDesktopPanel = vi.fn();
    const GeoLeaf = {
        UI: { initDesktopPanel },
        Filter: { hasActiveFilters: () => false },
    };
    const AppLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };

    initUIPanels({ GeoLeaf, cfg: { ui }, map: null, AppLog } as never);

    expect(initDesktopPanel).toHaveBeenCalledTimes(1);
    const call = initDesktopPanel.mock.calls[0];
    if (!call) throw new Error("initDesktopPanel was not called");
    return call[0] as Record<string, unknown>;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("ui.showPanelThemeToggle → DesktopPanelOptions.showThemeToggle", () => {
    it("absent ⇒ true (opt-out; AJV injects no default, `!== false` carries it)", () => {
        expect(run({}).showThemeToggle).toBe(true);
    });

    it("true ⇒ true", () => {
        expect(run({ showPanelThemeToggle: true }).showThemeToggle).toBe(true);
    });

    it("false ⇒ false — the only value that hides the button", () => {
        expect(run({ showPanelThemeToggle: false }).showThemeToggle).toBe(false);
    });

    it("a non-boolean is not `false`, so it does NOT hide the button", () => {
        // Documents the reader's shape rather than blessing the input: the schema types the
        // key as boolean, and AJV rejects anything else before this code runs.
        expect(run({ showPanelThemeToggle: "false" }).showThemeToggle).toBe(true);
    });
});
