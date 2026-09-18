import { AuthClient, AuthError } from "../auth-client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ENDPOINT = "https://api.example.com/auth/token";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const VALID_RESPONSE = { token: TOKEN, expiresIn: 3600 };

function mockFetch(status: number, body: unknown, rejectWith?: Error) {
    if (rejectWith) {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(rejectWith));
        return;
    }
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
        })
    );
}

/**
 * A 2xx whose body `readBody` produces — a factory, so that a rejected read is created when
 * it is consumed and never sits unhandled.
 */
function mockBody(readBody: () => Promise<string>) {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => readBody().then((t) => JSON.parse(t)),
            text: () => readBody(),
        })
    );
}

// ─── AuthClient.login ─────────────────────────────────────────────────────────

describe("AuthClient.login", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns token and expiresIn on success (200)", async () => {
        mockFetch(200, VALID_RESPONSE);
        const result = await AuthClient.login(ENDPOINT, "user@example.com", "secret");
        expect(result.token).toBe(TOKEN);
        expect(result.expiresIn).toBe(3600);
    });

    it("throws AuthError with 'Invalid credentials' on 401", async () => {
        mockFetch(401, {});
        await expect(AuthClient.login(ENDPOINT, "user@example.com", "wrong")).rejects.toThrow(
            AuthError
        );
        await expect(AuthClient.login(ENDPOINT, "user@example.com", "wrong")).rejects.toThrow(
            "Invalid credentials"
        );
    });

    it("throws AuthError with 'Endpoint not found' on 404", async () => {
        mockFetch(404, {});
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(
            "Endpoint not found (404)"
        );
    });

    it("throws AuthError on 500", async () => {
        mockFetch(500, {});
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
    });

    it("throws AuthError on non-ok status other than 401/404/500", async () => {
        mockFetch(403, {});
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
    });

    it("throws AuthError when JSON is malformed", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.reject(new SyntaxError("unexpected token")),
            })
        );
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
    });

    it("throws AuthError when token field is missing in response", async () => {
        mockFetch(200, { expiresIn: 3600 });
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
    });

    it("throws AuthError when expiresIn is not a number", async () => {
        mockFetch(200, { token: TOKEN, expiresIn: "3600" });
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
    });

    it("throws AuthError('Network unavailable') when fetch rejects", async () => {
        mockFetch(0, {}, new TypeError("Failed to fetch"));
        await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow("Network unavailable");
    });

    it("sends POST request with Content-Type application/json", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve(VALID_RESPONSE),
        });
        vi.stubGlobal("fetch", fetchMock);
        await AuthClient.login(ENDPOINT, "user", "pass");
        expect(fetchMock).toHaveBeenCalledWith(
            ENDPOINT,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                }),
            })
        );
    });

    it("includes login and password in the request body", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve(VALID_RESPONSE),
        });
        vi.stubGlobal("fetch", fetchMock);
        await AuthClient.login(ENDPOINT, "user@example.com", "s3cr3t");
        const callArgs = fetchMock.mock.calls[0];
        const body = JSON.parse(callArgs[1].body as string);
        expect(body.login).toBe("user@example.com");
        expect(body.password).toBe("s3cr3t");
    });
});

// ─── AuthClient.refresh ───────────────────────────────────────────────────────
//
// 🛑 WHAT A RENEWAL CONCLUDED DECIDES THE SESSION'S FATE, so the verdict IS the contract.
// Every failure used to come back as the same `null` — a network error, a 503, a refusal —
// and the caller erased the session on it: one minute of an unavailable authentication
// server signed the device out. Only a refusal may end a session now; a renewal that could
// not conclude IN TRANSIT keeps it.

describe("AuthClient.refresh — ce que le renouvellement a conclu", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("renouvelé : un 2xx lisible rend le jeton neuf", async () => {
        mockFetch(200, VALID_RESPONSE);
        expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toEqual({
            verdict: "renewed",
            token: TOKEN,
            expiresIn: 3600,
        });
    });

    it.each([408, 429, 500, 502, 503, 504])(
        "indisponible : un %i est passager, la session doit survivre",
        async (status: number) => {
            mockFetch(status, {});
            expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toMatchObject({
                verdict: "unavailable",
            });
        }
    );

    it("indisponible : le réseau est coupé", async () => {
        mockFetch(0, {}, new TypeError("Failed to fetch"));
        expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toMatchObject({ verdict: "unavailable" });
    });

    it("indisponible : le corps se coupe en route", async () => {
        mockBody(() => Promise.reject(new TypeError("network error while reading the body")));
        expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toMatchObject({ verdict: "unavailable" });
    });

    it("🛑 indisponible : un corps qui ne finit jamais est borné par le délai de l'échange", async () => {
        // `fetchWithTimeout` stops its clock when the headers arrive. A body that stalls
        // afterwards held the renewal — and every request that joins it — for as long as the
        // connection stayed open.
        vi.useFakeTimers();
        mockBody(() => new Promise<string>(() => undefined));
        const pending = AuthClient.refresh(ENDPOINT, TOKEN);
        await vi.advanceTimersByTimeAsync(15000);
        expect(await pending).toMatchObject({ verdict: "unavailable" });
    });

    it.each([
        ["401 — le jeton est refusé", 401],
        ["403", 403],
        ["404 — aucun renouvellement n'est offert", 404],
        ["400", 400],
        ["501 — « non implémenté » ne passe pas avec le temps", 501],
    ])("refus : %s", async (_label: string, status: number) => {
        mockFetch(status, {});
        expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toMatchObject({
            verdict: "refused",
            status,
        });
    });

    it.each([
        ["une page HTML", "<!doctype html><title>Sign in</title>"],
        ["un JSON d'une autre forme", JSON.stringify({ access_token: TOKEN, expires_in: 3600 })],
        ["un expiresIn en chaîne", JSON.stringify({ token: TOKEN, expiresIn: "3600" })],
        ["un expiresIn nul", JSON.stringify({ token: TOKEN, expiresIn: 0 })],
    ])(
        "refus : un 2xx reçu en entier mais inexploitable — %s",
        async (_label: string, body: string) => {
            // Under HTTPS such a body can only come from the server or its proxy: a permanent
            // misconfiguration, not an outage. Kept as a session, it would lock the device out
            // with no login window — waiting cannot fix it.
            mockBody(() => Promise.resolve(body));
            expect(await AuthClient.refresh(ENDPOINT, TOKEN)).toMatchObject({ verdict: "refused" });
        }
    );

    it("sends POST to {endpoint}/refresh with Authorization: Bearer header", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve(VALID_RESPONSE),
            text: () => Promise.resolve(JSON.stringify(VALID_RESPONSE)),
        });
        vi.stubGlobal("fetch", fetchMock);
        await AuthClient.refresh(ENDPOINT, TOKEN);
        expect(fetchMock).toHaveBeenCalledWith(
            `${ENDPOINT}/refresh`,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: `Bearer ${TOKEN}`,
                }),
            })
        );
    });
});

// ─── AuthError ────────────────────────────────────────────────────────────────

describe("AuthError", () => {
    it("has name 'AuthError'", () => {
        expect(new AuthError("x").name).toBe("AuthError");
    });

    it("extends Error", () => {
        const err = new AuthError("test");
        expect(err instanceof Error).toBe(true);
        expect(err.message).toBe("test");
    });
});
