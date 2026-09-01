/**
 * `UI.openPanel` / `closePanel` / `getOpenPanel`.
 *
 * 🛑 The assertion carrying this file is "opening twice in a row leaves it
 * open". It is the ONLY one that tells `openPanel` from a click on the tab,
 * and it was red by construction before `_activateTab` was extracted:
 * `handleTabClick` toggles, so the second call closed the panel back. An
 * integrator who calls "open" and gets "closed" is the toggle's defect,
 * reproduced on a public surface.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

// ── matchMedia: the panel only activates above the desktop breakpoint ────────────────────
let mqMatches = true;
const changeListeners: EventListener[] = [];
const mockMql = {
    get matches() {
        return mqMatches;
    },
    media: "(min-width: 1440px)",
    onchange: null,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "change") changeListeners.push(listener);
    }),
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
    openPanel,
    closePanel,
    getOpenPanel,
} from "../../src/kernel/ui/desktop/desktop-panel.js";

function mountPanel() {
    const glMain = document.createElement("div");
    glMain.className = "gl-main";
    document.body.appendChild(glMain);
    initDesktopPanel({ glMain });
    activateDesktopPanel();
    return glMain;
}

afterEach(() => {
    destroyDesktopPanel();
    document.body.innerHTML = "";
    changeListeners.length = 0;
    mqMatches = true;
    vi.clearAllMocks();
});

describe("UI.openPanel / closePanel / getOpenPanel — surface publique du panneau", () => {
    it("🛑 ouvrir DEUX FOIS de suite laisse le panneau ouvert — openPanel ne bascule pas", () => {
        mountPanel();

        expect(openPanel("layers")).toBe(true);
        expect(getOpenPanel()).toBe("layers");

        // The second call is the test's whole point: `handleTabClick` would close here.
        expect(openPanel("layers")).toBe(true);
        expect(getOpenPanel()).toBe("layers");
    });

    it("ouvre un autre onglet sans en laisser deux actifs", () => {
        const glMain = mountPanel();

        openPanel("layers");
        openPanel("legend");

        expect(getOpenPanel()).toBe("legend");
        expect(glMain.ownerDocument.querySelectorAll(".gl-rp-tab.gl-is-active")).toHaveLength(1);
    });

    it("closePanel referme, et getOpenPanel rend null", () => {
        mountPanel();

        openPanel("filters");
        expect(getOpenPanel()).toBe("filters");

        closePanel();
        expect(getOpenPanel()).toBeNull();
    });

    it("closePanel sur un panneau déjà fermé ne jette pas", () => {
        mountPanel();
        expect(() => closePanel()).not.toThrow();
        expect(getOpenPanel()).toBeNull();
    });

    it("un onglet inconnu rend false et ne change rien à l'état ouvert", () => {
        mountPanel();

        openPanel("layers");
        expect(openPanel("cet-onglet-n-existe-pas")).toBe(false);
        expect(getOpenPanel()).toBe("layers");
    });

    it("sans panneau construit : openPanel rend false et getOpenPanel rend null", () => {
        expect(openPanel("layers")).toBe(false);
        expect(getOpenPanel()).toBeNull();
    });

    it("panneau construit mais hors du point de rupture desktop : openPanel refuse", () => {
        mqMatches = false;
        const glMain = document.createElement("div");
        glMain.className = "gl-main";
        document.body.appendChild(glMain);
        initDesktopPanel({ glMain });
        activateDesktopPanel(); // does nothing: `_mql.matches` is false

        expect(openPanel("layers")).toBe(false);
    });

    it("un onglet désactivé par le profil n'est pas ouvrable", () => {
        const glMain = document.createElement("div");
        glMain.className = "gl-main";
        document.body.appendChild(glMain);
        initDesktopPanel({ glMain, showLegend: false });
        activateDesktopPanel();

        expect(openPanel("legend")).toBe(false);
        expect(getOpenPanel()).toBeNull();
    });
});

/**
 * `geoleaf:panel:opened` / `:closed`.
 *
 * 🛑 What is exercised here is not "the event fires", it is **when it does
 * NOT fire**. `_activateTab` calls `_closeAllTabs` before opening, and
 * `openPanel()` goes through it: without the "was a tab open?" guard, every
 * programmatic opening would start by announcing a closure that did not
 * happen. The first two cases below are the ones that turn red if the guard
 * goes — the others would stay green.
 */
describe("geoleaf:panel:opened / :closed — les deux sens du panneau à onglets", () => {
    type PanelEvt = { type: string; tabId: string };

    /** Records both keys in emission ORDER, which is half the contract. */
    function recordPanelEvents(): { seen: PanelEvt[]; stop: () => void } {
        const seen: PanelEvt[] = [];
        const onOpen = (e: Event) => {
            seen.push({ type: "opened", tabId: (e as CustomEvent).detail.tabId });
        };
        const onClose = (e: Event) => {
            seen.push({ type: "closed", tabId: (e as CustomEvent).detail.tabId });
        };
        document.addEventListener("geoleaf:panel:opened", onOpen);
        document.addEventListener("geoleaf:panel:closed", onClose);
        return {
            seen,
            stop: () => {
                document.removeEventListener("geoleaf:panel:opened", onOpen);
                document.removeEventListener("geoleaf:panel:closed", onClose);
            },
        };
    }

    it("🛑 ouvrir alors que RIEN n'était ouvert n'émet aucun `closed`", () => {
        mountPanel();
        const rec = recordPanelEvents();

        openPanel("layers");

        expect(rec.seen).toEqual([{ type: "opened", tabId: "layers" }]);
        rec.stop();
    });

    it("🛑 changer d'onglet émet `closed(ancien)` PUIS `opened(nouveau)`, dans cet ordre", () => {
        mountPanel();
        openPanel("layers");
        const rec = recordPanelEvents();

        openPanel("legend");

        expect(rec.seen).toEqual([
            { type: "closed", tabId: "layers" },
            { type: "opened", tabId: "legend" },
        ]);
        rec.stop();
    });

    it("closePanel émet `closed` en nommant l'onglet qui était ouvert", () => {
        mountPanel();
        openPanel("filters");
        const rec = recordPanelEvents();

        closePanel();

        expect(rec.seen).toEqual([{ type: "closed", tabId: "filters" }]);
        rec.stop();
    });

    it("closePanel sur un panneau déjà fermé n'émet rien", () => {
        mountPanel();
        const rec = recordPanelEvents();

        closePanel();

        expect(rec.seen).toEqual([]);
        rec.stop();
    });

    it("un onglet inconnu n'émet rien — ni ouverture, ni fermeture de l'onglet courant", () => {
        mountPanel();
        openPanel("layers");
        const rec = recordPanelEvents();

        expect(openPanel("cet-onglet-n-existe-pas")).toBe(false);

        expect(rec.seen).toEqual([]);
        rec.stop();
    });

    it("re-cliquer l'onglet actif émet `closed` seul — la bascule appartient au pointeur", () => {
        const glMain = mountPanel();
        openPanel("layers");
        const rec = recordPanelEvents();

        glMain.ownerDocument
            .querySelector<HTMLElement>("[data-gl-rp-tab='layers']")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(rec.seen).toEqual([{ type: "closed", tabId: "layers" }]);
        rec.stop();
    });
});
