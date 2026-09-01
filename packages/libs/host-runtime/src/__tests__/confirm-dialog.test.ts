// @vitest-environment happy-dom
/*!
 * Tests — `confirmDialog`, the shared confirmation box
 *
 * ⚠️ The environment annotation above is MANDATORY here, and it arrived with
 * the file: `field-renderer` has happy-dom by default, `host-runtime` has
 * `node` — deliberately, so `host.test.ts` can observe the real absence of
 * `window`. Without it, this suite's 12 cases fall into
 * `ReferenceError: document is not defined`. The idiom already used by
 * `drag.test.ts` and `tooltip.test.ts`.
 *
 * 🛑 **WHY THIS FILE IS BORN NOW, AND NOT BEFORE.** `confirmDialog` is
 * exported by a PUBLISHED package and already serves `offline-ui`; it had
 * **no test**. Switching `editor/modal/delete-confirm-modal.ts` (97 lines,
 * identical DOM and classes) over to it deleted **7 tests** — including the
 * only coverage of a **destructive** action. Deleting them without porting
 * would have traded a tested reimplementation for an untested factoring: the
 * duplication would have gone, and the guarantee with it.
 *
 * ⚠️ The assertions are **ported**, not reinvented: most come from the
 * deleted modal's tests. Added on top is what `confirmDialog` does **extra**
 * — `role="alertdialog"`, backdrop click, initial focus on the
 * non-destructive action.
 *
 * 🛑 **TWO OF THESE GUARDS WERE SEEN GREEN UNDER MUTATION, AND THEY ARE
 * ANNOTATED AS SUCH** rather than rewritten to pretend. The `settled` flag is
 * not observable (`resolve()` is idempotent), and the explicit
 * `btnCancel.focus()` is redundant with `trap.activate()`. The comments in
 * place say so, and the focus test was strengthened on the invariant that
 * does bite: the ORDER of the two buttons in the DOM.
 */
import { describe, it, expect, afterEach } from "vitest";
import { confirmDialog } from "../ui/confirm-dialog.js";

const OPTS = {
    title: "Confirmation de suppression",
    message: "Cette action est irréversible.",
    confirmLabel: "Supprimer définitivement",
    cancelLabel: "Annuler",
};

const overlay = () => document.body.querySelector(".gl-form-modal-overlay");
const btn = (cls: string) => document.body.querySelector<HTMLButtonElement>(`.${cls}`)!;

afterEach(() => {
    document.body.querySelectorAll(".gl-form-modal-overlay").forEach((el) => el.remove());
});

describe("confirmDialog — le montage", () => {
    it("monte l'overlay dans document.body", () => {
        void confirmDialog(OPTS);
        expect(overlay()).not.toBeNull();
    });

    it("rend le titre, le message et les deux libellés passés", () => {
        void confirmDialog(OPTS);
        expect(document.body.querySelector(".gl-form-modal__delete-title")?.textContent).toBe(
            OPTS.title
        );
        expect(document.body.querySelector(".gl-form-modal__delete-body")?.textContent).toBe(
            OPTS.message
        );
        expect(btn("gl-form-modal__btn-delete").textContent).toBe(OPTS.confirmLabel);
        expect(btn("gl-form-modal__btn-cancel").textContent).toBe(OPTS.cancelLabel);
    });

    it("omet le titre quand il n'est pas fourni", () => {
        const { title: _drop, ...rest } = OPTS;
        void confirmDialog(rest);
        expect(document.body.querySelector(".gl-form-modal__delete-title")).toBeNull();
        expect(document.body.querySelector(".gl-form-modal__delete-body")).not.toBeNull();
    });

    it("🛑 annonce une ALERTE modale, pas un simple dialogue", () => {
        // `alertdialog` is what the local version lacked: a screen reader
        // interrupts on it, which a destructive confirmation must do.
        void confirmDialog(OPTS);
        const panel = document.body.querySelector(".gl-form-modal-panel")!;
        expect(panel.getAttribute("role")).toBe("alertdialog");
        expect(panel.getAttribute("aria-modal")).toBe("true");
    });
});

describe("confirmDialog — les issues", () => {
    it("le bouton de confirmation résout `true` et retire l'overlay", async () => {
        const p = confirmDialog(OPTS);
        btn("gl-form-modal__btn-delete").click();
        await expect(p).resolves.toBe(true);
        expect(overlay()).toBeNull();
    });

    it("le bouton d'annulation résout `false` et retire l'overlay", async () => {
        const p = confirmDialog(OPTS);
        btn("gl-form-modal__btn-cancel").click();
        await expect(p).resolves.toBe(false);
        expect(overlay()).toBeNull();
    });

    it("Échap résout `false`", async () => {
        const p = confirmDialog(OPTS);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await expect(p).resolves.toBe(false);
    });

    it("🛑 un clic sur le FOND résout `false` — la version locale l'ignorait", async () => {
        const p = confirmDialog(OPTS);
        const ov = overlay() as HTMLElement;
        ov.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await expect(p).resolves.toBe(false);
        expect(overlay()).toBeNull();
    });

    it("🛑 un clic DANS le panneau ne ferme pas — sinon la boîte serait inutilisable", async () => {
        const p = confirmDialog(OPTS);
        const panel = document.body.querySelector(".gl-form-modal-panel") as HTMLElement;
        panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(overlay()).not.toBeNull();
        btn("gl-form-modal__btn-cancel").click();
        await p;
    });

    // ⚠️ THIS TEST DOES NOT GUARD THE `settled` FLAG, and saying so beats
    // letting it be believed: `resolve()` is idempotent by construction, so
    // removing the flag leaves this test GREEN (measured). What it holds is
    // the CONTRACT — the first answer wins, and a late Escape does not
    // reverse an already-confirmed deletion. The flag itself is defensive: it
    // avoids a second `trap.deactivate()` / `overlay.remove()`, both without
    // observable effect. Do not write a guard pretending otherwise.
    it("la première réponse gagne — Échap après un clic ne retourne pas le verdict", async () => {
        const p = confirmDialog(OPTS);
        btn("gl-form-modal__btn-delete").click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await expect(p).resolves.toBe(true);
    });

    // 🛑 THE INVARIANT IS THE DOM ORDER, not the `focus()` call. Measured:
    // `trap.activate()` already does `focusable[0].focus()`, so removing the
    // explicit `btnCancel.focus()` from `confirm-dialog.ts` leaves this test
    // green. What would turn it red — the real risk — is SWAPPING the two
    // buttons: focus would then land on the destructive action. The two
    // assertions together separate the two shapes.
    it("🛑 le focus initial va sur l'action NON destructive, qui est la PREMIÈRE du DOM", () => {
        void confirmDialog(OPTS);
        const panel = document.body.querySelector(".gl-form-modal-panel")!;
        const focusables = [...panel.querySelectorAll("button")];
        expect(focusables[0]).toBe(btn("gl-form-modal__btn-cancel"));
        expect(document.activeElement).toBe(btn("gl-form-modal__btn-cancel"));
    });

    it("`destructive: false` bascule le bouton sur le style d'action neutre", () => {
        void confirmDialog({ ...OPTS, destructive: false });
        expect(document.body.querySelector(".gl-form-modal__btn-save")).not.toBeNull();
        expect(document.body.querySelector(".gl-form-modal__btn-delete")).toBeNull();
    });
});
