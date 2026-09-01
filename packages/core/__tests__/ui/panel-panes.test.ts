/**
 * The hostable-pane registry — the seam that lets something outside the kernel own a panel.
 *
 * 🛑 The assertion carrying this file is that a pane registered AFTER the panel was built still
 * gets a tab. Bundle load order is not something either side controls: a plugin loaded as a
 * second `<script type="module">` may run before or after `initDesktopPanel`, and a registry
 * that only worked in one of the two orders would fail on a page where everything else about
 * the plugin works — the symptom would read as a CSS problem, not a wiring one.
 *
 * ⚠️ The built-in `filters` / `layers` / `legend` panes are deliberately NOT in this registry:
 * the two hosts CONCATENATE their own built-ins with what is registered here. These tests
 * therefore assert that the two sets coexist, not that one replaced the other.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

// ── matchMedia: the desktop panel only activates above its breakpoint ────────────────────
let mqMatches = true;
const mockMql = {
    get matches() {
        return mqMatches;
    },
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

import {
    registerPanelPane,
    listPanelPanes,
    getPanelPane,
    registerPaneHost,
    openPane,
    closePane,
    clearPanelPanes,
} from "../../src/kernel/ui/panel-panes.js";
import {
    initDesktopPanel,
    activateDesktopPanel,
    destroyDesktopPanel,
    getOpenPanel,
} from "../../src/kernel/ui/desktop/desktop-panel.js";

/** A panel some plugin owns, already in the document. */
function mountOwnedPanel(cls = "gl-fake-panel"): HTMLElement {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = "owned";
    document.body.appendChild(el);
    return el;
}

function mountKernelPanel(): HTMLElement {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    initDesktopPanel({ glMain });
    activateDesktopPanel();
    return glMain;
}

/**
 * Which test's doubled hosts are live.
 *
 * ⚠️ Hosts are registered for the life of the MODULE — `clearPanelPanes` drops panes and
 * deliberately keeps hosts, because a host is what survives a `Core.destroy()`. So a double
 * registered by one test is still there in the next one, and would answer for it. Gating on
 * the current test's name is what keeps each case measuring its own doubles.
 */
let liveGroup = "";

/**
 * Registers a doubled host that is only live for the named group.
 *
 * @param group - The owning test.
 * @param id - Host id.
 * @param open - What `open` answers, and what it records.
 * @param close - Optional close spy.
 */
function fakeHost(
    group: string,
    id: string,
    open: (paneId: string) => boolean,
    close: () => void = () => {}
): void {
    registerPaneHost({ id, isActive: () => liveGroup === group, open, close });
}

beforeEach(() => {
    mqMatches = true;
    liveGroup = "";
});

afterEach(() => {
    destroyDesktopPanel();
    clearPanelPanes();
    document.body.innerHTML = "";
});

describe("the registry itself", () => {
    it("is idempotent by id — a re-registration replaces, never doubles", () => {
        // A module re-registers across a destroy/recreate cycle. Two entries would mean two
        // tabs for one panel, and the second would control a pane the first already owns.
        registerPanelPane({ id: "x", labelKey: "k1", selector: ".a" });
        registerPanelPane({ id: "x", labelKey: "k2", selector: ".b" });
        expect(listPanelPanes()).toHaveLength(1);
        expect(getPanelPane("x")?.labelKey).toBe("k2");
    });

    it("refuses an incomplete declaration rather than registering half a pane", () => {
        // A pane with no selector names nothing to adopt: the tab would open on emptiness.
        registerPanelPane({ id: "x", labelKey: "k", selector: "" });
        registerPanelPane({ id: "", labelKey: "k", selector: ".a" });
        expect(listPanelPanes()).toEqual([]);
    });

    it("orders by `order`, and keeps registration order for those without one", () => {
        registerPanelPane({ id: "a", labelKey: "k", selector: ".a" });
        registerPanelPane({ id: "b", labelKey: "k", selector: ".b", order: -1 });
        registerPanelPane({ id: "c", labelKey: "k", selector: ".c" });
        expect(listPanelPanes().map((p) => p.id)).toEqual(["b", "a", "c"]);
    });
});

describe("hosts are consulted in registration order, and only when live", () => {
    it("skips a host that is not active", () => {
        const calls: string[] = [];
        registerPanelPane({ id: "p", labelKey: "k", selector: ".a" });
        registerPaneHost({
            id: "asleep",
            isActive: () => false,
            open: () => {
                calls.push("asleep");
                return true;
            },
            close: () => {},
        });
        fakeHost("skips", "awake", () => {
            calls.push("awake");
            return true;
        });
        liveGroup = "skips";
        expect(openPane("p")).toBe(true);
        expect(calls).toEqual(["awake"]);
    });

    it("falls through to the next host when the first does not know the pane", () => {
        // This is the real shape of the desktop/mobile pair: above 1440px both are live, and
        // below it only the sheet is. A host answering `false` must not end the search.
        const calls: string[] = [];
        fakeHost("falls", "first", () => {
            calls.push("first");
            return false;
        });
        fakeHost("falls", "second", () => {
            calls.push("second");
            return true;
        });
        liveGroup = "falls";
        expect(openPane("p")).toBe(true);
        expect(calls).toEqual(["first", "second"]);
    });

    it("answers false when no host could show it", () => {
        expect(openPane("nobody")).toBe(false);
    });

    it("🛑 retries until a host becomes live, instead of losing the request", async () => {
        // Measured on the deployed build, not imagined: when the routing plugin finishes
        // loading, `.gl-sheet-overlay`, `#gl-right-panel` and `.gl-map-toolbar` are ALL still
        // absent — both hosts are built later in boot. Before this retry the pane stayed
        // `display:none` for good; four seconds on it was still hidden, and nothing said why.
        // A user clicking early simply never got their panel.
        const calls: string[] = [];
        let live = false;
        registerPaneHost({
            id: "late",
            priority: -1,
            isActive: () => live,
            open: (id) => {
                calls.push(id);
                return true;
            },
            close: () => {},
        });

        // Nothing is live yet: the answer is an honest `false`…
        expect(openPane("p")).toBe(false);
        expect(calls).toEqual([]);

        // …and the request is not lost.
        live = true;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(calls).toEqual(["p"]);

        live = false;
    });

    it("closes every live host", () => {
        let closes = 0;
        fakeHost(
            "closes",
            "a",
            () => true,
            () => {
                closes += 1;
            }
        );
        liveGroup = "closes";
        closePane();
        expect(closes).toBe(1);
    });
});

describe("the desktop panel hosts registered panes", () => {
    it("builds a tab and a pane beside the three built-ins", () => {
        registerPanelPane({ id: "fake", labelKey: "fake.label", selector: ".gl-fake-panel" });
        mountKernelPanel();

        const tabs = [...document.querySelectorAll("[data-gl-rp-tab]")].map((t) =>
            t.getAttribute("data-gl-rp-tab")
        );
        // Concatenation, not replacement: the built-ins are still there.
        expect(tabs).toEqual(["filters", "layers", "legend", "fake"]);
        expect(document.getElementById("gl-rp-pane-fake")).not.toBeNull();
    });

    it("adopts the owned element into its pane", () => {
        const owned = mountOwnedPanel();
        registerPanelPane({ id: "fake", labelKey: "fake.label", selector: ".gl-fake-panel" });
        mountKernelPanel();
        expect(document.getElementById("gl-rp-pane-fake")?.contains(owned)).toBe(true);
    });

    it("🛑 syncs a pane registered AFTER the panel was built", () => {
        // The load order this repository cannot control. A registry that only worked when the
        // plugin ran first would leave the tab missing on half the pages, with no diagnostic.
        mountKernelPanel();
        expect(document.getElementById("gl-rp-pane-late")).toBeNull();

        const owned = mountOwnedPanel("gl-late-panel");
        registerPanelPane({ id: "late", labelKey: "late.label", selector: ".gl-late-panel" });

        expect(document.getElementById("gl-rp-pane-late")).not.toBeNull();
        expect(document.querySelector("[data-gl-rp-tab='late']")).not.toBeNull();
        expect(document.getElementById("gl-rp-pane-late")?.contains(owned)).toBe(true);
    });

    it("inserts the tab BEFORE the theme separator", () => {
        // The separator carries `margin-top: auto` and pushes the icon stack to the bottom of
        // the strip. A tab appended past it would land among buttons of a different shape.
        mountKernelPanel();
        mountOwnedPanel("gl-late-panel");
        registerPanelPane({ id: "late", labelKey: "late.label", selector: ".gl-late-panel" });

        const tabs = document.querySelector(".gl-rp-tabs");
        const children = [...(tabs?.children ?? [])];
        const tabIndex = children.findIndex((c) => c.getAttribute("data-gl-rp-tab") === "late");
        const sepIndex = children.findIndex((c) => c.classList.contains("gl-rp-theme-separator"));
        expect(tabIndex).toBeGreaterThanOrEqual(0);
        expect(sepIndex).toBeGreaterThanOrEqual(0);
        expect(tabIndex).toBeLessThan(sepIndex);
    });

    it("opens through `openPane`, and reports it like any other tab", () => {
        mountOwnedPanel();
        registerPanelPane({ id: "fake", labelKey: "fake.label", selector: ".gl-fake-panel" });
        mountKernelPanel();

        expect(openPane("fake")).toBe(true);
        expect(getOpenPanel()).toBe("fake");
        expect(document.getElementById("gl-rp-pane-fake")?.classList).toContain("gl-is-active");
    });

    it("restores the adopted element on teardown", () => {
        // ⚠️ The node is MOVED, not cloned. A teardown that forgot to put it back would leave
        // the plugin's panel inside a `#gl-right-panel` that no longer exists.
        const owned = mountOwnedPanel();
        registerPanelPane({ id: "fake", labelKey: "fake.label", selector: ".gl-fake-panel" });
        mountKernelPanel();
        expect(document.getElementById("gl-rp-pane-fake")?.contains(owned)).toBe(true);

        destroyDesktopPanel();
        expect(owned.parentElement).toBe(document.body);
    });
});
