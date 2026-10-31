/**
 * Unit tests — the controls a driver has during a session.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSessionControls } from "../ui/session-controls.js";

const LABELS = {
    stop: "Arrêter",
    finish: "Terminer",
    continue: "Continuer",
    arrived: "Arrivé",
    stopReached: "Étape atteinte",
    reroute: (reason: string) => `refus:${reason}`,
};

describe("createSessionControls", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
    });

    /** Builds controls and hands back their parts. */
    function build() {
        const actions = { onStop: vi.fn(), onContinue: vi.fn() };
        const controls = createSessionControls(LABELS, actions);
        container.append(controls.element);
        return {
            actions,
            controls,
            stop: container.querySelector<HTMLButtonElement>(".gl-nav-controls__stop")!,
            resume: container.querySelector<HTMLButtonElement>(".gl-nav-controls__continue")!,
            status: container.querySelector<HTMLElement>(".gl-nav-controls__status")!,
        };
    }

    it("🛑 un bouton d'arrêt existe dès le début, et il arrête", () => {
        const { stop, actions } = build();
        expect(stop.textContent).toBe("Arrêter");
        stop.click();
        expect(actions.onStop).toHaveBeenCalledTimes(1);
    });

    it("🛑 à une étape, « Continuer » paraît, agit, et disparaît ensuite", () => {
        const { controls, resume, status, actions } = build();
        expect(resume.hidden).toBe(true);
        controls.update("waypoint-reached", undefined);
        expect(resume.hidden).toBe(false);
        expect(status.textContent).toBe("Étape atteinte");
        resume.click();
        expect(actions.onContinue).toHaveBeenCalledTimes(1);
        controls.update("navigating", undefined);
        expect(resume.hidden).toBe(true);
        expect(status.textContent).toBe("");
    });

    it("🛑 à l'arrivée, le guidage le DIT et propose de terminer", () => {
        const { controls, stop, status } = build();
        controls.update("arrived", undefined);
        expect(status.textContent).toBe("Arrivé");
        expect(stop.textContent).toBe("Terminer");
    });

    it("🛑 un recalcul refusé est dit, et seulement tant qu'on est hors tracé", () => {
        const { controls, status } = build();
        controls.update("rerouting", "network");
        expect(status.textContent).toBe("refus:network");
        controls.update("navigating", "network");
        expect(status.textContent).toBe("");
    });

    it("hors tracé sans refus, rien n'est affirmé", () => {
        const { controls, status } = build();
        controls.update("rerouting", undefined);
        expect(status.textContent).toBe("");
    });

    it("`destroy` retire tout, et se répète sans dommage", () => {
        const { controls } = build();
        controls.destroy();
        controls.destroy();
        expect(container.children).toHaveLength(0);
    });
});
