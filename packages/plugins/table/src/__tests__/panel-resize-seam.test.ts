/**
 * Tests for `panel-resize.ts` THROUGH THE REAL EVENT SEAM.
 *
 * 🛑 POURQUOI UN FICHIER À PART, ET POURQUOI IL NE FAUT PAS Y AJOUTER DE `vi.mock`.
 *
 * `table-panel.test.ts` ET `table-panel-branches.test.ts` font tous deux
 * `vi.mock("../utils/events.js", () => ({ events: null }))`. C'est légitime chez eux, mais
 * l'effet cumulé est qu'AUCUN test du paquet n'exerçait le chemin `if (events)` — donc
 * aucun n'exerçait celui que la production prend, puisque `events` est un objet constant de
 * module et n'est jamais nul hors test.
 *
 * Mesuré le 14/08/2026 : la branche non couverte de `panel-resize.ts` était celle du HAUT.
 * On lit facilement l'inverse dans un rapport lcov — et s'y fier conduit à « simplifier »
 * le repli, ce qui casse trois tests d'un coup.
 *
 * Ce fichier n'a donc aucun mock du seam, délibérément.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createResizeHandle } from "../panel-resize.js";
import type { TableConfig } from "../types.js";
import type { EventCleanup } from "../event-cleanups.js";

const CONFIG = { minHeight: "300px", maxHeight: "80%" } as unknown as TableConfig;

let container: HTMLElement;
let cleanups: EventCleanup[];

beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "offsetHeight", { value: 400, configurable: true });
    document.body.appendChild(container);
    cleanups = [];
});

afterEach(() => {
    container.remove();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
});

describe("panel-resize — through the real `events` seam", () => {
    it("registers through the seam and resizes on a pointer drag", () => {
        const handle = createResizeHandle(container, CONFIG, cleanups);
        container.appendChild(handle);

        // Le seam rend une fonction de démontage par écouteur posé : en obtenir une prouve
        // que c'est bien la branche `if (events)` qui a tourné, et pas le repli.
        expect(cleanups).toHaveLength(1);
        expect(typeof cleanups[0]).toBe("function");

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        // 400 de départ, curseur de 500 à 300 → delta 200 → 600, dans [300px, 80 % viewport].
        expect(container.style.height).toBe("600px");
    });

    it("le démontage rendu par le seam détache réellement l'écouteur", () => {
        const handle = createResizeHandle(container, CONFIG, cleanups);
        container.appendChild(handle);

        (cleanups[0] as unknown as () => void)();

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));

        // Rien ne doit avoir bougé : un démontage qui ne démonte pas est indiscernable d'un
        // démontage qui marche tant qu'on ne rejoue pas le geste après.
        expect(container.style.height).toBe("");
    });

    it("🛑 le mouvement cesse APRÈS la fin du geste — les écouteurs sont retirés, pas gardés", () => {
        const handle = createResizeHandle(container, CONFIG, cleanups);
        container.appendChild(handle);

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        expect(container.style.height).toBe("600px");

        // Un mouvement de plus, sans nouvelle pression. Avant la conversion, deux écouteurs
        // `document` permanents vivaient toute la durée du panneau ; seul un drapeau les
        // empêchait d'agir. Ils n'existent plus du tout entre deux gestes.
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 100, bubbles: true }));
        expect(container.style.height).toBe("600px");
    });
});
