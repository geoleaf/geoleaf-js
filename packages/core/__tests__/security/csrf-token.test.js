/**
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { Log as MockLog } from "../../src/utils/log/index.js";

const mockGetRandomValues = vi.fn(() => {
    const arr = new Uint8Array(32);
    for (let i = 0; i < 32; i++) arr[i] = i;
    return arr;
});

describe("security/csrf-token", () => {
    let CSRFToken;

    // Déféré PORTEUR : le hook redéfinit `globalThis.crypto` avant de charger. Cible inerte
    // ou non, la séquence est voulue — `await import()` la préserve (1ʳᵉ limite du triage).
    beforeAll(async () => {
        Object.defineProperty(globalThis, "crypto", {
            value: { getRandomValues: mockGetRandomValues },
            writable: true,
        });
        ({ CSRFToken } = await import("../../src/kernel/security/csrf-token.js"));
    });

    beforeEach(() => {
        CSRFToken.destroy();
        mockGetRandomValues.mockClear();
    });

    describe("init", () => {
        it("generates token and starts auto-refresh", () => {
            CSRFToken.init();
            expect(CSRFToken.getToken()).toBeTruthy();
            expect(typeof CSRFToken.getToken()).toBe("string");
        });
    });

    describe("_generateToken", () => {
        it("throws when crypto.getRandomValues not available", () => {
            const prev = globalThis.crypto;
            globalThis.crypto = null;
            expect(() => CSRFToken._generateToken()).toThrow(/Secure random/);
            globalThis.crypto = prev;
        });
    });

    describe("getToken", () => {
        it("returns token after init", () => {
            CSRFToken.init();
            const t = CSRFToken.getToken();
            expect(t).toBeTruthy();
            expect(CSRFToken.getToken()).toBe(t);
        });
    });

    describe("validateToken", () => {
        it("returns false for null or non-string", () => {
            CSRFToken.init();
            expect(CSRFToken.validateToken(null)).toBe(false);
            expect(CSRFToken.validateToken(undefined)).toBe(false);
            expect(CSRFToken.validateToken(123)).toBe(false);
        });

        it("returns true when token matches and not expired", () => {
            CSRFToken.init();
            const token = CSRFToken.getToken();
            expect(CSRFToken.validateToken(token)).toBe(true);
        });

        it("returns false for wrong token", () => {
            CSRFToken.init();
            expect(CSRFToken.validateToken("wrong-token")).toBe(false);
        });
    });

    describe("addTokenToData", () => {
        it("appends token to FormData", () => {
            CSRFToken.init();
            const fd = new FormData();
            CSRFToken.addTokenToData(fd);
            expect(fd.get("csrf_token")).toBe(CSRFToken.getToken());
        });

        it("adds csrf_token to plain object", () => {
            CSRFToken.init();
            const obj = {};
            CSRFToken.addTokenToData(obj);
            expect(obj.csrf_token).toBe(CSRFToken.getToken());
        });
    });

    describe("addTokenToHeaders", () => {
        it("sets X-CSRF-Token in options.headers", () => {
            CSRFToken.init();
            const opts = {};
            CSRFToken.addTokenToHeaders(opts);
            expect(opts.headers["X-CSRF-Token"]).toBe(CSRFToken.getToken());
        });
    });

    describe("createTokenInput", () => {
        it("returns hidden input with name and value", () => {
            CSRFToken.init();
            const input = CSRFToken.createTokenInput();
            expect(input.tagName).toBe("INPUT");
            expect(input.type).toBe("hidden");
            expect(input.name).toBe("csrf_token");
            expect(input.value).toBe(CSRFToken.getToken());
        });
    });

    describe("addTokenToForm", () => {
        it("appends token input when form has none", () => {
            CSRFToken.init();
            const form = document.createElement("form");
            CSRFToken.addTokenToForm(form);
            const input = form.querySelector('input[name="csrf_token"]');
            expect(input).toBeTruthy();
            expect(input.value).toBe(CSRFToken.getToken());
        });

        it("updates value when input already exists", () => {
            CSRFToken.init();
            const form = document.createElement("form");
            const existing = document.createElement("input");
            existing.name = "csrf_token";
            existing.value = "old";
            form.appendChild(existing);
            CSRFToken.addTokenToForm(form);
            expect(form.querySelectorAll('input[name="csrf_token"]').length).toBe(1);
            expect(existing.value).toBe(CSRFToken.getToken());
        });
    });

    describe("validateFormToken", () => {
        it("validates token from FormData", () => {
            CSRFToken.init();
            const fd = new FormData();
            fd.append("csrf_token", CSRFToken.getToken());
            expect(CSRFToken.validateFormToken(fd)).toBe(true);
        });

        it("validates token from object", () => {
            CSRFToken.init();
            expect(CSRFToken.validateFormToken({ csrf_token: CSRFToken.getToken() })).toBe(true);
        });

        it("returns false when token missing in data", () => {
            CSRFToken.init();
            expect(CSRFToken.validateFormToken({})).toBe(false);
        });
    });

    describe("setSecureCookie", () => {
        it("sets cookie string on document.cookie", () => {
            CSRFToken.init();
            const prev = document.cookie;
            CSRFToken.setSecureCookie("csrf", "val", { maxAge: 60, path: "/" });
            expect(document.cookie).toContain("csrf=");
            document.cookie = prev;
        });

        it("emits a warning when secure:true is used in HTTP context", () => {
            MockLog.warn.mockClear();
            const origLocation = globalThis.location;
            Object.defineProperty(globalThis, "location", {
                value: { protocol: "http:", href: "http://localhost/", hostname: "localhost" },
                configurable: true,
                writable: true,
            });
            CSRFToken.setSecureCookie("csrf", "test", { secure: true });
            expect(MockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("HTTP context detected")
            );
            Object.defineProperty(globalThis, "location", {
                value: origLocation,
                configurable: true,
                writable: true,
            });
        });
    });

    describe("destroy", () => {
        it("clears token and interval", () => {
            CSRFToken.init();
            CSRFToken.destroy();
            expect(CSRFToken.getTokenInfo().hasToken).toBe(false);
        });
    });

    describe("rotateToken", () => {
        it("refreshes token and dispatches geoleaf:csrf:rotated event", () => {
            CSRFToken.init();
            let detail;
            document.addEventListener("geoleaf:csrf:rotated", (e) => {
                detail = e.detail;
            });
            CSRFToken.rotateToken();
            expect(CSRFToken.getToken()).toBeTruthy();
            expect(typeof CSRFToken.getToken()).toBe("string");
            expect(detail).toBeTruthy();
            expect(detail.token).toBe(CSRFToken.getToken());
        });
    });

    describe("getTokenInfo", () => {
        it("returns hasToken and isValid when token active", () => {
            CSRFToken.init();
            const info = CSRFToken.getTokenInfo();
            expect(info.hasToken).toBe(true);
            expect(info.isValid).toBe(true);
            expect(typeof info.expiresIn).toBe("number");
        });

        it("returns hasToken false after destroy", () => {
            CSRFToken.init();
            CSRFToken.destroy();
            expect(CSRFToken.getTokenInfo().hasToken).toBe(false);
            expect(CSRFToken.getTokenInfo().isValid).toBe(false);
        });
    });

    // ── T22c — csrf-token.ts branch coverage ───────────────────────
    describe("init — catch path", () => {
        it("handles crypto unavailability gracefully during init", () => {
            const prev = globalThis.crypto;
            globalThis.crypto = null;
            expect(() => CSRFToken.init()).not.toThrow();
            globalThis.crypto = prev;
        });
    });

    describe("getToken — expired and catch paths", () => {
        it("regenerates token when expired", () => {
            CSRFToken.init();
            CSRFToken._tokenExpiry = 0; // force expired
            const newToken = CSRFToken.getToken();
            expect(newToken).toBeTruthy();
        });

        it("returns null when regeneration fails after expiry", () => {
            CSRFToken.init();
            CSRFToken._tokenExpiry = 0; // force expired
            const prev = globalThis.crypto;
            globalThis.crypto = null;
            const result = CSRFToken.getToken();
            expect(result).toBeNull();
            globalThis.crypto = prev;
        });
    });

    describe("addTokenToForm — invalid input", () => {
        it("does not throw for null form", () => {
            CSRFToken.init();
            expect(() => CSRFToken.addTokenToForm(null)).not.toThrow();
        });
    });

    describe("validateFormToken — else branch", () => {
        it("returns false for primitive input", () => {
            CSRFToken.init();
            expect(CSRFToken.validateFormToken(42)).toBe(false);
        });
    });

    describe("_startAutoRefresh — interval callback", () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it("fires auto-refresh callback and dispatches geoleaf:csrf:refreshed event", async () => {
            const events = [];
            document.addEventListener("geoleaf:csrf:refreshed", (e) => events.push(e.detail));
            CSRFToken.init();
            // advance past the refresh interval (tokenDuration - 5min = 55min)
            vi.advanceTimersByTime(CSRFToken._tokenDuration - 5 * 60 * 1000 + 1);
            expect(events.length).toBeGreaterThan(0);
            expect(events[0]).toHaveProperty("token");
        });

        // Backlog B.15 — the interval used to call `_generateToken()` UNGUARDED, while
        // `init()` and `getToken()` both wrapped it. If the crypto source disappears
        // after boot the timer threw every ~55 min, and the throw escaped into the timer
        // queue where nothing could catch it.
        it("degrades instead of throwing when token generation fails", () => {
            CSRFToken.init();
            const boom = vi.spyOn(CSRFToken, "_generateToken").mockImplementation(() => {
                throw new Error("crypto gone");
            });

            expect(() =>
                vi.advanceTimersByTime(CSRFToken._tokenDuration - 5 * 60 * 1000 + 1)
            ).not.toThrow();
            boom.mockRestore();
        });

        it("does not announce a refresh that failed", () => {
            const events = [];
            document.addEventListener("geoleaf:csrf:refreshed", (e) => events.push(e.detail));
            CSRFToken.init();
            const boom = vi.spyOn(CSRFToken, "_generateToken").mockImplementation(() => {
                throw new Error("crypto gone");
            });

            vi.advanceTimersByTime(CSRFToken._tokenDuration - 5 * 60 * 1000 + 1);

            // Dispatching here would hand subscribers a null token.
            expect(events).toHaveLength(0);
            expect(CSRFToken._token).toBeNull();
            boom.mockRestore();
        });

        it("recovers on the next tick — the timer stays armed", () => {
            CSRFToken.init();
            const boom = vi.spyOn(CSRFToken, "_generateToken").mockImplementation(() => {
                throw new Error("transient");
            });
            const tick = CSRFToken._tokenDuration - 5 * 60 * 1000 + 1;

            vi.advanceTimersByTime(tick);
            expect(CSRFToken._token).toBeNull();

            boom.mockRestore();
            vi.advanceTimersByTime(tick);
            expect(CSRFToken._token).toBeTruthy();
        });
    });
});
