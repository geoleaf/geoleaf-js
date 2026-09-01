/*!
 * Tests — the offline image upload
 *
 * 🛑 THE CENTRAL GUARD IS THE ORPHAN ONE. In `addpoi`, `retryPendingUploads`
 * had NO production caller: `storeImageLocally` wrote field photos nothing
 * ever sent back. The absorbed module receives its caller, and that is
 * exercised here — otherwise we would have moved the hole instead of closing it.
 *
 * ⚠️ The doubles REPRODUCE the constraints: `uploaded` must be a numeric `0`
 * (a boolean is not a valid IndexedDB key and drops the record out of the
 * index), and a retry that fails must destroy NOTHING.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _setStrategy = vi.fn();
vi.mock("@geoleaf/field-renderer", () => ({
    setImageUploadStrategy: (fn: unknown) => _setStrategy(fn),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { uploadImage, storeImageLocally, retryPendingImages, initImageUpload, destroyImageUpload } =
    await import("../persistence/image-store.js");

const _stored: unknown[] = [];
let _pending: unknown[] = [];
const _statusCalls: Array<[string, string]> = [];

function mountCore(opts: { db?: boolean; csrf?: string | null } = {}) {
    const db = {
        storeImageLocally: vi.fn((d: unknown) => {
            _stored.push(d);
            return Promise.resolve();
        }),
        getPendingImages: vi.fn(() => Promise.resolve(_pending)),
        updateImageUploadStatus: vi.fn((id: string, s: string) => {
            _statusCalls.push([id, s]);
            return Promise.resolve();
        }),
        cleanUploadedImages: vi.fn(() => Promise.resolve(0)),
    };
    (globalThis as Record<string, unknown>).GeoLeaf = {
        ...(opts.db !== false && { Storage: { DB: db } }),
        Security: { CSRFToken: { getToken: () => opts.csrf ?? null } },
    };
    return db;
}

function imageFile(name = "photo.jpg"): File {
    return new File([new Uint8Array(4)], name, { type: "image/jpeg" });
}

function setOnline(v: boolean) {
    Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => {
    _stored.length = 0;
    _pending = [];
    _statusCalls.length = 0;
    _setStrategy.mockClear();
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    destroyImageUpload();
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    vi.unstubAllGlobals();
});

// --- local storage ---------------------------------------------------------------

describe("storeImageLocally — la mise de côté", () => {
    it("rend une data-URL immédiatement affichable", async () => {
        mountCore();
        const url = await storeImageLocally(imageFile(), "/api/up");
        expect(url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("🛑 écrit `uploaded: 0` — un booléen sortirait l'entrée de l'index", async () => {
        mountCore();
        await storeImageLocally(imageFile(), "/api/up");
        const rec = _stored[0] as { uploaded: unknown; blob: unknown; endpoint: string };
        expect(rec.uploaded).toBe(0);
        expect(typeof rec.uploaded).toBe("number");
        // The blob MUST be there: what was missing in the original defect
        // (a `base64` key written where the store declares `blob`), and the
        // record was unusable.
        expect(rec.blob).toBeInstanceOf(File);
        // The endpoint is kept, otherwise the retry would not know where to resend.
        expect(rec.endpoint).toBe("/api/up");
    });

    it("🛑 rend quand même la data-URL si la base ÉCHOUE — la saisie n'est pas perdue", async () => {
        const db = mountCore();
        db.storeImageLocally.mockRejectedValueOnce(new Error("quota"));
        await expect(storeImageLocally(imageFile(), "/api/up")).resolves.toMatch(/^data:/);
    });

    it("fonctionne sans magasin du tout", async () => {
        mountCore({ db: false });
        await expect(storeImageLocally(imageFile(), "/api/up")).resolves.toMatch(/^data:/);
    });
});

// --- the strategy ----------------------------------------------------------------

describe("uploadImage — réseau d'abord, local en secours", () => {
    it("rend l'URL du serveur quand le POST réussit", async () => {
        mountCore();
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "https://srv/img/1.jpg" }),
        } as Response);
        await expect(uploadImage(imageFile(), "/api/up")).resolves.toBe("https://srv/img/1.jpg");
        expect(_stored).toHaveLength(0);
    });

    it("🛑 NE TOUCHE PAS au réseau hors ligne — il stocke directement", async () => {
        mountCore();
        setOnline(false);
        const url = await uploadImage(imageFile(), "/api/up");
        expect(fetch).not.toHaveBeenCalled();
        expect(url).toMatch(/^data:/);
        expect(_stored).toHaveLength(1);
    });

    it("🛑 retombe sur le stockage local quand le serveur REFUSE", async () => {
        mountCore();
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
        await expect(uploadImage(imageFile(), "/api/up")).resolves.toMatch(/^data:/);
        expect(_stored).toHaveLength(1);
    });

    it("retombe aussi quand le réseau JETTE", async () => {
        mountCore();
        vi.mocked(fetch).mockRejectedValue(new Error("network"));
        await expect(uploadImage(imageFile(), "/api/up")).resolves.toMatch(/^data:/);
    });

    it("🛑 pose le jeton CSRF quand le core en fournit un", async () => {
        mountCore({ csrf: "tok-42" });
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "u" }),
        } as Response);
        await uploadImage(imageFile(), "/api/up");
        const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-42");
    });

    it("n'invente pas d'en-tête quand il n'y a pas de jeton", async () => {
        mountCore({ csrf: null });
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "u" }),
        } as Response);
        await uploadImage(imageFile(), "/api/up");
        expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers).toBeUndefined();
    });

    it("accepte `path` quand le serveur ne rend pas `url`", async () => {
        mountCore();
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ path: "/img/2.jpg" }),
        } as Response);
        await expect(uploadImage(imageFile(), "/api/up")).resolves.toBe("/img/2.jpg");
    });

    it("🛑 une réponse SANS url ni path est un échec, pas un succès vide", async () => {
        mountCore();
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        } as Response);
        // Returning "" would record an addressless image into the entity.
        await expect(uploadImage(imageFile(), "/api/up")).resolves.toMatch(/^data:/);
    });
});

// --- the retry -------------------------------------------------------------------

describe("retryPendingImages — l'orphelin qui reçoit son appelant", () => {
    it("téléverse les images en attente et les marque", async () => {
        const db = mountCore();
        _pending = [
            { id: "i1", blob: new Blob([new Uint8Array(2)]), filename: "a.jpg", endpoint: "/u" },
            { id: "i2", blob: new Blob([new Uint8Array(2)]), filename: "b.jpg", endpoint: "/u" },
        ];
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "ok" }),
        } as Response);

        await expect(retryPendingImages()).resolves.toEqual({
            attempted: 2,
            uploaded: 2,
            failed: 0,
        });
        expect(_statusCalls).toEqual([
            ["i1", "uploaded"],
            ["i2", "uploaded"],
        ]);
        expect(db.updateImageUploadStatus).toHaveBeenCalledTimes(2);
    });

    it("🛑 un échec LAISSE l'entrée en attente — il ne la détruit pas", async () => {
        const db = mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: "/u" }];
        vi.mocked(fetch).mockRejectedValue(new Error("boom"));

        await expect(retryPendingImages()).resolves.toEqual({
            attempted: 1,
            uploaded: 0,
            failed: 1,
        });
        expect(db.updateImageUploadStatus).not.toHaveBeenCalled();
    });

    it("🛑 SAUTE une image sans endpoint — on ne sait pas où l'envoyer", async () => {
        mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]) }];
        await expect(retryPendingImages()).resolves.toEqual({
            attempted: 0,
            uploaded: 0,
            failed: 0,
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("ne reprend pas hors réseau", async () => {
        mountCore();
        setOnline(false);
        await expect(retryPendingImages()).resolves.toBeNull();
    });

    it("rend null sans magasin", async () => {
        mountCore({ db: false });
        await expect(retryPendingImages()).resolves.toBeNull();
    });

    // --- the purge ------------------------------------------------------------
    //
    // 🛑 `local_images` had a LIVE WRITER and NO REACHABLE PURGE:
    // `cleanUploadedImages` had no caller, no facade relay, no namespace
    // exposure. The orphan crossed three sprint closures in a row. These two
    // cases are what keeps it from coming back — the second as much as the first.

    it("🛑 PURGE les images acquittées après un rejeu réussi", async () => {
        const db = mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: "/u" }];
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "ok" }),
        } as Response);

        await retryPendingImages();
        expect(db.cleanUploadedImages).toHaveBeenCalledTimes(1);
    });

    it("🛑 NE purge PAS quand rien n'a été acquitté — pas de transaction à vide", async () => {
        const db = mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: "/u" }];
        vi.mocked(fetch).mockRejectedValue(new Error("boom"));

        await expect(retryPendingImages()).resolves.toMatchObject({ uploaded: 0, failed: 1 });
        expect(db.cleanUploadedImages).not.toHaveBeenCalled();
    });

    it("un échec de purge ne fait PAS échouer la reprise — les octets repartiront", async () => {
        const db = mountCore();
        db.cleanUploadedImages.mockRejectedValueOnce(new Error("quota"));
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: "/u" }];
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "ok" }),
        } as Response);

        await expect(retryPendingImages()).resolves.toMatchObject({ uploaded: 1, failed: 0 });
    });
});

// --- the wiring ------------------------------------------------------------------

describe("initImageUpload — le câblage qui ferme l'orphelin", () => {
    it("🛑 POSE la stratégie sur field-renderer", () => {
        mountCore();
        initImageUpload();
        expect(_setStrategy).toHaveBeenCalledWith(uploadImage);
    });

    it("🛑 ARME la reprise au retour du réseau — c'est l'appelant qui manquait chez addpoi", async () => {
        const db = mountCore();
        setOnline(false);
        initImageUpload(); // hors réseau : pas de reprise opportuniste
        db.getPendingImages.mockClear();

        setOnline(true);
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
        await Promise.resolve();

        expect(db.getPendingImages).toHaveBeenCalled();
    });

    it("est idempotent — deux inits n'empilent pas d'écouteur", async () => {
        const db = mountCore();
        setOnline(false);
        initImageUpload();
        initImageUpload();
        db.getPendingImages.mockClear();

        setOnline(true);
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
        await Promise.resolve();

        expect(db.getPendingImages).toHaveBeenCalledTimes(1);
    });

    it("destroy retire l'écouteur ET rend la stratégie par défaut", async () => {
        const db = mountCore();
        setOnline(false);
        initImageUpload();
        destroyImageUpload();
        expect(_setStrategy).toHaveBeenLastCalledWith(null);

        db.getPendingImages.mockClear();
        setOnline(true);
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
        expect(db.getPendingImages).not.toHaveBeenCalled();
    });
});
