/**
 * renewal-retry.test.ts — the relaunch's mechanics, against a store double.
 *
 * The observable chains (network back → renewed → queue resumed) live in
 * `session-outage.test.ts`, on the real store. What is pinned here needs to steer the store
 * precisely: a renewal ALREADY in flight when the event comes, triggers that coincide, and a
 * second copy of the module on the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Outcome =
    | { verdict: "renewed"; token: string }
    | { verdict: "refused"; presented: string }
    | { verdict: "unavailable" | "absent" | "superseded" };

const BASE = "https://api.example.com";

const store = vi.hoisted(() => ({
    inflightRefresh: vi.fn<(baseUrl: string) => Promise<Outcome> | null>(),
    forceRefresh:
        vi.fn<(baseUrl: string, options?: { bypassPause?: boolean }) => Promise<Outcome>>(),
    declareSessionDead:
        vi.fn<(baseUrl: string, presented: string, message: string) => Promise<boolean>>(),
}));

vi.mock("../token-store.js", () => ({ TokenStore: store }));

type RetryModule = typeof import("../renewal-retry.js");

/** Lets the listener and the retry it started run to completion. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("la relance — ce qu'un déclencheur fait du renouvellement en vol", () => {
    let retry: RetryModule;

    beforeEach(async () => {
        vi.clearAllMocks();
        store.inflightRefresh.mockReturnValue(null);
        store.forceRefresh.mockResolvedValue({ verdict: "unavailable" });
        store.declareSessionDead.mockResolvedValue(true);
        retry = await import("../renewal-retry.js");
    });

    afterEach(() => {
        retry.disarmRenewalRetry();
    });

    it("🛑 un renouvellement en vol qui a renouvelé suffit : pas de nouvelle tentative", async () => {
        store.inflightRefresh.mockReturnValue(Promise.resolve({ verdict: "renewed", token: "t" }));
        retry.armRenewalRetry(BASE);

        window.dispatchEvent(new Event("online"));
        await settled();

        expect(store.forceRefresh).not.toHaveBeenCalled();
    });

    it("🛑 un renouvellement en vol qui n'a pas conclu décrit le monde d'avant : une tentative neuve, hors pause", async () => {
        store.inflightRefresh.mockReturnValue(Promise.resolve({ verdict: "unavailable" }));
        retry.armRenewalRetry(BASE);

        window.dispatchEvent(new Event("online"));
        await settled();

        expect(store.forceRefresh).toHaveBeenCalledTimes(1);
        expect(store.forceRefresh).toHaveBeenCalledWith(BASE, { bypassPause: true });
    });

    it("deux déclencheurs simultanés partagent une seule tentative", async () => {
        let answer!: (outcome: Outcome) => void;
        store.forceRefresh.mockReturnValue(new Promise<Outcome>((resolve) => (answer = resolve)));
        retry.armRenewalRetry(BASE);

        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
        answer({ verdict: "unavailable" });
        await settled();

        expect(store.forceRefresh).toHaveBeenCalledTimes(1);
    });

    it("un refus déclare la session morte pour le jeton refusé, et la relance se tait", async () => {
        store.forceRefresh.mockResolvedValue({ verdict: "refused", presented: "old.token.sig" });
        retry.armRenewalRetry(BASE);

        window.dispatchEvent(new Event("online"));
        await settled();
        window.dispatchEvent(new Event("online"));
        await settled();

        expect(store.declareSessionDead).toHaveBeenCalledWith(
            BASE,
            "old.token.sig",
            expect.any(String)
        );
        expect(store.forceRefresh).toHaveBeenCalledTimes(1);
    });

    it("🛑 armée par deux copies du module, un seul renouvellement par événement", async () => {
        // The handle lives on the global: the second copy's `arm` releases the first copy's
        // listeners, which a module-scoped handle could not reach.
        retry.armRenewalRetry(BASE);
        vi.resetModules();
        const second: RetryModule = await import("../renewal-retry.js");
        second.armRenewalRetry(BASE);

        window.dispatchEvent(new Event("online"));
        await settled();

        expect(store.forceRefresh).toHaveBeenCalledTimes(1);
        second.disarmRenewalRetry();
    });
});
