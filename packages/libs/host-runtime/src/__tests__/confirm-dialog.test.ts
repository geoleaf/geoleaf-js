// @vitest-environment happy-dom
/*!
 * Tests — `confirmDialog`, la boîte de confirmation partagée
 *
 * ⚠️ L'annotation d'environnement ci-dessus est OBLIGATOIRE ici, et elle est arrivée avec le
 * fichier (S6b / B-144) : `field-renderer` a happy-dom par défaut, `host-runtime` a `node`
 * — délibérément, pour que `host.test.ts` puisse constater l'absence réelle de `window`.
 * Sans elle, les 12 cas de cette suite tombent en `ReferenceError: document is not defined`.
 * C'est l'idiome déjà utilisé par `drag.test.ts` et `tooltip.test.ts`.
 *
 * 🛑 **POURQUOI CE FICHIER NAÎT À LA TÂCHE 5.2, ET PAS AVANT.** `confirmDialog` est exportée
 * par un paquet PUBLIÉ et sert déjà `offline-ui` ; elle n'avait **aucun test**. La bascule de
 * `editor/modal/delete-confirm-modal.ts` (97 lignes, DOM et classes identiques) vers elle
 * supprimait **7 tests** — dont l'unique couverture d'une action **destructive**. Les
 * supprimer sans les porter aurait échangé une réimplémentation testée contre une
 * factorisation qui ne l'est pas : la duplication aurait disparu, la garantie aussi.
 *
 * ⚠️ Les assertions sont **portées**, pas réinventées : la plupart viennent des tests de la
 * modale supprimée. S'y ajoute ce que `confirmDialog` fait **en plus** — `role="alertdialog"`,
 * clic sur le fond, focus initial sur l'action non destructive.
 *
 * 🛑 **DEUX DE CES GARDES ONT ÉTÉ VUES VERTES SOUS MUTATION, ET ELLES SONT ANNOTÉES COMME
 * TELLES** plutôt que réécrites pour faire semblant. Le drapeau `settled` n'est pas
 * observable (`resolve()` est idempotent), et le `btnCancel.focus()` explicite est redondant
 * avec `trap.activate()`. Les commentaires en place le disent, et le test de focus a été
 * renforcé sur l'invariant qui, lui, mord : l'ORDRE des deux boutons dans le DOM.
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
        // `alertdialog` est ce que la version locale n'avait pas : un lecteur d'écran
        // l'interrompt, ce qu'une confirmation destructive doit faire.
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

    // ⚠️ CE TEST NE GARDE PAS LE DRAPEAU `settled`, et le dire vaut mieux que le laisser
    // croire : `resolve()` est idempotent par construction, donc retirer le drapeau laisse ce
    // test VERT (mesuré). Ce qu'il tient est le CONTRAT — la première réponse gagne, et un
    // Échap tardif ne retourne pas une suppression déjà confirmée. Le drapeau, lui, est
    // défensif : il évite un second `trap.deactivate()` / `overlay.remove()`, tous deux sans
    // effet observable. Ne pas écrire de garde qui prétendrait le contraire.
    it("la première réponse gagne — Échap après un clic ne retourne pas le verdict", async () => {
        const p = confirmDialog(OPTS);
        btn("gl-form-modal__btn-delete").click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await expect(p).resolves.toBe(true);
    });

    // 🛑 L'INVARIANT EST L'ORDRE DU DOM, pas l'appel à `focus()`. Mesuré : `trap.activate()`
    // fait déjà `focusable[0].focus()`, donc retirer le `btnCancel.focus()` explicite de
    // `confirm-dialog.ts` laisse ce test vert. Ce qui le ferait rougir — et c'est le vrai
    // risque — c'est d'INVERSER les deux boutons : le focus tomberait alors sur l'action
    // destructive. Les deux assertions ensemble séparent les deux formes.
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
