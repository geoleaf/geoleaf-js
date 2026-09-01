/**
 * `types/image.ts` — branch coverage.
 *
 * **31.25% of functions** at the start — the package's lowest value. The gap
 * with lines (74.38%) says what was missing: the module loaded, but its
 * nested functions (`renderPreview`, `handleFile`, `showError` and the drop
 * zone's eight handlers) never ran.
 *
 * ⚠️ File separate from `field-renderer.test.ts` (2,074 l.) — see the header
 * of `types-gallery.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { imageComponent } from "../types/image.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "photo", type: "image", label: "Photo", ...overrides };
}

function imageFile(name = "a.png", type = "image/png", size = 1024): File {
    const f = new File([new Uint8Array(1)], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
}

/** Goes through the real channel: the file input's `change` event. */
function pickFile(root: HTMLElement, file: File): void {
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
}

beforeEach(() => {
    document.body.innerHTML = "";
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: vi.fn(), configurable: true });
    }
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:local/preview");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ─── formRender — preview ────────────────────────────────────────────────────────

describe("image.formRender — aperçu", () => {
    it("ne rend pas d'aperçu sans valeur", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-image__preview")).toBeNull();
    });

    it("traite une valeur nulle comme une chaîne vide", () => {
        const el = imageComponent.formRender!(null as unknown as string, field(), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-image__preview")).toBeNull();
    });

    it("rend l'aperçu et son bouton de retrait quand une valeur existe", () => {
        const el = imageComponent.formRender!("https://example.com/a.jpg", field(), vi.fn(), CTX);

        expect(el.querySelector(".gl-form-image__preview")).not.toBeNull();
        expect(el.querySelector(".gl-form-image__remove")).not.toBeNull();
    });

    it("le retrait vide la valeur, notifie et efface l'aperçu", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("https://example.com/a.jpg", field(), onChange, CTX);

        el.querySelector<HTMLButtonElement>(".gl-form-image__remove")!.click();

        expect(onChange).toHaveBeenCalledWith("");
        expect(el.querySelector(".gl-form-image__preview")).toBeNull();
    });

    it("un clic sur l'aperçu ouvre la visionneuse", () => {
        const el = imageComponent.formRender!("https://example.com/a.jpg", field(), vi.fn(), CTX);
        document.body.appendChild(el);

        el.querySelector(".gl-form-image__preview")!.dispatchEvent(new Event("click"));

        expect(document.querySelector(".gl-lightbox")).not.toBeNull();
    });

    it("marque le libellé requis", () => {
        const el = imageComponent.formRender!("", field({ required: true }), vi.fn(), CTX);

        expect(el.querySelector<HTMLLabelElement>("label")!.dataset.required).toBe("true");
    });
});

// ─── formRender — drop zone ──────────────────────────────────────────────────────

describe("image.formRender — zone de dépôt", () => {
    it("est accessible au clavier", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);
        const zone = el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!;

        expect(zone.getAttribute("role")).toBe("button");
        expect(zone.getAttribute("tabindex")).toBe("0");
    });

    it("Entrée et Espace relaient vers l'input de fichier", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=file]")!;
        // Same precaution as in the gallery: the input is a child of the
        // zone, so the relayed click bubbles up and would call the relay
        // again. happy-dom lacks the HTML spec's "click in progress flag"
        // that cuts re-entrance in a browser.
        const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
        const zone = el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!;

        zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        zone.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

        expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it("une autre touche ne déclenche rien", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=file]")!;
        const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

        el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "a" })
        );

        expect(clickSpy).not.toHaveBeenCalled();
    });

    it("le clic sur la zone relaie vers l'input", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=file]")!;
        const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

        el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!.dispatchEvent(
            new Event("click")
        );

        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("marque puis démarque le survol", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);
        const zone = el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!;

        zone.dispatchEvent(new Event("dragover", { cancelable: true }));
        expect(zone.classList.contains("is-over")).toBe(true);

        zone.dispatchEvent(new Event("dragleave"));
        expect(zone.classList.contains("is-over")).toBe(false);
    });

    it("accepte un fichier déposé directement", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);
        const zone = el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!;

        const drop = new Event("drop", { cancelable: true }) as Event & {
            dataTransfer?: { files: File[] };
        };
        drop.dataTransfer = { files: [imageFile()] };
        zone.dispatchEvent(drop);

        expect(onChange).toHaveBeenCalledWith("blob:local/preview");
    });

    it("un dépôt sans fichier ne fait rien", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);

        el.querySelector<HTMLElement>(".gl-form-image__drop-zone")!.dispatchEvent(
            new Event("drop", { cancelable: true })
        );

        expect(onChange).not.toHaveBeenCalled();
    });

    it("un change sans fichier ne fait rien", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=file]")!;

        Object.defineProperty(input, "files", { value: [], configurable: true });
        input.dispatchEvent(new Event("change"));

        expect(onChange).not.toHaveBeenCalled();
    });
});

// ─── formRender — file loading ───────────────────────────────────────────────────

describe("image.formRender — chargement", () => {
    it("sans endpoint : crée une URL d'objet et rend l'aperçu", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);

        pickFile(el, imageFile());

        expect(onChange).toHaveBeenCalledWith("blob:local/preview");
        expect(el.querySelector(".gl-form-image__preview")).not.toBeNull();
    });

    it("refuse un type hors whitelist sans notifier", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);

        pickFile(el, imageFile("doc.pdf", "application/pdf"));

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    // 🛑 REWRITTEN, NOT CANCELLED. This test asserted "above maxSizeMb →
    // refusal". That is no longer the contract: `maxSizeMb` is the size aimed
    // for AFTER compression, and the refusal happens on a ceiling BEFORE
    // compression (`maxSizeMb × PRECOMPRESSION_FACTOR`). The change's motive
    // is measured: a phone photo weighs 4 to 12 MB, so the default 5 MB
    // ceiling refused the most ordinary capture, with no recourse. What is
    // asserted here is the bound that REMAINS, and it does not depend on a
    // canvas being available in the test environment.
    it("refuse un fichier au-dessus du plafond AVANT compression (maxSizeMb × 5)", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field({ maxSizeMb: 1 }), onChange, CTX);

        pickFile(el, imageFile("enorme.png", "image/png", 6 * 1024 * 1024));

        // Synchronous: the refusal must not wait for the compression.
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("🛑 n'accepte PLUS sans broncher : sous le plafond, il tente la compression", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field({ maxSizeMb: 1 }), onChange, CTX);

        // 2 MB with maxSizeMb=1: above the target, UNDER the 5 MB ceiling.
        // The old contract refused here; the new one starts compression. We
        // therefore assert the refusal is NOT immediate — which tells the two
        // contracts apart without depending on the canvas.
        pickFile(el, imageFile("gros.png", "image/png", 2 * 1024 * 1024));

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });

    it("la CIBLE par défaut est de 5 Mo, donc le plafond de refus est de 25 Mo", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);

        // 6 MB: above the default target, but under the ceiling — no more outright refusal.
        pickFile(el, imageFile("photo.png", "image/png", 6 * 1024 * 1024));
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);

        // 26 MB: beyond the ceiling, immediate refusal.
        const el2 = imageComponent.formRender!("", field(), onChange, CTX);
        pickFile(el2, imageFile("enorme.png", "image/png", 26 * 1024 * 1024));
        expect(el2.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
    });

    it("avec endpoint : pousse l'URL du serveur et retire l'état d'envoi", async () => {
        const onChange = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ url: "https://cdn.example.com/1.png" }),
            })
        );
        const el = imageComponent.formRender!(
            "",
            field({ uploadEndpoint: "/upload" }),
            onChange,
            CTX
        );

        pickFile(el, imageFile());
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

        expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/1.png");
        expect(
            el.querySelector(".gl-form-image__drop-zone")!.classList.contains("is-uploading")
        ).toBe(false);
    });

    it("avec endpoint : un échec affiche l'erreur ET retire l'état d'envoi", async () => {
        const onChange = vi.fn();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        const el = imageComponent.formRender!(
            "",
            field({ uploadEndpoint: "/upload" }),
            onChange,
            CTX
        );

        pickFile(el, imageFile());
        await vi.waitFor(() =>
            expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false)
        );

        // The `finally` must run even on the error path: without it the zone
        // would stay stuck on "sending" after the first failure.
        expect(
            el.querySelector(".gl-form-image__drop-zone")!.classList.contains("is-uploading")
        ).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("une erreur précédente est effacée par un fichier valide", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX);

        pickFile(el, imageFile("doc.pdf", "application/pdf"));
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);

        pickFile(el, imageFile("ok.png"));

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });
});

// ─── formRender — repli champ texte ──────────────────────────────────────────────

describe("image.formRender — repli sur saisie d'URL", () => {
    // The condition is `endpoint || !ctx.readOnly`: the fallback is only
    // reached **with no endpoint AND read-only**. The other three
    // combinations render the drop zone — what the last two cases verify.

    it("rend un input url en lecture seule sans endpoint", () => {
        const el = imageComponent.formRender!(
            "https://example.com/a.jpg",
            field(),
            vi.fn(),
            CTX_RO
        );
        const input = el.querySelector<HTMLInputElement>("input[type=url]")!;

        expect(input).not.toBeNull();
        expect(input.disabled).toBe(true);
        expect(input.value).toBe("https://example.com/a.jpg");
        expect(el.querySelector(".gl-form-image__drop-zone")).toBeNull();
    });

    it("lie le libellé à l'input url", () => {
        const el = imageComponent.formRender!("", field(), vi.fn(), CTX_RO);

        expect(el.querySelector<HTMLLabelElement>("label")!.htmlFor).toBe("gl-field-photo-url");
    });

    it("la saisie met à jour la valeur et l'aperçu", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX_RO);
        const input = el.querySelector<HTMLInputElement>("input[type=url]")!;

        input.value = "https://example.com/b.jpg";
        input.dispatchEvent(new Event("input"));

        expect(onChange).toHaveBeenCalledWith("https://example.com/b.jpg");
        expect(el.querySelector(".gl-form-image__preview")).not.toBeNull();
    });

    it("garde la zone de dépôt en lecture seule DÈS QU'un endpoint est déclaré", () => {
        const el = imageComponent.formRender!(
            "",
            field({ uploadEndpoint: "/upload" }),
            vi.fn(),
            CTX_RO
        );

        expect(el.querySelector(".gl-form-image__drop-zone")).not.toBeNull();
        // …but the input is neutralised there, and so is removal.
        expect(el.querySelector<HTMLInputElement>("input[type=file]")!.disabled).toBe(true);
    });

    it("désactive le bouton de retrait en lecture seule", () => {
        const el = imageComponent.formRender!(
            "https://example.com/a.jpg",
            field({ uploadEndpoint: "/upload" }),
            vi.fn(),
            CTX_RO
        );

        expect(el.querySelector<HTMLButtonElement>(".gl-form-image__remove")!.disabled).toBe(true);
    });
});

// ─── validator ───────────────────────────────────────────────────────────────────

describe("image.validator", () => {
    it("accepte une valeur vide quand le champ n'est pas requis", () => {
        expect(imageComponent.validator!("", field())).toBeNull();
    });

    it("refuse une valeur vide quand le champ est requis", () => {
        expect(imageComponent.validator!("", field({ required: true }))).not.toBeNull();
    });

    it("accepte une URL quand le champ est requis", () => {
        expect(
            imageComponent.validator!("https://example.com/a.jpg", field({ required: true }))
        ).toBeNull();
    });
});
