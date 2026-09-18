/**
 * The queue's way back after a session came back.
 *
 * 🛑 **NOTHING BROUGHT A SET-ASIDE CAPTURE BACK.** A dead session with the network up sends
 * the drain's head entry to quarantine under `authRequired` — a motive the contract calls
 * replayable — and the core, which knows nothing of the connector, cannot see the session
 * return. Measured on 17/09/2026: no listener of `authenticated` or `token-refreshed`, no
 * caller of `requeueAll` outside the façade. A whole tour stayed quarantined until someone
 * opened the console.
 *
 * The connector is the one that knows, so it is the one that asks — through the two public
 * gestures, with no import of the core.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { armSessionResume, disarmSessionResume } from "../session-resume.js";

const BASE = "https://api.example.com";

const requeueAll = vi.fn(async (_reason?: string) => ({ requeued: 1, refused: null }));
const pushOutbox = vi.fn(async () => ({ pushed: 1 }));

/** Mounts the core's storage façade, or a narrower one. */
function mountStorage(surface: Record<string, unknown> | null): void {
    vi.stubGlobal("GeoLeaf", surface === null ? {} : { Storage: surface });
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const signIn = () =>
    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:authenticated", {
            detail: { baseUrl: BASE },
        })
    );

const refreshed = () =>
    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:token-refreshed", {
            detail: { baseUrl: BASE },
        })
    );

beforeEach(() => {
    requeueAll.mockClear();
    pushOutbox.mockClear();
    mountStorage({ requeueAll, pushOutbox });
    armSessionResume(BASE);
});

afterEach(() => {
    disarmSessionResume();
    vi.unstubAllGlobals();
});

describe("reprise de la file après une session retrouvée", () => {
    it("🛑 une connexion réussie remet en file les saisies écartées pour session, puis draine", async () => {
        signIn();
        await settle();
        // The motive, and only it: a capture the server refused stays refused.
        expect(requeueAll).toHaveBeenCalledWith("authRequired");
        expect(pushOutbox).toHaveBeenCalledTimes(1);
    });

    it("🛑 un jeton renouvelé fait le même geste — c'est la même cause qui se lève", async () => {
        refreshed();
        await settle();
        expect(requeueAll).toHaveBeenCalledWith("authRequired");
        expect(pushOutbox).toHaveBeenCalledTimes(1);
    });

    it("draine APRÈS la remise en file, jamais avant", async () => {
        const order: string[] = [];
        requeueAll.mockImplementationOnce(async () => {
            order.push("requeue");
            return { requeued: 1, refused: null };
        });
        pushOutbox.mockImplementationOnce(async () => {
            order.push("push");
            return { pushed: 1 };
        });
        signIn();
        await settle();
        expect(order).toEqual(["requeue", "push"]);
    });

    it("un cœur sans cycle d'écriture hors ligne ne fait rien jeter", async () => {
        mountStorage({});
        signIn();
        await settle();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("🛑 le retour d'une AUTRE session ne relance rien", async () => {
        // An instance of `createConnector()`, or another copy of the plugin, renewing the session
        // of another API: the queue waits on this one.
        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:token-refreshed", {
                detail: { baseUrl: "https://other.example.org" },
            })
        );
        await settle();
        expect(requeueAll).not.toHaveBeenCalled();
        expect(pushOutbox).not.toHaveBeenCalled();
    });

    it("un cœur absent ne fait rien jeter non plus", async () => {
        mountStorage(null);
        signIn();
        await settle();
        expect(requeueAll).not.toHaveBeenCalled();
    });

    it("🛑 désarmé, il ne répond plus — deux configurations ne doivent pas empiler deux écouteurs", async () => {
        armSessionResume(BASE);
        disarmSessionResume();
        signIn();
        await settle();
        expect(requeueAll).not.toHaveBeenCalled();
    });

    it("une remise en file qui jette ne remonte pas jusqu'à l'application", async () => {
        requeueAll.mockRejectedValueOnce(new Error("magasin fermé"));
        signIn();
        await settle();
        expect(pushOutbox).not.toHaveBeenCalled();
    });
});

/**
 * A façade shaped like the core's before and after its offline engine is wired.
 *
 * Before: both gestures answer `refused: "engineUnavailable"`, as `Storage` does until the
 * offline capability loads during boot. `wire()` then resolves `whenReady()`, and — as the
 * core does at that instant — starts its own arming pass, which read the queue BEFORE any
 * requeue.
 */
function unwiredEngine() {
    let wired = false;
    let ready!: () => void;
    const readiness = new Promise<void>((resolve) => (ready = resolve));
    const calls: string[] = [];
    let armingPass: Promise<unknown> | null = null;
    let endArmingPass!: () => void;
    const requeue = vi.fn(async (reason?: string) => {
        calls.push(wired ? `requeueAll:${reason}` : "requeueAll:refused");
        return wired
            ? { ok: true, requeued: 1, skipped: 0 }
            : { ok: false, requeued: 0, skipped: 0, refused: "engineUnavailable" };
    });
    const push = vi.fn(async () => {
        if (!wired) {
            calls.push("pushOutbox:refused");
            return { attempted: 0, refused: "engineUnavailable" };
        }
        // A caller arriving mid-pass gets the RUNNING pass — the core's lock.
        if (armingPass) {
            calls.push("pushOutbox:joined-arming-pass");
            return armingPass;
        }
        calls.push("pushOutbox");
        return { attempted: 1, pushed: 1 };
    });
    const whenReady = vi.fn(() => readiness);
    return {
        surface: { requeueAll: requeue, pushOutbox: push, whenReady },
        calls,
        wire() {
            wired = true;
            armingPass = new Promise<void>((resolve) => (endArmingPass = resolve)).then(() => {
                armingPass = null;
                return { attempted: 0 };
            });
            ready();
        },
        endArmingPass: () => endArmingPass(),
    };
}

describe("reprise demandée AVANT que le moteur hors ligne soit câblé", () => {
    it("🛑 un renouvellement émis avant le câblage est rejoué quand le moteur est prêt", async () => {
        const engine = unwiredEngine();
        mountStorage(engine.surface);
        refreshed();
        await settle();
        engine.wire();
        await settle();
        engine.endArmingPass();
        await settle();
        expect(engine.calls).toContain("requeueAll:authRequired");
        expect(engine.calls.at(-1)).toBe("pushOutbox");
    });

    it("🛑 le rejeu attend la fin de la passe d'armement, qui a lu la file avant la remise en file", async () => {
        const engine = unwiredEngine();
        mountStorage(engine.surface);
        refreshed();
        await settle();
        engine.wire();
        await settle();
        expect(engine.calls).not.toContain("requeueAll:authRequired");
        engine.endArmingPass();
        await settle();
        expect(engine.calls).toEqual([
            "requeueAll:refused",
            "pushOutbox:joined-arming-pass",
            "requeueAll:authRequired",
            "pushOutbox",
        ]);
    });

    it("une seule attente par page, quel que soit le nombre de renouvellements", async () => {
        const engine = unwiredEngine();
        mountStorage(engine.surface);
        refreshed();
        await settle();
        signIn();
        await settle();
        expect(engine.surface.whenReady).toHaveBeenCalledTimes(1);
        engine.wire();
        await settle();
        engine.endArmingPass();
        await settle();
        expect(engine.calls.filter((c) => c === "requeueAll:authRequired")).toHaveLength(1);
    });

    it("désarmée avant que le moteur soit prêt, la reprise due n'est pas rejouée", async () => {
        const engine = unwiredEngine();
        mountStorage(engine.surface);
        refreshed();
        await settle();
        disarmSessionResume();
        engine.wire();
        await settle();
        engine.endArmingPass();
        await settle();
        expect(engine.calls).toEqual(["requeueAll:refused"]);
    });

    it("un cœur sans `whenReady` : un seul essai, aucun rejeu, aucune erreur", async () => {
        const engine = unwiredEngine();
        const { whenReady: _absent, ...older } = engine.surface;
        mountStorage(older);
        refreshed();
        await settle();
        engine.wire();
        await settle();
        engine.endArmingPass();
        await settle();
        expect(engine.calls).toEqual(["requeueAll:refused"]);
    });
});
