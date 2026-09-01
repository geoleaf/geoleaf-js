/*!
 * Tests — the adaptive compression absorbed from `addpoi`
 *
 * ⚠️ The canvas and `Image` are STUBBED explicitly here rather than left to
 * the environment. The global shim (`canvas-setup.ts`) provides `getContext`
 * but neither a `toBlob` that calls back nor an `Image` that fires `onload`
 * on a data-URL: leaning on it would send the tests down the ERROR path while
 * believing they exercise the nominal one — a green on a fiction, exactly
 * what this repo hunts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    pickCompressionQuality,
    compressImage,
    compressToFit,
    _fitWithin,
    MAX_DIMENSION,
    BASE_QUALITY,
    PRECOMPRESSION_FACTOR,
} from "../types/image-compress.js";

function imageFile(size: number, type = "image/png", name = "a.png"): File {
    const f = new File([new Uint8Array(1)], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
}

// --- the quality step (pure) ------------------------------------------------------

describe("pickCompressionQuality — le palier adaptatif", () => {
    it("garde la qualité de base sous 2× le dépassement", () => {
        expect(pickCompressionQuality(1.5e6, 1e6)).toBe(BASE_QUALITY);
    });

    it("descend à 0,7 au-delà de 2×", () => {
        expect(pickCompressionQuality(2.5e6, 1e6)).toBe(0.7);
    });

    it("descend à 0,6 au-delà de 3×", () => {
        expect(pickCompressionQuality(4e6, 1e6)).toBe(0.6);
    });

    it("🛑 les bornes sont STRICTES — pile 2× et pile 3× ne descendent pas", () => {
        // Without this, a file exactly on the bound would change step with rounding.
        expect(pickCompressionQuality(2e6, 1e6)).toBe(BASE_QUALITY);
        expect(pickCompressionQuality(3e6, 1e6)).toBe(0.7);
    });

    it("accepte une qualité de base fournie par l'appelant", () => {
        expect(pickCompressionQuality(1.1e6, 1e6, 0.95)).toBe(0.95);
    });
});

// --- the resizing (pure) ----------------------------------------------------------

describe("_fitWithin — le redimensionnement, à ratio conservé", () => {
    it("ne touche pas une image déjà sous la borne", () => {
        expect(_fitWithin(800, 600, MAX_DIMENSION)).toEqual({ width: 800, height: 600 });
    });

    it("borne le grand côté en paysage et conserve le ratio", () => {
        expect(_fitWithin(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    });

    it("borne le grand côté en portrait", () => {
        expect(_fitWithin(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 });
    });

    it("un carré RESTE carré — ma première attente disait 1440×1920, elle était fausse", () => {
        expect(_fitWithin(3000, 3000, 1920)).toEqual({ width: 1920, height: 1920 });
    });

    it("🛑 c'est le gain que la roadmap ne nommait pas — 4000×3000 perd 77 % de ses pixels", () => {
        const before = 4000 * 3000;
        const { width, height } = _fitWithin(4000, 3000, MAX_DIMENSION);
        expect((width * height) / before).toBeLessThan(0.25);
    });
});

// --- compressImage: the canvas guard ----------------------------------------------

describe("compressImage — la garde canvas", () => {
    const realCreate = document.createElement.bind(document);

    afterEach(() => {
        document.createElement = realCreate;
    });

    it("🛑 REJETTE IMMÉDIATEMENT sans contexte 2D — elle ne reste pas pendue", async () => {
        // The defect inherited from `addpoi`: the check lived INSIDE
        // `img.onload`, which never fires without a canvas. The promise
        // settled neither in success nor failure, and the upload hung with no message.
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") (el as HTMLCanvasElement).getContext = () => null;
            return el;
        }) as typeof document.createElement;

        await expect(compressImage(imageFile(1e6))).rejects.toThrow("form.error.imageCanvas");
    });

    it("rejette aussi quand getContext JETTE", async () => {
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas")
                (el as HTMLCanvasElement).getContext = () => {
                    throw new Error("not implemented");
                };
            return el;
        }) as typeof document.createElement;

        await expect(compressImage(imageFile(1e6))).rejects.toThrow("form.error.imageCanvas");
    });
});

// --- compressToFit : l'orchestration --------------------------------------------

describe("compressToFit — validation puis compression", () => {
    it("laisse passer un fichier déjà sous la cible, SANS compresser", async () => {
        const file = imageFile(500_000);
        const out = await compressToFit(file, 1);
        expect(out).toEqual({ file, compressed: false, error: null });
    });

    it("🛑 refuse un type hors whitelist AVANT toute compression", async () => {
        const out = await compressToFit(imageFile(1000, "application/pdf", "a.pdf"), 5);
        expect(out.error).toBe("form.error.imageType");
        expect(out.compressed).toBe(false);
    });

    it(`🛑 refuse au-delà du plafond avant compression (× ${PRECOMPRESSION_FACTOR})`, async () => {
        // 6 MB for a 1 MB target: beyond 5×, we do not even run the canvas.
        const out = await compressToFit(imageFile(6 * 1024 * 1024), 1);
        expect(out.error).toBe("form.error.imageSize");
        expect(out.compressed).toBe(false);
    });

    it("refuse juste AU-DESSUS du plafond", async () => {
        // ⚠️ The "exactly at the ceiling" side is NOT asserted here, and the
        // omission is deliberate: at that size the call goes to compression,
        // and in this environment `Image` never fires `onload` on a data-URL —
        // the test HUNG (10 s timeout, measured). The accepting side is
        // covered below, where `Image` is stubbed. A hanging test is not a red
        // test: it says nothing at all.
        const cap = 1 * PRECOMPRESSION_FACTOR * 1024 * 1024;
        expect((await compressToFit(imageFile(cap + 1), 1)).error).toBe("form.error.imageSize");
    });

    it("🛑 remonte la clé i18n quand la compression échoue — jamais un message en dur", async () => {
        const realCreate = document.createElement.bind(document);
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") (el as HTMLCanvasElement).getContext = () => null;
            return el;
        }) as typeof document.createElement;

        const out = await compressToFit(imageFile(2 * 1024 * 1024), 1);
        document.createElement = realCreate;

        // `addpoi` returned « Erreur de compression » here, in French and
        // hardcoded, in a published package. This lib's convention is the key,
        // like `_validateFile`.
        expect(out.error).toBe("form.error.imageCanvas");
        expect(out.error).toMatch(/^form\./);
    });
});

// --- the nominal path, with a canvas that answers ---------------------------------

describe("compressImage — le chemin nominal", () => {
    const realCreate = document.createElement.bind(document);
    const RealImage = globalThis.Image;

    beforeEach(() => {
        // An `Image` firing `onload` with chosen dimensions.
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 4000;
            height = 3000;
            set src(_v: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        globalThis.Image = FakeImage as unknown as typeof Image;
    });

    afterEach(() => {
        globalThis.Image = RealImage;
        document.createElement = realCreate;
    });

    it("🛑 dimensionne le canvas AUX DIMENSIONS BORNÉES, et demande du JPEG à la qualité voulue", async () => {
        let seen: { w: number; h: number; type?: string; quality?: number } = { w: 0, h: 0 };
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") {
                const c = el as HTMLCanvasElement;
                c.getContext = (() => ({ drawImage: vi.fn() })) as never;
                c.toBlob = ((cb: BlobCallback, type?: string, quality?: number) => {
                    seen = { w: c.width, h: c.height, ...(type && { type }), ...{ quality } };
                    cb(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
                }) as never;
            }
            return el;
        }) as typeof document.createElement;

        const out = await compressImage(imageFile(4e6, "image/jpeg", "photo.jpg"), 0.6);

        // 4000×3000 bounded to 1920 → 1920×1440. Without resizing, the canvas
        // would be 4000×3000 and the gain would stop at JPEG quality.
        expect(seen.w).toBe(1920);
        expect(seen.h).toBe(1440);
        expect(seen.type).toBe("image/jpeg");
        expect(seen.quality).toBe(0.6);
        // The original name is kept — what the user recognises server-side.
        expect(out.name).toBe("photo.jpg");
        expect(out.type).toBe("image/jpeg");
    });

    it("🛑 REFUSE une image encore trop grosse APRÈS compression", async () => {
        // Found by mutation: removing this check left the suite GREEN.
        // Without it, an unmanageable file still leaves for the server and
        // fails further on, with a less clear message and after making the network wait.
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") {
                const c = el as HTMLCanvasElement;
                c.getContext = (() => ({ drawImage: vi.fn() })) as never;
                // The canvas returns a blob STILL above the target (3 MB for
                // a 1 MB goal). ⚠️ REAL bytes: `new File([blob], …)` re-reads
                // the data length, so a `size` redefined by `defineProperty`
                // on the Blob is ignored. My first version did that, and the
                // test read 1 instead of 3 MB.
                c.toBlob = ((cb: BlobCallback) => {
                    cb(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" }));
                }) as never;
            }
            return el;
        }) as typeof document.createElement;

        const out = await compressToFit(imageFile(4 * 1024 * 1024), 1);
        expect(out.error).toBe("form.error.imageSize");
        expect(out.compressed).toBe(true);
    });

    it("✅ et l'ACCEPTE quand la compression la fait tenir — le versant que le plafond ne couvre pas", async () => {
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") {
                const c = el as HTMLCanvasElement;
                c.getContext = (() => ({ drawImage: vi.fn() })) as never;
                c.toBlob = ((cb: BlobCallback) => {
                    cb(new Blob([new Uint8Array(400 * 1024)], { type: "image/jpeg" }));
                }) as never;
            }
            return el;
        }) as typeof document.createElement;

        const out = await compressToFit(imageFile(4 * 1024 * 1024), 1);
        expect(out.error).toBeNull();
        expect(out.compressed).toBe(true);
        expect(out.file.size).toBe(400 * 1024);
    });

    it("rejette avec une clé quand toBlob rend null", async () => {
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") {
                const c = el as HTMLCanvasElement;
                c.getContext = (() => ({ drawImage: vi.fn() })) as never;
                c.toBlob = ((cb: BlobCallback) => cb(null)) as never;
            }
            return el;
        }) as typeof document.createElement;

        await expect(compressImage(imageFile(1e6))).rejects.toThrow("form.error.imageCompress");
    });
});
