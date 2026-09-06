/**
 * Tests — the form SAYS what it refuses (`field-renderer-bridge` + `responsive-modal`).
 *
 * 🛑 THE DEFECT THESE TESTS EXIST FOR. `validate()` computed the error map and never painted
 * it; `getErrors()` had ZERO production callers; and `handleSave` answered an invalid form
 * with a bare `return`. Clicking "Enregistrer" on a form missing a required field produced
 * strictly nothing on screen — the modal simply stayed open, identical. Every piece needed
 * was already there (a hidden `.gl-form-error` slot per field, its CSS, the resolved i18n
 * message, the `id → element` map): only the wiring was missing.
 *
 * ⚠️ The painting is asserted through the SLOT and the ARIA state, never through
 * `getErrors()` alone — a map that agrees with itself would pass while the user still saw
 * nothing, which is exactly the state this file is here to make impossible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFieldRendererBridge } from "../field-renderer-bridge.js";
import { createResponsiveModal } from "../ui/responsive-modal.js";
import { ComponentRegistry } from "../registry.js";
import { textComponent } from "../types/text.js";
import type { FieldConfig } from "../contract.js";

const SCHEMA: FieldConfig[] = [
    { id: "name", type: "text", label: "Nom", required: true },
    { id: "note", type: "text", label: "Note" },
];

function stubMatchMedia(matches = false): void {
    (globalThis as any).window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    if (!(globalThis as any).matchMedia) {
        (globalThis as any).matchMedia = (globalThis as any).window.matchMedia;
    }
}

/** The error slot of one field, read from the DOM the bridge produced. */
function slotOf(el: HTMLElement, fieldId: string): HTMLElement {
    const wrap = el.querySelector<HTMLElement>(`[data-gl-field="${fieldId}"]`);
    if (!wrap) throw new Error(`no wrapper for ${fieldId}`);
    const slot = wrap.querySelector<HTMLElement>(".gl-form-error");
    if (!slot) throw new Error(`no error slot for ${fieldId}`);
    return slot;
}

function controlOf(el: HTMLElement, fieldId: string): HTMLElement {
    const wrap = el.querySelector<HTMLElement>(`[data-gl-field="${fieldId}"]`);
    if (!wrap) throw new Error(`no wrapper for ${fieldId}`);
    const ctl = wrap.querySelector<HTMLElement>("input, select, textarea");
    if (!ctl) throw new Error(`no control for ${fieldId}`);
    return ctl;
}

beforeEach(() => {
    ComponentRegistry.register(textComponent);
    stubMatchMedia();
    document.body.innerHTML = "";
});
afterEach(() => vi.restoreAllMocks());

describe("validate() peint la carte d'erreurs", () => {
    it("révèle le message du champ requis vide, et laisse l'autre caché", () => {
        const bridge = createFieldRendererBridge(SCHEMA, { name: "" }, { lang: "fr" });
        expect(slotOf(bridge.el, "name").hidden).toBe(true); // rien avant validation

        expect(bridge.validate()).toBe(false);

        const slot = slotOf(bridge.el, "name");
        expect(slot.hidden).toBe(false);
        expect(slot.textContent).toBe(bridge.getErrors()["name"]);
        expect(slot.textContent?.length).toBeGreaterThan(0);
        expect(slotOf(bridge.el, "note").hidden).toBe(true);
    });

    it("pose `aria-invalid` et un `aria-describedby` qui RÉSOUT vers le message", () => {
        const bridge = createFieldRendererBridge(SCHEMA, { name: "" }, { lang: "fr" });
        document.body.appendChild(bridge.el);
        bridge.validate();

        const ctl = controlOf(bridge.el, "name");
        expect(ctl.getAttribute("aria-invalid")).toBe("true");
        const described = ctl.getAttribute("aria-describedby");
        expect(described).toBeTruthy();
        // 🛑 The pointer must RESOLVE. An `aria-describedby` naming an id that does not exist
        // is worse than none: a screen reader announces nothing and no tool says why.
        const target = document.getElementById(described as string);
        expect(target).not.toBeNull();
        expect(target?.textContent).toBe(slotOf(bridge.el, "name").textContent);

        expect(controlOf(bridge.el, "note").getAttribute("aria-invalid")).toBe("false");
    });

    it("efface la peinture dès que l'utilisateur saisit", () => {
        const bridge = createFieldRendererBridge(SCHEMA, { name: "" }, { lang: "fr" });
        bridge.validate();
        expect(slotOf(bridge.el, "name").hidden).toBe(false);

        const ctl = controlOf(bridge.el, "name") as HTMLInputElement;
        ctl.value = "Alice";
        ctl.dispatchEvent(new Event("input", { bubbles: true }));

        expect(slotOf(bridge.el, "name").hidden).toBe(true);
        expect(ctl.getAttribute("aria-invalid")).toBe("false");
        // The map follows the DOM — otherwise `getErrors()` and the screen disagree.
        expect(bridge.getErrors()["name"]).toBeNull();
    });

    it("efface la peinture à la re-validation d'un champ corrigé", () => {
        const bridge = createFieldRendererBridge(SCHEMA, { name: "" }, { lang: "fr" });
        bridge.validate();
        bridge.setValues({ name: "Alice" });
        expect(bridge.validate()).toBe(true);
        expect(slotOf(bridge.el, "name").hidden).toBe(true);
        expect(controlOf(bridge.el, "name").getAttribute("aria-invalid")).toBe("false");
    });
});

describe("« Enregistrer » ne reste plus muet", () => {
    it("peint l'erreur, donne le focus au premier champ fautif, et n'appelle PAS onSave", async () => {
        const modal = createResponsiveModal({});
        const onSave = vi.fn();
        modal.open({ title: "Fiche", schema: SCHEMA, initialValues: { name: "" }, onSave });

        const panel = document.querySelector<HTMLElement>(".gl-form-modal-panel");
        expect(panel).not.toBeNull();
        const save = panel!.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save");
        save!.click();
        await Promise.resolve();

        expect(onSave).not.toHaveBeenCalled();
        expect(slotOf(panel!, "name").hidden).toBe(false);
        expect(document.activeElement).toBe(controlOf(panel!, "name"));
        // The modal stays open: refusing is not closing.
        expect(document.querySelector(".gl-form-modal-panel")).not.toBeNull();
        modal.close();
    });

    it("un formulaire valide passe — la contre-épreuve, sans laquelle « toujours refuser » passerait", async () => {
        const modal = createResponsiveModal({});
        const onSave = vi.fn();
        modal.open({ title: "Fiche", schema: SCHEMA, initialValues: { name: "Alice" }, onSave });

        const panel = document.querySelector<HTMLElement>(".gl-form-modal-panel");
        panel!.querySelector<HTMLButtonElement>(".gl-form-modal__btn-save")!.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledTimes(1);
    });
});
