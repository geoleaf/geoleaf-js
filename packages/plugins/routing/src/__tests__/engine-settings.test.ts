/**
 * Unit tests — `configure()`: the door a key comes through.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const warnMock = vi.fn();
vi.mock("@geoleaf/host-runtime", () => ({
    Log: { warn: (...a: unknown[]) => warnMock(...a) },
    coreConfigGet: () => undefined,
}));

const { setEngineSettings, getEngineSettings } = await import("../engine-settings.js");
const { createProvider, registerProvider, resolveEndpoint } = await import("../provider.js");
const { createValhallaProvider } = await import("../providers/valhalla.js");
const { createOsrmProvider } = await import("../providers/osrm.js");

const REQUEST = {
    waypoints: [
        { coordinates: [55.45, -20.88] as const },
        { coordinates: [55.48, -21.33] as const },
    ],
    profile: "car" as const,
};

beforeEach(() => {
    warnMock.mockClear();
    setEngineSettings(null);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("setEngineSettings", () => {
    it("retient l'adresse et les paramètres", () => {
        const settings = { endpoint: "https://moteur.example", query: { api_key: "k" } };
        expect(setEngineSettings(settings)).toBe(true);
        expect(getEngineSettings()).toEqual(settings);
    });

    it("`null` efface", () => {
        setEngineSettings({ query: { api_key: "k" } });
        expect(setEngineSettings(null)).toBe(true);
        expect(getEngineSettings()).toBeNull();
    });

    it.each([
        ["une adresse http", { endpoint: "http://moteur.example" }],
        ["une adresse avec identifiants", { endpoint: "https://u:p@moteur.example" }],
        ["un paramètre non textuel", { query: { api_key: 1 } }],
        ["un paramètre réservé", { query: { steps: "false" } }],
        ["autre chose qu'un objet", "https://moteur.example"],
    ])("🛑 refuse %s, et rien n'est appliqué", (_label, input) => {
        setEngineSettings({ query: { api_key: "ancienne" } });
        expect(setEngineSettings(input)).toBe(false);
        expect(getEngineSettings()).toEqual({ query: { api_key: "ancienne" } });
    });

    it("🛑 un refus nomme le CHAMP, jamais sa valeur", () => {
        setEngineSettings({ endpoint: "http://moteur.example", query: { api_key: "secret" } });
        expect(warnMock).toHaveBeenCalledTimes(1);
        expect(String(warnMock.mock.calls[0]![0])).toContain("endpoint");
        expect(String(warnMock.mock.calls[0]![0])).not.toContain("secret");
    });
});

describe("l'adresse et la clé arrivent au moteur", () => {
    it("l'adresse donnée à l'exécution passe avant celle du profil", () => {
        setEngineSettings({ endpoint: "https://moteur.example" });
        expect(resolveEndpoint({ endpoint: "https://profil.example" } as never)).toBe(
            "https://moteur.example"
        );
    });

    it("le fournisseur reçoit les paramètres", () => {
        const factory = vi.fn(() => ({ id: "x", attribution: "x", route: vi.fn() }));
        registerProvider("x", factory);
        setEngineSettings({ query: { api_key: "k" } });
        createProvider({ provider: "x", endpoint: "https://moteur.example" } as never);
        expect(factory).toHaveBeenCalledWith("https://moteur.example", { query: { api_key: "k" } });
    });

    /** Installs a `fetch` that records its URL. */
    function recording(): string[] {
        const urls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                urls.push(url);
                return { ok: false, status: 500, json: async () => null } as unknown as Response;
            })
        );
        return urls;
    }

    it("🛑 valhalla porte la clé dans la requête, avec son `/route`", async () => {
        const urls = recording();
        await createValhallaProvider("https://moteur.example/", 1000, { api_key: "a&b" }).route(
            REQUEST
        );
        expect(urls).toEqual(["https://moteur.example/route?api_key=a%26b"]);
    });

    it("osrm la porte aussi, à côté de ses propres paramètres", async () => {
        const urls = recording();
        await createOsrmProvider("https://moteur.example", 1000, { api_key: "k" }).route(REQUEST);
        const url = new URL(urls[0]!);
        expect(url.searchParams.get("api_key")).toBe("k");
        expect(url.searchParams.get("geometries")).toBe("polyline");
        expect(url.pathname).toContain("/route/v1/driving/55.45,-20.88;55.48,-21.33");
    });
});

describe("🛑 Valhalla dit « pas d'itinéraire » par une erreur HTTP", () => {
    /** Installs a `fetch` answering one HTTP error. */
    function refusing(status: number, body: unknown): void {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: false, status, json: async () => body })) as never
        );
    }

    it.each([
        [171, "No suitable edges near location"],
        [154, "Path distance exceeds the max distance limit: 5000000 meters"],
    ])("le code %i, mesuré sur le moteur, est `no-route`", async (code, error) => {
        refusing(400, { error_code: code, error, status_code: 400 });
        const res = await createValhallaProvider("https://moteur.example").route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "no-route" });
    });

    it("une clé refusée reste un refus", async () => {
        refusing(401, { error: "unauthorized" });
        const res = await createValhallaProvider("https://moteur.example").route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "http", status: 401 });
    });

    it("une erreur dont le corps est illisible reste un refus", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                ok: false,
                status: 400,
                json: async () => {
                    throw new SyntaxError("<html>");
                },
            })) as never
        );
        const res = await createValhallaProvider("https://moteur.example").route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "http", status: 400 });
    });
});
