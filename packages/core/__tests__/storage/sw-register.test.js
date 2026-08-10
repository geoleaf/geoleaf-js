/**
 * R4 — Tests du module d'enregistrement Service Worker (sw-register.ts).
 * Mock de navigator.serviceWorker et Log.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));
import { Log } from "../../src/utils/log/index.js";

const mockRegister = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockUnregister = vi.fn().mockResolvedValue(true);

function createRegistration() {
    return {
        scope: "/",
        addEventListener: vi.fn(),
        update: mockUpdate,
        unregister: mockUnregister,
        installing: null,
        waiting: null,
        active: null,
    };
}

describe("sw-register (R4)", () => {
    let registration;
    let SWRegister;

    // Déféré PORTEUR : le hook installe `navigator.serviceWorker` avant de charger. Cible
    // inerte ou non, la séquence est voulue — `await import()` la préserve.
    beforeAll(async () => {
        if (!global.navigator) global.navigator = {};
        global.navigator.serviceWorker = {
            register: mockRegister,
            // ⚠️ AJOUTÉ à la tâche 1.4, et le manque était un trou du HARNAIS, pas du code :
            // `ServiceWorkerContainer` est un `EventTarget` dans tout navigateur réel. Le mock
            // n'en portait rien, donc `register()` jetait dès qu'on y a posé le pont
            // d'éviction. Un mock plus pauvre que la plateforme fait échouer du code juste.
            addEventListener: vi.fn(),
        };
        ({ SWRegister } = await import("../../src/kernel/storage/sw-register.js"));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        SWRegister._registration = null;
        registration = createRegistration();
        mockRegister.mockResolvedValue(registration);
    });

    describe("register", () => {
        it("returns null if serviceWorker not supported", async () => {
            const sw = global.navigator.serviceWorker;
            delete global.navigator.serviceWorker;
            const result = await SWRegister.register();
            expect(result).toBeNull();
            global.navigator.serviceWorker = sw;
        });

        it("enregistre le SW et mémorise la registration", async () => {
            const result = await SWRegister.register();
            expect(mockRegister).toHaveBeenCalledWith("sw-core.js", { scope: "/" });
            expect(result).toBe(registration);
            // ⚠️ Lu sur `_registration` et non par `getRegistration()`, retiré à la tâche
            // 3.13 avec `update()` et `unregister()` — trois membres à zéro appelant de
            // production. Ce que ce test garde n'a pas changé : la registration est
            // MÉMORISÉE, ce dont dépend l'écoute `updatefound` ci-dessous.
            expect(SWRegister._registration).toBe(registration);
        });

        it("utilise options.path et options.scope si fournis", async () => {
            await SWRegister.register({ path: "sw.js", scope: "/app/" });
            expect(mockRegister).toHaveBeenCalledWith("sw.js", { scope: "/app/" });
        });

        it("throw si l'enregistrement fails", async () => {
            mockRegister.mockRejectedValue(new Error("Failed"));
            await expect(SWRegister.register()).rejects.toThrow("Failed");
        });
    });

    // ⚠️ LES BLOCS `update`, `unregister` ET `getRegistration` SONT RETIRÉS (tâche 3.13) —
    // les trois membres n'avaient aucun appelant de production, et leurs tests les auraient
    // donc SURVÉCUS (compteur C6).
    //
    // 🛑 Ce qui rend le retrait sûr et non optimiste : la désinscription réelle ne passait
    // pas par `unregister()`. `capabilities/pwa/lifecycle.ts` (`_unregisterAll`) itère
    // `navigator.serviceWorker.getRegistrations()` et désinscrit tout, sans jamais lire
    // `_registration` — deux chemins de désinscription, un seul qui s'exécutait, et celui
    // qui reste ne dépendait en rien de celui qui part. Ses tests vivent dans
    // `__tests__/capabilities/pwa-offline-installers.test.js`.

    describe("updatefound listener", () => {
        it("ne plante pas quand installing est null", async () => {
            registration.installing = null;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            expect(updatefoundCb).toBeDefined();
            expect(() => updatefoundCb()).not.toThrow();
        });

        it("ne log pas quand newWorker.state n'est pas activated", async () => {
            const newWorker = { state: "installing", addEventListener: vi.fn() };
            registration.installing = newWorker;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            updatefoundCb();
            const stateChangeCb = newWorker.addEventListener.mock.calls[0]?.[1];
            if (stateChangeCb) stateChangeCb();
            expect(Log.info).not.toHaveBeenCalledWith(expect.stringContaining("activated"));
        });

        it("log info quand newWorker.state est activated", async () => {
            const newWorker = { state: "activated", addEventListener: vi.fn() };
            registration.installing = newWorker;
            let updatefoundCb;
            registration.addEventListener = vi.fn((event, cb) => {
                if (event === "updatefound") updatefoundCb = cb;
            });
            mockRegister.mockResolvedValue(registration);
            await SWRegister.register();
            updatefoundCb();
            const stateChangeCb = newWorker.addEventListener.mock.calls[0]?.[1];
            if (stateChangeCb) stateChangeCb();
            expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("activated"));
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Tâche 1.4 — le PONT d'éviction : ce que le worker ne peut pas dire lui-même
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🛑 CE QUE CE PONT PORTE. Un Service Worker n'a pas de `document` : il ne peut pas
// dispatcher `geoleaf:cache:evicted`. Il ne peut pas non plus importer le bus — il est copié
// tel quel dans chaque variante de déploiement, sans bundler. Sans ce pont, une éviction sous
// pression du quota d'origine — le moment précis où l'utilisateur a besoin de savoir que la
// place manque — reste dans la console d'un worker que personne n'ouvre.
//
// ⚠️ `_evictionBridgeWired` est un drapeau de MODULE : chaque cas remonte un module neuf.

describe("1.4 — pont d'éviction du Service Worker", () => {
    /** Monte un module neuf et rend le gestionnaire de message effectivement posé. */
    async function mountBridge() {
        vi.resetModules();
        const listeners = [];
        const registration = createRegistration();
        global.navigator.serviceWorker = {
            register: vi.fn().mockResolvedValue(registration),
            addEventListener: (type, cb) => listeners.push({ type, cb }),
        };
        const dispatched = [];
        const target = globalThis.document;
        const spy = vi.spyOn(target, "dispatchEvent").mockImplementation((evt) => {
            dispatched.push({ type: evt.type, detail: evt.detail });
            return true;
        });
        const { SWRegister: SW } = await import("../../src/kernel/storage/sw-register.js");
        await SW.register();
        const onMessage = listeners.find((l) => l.type === "message")?.cb;
        return { onMessage, dispatched, spy, SW };
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("un message d'éviction du worker devient `geoleaf:cache:evicted` sur `document`", async () => {
        const { onMessage, dispatched } = await mountBridge();
        expect(onMessage).toBeTypeOf("function"); // témoin : le pont est bien posé

        onMessage({
            data: {
                type: "GEOLEAF_CACHE_EVICTED",
                detail: {
                    evicted: 200,
                    totalBefore: 600,
                    totalAfter: 400,
                    store: "cache-api",
                    reason: "pressure",
                },
            },
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].type).toBe("geoleaf:cache:evicted");
        expect(dispatched[0].detail).toMatchObject({ evicted: 200, reason: "pressure" });
    });

    it("un message d'un AUTRE type ne devient rien", async () => {
        // ⚠️ `navigator.serviceWorker` reçoit les messages de tout worker du scope :
        // re-dispatcher sans discriminer ferait de n'importe quel message un signal d'éviction.
        const { onMessage, dispatched } = await mountBridge();

        onMessage({ data: { type: "SOMETHING_ELSE", detail: { evicted: 5 } } });
        onMessage({ data: null });
        onMessage({});

        expect(dispatched).toHaveLength(0);
    });

    it("une éviction à ZÉRO entrée n'émet pas", async () => {
        // Un signal vide apprend à ses écouteurs à se méfier du signal.
        const { onMessage, dispatched } = await mountBridge();

        onMessage({ data: { type: "GEOLEAF_CACHE_EVICTED", detail: { evicted: 0 } } });

        expect(dispatched).toHaveLength(0);
    });

    it("le pont n'est posé QU'UNE fois, même si `register()` est rappelé", async () => {
        // Deux écouteurs feraient deux avis pour une seule éviction.
        vi.resetModules();
        const listeners = [];
        global.navigator.serviceWorker = {
            register: vi.fn().mockResolvedValue(createRegistration()),
            addEventListener: (type, cb) => listeners.push({ type, cb }),
        };
        const { SWRegister: SW } = await import("../../src/kernel/storage/sw-register.js");
        await SW.register();
        await SW.register();
        await SW.register();

        expect(listeners.filter((l) => l.type === "message")).toHaveLength(1);
    });
});
