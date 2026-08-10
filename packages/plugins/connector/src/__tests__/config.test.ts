// @vitest-environment node
import { validateConfig, ConfigError } from "../config.js";
import type { ConnectorConfig } from "../config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_HTTPS = "https://api.example.com";
const VALID_GETTOKEN: ConnectorConfig = {
    baseUrl: VALID_HTTPS,
    getToken: () => "tok",
};
const VALID_AUTH: ConnectorConfig = {
    baseUrl: VALID_HTTPS,
    auth: { endpoint: "https://api.example.com/auth/token" },
};

function setHostname(hostname: string) {
    (globalThis as Record<string, unknown>)["location"] = { hostname };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("validateConfig", () => {
    describe("baseUrl validation", () => {
        it("throws ConfigError when baseUrl is empty string", () => {
            expect(() => validateConfig({ baseUrl: "", getToken: () => "tok" })).toThrow(
                ConfigError
            );
        });

        it("throws ConfigError when baseUrl is whitespace-only", () => {
            expect(() => validateConfig({ baseUrl: "   ", getToken: () => "tok" })).toThrow(
                ConfigError
            );
        });

        it("throws ConfigError when config is null", () => {
            expect(() => validateConfig(null as unknown as ConnectorConfig)).toThrow(ConfigError);
        });

        it("throws ConfigError when baseUrl is a number", () => {
            expect(() =>
                validateConfig({ baseUrl: 42 as unknown as string, getToken: () => "tok" })
            ).toThrow(ConfigError);
        });
    });

    describe("HTTPS enforcement", () => {
        afterEach(() => {
            delete (globalThis as Record<string, unknown>)["location"];
        });

        it("throws ConfigError for http:// in non-localhost context", () => {
            setHostname("example.com");
            expect(() =>
                validateConfig({ baseUrl: "http://api.example.com", getToken: () => "tok" })
            ).toThrow(ConfigError);
        });

        it("warns (not throws) for http:// on localhost", () => {
            setHostname("localhost");
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(() =>
                validateConfig({ baseUrl: "http://localhost:3000", getToken: () => "tok" })
            ).not.toThrow();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("[GeoLeaf Connector]"));
            warn.mockRestore();
        });

        it("warns (not throws) for http:// on 127.0.0.1", () => {
            setHostname("127.0.0.1");
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(() =>
                validateConfig({ baseUrl: "http://127.0.0.1:8080", getToken: () => "tok" })
            ).not.toThrow();
            warn.mockRestore();
        });

        it("accepts https:// without warning", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(() => validateConfig(VALID_GETTOKEN)).not.toThrow();
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe("getToken / auth exclusivity", () => {
        it("throws ConfigError when neither getToken nor auth is provided", () => {
            expect(() => validateConfig({ baseUrl: VALID_HTTPS } as ConnectorConfig)).toThrow(
                ConfigError
            );
        });

        it("throws ConfigError when both getToken and auth are provided", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    getToken: () => "tok",
                    auth: { endpoint: "https://api.example.com/auth" },
                })
            ).toThrow(ConfigError);
        });

        it("throws ConfigError when auth is provided but auth.endpoint is empty", () => {
            expect(() => validateConfig({ baseUrl: VALID_HTTPS, auth: { endpoint: "" } })).toThrow(
                ConfigError
            );
        });

        it("throws ConfigError when auth is provided but auth.endpoint is whitespace", () => {
            expect(() =>
                validateConfig({ baseUrl: VALID_HTTPS, auth: { endpoint: "   " } })
            ).toThrow(ConfigError);
        });

        it("accepts valid config with getToken callback", () => {
            expect(() => validateConfig(VALID_GETTOKEN)).not.toThrow();
        });

        it("accepts valid config with async getToken callback", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    getToken: async () => "tok",
                })
            ).not.toThrow();
        });

        it("accepts valid config with auth.endpoint", () => {
            expect(() => validateConfig(VALID_AUTH)).not.toThrow();
        });

        it("accepts valid config with auth.endpoint and ui: true", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: { endpoint: "https://api.example.com/auth", ui: true },
                })
            ).not.toThrow();
        });
    });

    describe("Sprint 2 — signupUrl / forgotPasswordUrl validation", () => {
        afterEach(() => {
            delete (globalThis as Record<string, unknown>)["location"];
        });

        it("accepts valid auth config with signupUrl HTTPS", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        signupUrl: "https://app.example.com/signup",
                    },
                })
            ).not.toThrow();
        });

        it("accepts valid auth config with forgotPasswordUrl HTTPS", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        forgotPasswordUrl: "https://app.example.com/forgot",
                    },
                })
            ).not.toThrow();
        });

        it("throws ConfigError for signupUrl http:// in production", () => {
            setHostname("example.com");
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        signupUrl: "http://app.example.com/signup",
                    },
                })
            ).toThrow(ConfigError);
        });

        it("throws ConfigError for forgotPasswordUrl http:// in production", () => {
            setHostname("example.com");
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        forgotPasswordUrl: "http://app.example.com/forgot",
                    },
                })
            ).toThrow(ConfigError);
        });

        it("warns (not throws) for signupUrl http:// on localhost", () => {
            setHostname("localhost");
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            expect(() =>
                validateConfig({
                    baseUrl: "http://localhost:3000",
                    auth: {
                        endpoint: "http://localhost:3000/auth",
                        signupUrl: "http://localhost:3000/signup",
                    },
                })
            ).not.toThrow();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("auth.signupUrl"));
            warn.mockRestore();
        });

        it("throws ConfigError for empty signupUrl string", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        signupUrl: "",
                    },
                })
            ).toThrow(ConfigError);
        });

        it("throws ConfigError for whitespace-only forgotPasswordUrl", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        forgotPasswordUrl: "   ",
                    },
                })
            ).toThrow(ConfigError);
        });
    });

    describe("Sprint 2 — credentialButton.iconVariant fallback", () => {
        it("silently falls back to 'lock' for invalid iconVariant", () => {
            const config: ConnectorConfig = {
                baseUrl: VALID_HTTPS,
                auth: {
                    endpoint: "https://api.example.com/auth",
                    credentialButton: { enabled: true, iconVariant: "invalid" as "lock" },
                },
            };
            validateConfig(config);
            expect(config.auth!.credentialButton!.iconVariant).toBe("lock");
        });

        it("preserves 'user' iconVariant", () => {
            const config: ConnectorConfig = {
                baseUrl: VALID_HTTPS,
                auth: {
                    endpoint: "https://api.example.com/auth",
                    credentialButton: { enabled: true, iconVariant: "user" },
                },
            };
            validateConfig(config);
            expect(config.auth!.credentialButton!.iconVariant).toBe("user");
        });

        it("preserves 'lock' iconVariant", () => {
            const config: ConnectorConfig = {
                baseUrl: VALID_HTTPS,
                auth: {
                    endpoint: "https://api.example.com/auth",
                    credentialButton: { enabled: true, iconVariant: "lock" },
                },
            };
            validateConfig(config);
            expect(config.auth!.credentialButton!.iconVariant).toBe("lock");
        });

        it("accepts credentialButton without iconVariant", () => {
            expect(() =>
                validateConfig({
                    baseUrl: VALID_HTTPS,
                    auth: {
                        endpoint: "https://api.example.com/auth",
                        credentialButton: { enabled: true },
                    },
                })
            ).not.toThrow();
        });
    });
});

describe("ConfigError", () => {
    it("has name 'ConfigError'", () => {
        const err = new ConfigError("test");
        expect(err.name).toBe("ConfigError");
    });

    it("extends Error", () => {
        const err = new ConfigError("test message");
        expect(err instanceof Error).toBe(true);
        expect(err.message).toBe("test message");
    });
});
