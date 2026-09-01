/**
 * `types/gallery.ts` — branch coverage.
 *
 * The library's hollowest component at the start: **41.18% branches, 36.84%
 * functions**, over 210 lines. `field-renderer.test.ts` only exercised it on
 * one scenario — `javascript:` thumbnails discarded at the side panel
 * (security section).
 *
 * All of `formRender` was uncovered: the edit grid, drag-and-drop
 * reordering, deletion, the `maxCount` ceiling, read-only mode and the three
 * file-add paths (validation rejection, remote upload, local object URL).
 * They are nested functions — which explains the gap between functions
 * (36.84%) and lines (68.80%): the module loads, its handlers do not run.
 *
 * ⚠️ File separate **deliberately**: `field-renderer.test.ts` weighs 2,074
 * lines against a 700-line project limit. The ceiling is not gated on this
 * package, which is a reason not to worsen it, not a permission.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FieldConfig, RenderCtx } from "../contract.js";
import { galleryComponent } from "../types/gallery.js";

const CTX: RenderCtx = { lang: "fr" };
const CTX_RO: RenderCtx = { lang: "fr", readOnly: true };

function field(overrides: Partial<FieldConfig> = {}): FieldConfig {
    return { id: "photos", type: "gallery", label: "Photos", ...overrides };
}

/** An image file acceptable to `_validateFile` (MIME in the whitelist). */
function imageFile(name = "a.png", type = "image/png", size = 1024): File {
    const f = new File([new Uint8Array(1)], name, { type });
    // `File` does not let you set `size`; we redefine it to drive the size guard.
    Object.defineProperty(f, "size", { value: size });
    return f;
}

/** Triggers the file add through the real channel: the input's `change` event. */
function dropFiles(root: HTMLElement, files: File[]): void {
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
}

beforeEach(() => {
    document.body.innerHTML = "";
    // happy-dom does not implement createObjectURL; the component uses it
    // for the local preview (the "no endpoint" branch).
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: vi.fn(), configurable: true });
    }
    vi.spyOn(URL, "createObjectURL").mockImplementation((_b) => "blob:local/preview");
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── formRender — grid and read-only ─────────────────────────────────────────────

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

        // If the same reference were returned twice, `first` would have been
        // emptied by the second splice — a caller keeping the value would see
        // its state mutate under it.
        expect(first).toEqual(["https://example.com/b.jpg"]);
    });
});

// ─── formRender — reordering ─────────────────────────────────────────────────────

describe("gallery.formRender — glisser-déposer", () => {
    /** Renders the grid and returns its items, the original list holding 3 entries. */
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

// ─── formRender — adding files ───────────────────────────────────────────────────

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

    // 🛑 REWRITTEN, NOT CANCELLED — same switch as the `image` component:
    // `maxSizeMb` is the size aimed for AFTER compression, and the refusal
    // bears on a ceiling BEFORE compression (`× PRECOMPRESSION_FACTOR`).
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

        // The refusal is NOT immediate — what tells the new contract from the old.
        expect(el.querySelector<HTMLElement>(".gl-form-error")!.hidden).toBe(true);
    });

    it("un fichier rejeté n'empêche pas le suivant d'être accepté", () => {
        const onChange = vi.fn();
        const el = galleryComponent.formRender!([], field(), onChange, CTX);

        dropFiles(el, [imageFile("doc.pdf", "application/pdf"), imageFile("ok.png")]);

        // `continue`, not `break`: the loop goes on after a validation rejection.
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

        // ⚠️ We NEUTRALISE `click()` instead of observing it. The input is a
        // CHILD of the slot: the relayed click bubbles to the parent, whose
        // handler calls `click()` again. In a browser this stops after one
        // round — HTML sets a "click in progress flag" that bails a
        // re-entrant `click()`. happy-dom does not implement it, and the
        // observing version of this test fell into "Maximum call stack size
        // exceeded". An ENVIRONMENT limit, not a component defect; the stub
        // cuts the loop and keeps the wiring verifiable.
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
