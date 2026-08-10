/**
 */
/* T33.1 — desktop-panel.ts — branches ≥ 70 % */

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k) => k),
}));

// ── matchMedia mock (set up before any module loads initDesktopPanel) ────────
let mqMatches = false;
const changeListeners = [];
const mockMql = {
    get matches() {
        return mqMatches;
    },
    media: "(min-width: 1440px)",
    onchange: null,
    addEventListener: vi.fn((type, listener) => {
        if (type === "change") changeListeners.push(listener);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
};
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mockMql),
});

// `window.matchMedia` est posé juste au-dessus, et un `import` se hisse au-dessus de lui —
// mais `desktop-panel.ts` n'exécute rien au chargement (deux `const` et un `let`), donc le
// moment de son import ne peut pas compter. Dérivé du module cible, pas supposé.
import {
    initDesktopPanel,
    activateDesktopPanel,
    destroyDesktopPanel,
} from "../../src/kernel/ui/desktop/desktop-panel.js";

// ────────────────────────────────────────────────────────────────────────────

function makeGlMain() {
    const el = document.createElement("div");
    el.className = "gl-main";
    document.body.appendChild(el);
    return el;
}

function initPanel(opts = {}) {
    const glMain = makeGlMain();
    initDesktopPanel({ glMain, ...opts });
    return glMain;
}

afterEach(() => {
    destroyDesktopPanel();
    document.body.innerHTML = "";
    changeListeners.length = 0;
    mockMql.addEventListener.mockClear();
    mqMatches = false;
    vi.clearAllMocks();
});

// ── 1. initDesktopPanel ──────────────────────────────────────────────────────

describe("initDesktopPanel()", () => {
    test("creates #gl-right-panel with 3 tabs inside glMain", () => {
        const glMain = initPanel();
        const panel = document.getElementById("gl-right-panel");
        expect(panel).toBeTruthy();
        expect(glMain.contains(panel)).toBe(true);
        const tabs = panel.querySelectorAll(".gl-rp-tab");
        expect(tabs).toHaveLength(3);
    });

    test("first tab has tabindex=0, rest have -1 (roving tabindex B4)", () => {
        initPanel();
        const tabs = [...document.querySelectorAll(".gl-rp-tab")];
        expect(tabs[0].getAttribute("tabindex")).toBe("0");
        expect(tabs[1].getAttribute("tabindex")).toBe("-1");
        expect(tabs[2].getAttribute("tabindex")).toBe("-1");
    });

    test("panes have aria-labelledby matching tab ids (B5)", () => {
        initPanel();
        const pane = document.getElementById("gl-rp-pane-filters");
        expect(pane?.getAttribute("aria-labelledby")).toBe("gl-rp-tab-filters");
    });

    test("second call is a no-op when panel already exists", () => {
        const glMain = initPanel();
        initDesktopPanel({ glMain });
        const panels = document.querySelectorAll("#gl-right-panel");
        expect(panels).toHaveLength(1);
    });

    test("registers matchMedia change listener", () => {
        initPanel();
        expect(mockMql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    });

    test("uses custom tab titles from options", () => {
        initPanel({ titleFilters: "MyFilters", titleLayers: "MyLayers" });
        const filterTab = document.getElementById("gl-rp-tab-filters");
        expect(filterTab?.textContent).toBe("MyFilters");
    });
});

// ── 2. handleTabClick — non-table tabs ──────────────────────────────────────

describe("handleTabClick() — non-table tab", () => {
    test("clicking a tab activates it and its pane (B → tab active)", () => {
        initPanel();
        const filterTab = document.querySelector('[data-gl-rp-tab="filters"]');
        filterTab.click();
        expect(filterTab.classList.contains("gl-is-active")).toBe(true);
        expect(filterTab.getAttribute("aria-selected")).toBe("true");
        const pane = document.getElementById("gl-rp-pane-filters");
        expect(pane.classList.contains("gl-is-active")).toBe(true);
        const panel = document.getElementById("gl-right-panel");
        expect(panel.classList.contains("gl-has-active")).toBe(true);
    });

    test("clicking an already-active tab toggles it off (isAlreadyActive branch)", () => {
        initPanel();
        const filterTab = document.querySelector('[data-gl-rp-tab="filters"]');
        filterTab.click(); // activate
        filterTab.click(); // deactivate
        expect(filterTab.classList.contains("gl-is-active")).toBe(false);
        const panel = document.getElementById("gl-right-panel");
        expect(panel.classList.contains("gl-has-active")).toBe(false);
    });

    test("clicking one tab deactivates previously active tab", () => {
        initPanel();
        const filterTab = document.querySelector('[data-gl-rp-tab="filters"]');
        const layersTab = document.querySelector('[data-gl-rp-tab="layers"]');
        filterTab.click();
        layersTab.click();
        expect(filterTab.classList.contains("gl-is-active")).toBe(false);
        expect(layersTab.classList.contains("gl-is-active")).toBe(true);
    });
});

// ── 4. Keyboard navigation in tabs ──────────────────────────────────────────

describe("tab keyboard navigation (B3)", () => {
    test("ArrowDown moves focus to next tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[0].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        // Focus movement is driven by tab[next].focus() — in jsdom focus works
        expect(document.activeElement).toBe(tabs[1]);
    });

    test("ArrowRight also moves focus to next tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[1].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
    });

    test("ArrowUp moves focus to previous tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[2].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
    });

    test("ArrowLeft moves focus to previous tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[2].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]);
    });

    test("Home moves focus to first tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[2].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
    });

    test("End moves focus to last tab", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[0].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
        expect(document.activeElement).toBe(tabs[2]);
    });

    test("ArrowDown wraps from last to first", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[2].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        expect(document.activeElement).toBe(tabs[0]);
    });

    test("irrelevant key (Enter) does nothing", () => {
        initPanel();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        tabs[0].focus();
        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        // Focus should remain on tabs[0]
        expect(document.activeElement).toBe(tabs[0]);
    });

    test("keydown with no focused tab (idx=-1) is ignored", () => {
        initPanel();
        // No focused tab — activeElement is body
        document.body.focus();
        const tablist = document.querySelector('[role="tablist"]');
        // Should not throw
        expect(() => {
            tablist.dispatchEvent(
                new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
            );
        }).not.toThrow();
    });
});

// ── 5. activateDesktopPanel / activatePanel ──────────────────────────────────

describe("activateDesktopPanel()", () => {
    test("no-op when _mql is null (not initialized)", () => {
        // Don't call initDesktopPanel → _mql is null
        expect(() => activateDesktopPanel()).not.toThrow();
    });

    test("does not activate when MQL does not match", () => {
        mqMatches = false;
        initPanel();
        activateDesktopPanel();
        expect(document.body.classList.contains("gl-right-panel-open")).toBe(false);
    });

    test("activates panel with filterPanel and layerManager when MQL matches", () => {
        mqMatches = true;
        const filterPanel = document.createElement("div");
        filterPanel.id = "gl-filter-panel";
        document.body.appendChild(filterPanel);
        const layerMgr = document.createElement("div");
        layerMgr.className = "gl-layer-manager";
        document.body.appendChild(layerMgr);
        const legend = document.createElement("div");
        legend.className = "gl-map-legend";
        document.body.appendChild(legend);

        initPanel();
        activateDesktopPanel();

        const pFilters = document.getElementById("gl-rp-pane-filters");
        expect(pFilters.contains(filterPanel)).toBe(true);
        const pLayers = document.getElementById("gl-rp-pane-layers");
        expect(pLayers.contains(layerMgr)).toBe(true);
        const pLegend = document.getElementById("gl-rp-pane-legend");
        expect(pLegend.contains(legend)).toBe(true);
        expect(document.body.classList.contains("gl-right-panel-open")).toBe(true);
    });

    test("second activatePanel call is a no-op (_isActive guard)", () => {
        mqMatches = true;
        const filterPanel = document.createElement("div");
        filterPanel.id = "gl-filter-panel";
        document.body.appendChild(filterPanel);

        initPanel();
        activateDesktopPanel();
        activateDesktopPanel(); // second call: _isActive=true → early return
        // Panel is still active, no error
        expect(document.body.classList.contains("gl-right-panel-open")).toBe(true);
    });

    test("activatePanel: legend absent → MutationObserver watches for legend", async () => {
        mqMatches = true;
        initPanel();
        activateDesktopPanel(); // pFilters/pLayers/pLegend panes exist

        // Add legend AFTER activate — MutationObserver should move it
        const legend = document.createElement("div");
        legend.className = "gl-map-legend";
        document.body.appendChild(legend);

        // Flush microtasks so MutationObserver callback runs
        await new Promise((resolve) => setTimeout(resolve, 50));

        const pLegend = document.getElementById("gl-rp-pane-legend");
        expect(pLegend.contains(legend)).toBe(true);
    });

    test("activatePanel: filter panel absent → MutationObserver adopts it into the filters pane (S5)", async () => {
        mqMatches = true;
        initPanel();
        activateDesktopPanel(); // no #gl-filter-panel yet → observer set up

        // The in-core filter capability mounts #gl-filter-panel asynchronously on
        // geoleaf:app:ready (FilterLifecycle); the observer must adopt it afterwards
        // (regression: a static placeholder was adopted then orphaned by the mount).
        const filterPanel = document.createElement("aside");
        filterPanel.id = "gl-filter-panel";
        document.body.appendChild(filterPanel);

        // Flush so the MutationObserver callback runs
        await new Promise((resolve) => setTimeout(resolve, 50));

        const pFilters = document.getElementById("gl-rp-pane-filters");
        expect(pFilters.contains(filterPanel)).toBe(true);
    });
});

// ── 6. onMQChange ────────────────────────────────────────────────────────────

describe("onMQChange()", () => {
    test("matches=true → activatePanel", () => {
        initPanel();
        // changeListeners[0] is the onMQChange callback registered in initDesktopPanel
        expect(changeListeners.length).toBeGreaterThan(0);
        changeListeners[0]({ matches: true });
        expect(document.body.classList.contains("gl-right-panel-open")).toBe(true);
    });

    test("matches=false after active → deactivatePanel", () => {
        mqMatches = true;
        initPanel();
        // Activate first
        changeListeners[0]({ matches: true });
        // Then deactivate
        changeListeners[0]({ matches: false });
        expect(document.body.classList.contains("gl-right-panel-open")).toBe(false);
    });

    test("onMQChange does nothing when panel is null (guard)", () => {
        // Don't init — no panel
        expect(() => {
            if (changeListeners.length > 0) changeListeners[0]({ matches: true });
        }).not.toThrow();
    });
});

// ── 7. destroyDesktopPanel ───────────────────────────────────────────────────

describe("destroyDesktopPanel()", () => {
    test("removes the panel from the DOM", () => {
        initPanel();
        expect(document.getElementById("gl-right-panel")).toBeTruthy();
        destroyDesktopPanel();
        expect(document.getElementById("gl-right-panel")).toBeNull();
    });

    test("restores elements moved into panes", () => {
        mqMatches = true;
        const filterPanel = document.createElement("div");
        filterPanel.id = "gl-filter-panel";
        document.body.appendChild(filterPanel);

        initPanel();
        activateDesktopPanel();
        expect(document.getElementById("gl-rp-pane-filters").contains(filterPanel)).toBe(true);

        destroyDesktopPanel();
        // filterPanel should be restored to document.body
        expect(document.body.contains(filterPanel)).toBe(true);
    });

    test("deactivatePanel early return when not active (!_isActive guard)", () => {
        initPanel();
        // _isActive = false (never activated)
        expect(() => destroyDesktopPanel()).not.toThrow();
    });

    test("can be called when nothing was initialized (no crash)", () => {
        expect(() => destroyDesktopPanel()).not.toThrow();
    });
});
