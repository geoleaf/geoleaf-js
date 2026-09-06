import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectorConfig } from "../config.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../token-store.js", () => ({
    TokenStore: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(null),
        clear: vi.fn().mockResolvedValue(undefined),
        getTokenSync: vi.fn().mockReturnValue(null),
        getTokenAsync: vi.fn().mockResolvedValue(null),
        _setRefreshFn: vi.fn(),
    },
}));

vi.mock("../auth-client.js", () => ({
    AuthClient: {
        login: vi.fn(),
        refresh: vi.fn().mockResolvedValue(null),
    },
    AuthError: class AuthError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "AuthError";
        }
    },
}));

vi.mock("../login-ui.js", () => ({
    showLoginModal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../fetch-interceptor.js", () => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    getWorkerHeaders: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../maplibre-bridge.js", () => ({
    installMapLibreBridge: vi.fn(),
}));

vi.mock("../credential-button.js", () => ({
    installCredentialButton: vi.fn(),
    uninstallCredentialButton: vi.fn(),
}));

// ─── Config fixtures ──────────────────────────────────────────────────────────

const AUTH_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: { endpoint: "https://api.example.com/auth" },
};

const AUTH_UI_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: { endpoint: "https://api.example.com/auth", ui: true },
};

const GETTOKEN_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    getToken: () => "sync-token",
};

// ─── createConnector() ────────────────────────────────────────────────────────

describe("createConnector()", () => {
    let createConnector: (cfg: ConnectorConfig) => import("../entry.js").ConnectorInstance;
    let TokenStore: Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        // entry.ts has side-effects — set up GeoLeaf stub so registration paths work
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register: vi.fn() },
        };
        const entry = await import("../entry.js");
        createConnector = entry.createConnector;
        const ts = await import("../token-store.js");
        TokenStore = ts.TokenStore as unknown as Record<string, ReturnType<typeof vi.fn>>;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    });

    it("returns an object with getTokenSync, getTokenAsync, and destroy", () => {
        const inst = createConnector(AUTH_CONFIG);
        expect(typeof inst.getTokenSync).toBe("function");
        expect(typeof inst.getTokenAsync).toBe("function");
        expect(typeof inst.destroy).toBe("function");
    });

    it("getTokenSync() returns null when no RAM cache hit (auth config)", () => {
        TokenStore["getTokenSync"].mockReturnValue(null);
        const inst = createConnector(AUTH_CONFIG);
        expect(inst.getTokenSync()).toBeNull();
    });

    it("getTokenSync() returns the token from TokenStore cache", () => {
        TokenStore["getTokenSync"].mockReturnValue("cached-tok");
        const inst = createConnector(AUTH_CONFIG);
        expect(inst.getTokenSync()).toBe("cached-tok");
    });

    it("getTokenSync() with sync getToken returns the string", () => {
        const inst = createConnector(GETTOKEN_CONFIG);
        expect(inst.getTokenSync()).toBe("sync-token");
    });

    it("getTokenSync() with async getToken returns null (cannot resolve synchronously)", () => {
        const inst = createConnector({
            baseUrl: "https://api.example.com",
            getToken: () => Promise.resolve("async-token"),
        } as ConnectorConfig);
        expect(inst.getTokenSync()).toBeNull();
    });

    it("getTokenSync() returns null after destroy()", () => {
        const inst = createConnector(AUTH_CONFIG);
        inst.destroy();
        expect(inst.getTokenSync()).toBeNull();
    });

    it("getTokenAsync() returns null after destroy()", async () => {
        const inst = createConnector(AUTH_CONFIG);
        inst.destroy();
        expect(await inst.getTokenAsync()).toBeNull();
    });

    it("getTokenAsync() calls getToken() when configured", async () => {
        const getToken = vi.fn().mockResolvedValue("dynamic-token");
        const inst = createConnector({
            baseUrl: "https://api.example.com",
            getToken,
        } as ConnectorConfig);
        expect(await inst.getTokenAsync()).toBe("dynamic-token");
        expect(getToken).toHaveBeenCalled();
    });

    it("getTokenAsync() reads TokenStore when no getToken is configured", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue("store-token");
        const inst = createConnector(AUTH_CONFIG);
        expect(await inst.getTokenAsync()).toBe("store-token");
    });

    it("destroy() calls TokenStore._setRefreshFn(null)", () => {
        const inst = createConnector(AUTH_CONFIG);
        inst.destroy();
        expect(TokenStore["_setRefreshFn"]).toHaveBeenCalledWith(null);
    });

    it("wires a refresh delegate when auth.endpoint is configured", () => {
        createConnector(AUTH_CONFIG);
        const calls = (TokenStore["_setRefreshFn"] as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.some((c: unknown[]) => typeof c[0] === "function")).toBe(true);
    });

    it("🛑 the delegate reads the RAW token, so an EXPIRED one can still be refreshed", async () => {
        // The whole point of a refresh is to trade an expired token for a fresh one.
        // The delegate used to read `getTokenSync`, which EVICTS an expired entry and
        // returns null — so it gave up before calling the network, exactly in the case
        // it exists for. `load()` returns the record as stored, expiry included; the
        // server is the one that arbitrates.
        (TokenStore["load"] as ReturnType<typeof vi.fn>).mockResolvedValue({
            token: "expired.token.sig",
            expiresAt: Date.now() - 60_000,
        });
        (TokenStore["getTokenSync"] as ReturnType<typeof vi.fn>).mockReturnValue(null);

        const { AuthClient } = (await import("../auth-client.js")) as unknown as {
            AuthClient: Record<string, ReturnType<typeof vi.fn>>;
        };
        createConnector(AUTH_CONFIG);
        const delegate = (TokenStore["_setRefreshFn"] as ReturnType<typeof vi.fn>).mock.calls
            .map((c: unknown[]) => c[0])
            .filter(
                (f: unknown): f is (b: string) => Promise<string | null> => typeof f === "function"
            )
            .pop();
        expect(delegate).toBeTypeOf("function");
        await delegate!(AUTH_CONFIG.baseUrl);

        expect(AuthClient["refresh"]).toHaveBeenCalledWith(
            AUTH_CONFIG.auth!.endpoint,
            "expired.token.sig"
        );
    });

    it("does NOT wire a refresh delegate when using getToken (no auth.endpoint)", () => {
        createConnector(GETTOKEN_CONFIG);
        const calls = (TokenStore["_setRefreshFn"] as ReturnType<typeof vi.fn>).mock.calls;
        // Should not have been called with a function (only null from prior tests if any)
        expect(calls.some((c: unknown[]) => typeof c[0] === "function")).toBe(false);
    });
});

// ─── GeoLeaf.Connector.configure() ───────────────────────────────────────────

describe("GeoLeaf.Connector.configure()", () => {
    let Connector: {
        configure: (cfg: ConnectorConfig) => Promise<void>;
        openLoginModal: () => Promise<void>;
    };
    let TokenStore: Record<string, ReturnType<typeof vi.fn>>;
    let install: ReturnType<typeof vi.fn>;
    let installMapLibreBridge: ReturnType<typeof vi.fn>;
    let installCredentialButton: ReturnType<typeof vi.fn>;
    let uninstallCredentialButton: ReturnType<typeof vi.fn>;
    let showLoginModal: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register: vi.fn() },
        };
        await import("../entry.js");
        Connector = ((globalThis as Record<string, unknown>)["GeoLeaf"] as Record<string, unknown>)[
            "Connector"
        ] as typeof Connector;

        const ts = await import("../token-store.js");
        TokenStore = ts.TokenStore as unknown as Record<string, ReturnType<typeof vi.fn>>;
        const fi = await import("../fetch-interceptor.js");
        install = fi.install as ReturnType<typeof vi.fn>;
        const mb = await import("../maplibre-bridge.js");
        installMapLibreBridge = mb.installMapLibreBridge as ReturnType<typeof vi.fn>;
        const cb = await import("../credential-button.js");
        installCredentialButton = cb.installCredentialButton as ReturnType<typeof vi.fn>;
        uninstallCredentialButton = cb.uninstallCredentialButton as ReturnType<typeof vi.fn>;
        const lu = await import("../login-ui.js");
        showLoginModal = lu.showLoginModal as ReturnType<typeof vi.fn>;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
        delete (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"];
    });

    it("installs the fetch interceptor with the given config", async () => {
        await Connector.configure(GETTOKEN_CONFIG);
        expect(install).toHaveBeenCalledWith(GETTOKEN_CONFIG);
    });

    it("installs the MapLibre bridge", async () => {
        await Connector.configure(GETTOKEN_CONFIG);
        expect(installMapLibreBridge).toHaveBeenCalledWith(GETTOKEN_CONFIG);
    });

    it("installs the credential button", async () => {
        await Connector.configure(GETTOKEN_CONFIG);
        expect(installCredentialButton).toHaveBeenCalled();
    });

    it("registers the Worker headers hook on globalThis", async () => {
        await Connector.configure(GETTOKEN_CONFIG);
        expect(
            typeof (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"]
        ).toBe("function");
    });

    it("with getToken that returns a token — does NOT open the login modal", async () => {
        await Connector.configure(GETTOKEN_CONFIG);
        expect(showLoginModal).not.toHaveBeenCalled();
    });

    it("with auth.endpoint and token found in store — does NOT open the login modal", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue("cached-tok");
        await Connector.configure(AUTH_CONFIG);
        expect(showLoginModal).not.toHaveBeenCalled();
    });

    it("with auth.endpoint, no token, and auth.ui=true — opens the login modal", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue(null);
        await Connector.configure(AUTH_UI_CONFIG);
        expect(showLoginModal).toHaveBeenCalledWith(AUTH_UI_CONFIG);
    });

    it("with auth.endpoint, no token, and auth.ui omitted — throws ConfigError", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue(null);
        await expect(Connector.configure(AUTH_CONFIG)).rejects.toThrow(/No valid token found/);
    });

    it("warms up TokenStore from IDB when auth.endpoint is configured", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue("warm-tok");
        await Connector.configure(AUTH_CONFIG);
        // getTokenAsync is called for warmup and then for token resolution
        expect(TokenStore["getTokenAsync"]).toHaveBeenCalledWith(AUTH_CONFIG.baseUrl);
    });

    it("calling configure() twice destroys the previous instance", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue("tok");
        await Connector.configure(AUTH_CONFIG);
        install.mockClear();
        uninstallCredentialButton.mockClear();

        await Connector.configure(AUTH_CONFIG);
        expect(uninstallCredentialButton).toHaveBeenCalled();
        expect(install).toHaveBeenCalledTimes(1); // re-installed for new config
    });
});

// ─── GeoLeaf.Connector.openLoginModal() ──────────────────────────────────────

describe("GeoLeaf.Connector.openLoginModal()", () => {
    let Connector: {
        configure: (cfg: ConnectorConfig) => Promise<void>;
        openLoginModal: () => Promise<void>;
    };
    let TokenStore: Record<string, ReturnType<typeof vi.fn>>;
    let showLoginModal: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register: vi.fn() },
        };
        await import("../entry.js");
        Connector = ((globalThis as Record<string, unknown>)["GeoLeaf"] as Record<string, unknown>)[
            "Connector"
        ] as typeof Connector;
        const ts = await import("../token-store.js");
        TokenStore = ts.TokenStore as unknown as Record<string, ReturnType<typeof vi.fn>>;
        const lu = await import("../login-ui.js");
        showLoginModal = lu.showLoginModal as ReturnType<typeof vi.fn>;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
        delete (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"];
    });

    it("throws ConfigError when called before configure() (no auth configured)", async () => {
        await expect(Connector.openLoginModal()).rejects.toThrow(
            /openLoginModal\(\) requires auth/
        );
    });

    it("calls showLoginModal when auth is configured", async () => {
        TokenStore["getTokenAsync"].mockResolvedValue("tok");
        await Connector.configure(AUTH_UI_CONFIG);
        showLoginModal.mockClear();

        await Connector.openLoginModal();
        expect(showLoginModal).toHaveBeenCalledWith(AUTH_UI_CONFIG);
    });
});

// ─── Guided reconnection ─────────────────────────────────────────────────────

describe("reconnexion guidée — l'événement d'échec d'auth avait DEUX émetteurs et zéro écouteur", () => {
    // 🛑 `geoleaf:connector:auth-error` was emitted by the interceptor AND by the store,
    // and listened to by nobody: the session ended in silence at the worst moment — the
    // return of network, when the outbox is waiting to be pushed. The component that
    // reopens it already existed (`showLoginModal`); only the link was missing.
    let Connector: { configure: (cfg: ConnectorConfig) => Promise<void> };
    let TokenStore: Record<string, ReturnType<typeof vi.fn>>;
    let showLoginModal: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ TokenStore } = (await import("../token-store.js")) as unknown as {
            TokenStore: Record<string, ReturnType<typeof vi.fn>>;
        });
        TokenStore["getTokenAsync"].mockResolvedValue("tok");
        ({ showLoginModal } = (await import("../login-ui.js")) as unknown as {
            showLoginModal: ReturnType<typeof vi.fn>;
        });
        Connector = (await import("../connector-api.js")) as unknown as typeof Connector;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    });

    it("rouvre la fenêtre de connexion sur `auth-error` quand l'interface est autorisée", async () => {
        await Connector.configure(AUTH_UI_CONFIG);
        showLoginModal.mockClear();

        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:auth-error", {
                detail: { baseUrl: AUTH_UI_CONFIG.baseUrl },
            })
        );
        await new Promise((r) => setTimeout(r, 0));

        expect(showLoginModal).toHaveBeenCalledTimes(1);
    });

    it("🛑 ne la rouvre PAS quand `auth.ui` n'est pas demandée — le silence est le contrat", async () => {
        // An absent `auth.ui` means "the host owns the interface": opening a window an
        // integrator never asked for would be more intrusive than the defect being fixed.
        await Connector.configure(AUTH_CONFIG);
        showLoginModal.mockClear();

        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:auth-error", {
                detail: { baseUrl: AUTH_CONFIG.baseUrl },
            })
        );
        await new Promise((r) => setTimeout(r, 0));

        expect(showLoginModal).not.toHaveBeenCalled();
    });

    it("🛑 deux échecs rapprochés n'ouvrent qu'UNE fenêtre", async () => {
        // A drain pushes the queue entry by entry: without the guard, a failed tour
        // would open one window per capture.
        await Connector.configure(AUTH_UI_CONFIG);
        showLoginModal.mockClear();
        let resolveModal!: () => void;
        showLoginModal.mockReturnValue(new Promise<void>((r) => (resolveModal = r)));

        for (let i = 0; i < 3; i += 1) {
            document.dispatchEvent(
                new CustomEvent("geoleaf:connector:auth-error", {
                    detail: { baseUrl: AUTH_UI_CONFIG.baseUrl },
                })
            );
        }
        await new Promise((r) => setTimeout(r, 0));
        resolveModal();

        expect(showLoginModal).toHaveBeenCalledTimes(1);
    });
});

// ─── End of session ──────────────────────────────────────────────────────────

describe("logout() — la fin de session, qui n'existait pas", () => {
    // 🛑 There was NO way to end a session: the public surface carried `configure` and
    // `openLoginModal` only, `TokenStore.clear` had a single caller (the 401 path), and
    // the store's own docblock states that "sign-out must clear it here". A handed-back,
    // lent or lost device kept a valid Bearer until its expiry.
    let Connector: {
        configure: (cfg: ConnectorConfig) => Promise<void>;
        logout: () => Promise<void>;
    };
    let TokenStore: Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        ({ TokenStore } = (await import("../token-store.js")) as unknown as {
            TokenStore: Record<string, ReturnType<typeof vi.fn>>;
        });
        TokenStore["getTokenAsync"].mockResolvedValue("tok");
        const api = await import("../connector-api.js");
        Connector = api as unknown as typeof Connector;
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    });

    it("efface le jeton du magasin — RAM et base indexée", async () => {
        await Connector.configure(AUTH_CONFIG);
        TokenStore["clear"].mockClear();

        await Connector.logout();

        expect(TokenStore["clear"]).toHaveBeenCalledWith(AUTH_CONFIG.baseUrl);
    });

    it("émet `geoleaf:connector:signed-out` — un hôte doit pouvoir réagir", async () => {
        await Connector.configure(AUTH_CONFIG);
        const seen: CustomEvent[] = [];
        document.addEventListener("geoleaf:connector:signed-out", (e) =>
            seen.push(e as CustomEvent)
        );

        await Connector.logout();

        expect(seen.length).toBe(1);
        expect(seen[0].detail.baseUrl).toBe(AUTH_CONFIG.baseUrl);
    });

    it("🛑 en mode `getToken`, elle n'efface RIEN : le secret appartient à l'hôte", async () => {
        // The CDC's decision ⑧ makes `getToken` a PULL — no copy of the secret resides
        // in the plugin. Clearing a store it does not own would be theatre, and calling
        // it "logout" would lie about what happened.
        await Connector.configure(GETTOKEN_CONFIG);
        TokenStore["clear"].mockClear();

        await Connector.logout();

        expect(TokenStore["clear"]).not.toHaveBeenCalled();
    });

    it("sans configuration, elle ne jette pas", async () => {
        await expect(Connector.logout()).resolves.toBeUndefined();
    });
});
