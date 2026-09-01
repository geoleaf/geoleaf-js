/**
 * @geoleaf-plugins/routing — the step list
 *
 * The list a user reorders. What is pinned is that it can be reordered WITHOUT a pointer, that
 * the numbers cannot desynchronise, and that a name coming from profile data is never written as
 * markup.
 */
import { describe, it, expect, vi } from "vitest";
import { renderStepList, type StepListLabels } from "../ui/step-list.js";
import type { Waypoint, RouteResult } from "../model.js";

const labels: StepListLabels = {
    origin: "Départ",
    via: "Étape",
    destination: "Arrivée",
    moveUp: "Monter",
    moveDown: "Descendre",
    remove: "Retirer",
    empty: "Aucune étape.",
    leg: (m, s) => `${Math.round(m)}m/${Math.round(s)}s`,
};

const wp = (name?: string): Waypoint => ({
    coordinates: [55.45, -20.88],
    ...(name ? { name } : {}),
});

/**
 * Renders a list and returns it with its spies.
 *
 * @param waypoints The itinerary.
 * @param route A computed route, or null.
 * @returns The element and the two callbacks.
 */
function render(waypoints: Waypoint[], route: RouteResult | null = null) {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const el = renderStepList({ waypoints, route, labels, onMove, onRemove });
    return { el, onMove, onRemove };
}

describe("what it renders", () => {
    it("says so when the itinerary is empty, rather than rendering nothing", () => {
        const { el } = render([]);
        expect(el.textContent).toContain("Aucune étape.");
    });

    it("labels the roles from the POSITION", () => {
        const { el } = render([wp("A"), wp("B"), wp("C")]);
        const roles = [...el.querySelectorAll(".gl-routing-steps__role")].map((n) => n.textContent);
        expect(roles).toEqual(["Départ", "Étape", "Arrivée"]);
    });

    it("shows coordinates when a waypoint has no name", () => {
        // Better than an empty row: the user placed this point and has to recognise it.
        const { el } = render([wp()]);
        expect(el.textContent).toContain("-20.8800, 55.4500");
    });

    it("writes a name as TEXT, never as markup", () => {
        // 🛑 The name comes from a feature property, which comes from a profile, which comes from
        // data nobody in this package controls.
        const { el } = render([wp("<img src=x onerror=alert(1)>")]);
        expect(el.querySelector("img")).toBeNull();
        expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
    });

    it("puts the leg figure beside the step it ARRIVES at", () => {
        // "Distance since the previous point" means the number belongs to the row it ends on.
        const route = {
            distance: 300,
            duration: 60,
            legs: [
                { distance: 100, duration: 20, steps: [] },
                { distance: 200, duration: 40, steps: [] },
            ],
            geometry: "",
            waypoints: [wp("A"), wp("B"), wp("C")],
            provider: "osrm",
        } as unknown as RouteResult;
        const { el } = render([wp("A"), wp("B"), wp("C")], route);
        const legs = [...el.querySelectorAll(".gl-routing-steps__leg")].map((n) => n.textContent);
        // Three rows, two legs: the first row has none, because nothing arrives at the origin.
        expect(legs).toEqual(["100m/20s", "200m/40s"]);
    });
});

describe("reordering WITHOUT a pointer", () => {
    it("gives every row a move-up and a move-down button", () => {
        // A list reorderable only by dragging cannot be reordered by anyone using a keyboard, a
        // switch, or a screen reader — and this repository runs axe scans that would say so.
        const { el } = render([wp("A"), wp("B"), wp("C")]);
        expect(el.querySelectorAll(".gl-routing-steps__move")).toHaveLength(6);
    });

    it("disables the impossible moves rather than hiding them", () => {
        // ⚠️ A control that disappears at the ends changes the number of tab stops per row, and
        // a keyboard user loses their place.
        const { el } = render([wp("A"), wp("B")]);
        const moves = [...el.querySelectorAll<HTMLButtonElement>(".gl-routing-steps__move")];
        expect(moves.map((b) => b.disabled)).toEqual([true, false, false, true]);
    });

    it("moves by one when a move button is pressed", () => {
        const { el, onMove } = render([wp("A"), wp("B"), wp("C")]);
        const moves = [...el.querySelectorAll<HTMLButtonElement>(".gl-routing-steps__move")];
        moves[1].click(); // first row, "down"
        expect(onMove).toHaveBeenCalledWith(0, 1);
        moves[2].click(); // second row, "up"
        expect(onMove).toHaveBeenCalledWith(1, 0);
    });

    it("names every control, so a screen reader does not read three identical buttons", () => {
        const { el } = render([wp("A"), wp("B")]);
        for (const b of el.querySelectorAll("button")) {
            expect(b.getAttribute("aria-label")).toBeTruthy();
        }
    });

    it("removes the row that was asked for", () => {
        const { el, onRemove } = render([wp("A"), wp("B")]);
        el.querySelectorAll<HTMLButtonElement>(".gl-routing-steps__remove")[1].click();
        expect(onRemove).toHaveBeenCalledWith(1);
    });
});

describe("reordering WITH a pointer", () => {
    it("marks every row draggable and carries its index", () => {
        const { el } = render([wp("A"), wp("B")]);
        const items = [...el.querySelectorAll<HTMLElement>("li")];
        expect(items.map((n) => n.draggable)).toEqual([true, true]);
        expect(items.map((n) => n.dataset["index"])).toEqual(["0", "1"]);
    });
});
