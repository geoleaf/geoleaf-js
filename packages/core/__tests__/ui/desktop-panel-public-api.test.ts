/**
 * Sprint 2, tâche 2.4 — `UI.openPanel` / `closePanel` / `getOpenPanel`.
 *
 * 🛑 L'assertion qui porte ce fichier est « ouvrir deux fois de suite laisse ouvert ».
 * C'est la SEULE qui distingue `openPanel` d'un clic sur l'onglet, et elle était rouge par
 * construction avant l'extraction de `_activateTab` : `handleTabClick` bascule, donc le
 * second appel refermait le panneau. Un intégrateur qui appelle « ouvrir » et obtient
 * « fermé » est le défaut B-71, reproduit sur une surface publique.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k: string) => k),
}));

// ── matchMedia : le panneau ne s'active qu'au-dessus du point de rupture desktop ─────────
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

        // Le second appel est tout l'objet du test : `handleTabClick` refermerait ici.
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
        activateDesktopPanel(); // ne fait rien : `_mql.matches` est faux

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
 * Sprint 4, tâche 4.5 — `geoleaf:panel:opened` / `:closed`.
 *
 * 🛑 Ce qui est éprouvé ici n'est pas « l'événement part », c'est **quand il ne part PAS**.
 * `_activateTab` appelle `_closeAllTabs` avant d'ouvrir, et `openPanel()` passe par lui :
 * sans la garde « un onglet était-il ouvert ? », toute ouverture programmatique commencerait
 * par annoncer une fermeture qui n'a pas eu lieu. Les deux premiers cas ci-dessous sont ceux
 * qui rougissent si la garde saute — les autres resteraient verts.
 */
describe("geoleaf:panel:opened / :closed — les deux sens du panneau à onglets", () => {
    type PanelEvt = { type: string; tabId: string };

    /** Enregistre les deux clés dans l'ORDRE d'émission, ce qui est la moitié du contrat. */
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
