/**
 * Tests for `panel-resize.ts` THROUGH THE REAL EVENT SEAM.
 *
 * 🛑 WHY A SEPARATE FILE, AND WHY NO `vi.mock` MUST BE ADDED TO IT.
 *
 * STATE ON 14/08/2026, at this file's creation — `table-panel.test.ts` AND
 * `table-panel-branches.test.ts` both neutralised the seam for their whole
 * duration (a `vi.mock` of the events module returning a null object).
 * Legitimate for them, but the cumulative effect was that NO test in the
 * package exercised the `if (events)` path — hence none exercised the one
 * production takes, since `events` is a constant module object and is never
 * null outside tests. The uncovered branch of `panel-resize.ts` was the TOP
 * one. An lcov report easily reads the other way — and trusting it led to
 * "simplifying" the fallback, which broke three tests at once.
 *
 * ✅ UPDATE OF 17/08/2026 — **the deposit was SEVEN suites, not two**, and all
 * seven now set a mock FAITHFUL to the seam instead of nulling it. The
 * sentence above is thus no longer true of the present: the `if (events)`
 * path is now widely exercised. **It is kept as-is, dated, because it is what
 * explains why this file exists** — not erased, without which the next
 * reread would see only a duplicate of the other suites.
 *
 * 🛑 WHAT DOES NOT CHANGE, AND IS THE FILE'S REASON TO EXIST: it is the ONLY
 * one exercising `panel-resize.ts` with no mock of the seam. The seven others
 * go through a faithful mock — faithful today, and nothing guarantees it
 * stays so. This file is what would turn red on a divergence between the mock
 * and `utils/events.ts`. Do not add a mock to it, and do not delete it on the
 * grounds that the others cover the same branch.
 *
 * ⚠️ The neutralisation token is no longer spelled out here, deliberately:
 * citing it made this file indistinguishable from a real neutralisation for
 * any completeness grep — it showed up as a false positive in that sweep.
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

        // The seam returns one teardown function per listener set: getting one
        // proves the `if (events)` branch ran, and not the fallback.
        expect(cleanups).toHaveLength(1);
        expect(typeof cleanups[0]).toBe("function");

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        // 400 to start, cursor from 500 to 300 → delta 200 → 600, within [300px, 80% viewport].
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

        // Nothing must have moved: a teardown that does not tear down is
        // indistinguishable from one that works until the gesture is replayed after.
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

        // One more movement, with no new press. Before the conversion, two
        // permanent `document` listeners lived for the panel's whole lifetime;
        // only a flag kept them from acting. They no longer exist at all
        // between two gestures.
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 100, bubbles: true }));
        expect(container.style.height).toBe("600px");
    });
});
