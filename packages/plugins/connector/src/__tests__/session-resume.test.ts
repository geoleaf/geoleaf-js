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
            detail: { baseUrl: "https://api.example.com" },
        })
    );

const refreshed = () =>
    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:token-refreshed", {
            detail: { baseUrl: "https://api.example.com" },
        })
    );

beforeEach(() => {
    requeueAll.mockClear();
    pushOutbox.mockClear();
    mountStorage({ requeueAll, pushOutbox });
    armSessionResume();
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

    it("un cœur absent ne fait rien jeter non plus", async () => {
        mountStorage(null);
        signIn();
        await settle();
        expect(requeueAll).not.toHaveBeenCalled();
    });

    it("🛑 désarmé, il ne répond plus — deux configurations ne doivent pas empiler deux écouteurs", async () => {
        armSessionResume();
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
