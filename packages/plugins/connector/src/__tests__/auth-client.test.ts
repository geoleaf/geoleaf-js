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

/** A response of `status` whose body is `body`, declared as `contentType`. */
function mockDeclared(status: number, body: unknown, contentType: string | null) {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => (/^content-type$/i.test(name) ? contentType : null) },
            text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
        })
    );
}

/** The error a sign-in rejects with. */
async function refusal(): Promise<AuthError> {
    return AuthClient.login(ENDPOINT, "u", "p").then(
        () => {
            throw new Error("the sign-in should have been refused");
        },
        (err: AuthError) => err
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

    // ── What a refusal SAYS (RFC 9457) ─────────────────────────────────────────────────────
    // A server that answers `application/problem+json` names its motive — a second factor
    // required, an account locked. It used to be dropped: a 403 read "Authentication failed
    // (403)" and nothing else reached the window or the host.

    const PROBLEM = {
        type: "https://example.com/problems/second-factor-required",
        title: "Second factor required",
        detail: "Un second facteur est exigé pour ce compte.",
        status: 403,
        method: "totp",
    };

    it("a refusal carries its status and the problem the server declared", async () => {
        mockDeclared(403, PROBLEM, "application/problem+json");
        const err = await refusal();
        expect(err).toBeInstanceOf(AuthError);
        expect(err.message).toBe("Authentication failed (403)");
        expect(err.status).toBe(403);
        expect(err.problem).toEqual({
            type: PROBLEM.type,
            title: PROBLEM.title,
            detail: PROBLEM.detail,
            body: PROBLEM,
        });
    });

    it("reads the problem whatever the status, and with a charset parameter", async () => {
        mockDeclared(
            401,
            { title: "Compte verrouillé" },
            "application/problem+json; charset=utf-8"
        );
        const err = await refusal();
        expect(err.message).toBe("Invalid credentials");
        expect(err.status).toBe(401);
        expect(err.problem?.title).toBe("Compte verrouillé");
        expect(err.problem?.detail).toBeUndefined();
    });

    it("a refusal without a declared problem carries its status alone", async () => {
        mockDeclared(403, PROBLEM, "application/json");
        const err = await refusal();
        expect(err.status).toBe(403);
        expect(err.problem).toBeUndefined();
    });

    it.each([
        ["a body that does not parse", "<html>403</html>"],
        ["a body that is not an object", "[1, 2]"],
        ["an empty body", ""],
    ])("drops %s, and keeps the status", async (_what: string, body: string) => {
        mockDeclared(403, body, "application/problem+json");
        const err = await refusal();
        expect(err.message).toBe("Authentication failed (403)");
        expect(err.status).toBe(403);
        expect(err.problem).toBeUndefined();
    });

    it("keeps only the members that are strings", async () => {
        mockDeclared(
            403,
            { title: 42, detail: { a: 1 }, type: "about:blank" },
            "application/problem+json"
        );
        const err = await refusal();
        expect(err.problem?.type).toBe("about:blank");
        expect(err.problem?.title).toBeUndefined();
        expect(err.problem?.detail).toBeUndefined();
    });

    it("a problem body cut in transit does not change the refusal", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 403,
                headers: { get: () => "application/problem+json" },
                text: () => Promise.reject(new Error("cut")),
            })
        );
        const err = await refusal();
        expect(err.message).toBe("Authentication failed (403)");
        expect(err.status).toBe(403);
        expect(err.problem).toBeUndefined();
    });

    it("throws AuthError when JSON is malformed", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.reject(new SyntaxError("unexpected token")),
                text: () => Promise.resolve("{ not json"),
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

    it.each([
        ["an expiresIn of zero", { token: TOKEN, expiresIn: 0 }],
        ["a negative expiresIn", { token: TOKEN, expiresIn: -60 }],
        ["a token that is not a string", { token: 12345, expiresIn: 3600 }],
    ])(
        "refuses %s — it would be stored already expired, or unusable",
        async (_label: string, body: unknown) => {
            // The renewal refuses these; the sign-in accepted them, and saved the session as is.
            mockFetch(200, body);
            await expect(AuthClient.login(ENDPOINT, "u", "p")).rejects.toThrow(AuthError);
        }
    );

    it("a body that never ends is bounded by the exchange's time budget", async () => {
        // `fetchWithTimeout` stops its clock when the headers arrive: a body that stalled
        // after them left the login window waiting for as long as the connection stayed open.
        vi.useFakeTimers();
        try {
            mockBody(() => new Promise<string>(() => undefined));
            let outcome = "pending";
            AuthClient.login(ENDPOINT, "u", "p").then(
                () => (outcome = "resolved"),
                (error: Error) => (outcome = error.message)
            );
            await vi.advanceTimersByTimeAsync(15000);
            expect(outcome).toBe("Network unavailable");
        } finally {
            vi.useRealTimers();
        }
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
            text: () => Promise.resolve(JSON.stringify(VALID_RESPONSE)),
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
            text: () => Promise.resolve(JSON.stringify(VALID_RESPONSE)),
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
