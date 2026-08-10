/**
 * `types/image.ts` — couverture des branches (backlog R.2).
 *
 * **31,25 % de fonctions** à l'ouverture — la valeur la plus basse du paquet. L'écart
 * avec les lignes (74,38 %) dit ce qui manquait : le module se chargeait, mais ses
 * fonctions imbriquées (`renderPreview`, `handleFile`, `showError` et les huit
 * gestionnaires de la zone de dépôt) ne s'exécutaient jamais.
 *
 * ⚠️ Fichier séparé de `field-renderer.test.ts` (2 074 l.) — voir l'en-tête de
 * `types-gallery.test.ts`.
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

/** Passe par le canal réel : l'événement `change` de l'input de fichier. */
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

// ─── formRender — aperçu ─────────────────────────────────────────────────────────

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

// ─── formRender — zone de dépôt ──────────────────────────────────────────────────

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
        // Même précaution qu'en galerie : l'input est un enfant de la zone, donc le clic
        // relayé remonte et rappellerait le relais. happy-dom n'a pas le
        // « click in progress flag » du spec HTML qui coupe la ré-entrance en navigateur.
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

// ─── formRender — chargement du fichier ──────────────────────────────────────────

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

    // 🛑 RÉÉCRIT À LA TÂCHE 5.1-d, PAS ANNULÉ. Ce test assertait « au-dessus de maxSizeMb →
    // refus ». Ce n'est plus le contrat : `maxSizeMb` est la taille visée APRÈS compression,
    // et le refus se fait sur un plafond AVANT compression (`maxSizeMb × PRECOMPRESSION_FACTOR`).
    // Le motif du changement est mesuré : une photo de téléphone pèse 4 à 12 Mo, donc le
    // plafond par défaut de 5 Mo refusait la saisie la plus ordinaire, sans recours.
    // Ce qui est asserté ici est la borne qui SUBSISTE, et elle ne dépend pas de la
    // disponibilité d'un canvas dans l'environnement de test.
    it("refuse un fichier au-dessus du plafond AVANT compression (maxSizeMb × 5)", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field({ maxSizeMb: 1 }), onChange, CTX);

        pickFile(el, imageFile("enorme.png", "image/png", 6 * 1024 * 1024));

        // Synchrone : le refus ne doit pas attendre la compression.
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("🛑 n'accepte PLUS sans broncher : sous le plafond, il tente la compression", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field({ maxSizeMb: 1 }), onChange, CTX);

        // 2 Mo avec maxSizeMb=1 : au-dessus de la cible, SOUS le plafond de 5 Mo. L'ancien
        // contrat refusait ici ; le nouveau engage la compression. On assert donc que le
        // refus n'est PAS immédiat — ce qui distingue les deux contrats sans dépendre du
        // canvas.
        pickFile(el, imageFile("gros.png", "image/png", 2 * 1024 * 1024));

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });

    it("la CIBLE par défaut est de 5 Mo, donc le plafond de refus est de 25 Mo", () => {
        const onChange = vi.fn();
        const el = imageComponent.formRender!("", field(), onChange, CTX);

        // 6 Mo : au-dessus de la cible par défaut, mais sous le plafond — plus de refus sec.
        pickFile(el, imageFile("photo.png", "image/png", 6 * 1024 * 1024));
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);

        // 26 Mo : au-delà du plafond, refus immédiat.
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

        // Le `finally` doit passer même sur le chemin d'erreur : sans lui la zone
        // resterait bloquée en « envoi en cours » après le premier échec.
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
    // La condition est `endpoint || !ctx.readOnly` : le repli n'est atteint que
    // **sans endpoint ET en lecture seule**. Les trois autres combinaisons rendent la
    // zone de dépôt — c'est ce que vérifient les deux derniers cas.

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
        // …mais l'input y est neutralisé, et le retrait aussi.
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
