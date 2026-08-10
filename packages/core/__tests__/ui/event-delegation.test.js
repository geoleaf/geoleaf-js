/**
 */
/* Phase 5.17 - event-delegation */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { _UIEventDelegation } from "../../src/kernel/ui/event-delegation.js";

describe("ui/event-delegation (Phase 5.17)", () => {
    it("attachTrackedListener returns null when element or handler missing", () => {
        expect(_UIEventDelegation.attachTrackedListener(null, "click", () => {})).toBeNull();
        expect(
            _UIEventDelegation.attachTrackedListener(document.createElement("div"), "click", null)
        ).toBeNull();
    });

    it("attachTrackedListener returns id and handler is invoked", () => {
        const el = document.createElement("button");
        const handler = vi.fn();
        const id = _UIEventDelegation.attachTrackedListener(el, "click", handler);
        expect(id).toBeTruthy();
        el.click();
        expect(handler).toHaveBeenCalled();
    });

    it("cleanupAllListeners returns number cleaned", () => {
        const el = document.createElement("div");
        _UIEventDelegation.attachTrackedListener(el, "click", () => {});
        const n = _UIEventDelegation.cleanupAllListeners();
        expect(n).toBeGreaterThanOrEqual(0);
    });

    it("attachTrackedListener handler throw is caught and logged", () => {
        const el = document.createElement("button");
        const id = _UIEventDelegation.attachTrackedListener(el, "click", () => {
            throw new Error("test");
        });
        expect(id).toBeTruthy();
        expect(() => el.click()).not.toThrow();
    });

    it("attachAccordionEvents returns null when container missing", () => {
        expect(_UIEventDelegation.attachAccordionEvents(null)).toBeNull();
    });

    it("attachAccordionEvents toggles panel on click", () => {
        const container = document.createElement("div");
        const accordion = document.createElement("div");
        accordion.className = "gl-accordion";
        const btn = document.createElement("button");
        btn.className = "gl-accordion-toggle";
        const panel = document.createElement("div");
        panel.className = "gl-accordion-content";
        panel.style.display = "block";
        accordion.appendChild(btn);
        accordion.appendChild(panel);
        container.appendChild(accordion);
        const id = _UIEventDelegation.attachAccordionEvents(container);
        expect(id).toBeTruthy();
        btn.click();
        expect(panel.style.display).toBe("none");
        btn.click();
        expect(panel.style.display).toBe("block");
        _UIEventDelegation.cleanupAllListeners();
    });
});
