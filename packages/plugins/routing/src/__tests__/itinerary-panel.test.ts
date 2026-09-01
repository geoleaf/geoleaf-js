/**
 * @geoleaf-plugins/routing — the itinerary panel
 *
 * What is under test is the panel's own behaviour — when Compute is available, what happens to
 * a drawn route when the itinerary changes, and which refusals reach the message area.
 *
 * ⚠️ The panel builds its own DOM since 26/08/2026, so there is no shell left to mock: it used
 * to be a `createModalShell` overlay, whose stylesheet this bundle never shipped. Only the
 * kernel seam is stubbed — the panel asks a HOST to hide it, and there is no host here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteResult, Waypoint } from "../model.js";
import type { PanelLabels, PanelHandlers } from "../ui/itinerary-panel.js";

let closed = 0;

// The only seam the panel reaches through: asking the kernel to hide the pane. Counting the
// calls is what the old mock's `close` counter measured, one indirection further out.
vi.mock("../ui-seam.js", () => ({
    hidePane: () => {
        closed += 1;
    },
}));

vi.mock("../config.js", () => ({ getPluginConfig: () => ({}) }));

const { openItineraryPanel } = await import("../ui/itinerary-panel.js");

const labels: PanelLabels = {
    title: "Itinéraire",
    close: "Fermer",
    useMyPosition: "Votre position",
    clear: "Vider",
    compute: "Calculer",
    empty: "Aucune étape.",
    origin: "Départ",
    via: "Étape",
    destination: "Arrivée",
    moveUp: "Monter",
    moveDown: "Descendre",
    remove: "Retirer",
    leg: (m) => `${Math.round(m)}m`,
    total: (m) => `total ${Math.round(m)}m`,
    failure: (reason) => `échec:${reason}`,
    // Required: the panel carries a stop-entry field, and its labels are
    // REQUIRED and not optional — an optional block would let a panel mount
    // with no way to add a stop, with nothing turning red. The defect's original state.
    input: {
        field: "champ",
        add: "ajouter",
        pickOnMap: "carte",
        picking: "cliquez…",
        refusal: (reason) => `refus:${reason}`,
    },
};

const wp = (name: string): Waypoint => ({ coordinates: [55.45, -20.88], name });

const route = (distance = 1000): RouteResult =>
    ({
        distance,
        duration: 600,
        legs: [{ distance, duration: 600, steps: [] }],
        geometry: "",
        waypoints: [wp("A"), wp("B")],
        provider: "osrm",
    }) as unknown as RouteResult;

/**
 * Opens a panel with spied handlers.
 *
 * @param initial Waypoints to open with.
 * @returns The panel and its handlers.
 */
function open(initial: Waypoint[] = []) {
    const handlers: PanelHandlers = {
        onCompute: vi.fn(),
        onUseMyPosition: vi.fn(),
        onPickOnMap: vi.fn(),
        onChange: vi.fn(),
        onClose: vi.fn(),
    };
    return { panel: openItineraryPanel(labels, handlers, initial), handlers };
}

/** The live panel root — rebuilt by every `open()`, and cleared between tests. */
const panelRoot = () => document.querySelector<HTMLElement>(".gl-routing-panel")!;

const q = <T extends HTMLElement>(sel: string) => panelRoot().querySelector<T>(sel)!;

beforeEach(() => {
    document.body.replaceChildren();
    closed = 0;
});

describe("🛑 LE CÂBLAGE — le panneau PORTE son champ d'ajout d'étape", () => {
    // 🛑 This block exists because its first absence went through. Mutation
    // done on `panel.append(input.element)`: all 226 tests stayed GREEN. The
    // field was built, unit-tested, and nothing asserted a panel contains one
    // — the very shape being fixed, reproduced in the code written to fix it.
    //
    // The lesson is not about this file: a module can be entirely correct and
    // entirely unreachable, and only a test starting from the ENTRY sees it.

    it("🛑 un panneau ouvert contient un champ de saisie d'étape", () => {
        open([]);
        expect(document.querySelector(".gl-routing-add__field")).not.toBeNull();
    });

    it("le bouton « choisir sur la carte » DÉLÈGUE au contrôleur", () => {
        // The panel attaches nothing itself: the controller owns the mode's
        // lifetime, because only it can end it once the panel is gone.
        const { handlers } = open([]);
        document.querySelector<HTMLButtonElement>(".gl-routing-add__pick")?.click();
        expect(handlers.onPickOnMap).toHaveBeenCalledTimes(1);
    });

    it("le champ ajoute RÉELLEMENT une étape à la liste du panneau", () => {
        const { handlers } = open([]);
        const field = document.querySelector<HTMLInputElement>(".gl-routing-add__field");
        (field as HTMLInputElement).value = "-21.0964, 55.4781";
        document.querySelector<HTMLButtonElement>(".gl-routing-add__submit")?.click();
        expect(handlers.onChange).toHaveBeenCalledWith([{ coordinates: [55.4781, -21.0964] }]);
    });
});

describe("Compute is offered only when there is something to compute", () => {
    it("is disabled on an empty itinerary", () => {
        open();
        expect(q<HTMLButtonElement>(".gl-routing-panel__compute").disabled).toBe(true);
    });

    it("is still disabled with a single waypoint", () => {
        // One point is not a route. Offering the button and then refusing on click would move
        // the discovery to after the user acted.
        open([wp("A")]);
        expect(q<HTMLButtonElement>(".gl-routing-panel__compute").disabled).toBe(true);
    });

    it("becomes available at two, and hands the itinerary over", () => {
        const { handlers } = open([wp("A"), wp("B")]);
        const btn = q<HTMLButtonElement>(".gl-routing-panel__compute");
        expect(btn.disabled).toBe(false);
        btn.click();
        expect(handlers.onCompute).toHaveBeenCalledWith([wp("A"), wp("B")]);
    });
});

describe("a drawn route belongs to the itinerary it was computed for", () => {
    it("shows the total once a route arrives", () => {
        const { panel } = open([wp("A"), wp("B")]);
        panel.setRoute(route(2500));
        expect(q(".gl-routing-panel__message").textContent).toBe("total 2500m");
    });

    it("DROPS the route when the itinerary changes", () => {
        // 🛑 Keeping it would show per-leg figures beside stops they do not belong to — numbers
        // that look computed and describe a journey nobody asked for.
        const { panel } = open([wp("A"), wp("B")]);
        panel.setRoute(route());
        panel.setWaypoints([wp("A"), wp("C")]);
        expect(panelRoot().querySelectorAll(".gl-routing-steps__leg")).toHaveLength(0);
    });

    it("tells the host every time the itinerary changes", () => {
        const { panel, handlers } = open([wp("A")]);
        panel.setWaypoints([wp("A"), wp("B")]);
        expect(handlers.onChange).toHaveBeenCalledWith([wp("A"), wp("B")]);
    });
});

describe("refusals reach the message area, and the area is polite", () => {
    it("announces a refusal without stealing focus", () => {
        const { panel } = open();
        const msg = q(".gl-routing-panel__message");
        expect(msg.getAttribute("aria-live")).toBe("polite");
        panel.showFailure("timeout");
        expect(msg.textContent).toBe("échec:timeout");
    });

    it("shows the cap refusal when an add is turned down", () => {
        const { panel } = open();
        for (let i = 0; i < 12; i += 1) panel.addWaypoint(wp(`P${i}`));
        expect(q(".gl-routing-panel__message").textContent).toBe("échec:cap-reached");
    });
});

describe("the three plain buttons", () => {
    it("clears the itinerary", () => {
        const { panel, handlers } = open([wp("A"), wp("B")]);
        void panel;
        q<HTMLButtonElement>(".gl-routing-panel__clear").click();
        expect(handlers.onChange).toHaveBeenLastCalledWith([]);
    });

    it("asks the host for the position rather than reading it itself", () => {
        // Reading it here would open a second watch beside the one the core already holds.
        const { handlers } = open();
        q<HTMLButtonElement>(".gl-routing-panel__my-position").click();
        expect(handlers.onUseMyPosition).toHaveBeenCalled();
    });

    it("closes through the shell and tells the host", () => {
        const { handlers } = open();
        q<HTMLButtonElement>(".gl-routing-panel__close").click();
        expect(closed).toBe(1);
        expect(handlers.onClose).toHaveBeenCalled();
    });
});
