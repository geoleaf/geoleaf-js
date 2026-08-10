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

describe("AuthClient.refresh", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns new token and expiresIn on success (200)", async () => {
        mockFetch(200, VALID_RESPONSE);
        const result = await AuthClient.refresh(ENDPOINT, TOKEN);
        expect(result?.token).toBe(TOKEN);
        expect(result?.expiresIn).toBe(3600);
    });

    it("returns null when backend returns 404 (refresh not supported)", async () => {
        mockFetch(404, {});
        const result = await AuthClient.refresh(ENDPOINT, TOKEN);
        expect(result).toBeNull();
    });

    it("returns null when fetch rejects (network error)", async () => {
        mockFetch(0, {}, new TypeError("Failed to fetch"));
        const result = await AuthClient.refresh(ENDPOINT, TOKEN);
        expect(result).toBeNull();
    });

    it("returns null on non-ok non-404 status (silent failure)", async () => {
        mockFetch(401, {});
        const result = await AuthClient.refresh(ENDPOINT, TOKEN);
        expect(result).toBeNull();
    });

    it("sends POST to {endpoint}/refresh with Authorization: Bearer header", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve(VALID_RESPONSE),
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
