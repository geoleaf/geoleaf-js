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
 *
 * 🛑 **THIS FILE USED TO CEMENT TWO OF THE DEFECTS IT WAS MEANT TO GUARD.** Its double typed
 * `updateImageUploadStatus(id, s: string)` and asserted `[["i1", "uploaded"]]` — reproducing
 * the plugin's own mistake, so no correction could ever be seen red through it. And several
 * cases asserted that a stored capture comes back as a `data:` URL, which is exactly what
 * put the base64 of the photo inside the feature's attribute and shipped it to the server
 * inside the create. A double more permissive than the surface, and assertions faithful to a
 * broken behaviour, are the two ways a suite can be green over a hole.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _setStrategy = vi.fn();
const _setResolver = vi.fn();
vi.mock("@geoleaf/field-renderer", () => ({
    setImageUploadStrategy: (fn: unknown) => _setStrategy(fn),
    setImagePreviewResolver: (fn: unknown) => _setResolver(fn),
}));
/**
 * The core's write point, reached through the storage seam.
 *
 * ⚠️ Its parameter is TYPED: `vi.fn()` alone infers an empty argument tuple, and a test that
 * reads WHAT was enqueued — which is the whole subject of the reconciliation — then cannot
 * compile.
 */
interface ApplyEditArgs {
    layerId: string;
    kind: "create" | "update" | "delete";
    localId?: string;
    feature?: unknown;
}
const _applyEdit = vi.fn(
    async (_input: ApplyEditArgs): Promise<{ entryId: string | null; refused: string | null }> => ({
        entryId: "e1",
        refused: null,
    })
);
vi.mock("../persistence/storage-seam.js", () => ({
    storageFacade: () => ({ applyEdit: _applyEdit }),
}));
const _log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("@geoleaf/host-runtime", () => ({ Log: _log }));

const {
    uploadImage,
    storeImageLocally,
    retryPendingImages,
    initImageUpload,
    destroyImageUpload,
    claimImages,
} = await import("../persistence/image-store.js");

/**
 * The token prefix, spelled out HERE on purpose: it is the contract between the attribute
 * and the store, so the test must state it rather than import whatever the module happens
 * to use — an assertion built from the subject cannot fail with it.
 */
const TOKEN = "gl-img:";

/**
 * The preview resolver, reached THROUGH `initImageUpload`'s wiring rather than imported.
 *
 * ⚠️ That is stricter, not more convenient: importing it would leave "it is registered" and
 * "it works" as two facts nothing ties together, and the registration is exactly what was
 * missing for the retry in the plugin this code came from.
 */
function wiredResolver(): (v: string) => Promise<string | null> {
    initImageUpload();
    const last = _setResolver.mock.calls.at(-1);
    if (!last) throw new Error("initImageUpload did not register a preview resolver");
    return last[0] as (v: string) => Promise<string | null>;
}

const _stored: unknown[] = [];
let _pending: unknown[] = [];
const _statusCalls: Array<[string, { uploaded: boolean; url?: string }]> = [];
const _bindCalls: Array<[string, { layerId: string; localId: string }]> = [];
let _localImages: Record<string, { blob: Blob }> = {};

function mountCore(opts: { db?: boolean; csrf?: string | null } = {}) {
    const db = {
        storeImageLocally: vi.fn((d: unknown) => {
            _stored.push(d);
            return Promise.resolve();
        }),
        getPendingImages: vi.fn(() => Promise.resolve(_pending)),
        // 🛑 THE REAL CONTRACT — `{uploaded, url?}`, an OBJECT. This double declared
        // `s: string` and the assertions below expected `"uploaded"`, so it reproduced the
        // plugin's bug instead of measuring it: the record came back written as still
        // pending, the URL was never stored, and the purge found nothing to reclaim.
        updateImageUploadStatus: vi.fn((id: string, s: { uploaded: boolean; url?: string }) => {
            _statusCalls.push([id, s]);
            return Promise.resolve();
        }),
        bindLocalImage: vi.fn((id: string, owner: { layerId: string; localId: string }) => {
            _bindCalls.push([id, owner]);
            return Promise.resolve();
        }),
        getLocalImage: vi.fn((id: string) => Promise.resolve(_localImages[id] ?? null)),
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
    _bindCalls.length = 0;
    _localImages = {};
    _setStrategy.mockClear();
    _setResolver.mockClear();
    _log.warn.mockClear();
    _applyEdit.mockClear().mockResolvedValue({ entryId: "e1", refused: null });
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
    // 🛑 THIS CASE ASSERTED THE DEFECT. It read "rend une data-URL immédiatement affichable",
    // and that data-URL went straight into the feature's attribute — so the base64 of the
    // photo travelled to the server inside the create, in a text column, while the real
    // upload's URL was obtained later and thrown away.
    it("rend un JETON stable, pas la base64 de la photo", async () => {
        mountCore();
        const value = await storeImageLocally(imageFile(), "/api/up");
        expect(value).not.toMatch(/^data:/);
        expect(value).toBe(TOKEN + (_stored[0] as { id: string }).id);
    });

    it("garde l'ADRESSE DE RETOUR : endpoint et chemin du champ", async () => {
        mountCore();
        await storeImageLocally(imageFile(), "/api/up", "properties.photo");
        const rec = _stored[0] as { endpoint: string; fieldPath: string };
        expect(rec.endpoint).toBe("/api/up");
        expect(rec.fieldPath).toBe("properties.photo");
    });

    it("`endpoint: null` est un état à part — le champ n'en déclare aucun", async () => {
        mountCore();
        await storeImageLocally(imageFile(), null, "properties.photo");
        expect((_stored[0] as { endpoint: unknown }).endpoint).toBeNull();
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

    // The data-URL survives as a LAST RESORT only: losing a capture to protect a queue is
    // the wrong arbitration on a field device. It is unreconcilable, hence not the default.
    it("🛑 retombe sur la data-URL si la base ÉCHOUE — la saisie n'est pas perdue", async () => {
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
        const value = await uploadImage(imageFile(), "/api/up");
        expect(fetch).not.toHaveBeenCalled();
        expect(value).toMatch(TOKEN);
        expect(_stored).toHaveLength(1);
    });

    it("🛑 retombe sur le stockage local quand le serveur REFUSE", async () => {
        mountCore();
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
        expect(await uploadImage(imageFile(), "/api/up")).toMatch(TOKEN);
        expect(_stored).toHaveLength(1);
    });

    it("retombe aussi quand le réseau JETTE", async () => {
        mountCore();
        vi.mocked(fetch).mockRejectedValue(new Error("network"));
        expect(await uploadImage(imageFile(), "/api/up")).toMatch(TOKEN);
    });

    // 🛑 FOUR SHIPPED LAYERS DECLARE A `widget: "image"` WITH NO `uploadEndpoint`. The
    // library answered that with `URL.createObjectURL` written into the attribute — a value
    // that dies with the document, so the photo was gone at the next reload and whatever
    // reached a server designated nothing. Same loss as the data-URL, by another route.
    it("🛑 SANS endpoint, garde quand même la photo — et ne touche pas au réseau", async () => {
        mountCore();
        const value = await uploadImage(imageFile(), null, "properties.photo");
        expect(fetch).not.toHaveBeenCalled();
        expect(value).toMatch(TOKEN);
        expect((_stored[0] as { endpoint: unknown }).endpoint).toBeNull();
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
        expect(await uploadImage(imageFile(), "/api/up")).toMatch(TOKEN);
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
            skipped: 0,
        });
        // 🛑 AN OBJECT CARRYING THE URL. This assertion read `[["i1","uploaded"]]` — the
        // literal string the plugin passed, which the core reads as `status.uploaded ===
        // undefined`: the record was rewritten as STILL PENDING, the URL was never stored,
        // and the purge (a cursor over the index at `1`) found nothing, forever. The same
        // photo therefore left again on every reconnection and every boot.
        expect(_statusCalls).toEqual([
            ["i1", { uploaded: true, url: "ok" }],
            ["i2", { uploaded: true, url: "ok" }],
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
            skipped: 0,
        });
        expect(db.updateImageUploadStatus).not.toHaveBeenCalled();
    });

    // 🛑 TWO REASONS TO SKIP, AND CONFLATING THEM COST THE WHOLE MECHANISM. `endpoint: null`
    // is a field that declared none — expected and permanent. `endpoint` MISSING where one
    // should be is a defect: the core did not persist the field, so this very `continue`
    // skipped EVERY image and the retry was a complete no-op while reporting success.
    it("🛑 SAUTE, en le disant, une image dont l'endpoint a été PERDU", async () => {
        mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]) }];
        await expect(retryPendingImages()).resolves.toEqual({
            attempted: 0,
            uploaded: 0,
            failed: 0,
            skipped: 1,
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(_log.warn).toHaveBeenCalled();
    });

    it("saute EN SILENCE une image dont le champ ne déclare aucun endpoint", async () => {
        mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: null }];
        await expect(retryPendingImages()).resolves.toMatchObject({ attempted: 0, skipped: 1 });
        expect(_log.warn).not.toHaveBeenCalled();
    });

    // --- la réconciliation ----------------------------------------------------
    //
    // 🛑 THE URL USED TO BE THROWN AWAY — `await _postToServer(...)` with no assignment — and
    // nothing could have received it anyway: the stored record referenced no feature. The
    // file reached the server and the entity never learnt where it landed.

    it("🛑 RÉCONCILIE : une entrée `update` porte l'URL serveur sur le bon champ", async () => {
        mountCore();
        _pending = [
            {
                id: "i1",
                blob: new Blob([new Uint8Array(2)]),
                endpoint: "/u",
                layerId: "candelabres",
                localId: "loc:abc",
                fieldPath: "properties.photo",
            },
        ];
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "https://srv/1.jpg" }),
        } as Response);

        await retryPendingImages();

        expect(_applyEdit).toHaveBeenCalledTimes(1);
        expect(_applyEdit.mock.calls[0]![0]).toEqual({
            layerId: "candelabres",
            kind: "update",
            localId: "loc:abc",
            feature: {
                type: "Feature",
                properties: { "properties.photo": "https://srv/1.jpg" },
            },
        });
    });

    // A photo whose feature was never bound is uploaded and kept — patching a record we
    // cannot name would be worse than leaving it unreconciled.
    it("n'écrit RIEN quand l'image ne connaît pas son entité", async () => {
        mountCore();
        _pending = [{ id: "i1", blob: new Blob([new Uint8Array(2)]), endpoint: "/u" }];
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "u" }),
        } as Response);

        await expect(retryPendingImages()).resolves.toMatchObject({ uploaded: 1 });
        expect(_applyEdit).not.toHaveBeenCalled();
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

    it("🛑 POSE AUSSI le résolveur d'aperçu — sans lui, un jeton ne s'affiche pas", () => {
        mountCore();
        initImageUpload();
        expect(_setResolver).toHaveBeenCalledTimes(1);
        expect(typeof _setResolver.mock.calls[0]![0]).toBe("function");
    });

    // 🛑 THIS MODULE NO LONGER OWNS AN `online` LISTENER, AND THE REMOVAL IS THE FIX. It had
    // one, and so did the outbox replay — the replay's registered FIRST. On reconnection the
    // queue was therefore pushed while the photos were still held locally, so the create left
    // carrying an image token no server can resolve. The retry is now SEQUENCED by the replay
    // (`beforeDrain`), inside its drain lock. The two cases that asserted the listener here
    // are replaced: the ORDER is what matters, and it is proven where the order lives.
    it("🛑 n'installe AUCUN écouteur `online` — l'ordre appartient au drain", async () => {
        const db = mountCore();
        setOnline(false);
        initImageUpload();
        db.getPendingImages.mockClear();

        setOnline(true);
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
        await Promise.resolve();

        expect(db.getPendingImages).not.toHaveBeenCalled();
    });

    it("destroy rend les deux seams à la bibliothèque", () => {
        mountCore();
        initImageUpload();
        destroyImageUpload();
        expect(_setStrategy).toHaveBeenLastCalledWith(null);
        expect(_setResolver).toHaveBeenLastCalledWith(null);
    });
});

// --- l'adresse de retour ---------------------------------------------------------

/**
 * 🛑 WHY A SEPARATE STEP AT ALL. A photo is captured while the form is open, BEFORE the
 * feature exists: off-network its client identity is only minted when the edit is enqueued.
 * Until that moment the stored image knows its field and not its feature — and an image with
 * no feature is one whose upload has nowhere to send the resulting URL back to, which is
 * exactly why that URL used to be discarded.
 */
describe("claimImages — lier les photos à leur entité", () => {
    it("lie chaque jeton trouvé dans les propriétés", async () => {
        mountCore();
        await claimImages(
            { photo: "gl-img:i1", nom: "L7", autre: "https://srv/x.jpg" },
            "candelabres",
            "loc:abc"
        );
        expect(_bindCalls).toEqual([["i1", { layerId: "candelabres", localId: "loc:abc" }]]);
    });

    it("parcourt AUSSI les galeries — un champ peut porter plusieurs photos", async () => {
        mountCore();
        await claimImages({ galerie: ["gl-img:i1", "gl-img:i2"] }, "L", "loc:a");
        expect(_bindCalls.map(([id]) => id)).toEqual(["i1", "i2"]);
    });

    it("ne lie rien sans identité — il n'y aurait pas d'adresse à écrire", async () => {
        mountCore();
        await claimImages({ photo: "gl-img:i1" }, "L", "");
        expect(_bindCalls).toHaveLength(0);
    });

    // A save must never be lost because a photo could not be bound: the photo stays
    // unreconciled and says so at the next retry, which is strictly less bad.
    it("🛑 un échec de liaison ne fait PAS échouer l'enregistrement", async () => {
        const db = mountCore();
        db.bindLocalImage.mockRejectedValueOnce(new Error("quota"));
        await expect(claimImages({ photo: "gl-img:i1" }, "L", "loc:a")).resolves.toBeUndefined();
    });
});

describe("resolveImagePreview — afficher ce qui n'est que local", () => {
    it("rend une URL d'objet pour un jeton", async () => {
        mountCore();
        _localImages["i1"] = { blob: new Blob([new Uint8Array(2)]) };
        const url = await wiredResolver()("gl-img:i1");
        expect(url).toMatch(/^blob:/);
    });

    // An ordinary server URL must come back untouched: the resolver is a supplement, not a
    // gate, and returning "" for anything it does not recognise would blank every photo
    // already stored on the server.
    it("rend `null` pour ce qui n'est pas un jeton — la valeur passe telle quelle", async () => {
        mountCore();
        await expect(wiredResolver()("https://srv/1.jpg")).resolves.toBeNull();
    });

    it("mémoïse — une galerie repeinte ne fuit pas une poignée par rendu", async () => {
        const db = mountCore();
        _localImages["i1"] = { blob: new Blob([new Uint8Array(2)]) };
        const resolve = wiredResolver();
        const a = await resolve("gl-img:i1");
        const b = await resolve("gl-img:i1");
        expect(a).toBe(b);
        expect(db.getLocalImage).toHaveBeenCalledTimes(1);
    });

    it("rend `null` quand l'image n'est plus là", async () => {
        mountCore();
        await expect(wiredResolver()("gl-img:absent")).resolves.toBeNull();
    });
});
