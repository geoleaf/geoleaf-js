/**
 * `types/gallery.ts` — couverture des branches (backlog R.2).
 *
 * Le composant le plus creux de la bibliothèque à l'ouverture de R.2 : **41,18 % de
 * branches, 36,84 % de fonctions**, pour 210 lignes. `field-renderer.test.ts` ne
 * l'exerçait que sur un seul scénario — les vignettes `javascript:` écartées au
 * side-panel (§S2.2 sécurité).
 *
 * Tout `formRender` était hors couverture : la grille d'édition, le réordonnancement
 * par glisser-déposer, la suppression, le plafond `maxCount`, le mode lecture seule et
 * les trois chemins d'ajout de fichier (rejet de validation, upload distant, URL
 * d'objet locale). Ce sont des fonctions imbriquées — c'est ce qui explique l'écart
 * entre les fonctions (36,84 %) et les lignes (68,80 %) : le module se charge, ses
 * gestionnaires ne s'exécutent pas.
 *
 * ⚠️ Fichier séparé **délibérément** : `field-renderer.test.ts` pèse 2 074 lignes pour
 * une limite projet de 700. Le plafond n'est pas gaté sur ce paquet (backlog R.16), ce
 * qui est une raison de ne pas l'aggraver, pas une permission.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { galleryComponent } from "../types/gallery.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "photos", type: "gallery", label: "Photos", ...overrides };
}

/** Un fichier image acceptable au sens de `_validateFile` (MIME dans la whitelist). */
function imageFile(name = "a.png", type = "image/png", size = 1024): File {
    const f = new File([new Uint8Array(1)], name, { type });
    // `File` ne laisse pas fixer `size` ; on le redéfinit pour piloter la garde de taille.
    Object.defineProperty(f, "size", { value: size });
    return f;
}

/** Déclenche l'ajout de fichiers par le canal réel : l'événement `change` de l'input. */
function dropFiles(root: HTMLElement, files: File[]): void {
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
}

beforeEach(() => {
    document.body.innerHTML = "";
    // happy-dom n'implémente pas createObjectURL ; le composant s'en sert pour la
    // prévisualisation locale (branche « pas d'endpoint »).
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: vi.fn(), configurable: true });
    }
    vi.spyOn(URL, "createObjectURL").mockImplementation((_b) => "blob:local/preview");
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── formRender — grille et lecture seule ────────────────────────────────────────

describe("gallery.formRender — grille", () => {
    it("traite une valeur non-tableau comme une galerie vide", () => {
        const el = galleryComponent.formRender!(
            "pas un tableau" as unknown as string[],
            field(),
            vi.fn(),
            CTX
        );

        expect(el.querySelectorAll(".gl-form-gallery__item").length).toBe(0);
    });

    it("rend un item par URL, plus l'emplacement d'ajout", () => {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            field(),
            vi.fn(),
            CTX
        );

        expect(el.querySelectorAll(".gl-form-gallery__item").length).toBe(2);
        expect(el.querySelector(".gl-form-gallery__add-slot")).not.toBeNull();
    });

    it("marque le libellé requis et le lie à l'input de fichier", () => {
        const el = galleryComponent.formRender!([], field({ required: true }), vi.fn(), CTX);
        const label = el.querySelector<HTMLLabelElement>("label.gl-form-label")!;

        expect(label.dataset.required).toBe("true");
        expect(label.htmlFor).toBe("gl-field-photos-file");
    });

    it("en lecture seule : rien n'est déplaçable, rien ne s'ajoute, rien ne se supprime", () => {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg"],
            field(),
            vi.fn(),
            CTX_RO
        );
        const item = el.querySelector<HTMLElement>(".gl-form-gallery__item")!;

        expect(item.draggable).toBe(false);
        expect(el.querySelector<HTMLButtonElement>(".gl-form-gallery__remove")!.disabled).toBe(
            true
        );
        expect(el.querySelector(".gl-form-gallery__add-slot")).toBeNull();
    });

    it("masque l'emplacement d'ajout une fois maxCount atteint", () => {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            field({ maxCount: 2 }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector(".gl-form-gallery__add-slot")).toBeNull();
    });

    it("le garde tant qu'on est sous maxCount", () => {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg"],
            field({ maxCount: 2 }),
            vi.fn(),
            CTX
        );

        expect(el.querySelector(".gl-form-gallery__add-slot")).not.toBeNull();
    });
});

// ─── formRender — suppression ────────────────────────────────────────────────────

describe("gallery.formRender — suppression", () => {
    it("retire l'image visée et notifie la nouvelle liste", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            field(),
            onChange,
            CTX
        );

        el.querySelectorAll<HTMLButtonElement>(".gl-form-gallery__remove")[0].click();

        expect(onChange).toHaveBeenCalledWith(["https://example.com/b.jpg"]);
        expect(el.querySelectorAll(".gl-form-gallery__item").length).toBe(1);
    });

    it("fait réapparaître l'emplacement d'ajout en repassant sous maxCount", () => {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            field({ maxCount: 2 }),
            vi.fn(),
            CTX
        );
        expect(el.querySelector(".gl-form-gallery__add-slot")).toBeNull();

        el.querySelectorAll<HTMLButtonElement>(".gl-form-gallery__remove")[0].click();

        expect(el.querySelector(".gl-form-gallery__add-slot")).not.toBeNull();
    });

    it("notifie une COPIE, pas la liste interne", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            field(),
            onChange,
            CTX
        );

        el.querySelectorAll<HTMLButtonElement>(".gl-form-gallery__remove")[0].click();
        const first = onChange.mock.calls[0][0] as string[];
        el.querySelectorAll<HTMLButtonElement>(".gl-form-gallery__remove")[0].click();

        // Si la même référence était rendue deux fois, `first` aurait été vidé par le
        // second splice — l'appelant qui garde la valeur verrait son état muter sous lui.
        expect(first).toEqual(["https://example.com/b.jpg"]);
    });
});

// ─── formRender — réordonnancement ───────────────────────────────────────────────

describe("gallery.formRender — glisser-déposer", () => {
    /** Rend la grille et retourne ses items, la liste d'origine étant à 3 entrées. */
    function threeItems(onChange = vi.fn()) {
        const el = galleryComponent.formRender!(
            ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
            field(),
            onChange,
            CTX
        );
        return {
            el,
            onChange,
            items: [...el.querySelectorAll<HTMLElement>(".gl-form-gallery__item")],
        };
    }

    it("déplace l'image tirée à l'index de celle survolée", () => {
        const { items, onChange } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        items[2].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).toHaveBeenCalledWith([
            "https://example.com/b.jpg",
            "https://example.com/c.jpg",
            "https://example.com/a.jpg",
        ]);
    });

    it("un dépôt sur soi-même ne change rien", () => {
        const { items, onChange } = threeItems();

        items[1].dispatchEvent(new Event("dragstart"));
        items[1].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("un dépôt sans tirage préalable ne change rien", () => {
        const { items, onChange } = threeItems();

        items[1].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("dragend annule le tirage en cours", () => {
        const { items, onChange } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        items[0].dispatchEvent(new Event("dragend"));
        items[2].dispatchEvent(new Event("drop", { cancelable: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it("marque puis démarque l'item tiré et l'item survolé", () => {
        const { items } = threeItems();

        items[0].dispatchEvent(new Event("dragstart"));
        expect(items[0].classList.contains("is-dragging")).toBe(true);

        items[1].dispatchEvent(new Event("dragover", { cancelable: true }));
        expect(items[1].classList.contains("is-over")).toBe(true);

        items[1].dispatchEvent(new Event("dragleave"));
        expect(items[1].classList.contains("is-over")).toBe(false);

        items[0].dispatchEvent(new Event("dragend"));
        expect(items[0].classList.contains("is-dragging")).toBe(false);
    });
});

// ─── formRender — ajout de fichiers ──────────────────────────────────────────────

describe("gallery.formRender — ajout de fichiers", () => {
    it("sans endpoint : crée une URL d'objet locale et notifie", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);

        dropFiles(el, [imageFile()]);

        expect(onChange).toHaveBeenCalledWith(["blob:local/preview"]);
        expect(el.querySelectorAll(".gl-form-gallery__item").length).toBe(1);
    });

    it("refuse un type non image et affiche l'erreur sans notifier", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);

        dropFiles(el, [imageFile("doc.pdf", "application/pdf")]);

        const err = el.querySelector<HTMLElement>(".gl-form-error")!;
        expect(err.hidden).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    // 🛑 RÉÉCRIT À LA TÂCHE 5.1-d, PAS ANNULÉ — même bascule que le composant `image` :
    // `maxSizeMb` est la taille visée APRÈS compression, et le refus porte sur un plafond
    // AVANT compression (`× PRECOMPRESSION_FACTOR`).
    it("refuse un fichier au-dessus du plafond AVANT compression (maxSizeMb × 5)", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field({ maxSizeMb: 1 }), onChange, CTX);

        dropFiles(el, [imageFile("enorme.png", "image/png", 6 * 1024 * 1024)]);

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("🛑 sous le plafond, il tente la compression au lieu de refuser", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field({ maxSizeMb: 1 }), onChange, CTX);

        dropFiles(el, [imageFile("gros.png", "image/png", 2 * 1024 * 1024)]);

        // Le refus n'est PAS immédiat — c'est ce qui distingue le nouveau contrat de l'ancien.
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });

    it("un fichier rejeté n'empêche pas le suivant d'être accepté", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);

        dropFiles(el, [imageFile("doc.pdf", "application/pdf"), imageFile("ok.png")]);

        // `continue`, pas `break` : la boucle poursuit après un rejet de validation.
        expect(onChange).toHaveBeenCalledWith(["blob:local/preview"]);
    });

    it("s'arrête net une fois maxCount atteint", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field({ maxCount: 1 }), onChange, CTX);

        dropFiles(el, [imageFile("a.png"), imageFile("b.png")]);

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("avec endpoint : pousse l'URL rendue par le serveur", async () => {
        const onChange = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ url: "https://cdn.example.com/1.png" }),
            })
        );
        const el = galleryComponent.formRender!(
            [],
            field({ uploadEndpoint: "/upload" }),
            onChange,
            CTX
        );

        dropFiles(el, [imageFile()]);
        await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

        expect(onChange).toHaveBeenCalledWith(["https://cdn.example.com/1.png"]);
        vi.unstubAllGlobals();
    });

    it("avec endpoint : un échec HTTP affiche l'erreur d'upload sans notifier", async () => {
        const onChange = vi.fn();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        const el = galleryComponent.formRender!(
            [],
            field({ uploadEndpoint: "/upload" }),
            onChange,
            CTX
        );

        dropFiles(el, [imageFile()]);
        await vi.waitFor(() =>
            expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false)
        );

        expect(onChange).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("l'erreur précédente est effacée à la tentative suivante", async () => {
        const el = galleryComponent.formRender!([], field(), vi.fn(), CTX);

        dropFiles(el, [imageFile("doc.pdf", "application/pdf")]);
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(false);

        dropFiles(el, [imageFile("ok.png")]);

        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });

    it("l'emplacement d'ajout accepte aussi un dépôt direct", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);
        const slot = el.querySelector<HTMLElement>(".gl-form-gallery__add-slot")!;

        const drop = new Event("drop", { cancelable: true }) as Event & {
            dataTransfer?: { files: File[] };
        };
        drop.dataTransfer = { files: [imageFile()] };
        slot.dispatchEvent(drop);

        expect(onChange).toHaveBeenCalledWith(["blob:local/preview"]);
    });

    it("un dépôt sans dataTransfer ne fait rien", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);

        el.querySelector<HTMLElement>(".gl-form-gallery__add-slot")!.dispatchEvent(
            new Event("drop", { cancelable: true })
        );

        expect(onChange).not.toHaveBeenCalled();
    });

    it("l'emplacement marque puis démarque le survol", () => {
        const el = galleryComponent.formRender!([], field(), vi.fn(), CTX);
        const slot = el.querySelector<HTMLElement>(".gl-form-gallery__add-slot")!;

        slot.dispatchEvent(new Event("dragover", { cancelable: true }));
        expect(slot.classList.contains("is-over")).toBe(true);

        slot.dispatchEvent(new Event("dragleave"));
        expect(slot.classList.contains("is-over")).toBe(false);
    });

    it("un clic sur l'emplacement relaie vers l'input de fichier", () => {
        const el = galleryComponent.formRender!([], field(), vi.fn(), CTX);
        const input = el.querySelector<HTMLInputElement>("input[type=file]")!;

        // ⚠️ On NEUTRALISE `click()` au lieu de l'observer. L'input est un ENFANT de
        // l'emplacement : le clic relayé remonte au parent, dont le gestionnaire rappelle
        // `click()`. En navigateur cela s'arrête au premier tour — HTML pose un
        // « click in progress flag » qui fait sortir un `click()` ré-entrant. happy-dom
        // ne l'implémente pas, et la version observante de ce test tombait en
        // « Maximum call stack size exceeded ». C'est une limite d'ENVIRONNEMENT, pas un
        // défaut du composant ; le stub coupe la boucle et laisse le câblage vérifiable.
        const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

        el.querySelector<HTMLElement>(".gl-form-gallery__add-slot")!.dispatchEvent(
            new Event("click")
        );

        expect(clickSpy).toHaveBeenCalledTimes(1);
    });
});

// ─── validator ───────────────────────────────────────────────────────────────────

describe("gallery.validator", () => {
    it("accepte une galerie vide quand le champ n'est pas requis", () => {
        expect(galleryComponent.validator!([], field())).toBeNull();
    });

    it("refuse une galerie vide quand le champ est requis", () => {
        expect(galleryComponent.validator!([], field({ required: true }))).not.toBeNull();
    });

    it("accepte une galerie non vide quand le champ est requis", () => {
        expect(
            galleryComponent.validator!(["https://example.com/a.jpg"], field({ required: true }))
        ).toBeNull();
    });
});
