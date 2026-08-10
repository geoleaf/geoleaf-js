/*!
 * Tests — tâche 5.1-d : la compression adaptative absorbée d'`addpoi`
 *
 * ⚠️ Le canvas et `Image` sont STUBÉS explicitement ici plutôt que laissés à
 * l'environnement. Le shim global (`canvas-setup.ts`) fournit `getContext` mais ni un
 * `toBlob` qui rappelle, ni un `Image` qui déclenche `onload` sur une data-URL : s'appuyer
 * dessus ferait passer les tests par le chemin d'ERREUR en croyant éprouver le chemin
 * nominal — un vert sur une fiction, exactement ce que ce dépôt traque.
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

// --- le palier de qualité (pur) -------------------------------------------------

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
        // Sans ça, un fichier pile sur la borne changerait de palier selon l'arrondi.
        expect(pickCompressionQuality(2e6, 1e6)).toBe(BASE_QUALITY);
        expect(pickCompressionQuality(3e6, 1e6)).toBe(0.7);
    });

    it("accepte une qualité de base fournie par l'appelant", () => {
        expect(pickCompressionQuality(1.1e6, 1e6, 0.95)).toBe(0.95);
    });
});

// --- le redimensionnement (pur) -------------------------------------------------

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

// --- compressImage : la garde canvas --------------------------------------------

describe("compressImage — la garde canvas", () => {
    const realCreate = document.createElement.bind(document);

    afterEach(() => {
        document.createElement = realCreate;
    });

    it("🛑 REJETTE IMMÉDIATEMENT sans contexte 2D — elle ne reste pas pendue", async () => {
        // Le défaut hérité d'`addpoi` : la vérification y vivait DANS `img.onload`, qui ne se
        // déclenche jamais sans canvas. La promesse ne se réglait ni en succès ni en échec,
        // et le téléversement restait pendu sans message.
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
        // 6 Mo pour une cible de 1 Mo : au-delà de 5×, on ne fait même pas tourner le canvas.
        const out = await compressToFit(imageFile(6 * 1024 * 1024), 1);
        expect(out.error).toBe("form.error.imageSize");
        expect(out.compressed).toBe(false);
    });

    it("refuse juste AU-DESSUS du plafond", async () => {
        // ⚠️ Le versant « pile au plafond » n'est PAS asserté ici, et l'omission est
        // délibérée : à cette taille l'appel part en compression, et dans cet environnement
        // `Image` ne déclenche jamais `onload` sur une data-URL — le test PENDAIT (10 s de
        // timeout, mesuré). Le versant acceptant est couvert plus bas, là où `Image` est
        // stubée. Un test qui pend n'est pas un test rouge : il ne dit rien du tout.
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

        // `addpoi` rendait ici « Erreur de compression », en français et en dur, dans un
        // paquet publié. La convention de cette lib est la clé, comme `_validateFile`.
        expect(out.error).toBe("form.error.imageCanvas");
        expect(out.error).toMatch(/^form\./);
    });
});

// --- le chemin nominal, avec un canvas qui répond -------------------------------

describe("compressImage — le chemin nominal", () => {
    const realCreate = document.createElement.bind(document);
    const RealImage = globalThis.Image;

    beforeEach(() => {
        // `Image` qui déclenche `onload` avec des dimensions choisies.
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

        // 4000×3000 borné à 1920 → 1920×1440. Sans le redimensionnement, le canvas ferait
        // 4000×3000 et le gain se limiterait à la qualité JPEG.
        expect(seen.w).toBe(1920);
        expect(seen.h).toBe(1440);
        expect(seen.type).toBe("image/jpeg");
        expect(seen.quality).toBe(0.6);
        // Le nom d'origine est conservé — c'est ce que l'utilisateur reconnaît côté serveur.
        expect(out.name).toBe("photo.jpg");
        expect(out.type).toBe("image/jpeg");
    });

    it("🛑 REFUSE une image encore trop grosse APRÈS compression", async () => {
        // Trouvé par mutation : retirer ce contrôle laissait la suite VERTE. Sans lui, un
        // fichier ingérable part quand même au serveur et échoue plus loin, avec un message
        // moins clair et après avoir fait attendre le réseau.
        document.createElement = ((tag: string) => {
            const el = realCreate(tag as "canvas");
            if (tag === "canvas") {
                const c = el as HTMLCanvasElement;
                c.getContext = (() => ({ drawImage: vi.fn() })) as never;
                // Le canvas rend un blob ENCORE au-dessus de la cible (3 Mo pour 1 Mo visé).
                // ⚠️ De VRAIS octets : `new File([blob], …)` relit la longueur des données,
                // donc un `size` redéfini par `defineProperty` sur le Blob est ignoré. Ma
                // première version le faisait, et le test rendait 1 au lieu de 3 Mo.
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
