/**
 * Tests — `isDirty()` compares the form against WHAT IT WAS SEEDED WITH.
 *
 * 🛑 THE DEFECT. The bridge is built on `{...initialValues, ...computeValues(schema)}`
 * (`responsive-modal.ts`, `seedValues`), while `isDirty()` compared its values against
 * `initialValues` ALONE. Any schema carrying a `computed` field was therefore dirty the
 * instant it opened, and closing a form the user had never touched raised
 * "Êtes-vous sûr de vouloir supprimer la saisie ?".
 *
 * ⚠️ That is worse than a cosmetic annoyance: a confirmation that fires when nothing is at
 * stake is a confirmation people learn to dismiss, so it stops protecting the case it
 * exists for. The comparison must be against the same seed the bridge received.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(async () => true) }));
vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    confirmDialog: confirmMock,
}));

const { createResponsiveModal } = await import("../ui/responsive-modal.js");
const { ComponentRegistry } = await import("../registry.js");
const { textComponent } = await import("../types/text.js");
type FieldConfig = import("../contract.js").FieldConfig;

/** A schema with a `computed` field — the shape the editor really opens. */
const SCHEMA: FieldConfig[] = [
    { id: "nom", type: "text", label: "Nom" },
    { id: "longueur", type: "text", label: "Longueur", computed: "geometry.length" },
];

function stubMatchMedia(): void {
    (globalThis as any).window.matchMedia = vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    if (!(globalThis as any).matchMedia) {
        (globalThis as any).matchMedia = (globalThis as any).window.matchMedia;
    }
}

beforeEach(() => {
    ComponentRegistry.register(textComponent);
    stubMatchMedia();
    confirmMock.mockClear();
    document.body.innerHTML = "";
});
afterEach(() => vi.restoreAllMocks());

describe("isDirty — un formulaire jamais touché n'est pas sale", () => {
    it("ne demande PAS confirmation à la fermeture d'un formulaire à champ calculé, intact", async () => {
        const modal = createResponsiveModal({ confirmCancelOnDirty: true });
        modal.open({
            title: "Fiche",
            schema: SCHEMA,
            initialValues: { nom: "Câble 7" },
            computeValues: () => ({ longueur: "128 m" }),
            onSave: vi.fn(),
        });

        const panel = document.querySelector<HTMLElement>(".gl-form-modal-panel");
        panel!.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        await Promise.resolve();

        expect(confirmMock).not.toHaveBeenCalled();
    });

    it("la demande TOUJOURS quand l'utilisateur a saisi — la contre-épreuve", async () => {
        const modal = createResponsiveModal({ confirmCancelOnDirty: true });
        modal.open({
            title: "Fiche",
            schema: SCHEMA,
            initialValues: { nom: "Câble 7" },
            computeValues: () => ({ longueur: "128 m" }),
            onSave: vi.fn(),
        });

        const panel = document.querySelector<HTMLElement>(".gl-form-modal-panel");
        const input = panel!.querySelector<HTMLInputElement>("input");
        input!.value = "Câble 8";
        input!.dispatchEvent(new Event("input", { bubbles: true }));

        panel!.querySelector<HTMLButtonElement>(".gl-form-modal__btn-cancel")!.click();
        await Promise.resolve();

        expect(confirmMock).toHaveBeenCalledTimes(1);
    });
});
