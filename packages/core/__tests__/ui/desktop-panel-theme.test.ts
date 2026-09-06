/**
 * ui/desktop/desktop-panel-theme.ts + the `ui.showPanelThemeToggle` gate.
 *
 * 🛑 The assertion carrying this file is that hiding the toggle does NOT take the separator
 * with it. `.gl-rp-tabs` is a flex column WITH `justify-content: center`, and the separator
 * carries the strip's only `margin-top: auto` — that margin is what cancels the centring and
 * pins the tabs to the top. It is also the insertion anchor of the `"tab"` variant and of the
 * registered-pane sync, neither of which ever looks at the button.
 *
 * So the naive gate — wrapping the OLD `appendThemeToggleToTabs`, which posted both nodes —
 * is a layout regression reachable by the nominal path, and cases 3 and 4 exist to catch it.
 *
 * ⚠️ No machine here sees CSS: jsdom computes no layout. These tests assert the DOM contract
 * the CSS depends on (the separator is present, and it precedes the bottom stack), never the
 * rendering itself. The rendering's only witness is a manual Chromium probe at >= 1440px.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
    registerDict: vi.fn(),
}));

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
    initDesktopPanel,
    activateDesktopPanel,
    destroyDesktopPanel,
} from "../../src/kernel/ui/desktop/desktop-panel.js";
import {
    appendTabsSeparator,
    appendThemeToggleToTabs,
} from "../../src/kernel/ui/desktop/desktop-panel-theme.js";
import { registerPanelPane, clearPanelPanes } from "../../src/kernel/ui/panel-panes.js";

const TOGGLE = ".gl-rp-theme-toggle";
const SEPARATOR = ".gl-rp-theme-separator";

/** Builds the panel, optionally passing the gate. Returns the `.gl-main` it lives in. */
function mountPanel(options: Record<string, unknown> = {}): HTMLElement {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    initDesktopPanel({ glMain, ...options } as never);
    return glMain;
}

function tabs(): HTMLElement {
    const el = document.querySelector<HTMLElement>(".gl-rp-tabs");
    if (!el) throw new Error("tab strip not built");
    return el;
}

/** Index of a child matching `sel`, or -1. Order is the whole point of several cases. */
function indexOf(sel: string): number {
    return [...tabs().children].findIndex((c) => c.matches(sel));
}

beforeEach(() => {
    mqMatches = true;
});

afterEach(() => {
    destroyDesktopPanel();
    clearPanelPanes();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ui.showPanelThemeToggle — the gate", () => {
    it("1 — no option at all shows the toggle AND the separator (opt-out default)", () => {
        mountPanel();
        expect(tabs().querySelector(TOGGLE)).not.toBeNull();
        expect(tabs().querySelector(SEPARATOR)).not.toBeNull();
    });

    it("2 — showThemeToggle:true is the same as omitting it", () => {
        mountPanel({ showThemeToggle: true });
        expect(tabs().querySelector(TOGGLE)).not.toBeNull();
        expect(tabs().querySelector(SEPARATOR)).not.toBeNull();
    });

    it("3 — showThemeToggle:false removes the BUTTON and keeps the SEPARATOR", () => {
        // 🔴 The naive patch (gating the old two-node function) makes this red: it would take
        // the separator with the button, and with it the strip's only `margin-top: auto` —
        // the bottom icon stack would ride up against the tabs instead of sitting on the
        // bottom edge. (This comment said "`justify-content: center` would re-centre the
        // whole strip" while the strip was centred; it is `flex-start` now. The regression is
        // real either way, its shape changed.)
        mountPanel({ showThemeToggle: false });
        expect(tabs().querySelector(TOGGLE)).toBeNull();
        expect(tabs().querySelector(SEPARATOR)).not.toBeNull();
    });

    it("4 — with the toggle hidden, a registered pane's tab still lands BEFORE the separator", () => {
        // 🔴 Replica of panel-panes.test.ts in the gated branch: the separator is the anchor
        // `_insertTabButton` uses for the "tab" variant, and it must survive the gate.
        const owned = document.createElement("div");
        owned.className = "gl-late-panel";
        document.body.appendChild(owned);
        mountPanel({ showThemeToggle: false });
        activateDesktopPanel();
        registerPanelPane({ id: "late", labelKey: "late.label", selector: ".gl-late-panel" });

        const tabIndex = indexOf("[data-gl-rp-tab='late']");
        const sepIndex = indexOf(SEPARATOR);
        expect(tabIndex).toBeGreaterThanOrEqual(0);
        expect(sepIndex).toBeGreaterThanOrEqual(0);
        expect(tabIndex).toBeLessThan(sepIndex);
    });

    it("5 — an injector anchoring on the toggle falls back to appendChild without throwing", () => {
        // The four real injectors all do `insertBefore(anchor) ?? appendChild`. With the anchor
        // gone the fallback is the ONLY path, so it has to land inside the strip, past the
        // separator — not before the tabs.
        mountPanel({ showThemeToggle: false });
        const strip = tabs();
        const btn = document.createElement("button");
        btn.className = "gl-rp-tab-btn gl-rp-fake-btn";
        const anchor = strip.querySelector(TOGGLE);
        if (anchor) strip.insertBefore(btn, anchor);
        else strip.appendChild(btn);

        expect(indexOf(".gl-rp-fake-btn")).toBeGreaterThan(indexOf(SEPARATOR));
    });

    it("6 — appendTabsSeparator is idempotent (contract of the function, not of a scenario)", () => {
        // ⚠️ Honest scope: `buildTabsDom` builds a fresh strip each time and is the only
        // caller, so duplication is NOT reachable by the real path. This guards the function's
        // contract for the next caller, and nothing more.
        const strip = document.createElement("div");
        strip.className = "gl-rp-tabs";
        document.body.appendChild(strip);
        appendTabsSeparator(strip);
        appendTabsSeparator(strip);
        expect(strip.querySelectorAll(SEPARATOR)).toHaveLength(1);
    });

    it("6b — appendThemeToggleToTabs is idempotent and posts the button ONLY", () => {
        const strip = document.createElement("div");
        strip.className = "gl-rp-tabs";
        document.body.appendChild(strip);
        appendThemeToggleToTabs(strip);
        appendThemeToggleToTabs(strip);
        expect(strip.querySelectorAll(TOGGLE)).toHaveLength(1);
        expect(strip.querySelector(SEPARATOR)).toBeNull();
    });

    it("7 — after destroy, a remount without the option brings the toggle back", () => {
        mountPanel({ showThemeToggle: false });
        expect(tabs().querySelector(TOGGLE)).toBeNull();
        destroyDesktopPanel();
        document.body.innerHTML = "";
        mountPanel();
        expect(tabs().querySelector(TOGGLE)).not.toBeNull();
    });

    it("7b — destroy evicts the MOBILE copy, so a remount with the gate off leaves none", () => {
        // The mobile button lives in the toolbar, OUTSIDE the panel `destroy` removes. Dropping
        // only the reference would leave it on screen: the gate blocks injection, it does not
        // evict what is already there.
        const toolbar = document.createElement("div");
        toolbar.className = "gl-map-toolbar__scroll";
        document.body.appendChild(toolbar);

        mountPanel();
        activateDesktopPanel();
        expect(toolbar.querySelector('[data-variant="mobile"]')).not.toBeNull();

        destroyDesktopPanel();
        expect(toolbar.querySelector('[data-variant="mobile"]')).toBeNull();

        mountPanel({ showThemeToggle: false });
        activateDesktopPanel();
        expect(toolbar.querySelector('[data-variant="mobile"]')).toBeNull();
    });

    it("8 — a second init on an existing panel changes neither the DOM nor the module state", () => {
        // The flag is read AFTER the early return. Reading it before would mutate module state
        // while leaving the built DOM alone — a bug in zero lines of code.
        const glMain = mountPanel();
        expect(tabs().querySelector(TOGGLE)).not.toBeNull();

        initDesktopPanel({ glMain, showThemeToggle: false } as never);
        expect(tabs().querySelector(TOGGLE)).not.toBeNull();

        // The module state must not have flipped either: the mobile injection still happens.
        const toolbar = document.createElement("div");
        toolbar.className = "gl-map-toolbar__scroll";
        document.body.appendChild(toolbar);
        activateDesktopPanel();
        expect(toolbar.querySelector('[data-variant="mobile"]')).not.toBeNull();
    });

    it("9 — the gate covers the mobile placement, observer included", () => {
        // `_themeObserver` is private with no accessor, so counting constructions is the only
        // falsifiable witness. Differential, because activatePanel builds other observers:
        // the gated run must build exactly ONE fewer.
        const RealMO = globalThis.MutationObserver;
        const spy = vi.fn();
        class CountingMO extends RealMO {
            constructor(cb: MutationCallback) {
                super(cb);
                spy();
            }
        }
        vi.stubGlobal("MutationObserver", CountingMO);

        // No toolbar in the DOM → the shown branch arms the catch-up observer.
        mountPanel();
        activateDesktopPanel();
        const withToggle = spy.mock.calls.length;
        expect(withToggle).toBeGreaterThan(0);

        destroyDesktopPanel();
        document.body.innerHTML = "";
        spy.mockClear();

        mountPanel({ showThemeToggle: false });
        activateDesktopPanel();
        const withoutToggle = spy.mock.calls.length;

        expect(withoutToggle).toBe(withToggle - 1);
    });

    it("9b — with the gate off, no mobile button is injected into an existing toolbar", () => {
        const toolbar = document.createElement("div");
        toolbar.className = "gl-map-toolbar__scroll";
        document.body.appendChild(toolbar);

        mountPanel({ showThemeToggle: false });
        activateDesktopPanel();

        expect(toolbar.querySelector('[data-variant="mobile"]')).toBeNull();
        expect(toolbar.querySelector(TOGGLE)).toBeNull();
    });

    it("10 — catch-up on an already-rendered strip: the toggle is not always the last child", () => {
        // The seam is synchronous, so at emit time `insertBefore(toggle) ≡ appendChild`. That
        // equivalence does NOT hold for a capability catching up later, once something else has
        // appended past the toggle — the gated branch must stay well-defined there too.
        mountPanel();
        const strip = tabs();
        const late = document.createElement("button");
        late.className = "gl-rp-tab-btn gl-rp-late-btn";
        strip.appendChild(late);
        expect(indexOf(TOGGLE)).toBeLessThan(indexOf(".gl-rp-late-btn"));

        destroyDesktopPanel();
        document.body.innerHTML = "";

        mountPanel({ showThemeToggle: false });
        const strip2 = tabs();
        const late2 = document.createElement("button");
        late2.className = "gl-rp-tab-btn gl-rp-late-btn";
        const anchor = strip2.querySelector(TOGGLE);
        if (anchor) strip2.insertBefore(late2, anchor);
        else strip2.appendChild(late2);
        expect(indexOf(".gl-rp-late-btn")).toBeGreaterThan(indexOf(SEPARATOR));
    });
});

describe("la bande rend des ICÔNES — et le repli texte reste ouvert", () => {
    it("6 — les trois onglets natifs sont des icônes, et le titre du profil est leur NOM", () => {
        // 🛑 The word is not decoration: it WAS the button's accessible name. Six anonymous
        // buttons in a `tablist` is what the E2E axe scan says out loud.
        mountPanel({ titleFilters: "MyFilters" });
        const tab = document.getElementById("gl-rp-tab-filters");

        expect(tab?.querySelector("svg")).not.toBeNull();
        expect(tab?.classList.contains("gl-rp-tab--icon")).toBe(true);
        expect(tab?.getAttribute("aria-label")).toBe("MyFilters");
        expect(tab?.textContent).toBe("");
    });

    it("7 — un pane qui DÉCLARE une icône la rend", () => {
        const owned = document.createElement("div");
        owned.className = "gl-iconed-panel";
        document.body.appendChild(owned);
        registerPanelPane({
            id: "iconed",
            labelKey: "iconed.label",
            selector: ".gl-iconed-panel",
            icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
        });
        mountPanel();

        const tab = document.querySelector("[data-gl-rp-tab='iconed']");
        expect(tab?.querySelector("svg")).not.toBeNull();
        expect(tab?.getAttribute("aria-label")).toBe("iconed.label");
    });

    it("🛑 8 — un pane SANS icône garde un onglet TEXTE, il ne devient pas un carré vide", () => {
        // `registerPanelPane` is a public seam. A third-party pane that predates this change
        // has no icon to give, and hiding it behind an empty 28 px square would be worse than
        // the long word that motivated the change in the first place.
        const owned = document.createElement("div");
        owned.className = "gl-plain-panel";
        document.body.appendChild(owned);
        registerPanelPane({
            id: "plain",
            labelKey: "plain.label",
            selector: ".gl-plain-panel",
        });
        mountPanel();

        const tab = document.querySelector("[data-gl-rp-tab='plain']");
        expect(tab?.querySelector("svg")).toBeNull();
        expect(tab?.classList.contains("gl-rp-tab--icon")).toBe(false);
        expect(tab?.textContent).toBe("plain.label");
        // And the accessible name is posted in both forms.
        expect(tab?.getAttribute("aria-label")).toBe("plain.label");
    });
});
