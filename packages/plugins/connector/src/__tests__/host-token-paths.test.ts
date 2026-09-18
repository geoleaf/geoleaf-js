/**
 * host-token-paths.test.ts — the host's token on the GeoJSON worker's path, through the hook
 * `configure()` really installs.
 *
 * The worker does not go through the page's `fetch`: the core asks a hook on the global for the
 * headers of each URL. That hook read only the plugin's token store, which the host never fills
 * in `getToken` mode — every GeoJSON layer loaded by URL left without the host's token. Tested
 * here through the hook itself, as the core calls it, so that what is pinned is the seam and not
 * one function's arguments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeIDBDouble } from "./helpers/idb-double.js";

const BASE = "https://api.example.com";
const LAYER = `${BASE}/layers/a.geojson`;
const CAPABLE = { acceptsPromise: true } as const;

type Hook = (
    url: string,
    capabilities?: { acceptsPromise?: boolean }
) => Record<string, string> | undefined | Promise<Record<string, string> | undefined>;

/** Configures the plugin fresh in `getToken` mode, and returns the hook it installed. */
async function hookFor(getToken: () => string | null | Promise<string | null>): Promise<Hook> {
    vi.resetModules();
    vi.stubGlobal("indexedDB", makeIDBDouble());
    const api = await import("../connector-api.js");
    await api.configure({ baseUrl: BASE, getToken });
    return (globalThis as { __GEOLEAF_WORKER_HEADERS_HOOK__?: Hook })
        .__GEOLEAF_WORKER_HEADERS_HOOK__!;
}

describe("le crochet de l'ouvrier GeoJSON — le jeton de l'hôte", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        delete (globalThis as { __GEOLEAF_WORKER_HEADERS_HOOK__?: unknown })
            .__GEOLEAF_WORKER_HEADERS_HOOK__;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("🛑 un getToken synchrone : l'en-tête, synchrone", async () => {
        const hook = await hookFor(() => "host.tok.1");
        expect(hook(LAYER, CAPABLE)).toEqual({ Authorization: "Bearer host.tok.1" });
    });

    it("🛑 un getToken asynchrone, cœur qui l'accepte : une promesse de l'en-tête", async () => {
        const hook = await hookFor(async () => "host.tok.1");
        const answer = hook(LAYER, CAPABLE);
        expect(answer).toBeInstanceOf(Promise);
        expect(await answer).toEqual({ Authorization: "Bearer host.tok.1" });
    });

    it("🛑 un cœur qui ne l'annonce pas ne reçoit jamais de promesse", async () => {
        // It would hand the promise to `postMessage`, which cannot clone it: the load would
        // fail where it used to leave without a token.
        const hook = await hookFor(async () => "host.tok.1");
        expect(hook(LAYER)).toBeUndefined();
    });

    it("🛑 le jeton est relu à chaque chargement — l'hôte le fait tourner, rien ne le copie", async () => {
        let token = "host.tok.1";
        const hook = await hookFor(() => token);
        expect(hook(LAYER, CAPABLE)).toEqual({ Authorization: "Bearer host.tok.1" });
        token = "host.tok.2";
        expect(hook(LAYER, CAPABLE)).toEqual({ Authorization: "Bearer host.tok.2" });
    });

    it("un getToken qui jette (hôte sans réseau) : pas d'en-tête, pas d'exception", async () => {
        let online = true;
        const hook = await hookFor(() => {
            if (!online) throw new Error("host session unreachable");
            return "host.tok.1";
        });
        online = false;
        expect(hook(LAYER, CAPABLE)).toBeUndefined();
    });

    it("un getToken qui rejette (hôte sans réseau) : une promesse de rien, jamais un rejet", async () => {
        let online = true;
        const hook = await hookFor(async () => {
            if (!online) throw new Error("host session unreachable");
            return "host.tok.1";
        });
        online = false;
        expect(await hook(LAYER, CAPABLE)).toBeUndefined();
    });

    it("une URL d'une autre origine : pas d'en-tête, et l'hôte n'est pas sollicité", async () => {
        const getToken = vi.fn(() => "host.tok.1");
        const hook = await hookFor(getToken);
        getToken.mockClear();
        expect(hook("https://other.example.com/a.geojson", CAPABLE)).toBeUndefined();
        expect(getToken).not.toHaveBeenCalled();
    });
});
