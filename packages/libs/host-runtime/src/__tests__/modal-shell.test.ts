// @vitest-environment happy-dom
//
// ⚠️ Mandatory here: this package defaults to the `node` environment, and
// the shell manipulates the DOM. Without this line the eight assertions fail
// on a missing `document` — i.e. for the wrong reason, worse than an honest red.

/**
 * Guard — the modal shell holds the accessibility contract the three copies shared.
 *
 * ## What was duplicated, and what was actually at stake
 *
 * The same eleven lines were written three times — twice inside one editor module, once in the
 * confirmation dialog. The duplicate-code gate passes on them: the clone sits under its
 * threshold, and each copy reads as ordinary DOM assembly.
 *
 * 🛑 **What repeats is not markup, it is a CONTRACT**: an ARIA role, `aria-modal`, a focus trap
 * that dismisses on Escape, focus landing inside the panel, and a teardown that deactivates the
 * trap *before* detaching the node. A fourth modal written by hand gets the markup right and
 * drops one of those five — silently, because nothing compares modals with each other.
 *
 * ⚠️ **The ordering assertion below is not decorative.** Extracting this shell nearly introduced
 * the bug it now guards: the first version attached the panel and activated the trap
 * immediately, leaving the caller to fill it afterwards. A trap activated on an empty panel
 * focuses nothing — it picks the first focusable element *at activation time*, and there was
 * none. Taking the content as a callback is what makes that unrepresentable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createModalShell } from "../ui/modal-shell.js";

afterEach(() => {
    document.body.innerHTML = "";
});

/** A panel with one button, so focus has somewhere to land. */
const withButton = (label = "ok") =>
    function fill(panel: HTMLElement): void {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        panel.appendChild(b);
    };

describe("modal shell", () => {
    it("attaches an overlay carrying a panel, in the document", () => {
        const shell = createModalShell({ fill: withButton() });
        expect(document.body.contains(shell.overlay)).toBe(true);
        expect(shell.overlay.contains(shell.panel)).toBe(true);
        expect(shell.overlay.className).toContain("gl-form-modal-overlay");
        expect(shell.panel.className).toContain("gl-form-modal-panel");
    });

    it("declares the accessibility contract: role and aria-modal", () => {
        const shell = createModalShell({ fill: withButton() });
        expect(shell.panel.getAttribute("role")).toBe("dialog");
        expect(shell.panel.getAttribute("aria-modal")).toBe("true");
    });

    it("honours `alertdialog` when the modal interrupts rather than presents", () => {
        const shell = createModalShell({ role: "alertdialog", fill: withButton() });
        expect(shell.panel.getAttribute("role")).toBe("alertdialog");
    });

    it("appends the caller's panel classes beside the base one", () => {
        const shell = createModalShell({ panelClass: "gl-x-thing", fill: withButton() });
        expect(shell.panel.className).toBe("gl-form-modal-panel gl-x-thing");
    });

    it("FILLS BEFORE TRAPPING — focus lands on the caller's content, not nowhere", () => {
        // The bug this refactor nearly shipped: a trap activated on an empty panel picks the
        // first focusable element at activation time, and there is none.
        const shell = createModalShell({ fill: withButton("go") });
        const btn = shell.panel.querySelector("button");
        expect(btn).not.toBeNull();
        expect(
            document.activeElement,
            "le piège a été activé avant que le panneau ne soit rempli : il n'avait rien à " +
                "focaliser, et l'utilisateur au clavier se retrouve hors de la modale."
        ).toBe(btn);
    });

    it("close() detaches the overlay, and is idempotent", () => {
        const shell = createModalShell({ fill: withButton() });
        shell.close();
        expect(document.body.contains(shell.overlay)).toBe(false);
        expect(() => shell.close()).not.toThrow();
    });

    it("close() deactivates the trap BEFORE detaching — order, not sequence", () => {
        // Deactivating after removal leaves the trap restoring focus to a detached node. The
        // three copies had it right; the point of the shell is that a fourth cannot get it wrong.
        //
        // 🛑 **The FIRST version of this assertion did not bite**, and it
        // measured the wrong instant: it noted, at removal time, whether the
        // panel was still attached — true of BOTH orders, since removal is
        // precisely what detaches it. Swapping `close()`'s two lines left it
        // green. What must be observed is the DEACTIVATION, and it is
        // observed through its public effect: a deactivated trap no longer
        // answers Escape.
        const onDismiss = vi.fn();
        const shell = createModalShell({ onDismiss, fill: withButton() });

        let trapStillLive: boolean | null = null;
        const realRemove = shell.overlay.remove.bind(shell.overlay);
        vi.spyOn(shell.overlay, "remove").mockImplementation(() => {
            const before = onDismiss.mock.calls.length;
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            trapStillLive = onDismiss.mock.calls.length > before;
            realRemove();
        });

        shell.close();
        expect(
            trapStillLive,
            "le piège répondait encore à Échap au moment du retrait de l'overlay : il est donc " +
                "désactivé APRÈS, et il rendra le focus à un nœud détaché."
        ).toBe(false);
    });

    it("Escape dismisses: the callback runs and the overlay goes", () => {
        const onDismiss = vi.fn();
        const shell = createModalShell({ onDismiss, fill: withButton() });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(document.body.contains(shell.overlay)).toBe(false);
    });
});
