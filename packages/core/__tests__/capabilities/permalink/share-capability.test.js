/**
 * @vitest-environment happy-dom
 *
 * Share sub-feature (S12 → S13 F7) — config reader, lifecycle, read helpers.
 * Covers the in-core surface when share moved to `capabilities/permalink/share`
 * (sub-feature of the permalink capability, gated `modules.permalink.share.enabled`).
 *
 * Uses happy-dom (not jsdom) — same Node 18 / webidl-conversions workaround as
 * the rest of the share suite.
 */
import { vi } from "vitest";

// Cut the lazy qrcode-generator chain (absent from the worktree's symlinked
// node_modules) — reached transitively through share-modal.
vi.mock("qrcode-generator", () => ({ default: vi.fn() }));

// Config seam: getShareConfig() reads `modules.permalink.share` through Config.get.
const mockGet = vi.hoisted(() => vi.fn());
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: mockGet },
}));

import { getShareConfig } from "../../../src/capabilities/permalink/share/config.ts";
import { ShareLifecycle } from "../../../src/capabilities/permalink/share/lifecycle.ts";
import { Share } from "../../../src/capabilities/permalink/share/public-api.ts";

beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockReturnValue({});
    ShareLifecycle._reset();
    document.body.innerHTML = "";
});

afterEach(() => {
    Share.closeShareDialog();
    ShareLifecycle._reset();
});

// ─── Config reader ──────────────────────────────────────────────────────────
describe("getShareConfig", () => {
    test("defaults to { enabled: true } when modules.permalink.share is absent", () => {
        mockGet.mockReturnValue({});
        expect(getShareConfig()).toEqual({ enabled: true });
    });

    test("honours an explicit modules.permalink.share.enabled:false override", () => {
        mockGet.mockReturnValue({ enabled: false });
        expect(getShareConfig().enabled).toBe(false);
    });

    test("reads the `modules.permalink.share` config path", () => {
        mockGet.mockReturnValue({});
        getShareConfig();
        expect(mockGet).toHaveBeenCalledWith("modules.permalink.share", {});
    });
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────
describe("ShareLifecycle", () => {
    test("init() attaches exactly one geoleaf:toolbar:action listener (idempotent)", () => {
        const addSpy = vi.spyOn(document, "addEventListener");
        ShareLifecycle.init();
        ShareLifecycle.init();
        const binds = addSpy.mock.calls.filter((c) => c[0] === "geoleaf:toolbar:action");
        expect(binds).toHaveLength(1);
        addSpy.mockRestore();
    });

    test("_reset() detaches the listener", () => {
        const removeSpy = vi.spyOn(document, "removeEventListener");
        ShareLifecycle.init();
        ShareLifecycle._reset();
        expect(removeSpy).toHaveBeenCalledWith("geoleaf:toolbar:action", expect.any(Function));
        removeSpy.mockRestore();
    });

    test("a 'share' toolbar action opens the modal; unrelated actions are ignored", () => {
        ShareLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "layers" } })
        );
        expect(Share.isOpen()).toBe(false);
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "share" } })
        );
        expect(Share.isOpen()).toBe(true);
    });
});

// ─── Desktop-tabs button seam ───────────────────────────────────────────────
describe("ShareLifecycle — desktop-tabs button seam", () => {
    function makeTabs() {
        const tabs = document.createElement("div");
        tabs.className = "gl-rp-tabs";
        document.body.appendChild(tabs);
        return tabs;
    }

    test("injects the share button when geoleaf:desktop-panel:tabs-ready fires", () => {
        ShareLifecycle.init();
        const tabs = makeTabs();
        document.dispatchEvent(
            new CustomEvent("geoleaf:desktop-panel:tabs-ready", { detail: { tabs } })
        );
        const btn = tabs.querySelector(".gl-rp-share-btn");
        expect(btn).toBeTruthy();
        // Icon comes from the shared registry (DOMSecurity.SVG_ICONS.share), not a local literal.
        expect(btn.querySelector("path")?.getAttribute("d")).toContain("M12 2v14");
    });

    test("init() catch-up injects into an already-rendered tab strip", () => {
        const tabs = makeTabs();
        ShareLifecycle._reset();
        ShareLifecycle.init();
        expect(tabs.querySelector(".gl-rp-share-btn")).toBeTruthy();
    });

    test("does not inject when the capability is disabled (opt-out)", () => {
        mockGet.mockReturnValue({ enabled: false });
        ShareLifecycle.init();
        const tabs = makeTabs();
        document.dispatchEvent(
            new CustomEvent("geoleaf:desktop-panel:tabs-ready", { detail: { tabs } })
        );
        expect(tabs.querySelector(".gl-rp-share-btn")).toBeNull();
    });
});

// ─── Teardown symmetry (B.27a) ──────────────────────────────────────────────
//
// The capability injects DOM into containers it does not own (the desktop tab
// strip, `document.body` for the modal). `_reset()` used to detach only its two
// document listeners: the button and the open modal survived a destroy with no
// re-init, keeping a live click handler and a live `keydown` handler on a
// capability that no longer exists.

describe("ShareLifecycle — teardown symmetry (B.27a)", () => {
    function makeTabs() {
        const tabs = document.createElement("div");
        tabs.className = "gl-rp-tabs";
        document.body.appendChild(tabs);
        return tabs;
    }

    test("_reset() removes the injected desktop share button", () => {
        const tabs = makeTabs();
        ShareLifecycle.init();
        expect(tabs.querySelector(".gl-rp-share-btn")).toBeTruthy();

        ShareLifecycle._reset();
        expect(tabs.querySelector(".gl-rp-share-btn")).toBeNull();
    });

    test("the button element is detached from the document, not merely inert", () => {
        const tabs = makeTabs();
        ShareLifecycle.init();
        const btn = tabs.querySelector(".gl-rp-share-btn");
        ShareLifecycle._reset();

        // `_reset()` already detached the toolbar-action listener, so a leftover
        // button could no longer *open* anything — which is exactly why the leak went
        // unnoticed. What survives is the element itself, still painted in a strip the
        // capability no longer serves, with its own click handler attached.
        expect(btn.isConnected).toBe(false);
        btn.click();
        expect(Share.isOpen()).toBe(false);
    });

    test("_reset() closes an open modal (overlay + keydown released)", () => {
        ShareLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "share" } })
        );
        expect(Share.isOpen()).toBe(true);

        ShareLifecycle._reset();
        expect(Share.isOpen()).toBe(false);
        expect(document.getElementById("gl-share-modal")).toBeNull();
    });

    test("init() after _reset() re-injects exactly one button (no duplicate)", () => {
        const tabs = makeTabs();
        ShareLifecycle.init();
        ShareLifecycle._reset();
        ShareLifecycle.init();
        expect(tabs.querySelectorAll(".gl-rp-share-btn")).toHaveLength(1);
    });
});

// ─── Public API read helpers ────────────────────────────────────────────────
describe("Share facade — read helpers", () => {
    test("isEnabled() reflects modules.permalink.share.enabled (opt-out)", () => {
        mockGet.mockReturnValue({});
        expect(Share.isEnabled()).toBe(true);
        mockGet.mockReturnValue({ enabled: false });
        expect(Share.isEnabled()).toBe(false);
    });

    test("getConfig() returns the merged capability config", () => {
        mockGet.mockReturnValue({ enabled: false });
        expect(Share.getConfig()).toEqual({ enabled: false });
    });
});
