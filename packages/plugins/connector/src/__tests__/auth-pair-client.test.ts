/**
 * The network side of `auth.contract: "pair"` — sign-in, renewal, revocation — and what a
 * refusal carries to the host: status, problem, application code, the wait of a `429`.
 *
 * 🛑 No token and no password may appear in a message, a reason or a serialised error: the
 * last describe reads every failure this client can produce.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { PairAuthClient } from "../auth-pair-client.js";
import type { AuthError } from "../auth-client.js";

const URL_LOGIN = "https://api.example.com/auth/token";
const URL_REFRESH = "https://api.example.com/auth/refresh";
const URL_REVOKE = "https://api.example.com/auth/revoke";
const PAIR = { access_token: "at-1", refresh_token: "rt-1", expires_in: 900 };
const SECRET_PASSWORD = "s3cret-pw";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const fetchFn = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
        text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    });
    vi.stubGlobal("fetch", fetchFn);
    return fetchFn;
}

/** The error a sign-in rejects with. */
async function refusal(): Promise<AuthError> {
    return PairAuthClient.login(URL_LOGIN, "user", SECRET_PASSWORD).then(
        () => {
            throw new Error("the sign-in should have been refused");
        },
        (err: AuthError) => err
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("connexion", () => {
    it("poste { login, password } en JSON et rend la paire", async () => {
        const fetchFn = respond(200, { ...PAIR, refresh_expires_in: 86400 });
        const session = await PairAuthClient.login(URL_LOGIN, "user", SECRET_PASSWORD);
        expect(session).toEqual({
            accessToken: "at-1",
            refreshToken: "rt-1",
            expiresIn: 900,
            refreshExpiresIn: 86400,
        });
        const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(URL_LOGIN);
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({ login: "user", password: SECRET_PASSWORD });
    });

    it("une réponse sans refresh_token ou sans expires_in est refusée", async () => {
        respond(200, { access_token: "at-1", expires_in: 900 });
        expect((await refusal()).message).toMatch(/missing access_token, refresh_token/);
        respond(200, { access_token: "at-1", refresh_token: "rt-1" });
        expect((await refusal()).message).toMatch(/expires_in/);
    });

    it("401 → « Invalid credentials », avec le code applicatif du problème", async () => {
        respond(
            401,
            { title: "Refused", detail: "Mot de passe incorrect", code: "invalid_credentials" },
            { "content-type": "application/problem+json" }
        );
        const err = await refusal();
        expect(err.message).toBe("Invalid credentials");
        expect(err.status).toBe(401);
        expect(err.code).toBe("invalid_credentials");
        expect(err.problem?.detail).toBe("Mot de passe incorrect");
    });

    it("le code se lit aussi sur `error` (forme RFC 6749 §5.2)", async () => {
        respond(400, { error: "invalid_grant" }, { "content-type": "application/problem+json" });
        expect((await refusal()).code).toBe("invalid_grant");
    });

    it("🛑 429 → « Too many attempts », Retry-After lu en secondes", async () => {
        respond(429, "", { "retry-after": "42" });
        const err = await refusal();
        expect(err.message).toBe("Too many attempts");
        expect(err.retryAfter).toBe(42);
    });

    it("Retry-After en date HTTP", async () => {
        vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-24T10:00:00Z"));
        respond(429, "", { "retry-after": "Tue, 24 Nov 2026 10:00:30 GMT" });
        expect((await refusal()).retryAfter).toBe(30);
    });

    it("un Retry-After illisible ou au-delà d'une heure n'est pas cru", async () => {
        respond(429, "", { "retry-after": "bientôt" });
        expect((await refusal()).retryAfter).toBeUndefined();
        respond(429, "", { "retry-after": "7200" });
        expect((await refusal()).retryAfter).toBeUndefined();
    });

    it("réseau coupé → « Network unavailable »", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        expect((await refusal()).message).toBe("Network unavailable");
    });
});

describe("renouvellement", () => {
    it("🛑 poste { refresh_token } dans le corps, SANS Bearer", async () => {
        const fetchFn = respond(200, { ...PAIR, refresh_token: "rt-2" });
        const result = await PairAuthClient.refresh(URL_REFRESH, "rt-1");
        expect(result).toEqual({
            verdict: "renewed",
            session: { accessToken: "at-1", refreshToken: "rt-2", expiresIn: 900 },
        });
        const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(URL_REFRESH);
        expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "rt-1" });
        const headers = init.headers as Record<string, string>;
        expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    });

    it.each([408, 429, 500, 502, 503, 504])("%i → unavailable", async (status) => {
        respond(status, "");
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("unavailable");
    });

    it.each([400, 401, 403])("%i → refused", async (status) => {
        respond(status, "");
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("refused");
    });

    it("un 2xx sans paire utilisable → refused", async () => {
        respond(200, { token: "x", expiresIn: 10 });
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("refused");
    });

    it("réseau coupé → unavailable, sans lever", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("unavailable");
    });
});

describe("révocation", () => {
    it("poste { token: <refresh token> }", async () => {
        const fetchFn = respond(200, "");
        expect(await PairAuthClient.revoke(URL_REVOKE, "rt-9")).toBe(true);
        const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({ token: "rt-9" });
    });

    it("400 « déjà révoqué » vaut succès ; 500 et réseau coupé non, sans lever", async () => {
        respond(400, "");
        expect(await PairAuthClient.revoke(URL_REVOKE, "rt-9")).toBe(true);
        respond(500, "");
        expect(await PairAuthClient.revoke(URL_REVOKE, "rt-9")).toBe(false);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
        expect(await PairAuthClient.revoke(URL_REVOKE, "rt-9")).toBe(false);
    });
});

describe("🛑 aucun secret dans une erreur", () => {
    it("ni le mot de passe ni un jeton dans le message, la raison ou l'erreur sérialisée", async () => {
        const outputs: string[] = [];
        for (const status of [400, 401, 404, 429, 500]) {
            respond(status, "");
            const err = await refusal();
            outputs.push(err.message, JSON.stringify(err), String(err));
        }
        respond(200, { access_token: "at-leak", expires_in: 900 });
        const malformed = await refusal();
        outputs.push(malformed.message, JSON.stringify(malformed));
        for (const status of [401, 503]) {
            respond(status, "");
            outputs.push(JSON.stringify(await PairAuthClient.refresh(URL_REFRESH, "rt-leak")));
        }
        const all = outputs.join("\n");
        expect(all).not.toContain(SECRET_PASSWORD);
        expect(all).not.toContain("rt-leak");
        expect(all).not.toContain("at-leak");
    });
});

describe("lecture de la paire", () => {
    it("ignore un refresh_expires_in inutilisable sans refuser la paire", async () => {
        respond(200, { ...PAIR, refresh_expires_in: -1 });
        expect(await PairAuthClient.login(URL_LOGIN, "user", SECRET_PASSWORD)).toEqual({
            accessToken: "at-1",
            refreshToken: "rt-1",
            expiresIn: 900,
        });
    });

    it("refuse un JSON qui n'est pas un objet", async () => {
        respond(200, "null");
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("refused");
        respond(200, "<html>");
        expect((await PairAuthClient.refresh(URL_REFRESH, "rt-1")).verdict).toBe("refused");
    });
});
