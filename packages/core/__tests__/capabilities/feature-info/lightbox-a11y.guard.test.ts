/**
 * GUARD — the lightbox ANNOUNCES itself as a modal, not just behaves like one.
 *
 * 🛑 THE DEFECT IT CLOSES, AND WHY IT SURVIVED SO LONG.
 *
 * The lightbox trapped focus, closed on Escape and restored focus to the
 * trigger — it behaved as a modal **on every point except the one that
 * announces it**. It lacked `role="dialog"`, `aria-modal="true"` and an
 * accessible name. To a screen reader it was a `div`: the content behind
 * stayed announced as reachable, and nothing signalled the opening.
 *
 * ⚠️ **Not a regression: these attributes never existed.» The repo's three
 * other modals set them (`share-modal.ts`, `mobile-toolbar-sheet.ts`,
 * `field-renderer/responsive-modal.ts`); this one was the only one not to.
 *
 * ── WHY NOTHING HAD SEEN IT ─────────────────────────────────────────────────────────────────
 *
 * The lightbox's only a11y test is `e2e/05-accessibility.spec.js`,
 * **`test.skip` since forever**: `deploy-core`'s `tourism` profile carries no
 * POI with an image gallery, so the lightbox cannot be triggered there. 🛑 And
 * the selector it aims at — `[role="dialog"].gl-poi-lightbox-global` —
 * **would have found nothing even with the data**: it looked for an attribute
 * the code did not set. The skip masked two things at once, and the second
 * was the real one.
 *
 * ── THIS GUARD'S SHAPE, AND WHAT IT IS NOT ──────────────────────────────────────────────────
 *
 * ✅ **Unit, not E2E, and without demo data.** `LightboxManager` is an
 * exported class: `open()` suffices to produce the real DOM. Arbitrated on
 * 17/08/2026 — adding an image POI to `profiles/` would have modified **what
 * ships to the integrator** to satisfy a test, and `profiles/` is read
 * directly by `build-deploy.cjs`.
 *
 * ⚠️ **It does not replace an `axe` scan.** It verifies the properties `axe`
 * would flag on a `role="dialog"` — role, modality, accessible name, initial
 * focus, focus restitution — but it sweeps neither contrast, nor the real tab
 * order, nor what rendering produces in a real browser. `axe-core` is only
 * installed **transitively** via `@axe-core/playwright`: calling it here
 * would create an undeclared dependency, which the `IMPL` gate rightly
 * refuses. **The E2E thus stays owed** — what changes is that it is no longer
 * the ONLY net.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { LightboxManager } =
    await import("../../../src/capabilities/feature-info/render/lightbox.js");

/** The container `open()` sets on `document.body`. */
function conteneur(): HTMLElement | null {
    return document.querySelector(".gl-poi-lightbox-global");
}

describe("garde a11y — la lightbox est annoncée comme une modale", () => {
    let manager: InstanceType<typeof LightboxManager>;

    beforeEach(() => {
        document.body.innerHTML = "";
        manager = new LightboxManager();
    });

    afterEach(() => {
        manager.close();
        document.body.innerHTML = "";
    });

    it("précondition — `open()` pose bien un conteneur, sans quoi tout ce qui suit est vide", () => {
        expect(conteneur(), "aucune lightbox avant ouverture").toBeNull();
        manager.open("https://exemple.test/a.jpg");
        expect(
            conteneur(),
            "`open()` n'a rien posé : les assertions suivantes seraient vraies de rien"
        ).not.toBeNull();
    });

    it('porte `role="dialog"` — sans lui, un lecteur d\'écran lit un `div` ordinaire', () => {
        manager.open("https://exemple.test/a.jpg");
        expect(conteneur()?.getAttribute("role")).toBe("dialog");
    });

    it('porte `aria-modal="true"` — c\'est ce qui retire le fond du parcours', () => {
        manager.open("https://exemple.test/a.jpg");
        expect(conteneur()?.getAttribute("aria-modal")).toBe("true");
    });

    it("porte un NOM accessible non vide — un dialogue anonyme est annoncé sans objet", () => {
        manager.open("https://exemple.test/a.jpg");
        const nom = conteneur()?.getAttribute("aria-label") ?? "";
        expect(nom.trim().length, "`aria-label` vide ou absent").toBeGreaterThan(0);
    });

    it("le bouton de fermeture garde son nom accessible", () => {
        manager.open("https://exemple.test/a.jpg");
        const fermer = conteneur()?.querySelector(".gl-poi-lightbox__close");
        expect((fermer?.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(0);
    });

    it("RESTITUE le focus au déclencheur à la fermeture", () => {
        const declencheur = document.createElement("button");
        document.body.appendChild(declencheur);
        declencheur.focus();

        manager.open("https://exemple.test/a.jpg");
        manager.close();

        expect(
            document.activeElement,
            "le focus n'est pas revenu au déclencheur : l'utilisateur au clavier est éjecté en tête de page"
        ).toBe(declencheur);
    });

    it("retire le conteneur du DOM à la fermeture — pas seulement de la vue", () => {
        manager.open("https://exemple.test/a.jpg");
        manager.close();
        expect(
            conteneur(),
            'le conteneur survit à `close()` : un `role="dialog"` résiduel reste dans l\'arbre'
        ).toBeNull();
    });
});
