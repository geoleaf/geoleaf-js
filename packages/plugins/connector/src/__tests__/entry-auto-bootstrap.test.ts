import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks shared across all imports of entry.ts
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

function setupDom(): void {
    const tabs = document.createElement("div");
    tabs.className = "gl-rp-tabs";
    document.body.appendChild(tabs);
}

/**
 * Mocks the GeoLeaf.Config.getActiveProfile() API used by the plugin to read
 * profile.ui.showCredentialButton. Passing null simulates the pre-profile-load
 * state (Config exists but no active profile yet).
 */
function setActiveProfile(ui: { showCredentialButton?: boolean } | null): void {
    (globalThis as Record<string, unknown>)["GeoLeaf"] = {
        Config: {
            getActiveProfile: () => (ui === null ? null : { ui }),
        },
        plugins: { register: vi.fn() },
        registry: { register: registerModule, isInitialized: () => false },
    };
}

/** What the entry hands to the core's module registry — reset with the environment. */
let registerModule = vi.fn();

/** The teardown the entry registered: what `GeoLeaf.mount()`'s `unmount()` calls. */
function teardown(): void {
    const module = registerModule.mock.calls[0]?.[0] as { id: string; destroy: () => void };
    expect(module?.id).toBe("connector");
    module.destroy();
}

function resetEnv(): void {
    // The entry evaluated by the previous test may still be waiting for its bars, behind a
    // mutation observer: left alive, it injects ITS button into the DOM of the next test.
    (registerModule.mock.calls[0]?.[0] as { destroy?: () => void } | undefined)?.destroy?.();
    document.body.innerHTML = "";
    document.getElementById("gc-btn-style")?.remove();
    delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    registerModule = vi.fn();
    // Reset module graph so entry.ts re-runs its top-level code per test
    vi.resetModules();
}

// ⚠️ The entry attaches its listeners to `document` FOR THE LIFE OF THE PAGE, and
// `vi.resetModules()` does not remove them: every test would leave behind an entry that still
// answers the events of the next one — and, being older, answers them first. They used to be
// `{ once: true }`, which hid this. Tracked and removed here, as `maplibre-bridge.test.ts` does.
const _tracked: Array<[string, EventListenerOrEventListenerObject]> = [];
const _origAdd = document.addEventListener.bind(document);
let _addSpy: { mockRestore: () => void } | null = null;

beforeEach(() => {
    _addSpy = vi
        .spyOn(document, "addEventListener")
        .mockImplementation(
            (
                type: string,
                fn: EventListenerOrEventListenerObject,
                options?: boolean | AddEventListenerOptions
            ) => {
                _tracked.push([type, fn]);
                _origAdd(type, fn, options);
            }
        );
});

afterEach(() => {
    for (const [type, fn] of _tracked) document.removeEventListener(type, fn);
    _tracked.length = 0;
    _addSpy?.mockRestore();
    _addSpy = null;
});

describe("entry.ts — auto-bootstrap UI-only from ui.showCredentialButton", () => {
    beforeEach(() => {
        resetEnv();
    });

    afterEach(() => {
        resetEnv();
    });

    it("mounts the credential button on geoleaf:profile:loaded when flag is true", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });

        await import("../entry.js");

        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));

        // .gl-rp-tabs exists and profile is readable — injection is synchronous.
        expect(document.querySelector(".gl-rp-tabs .gc-credential-btn")).not.toBeNull();
    });

    it("mounts on geoleaf:map:ready when profile:loaded did not fire", async () => {
        setupDom();
        // Profile not yet loaded when the plugin initializes.
        setActiveProfile(null);
        await import("../entry.js");

        // Later: core finishes loading the profile and dispatches map:ready.
        setActiveProfile({ showCredentialButton: true });
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelector(".gl-rp-tabs .gc-credential-btn")).not.toBeNull();
    });

    it("does NOT mount when ui.showCredentialButton is false", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: false });
        await import("../entry.js");

        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelector(".gc-credential-btn")).toBeNull();
    });

    it("does NOT mount when GeoLeaf.Config.getActiveProfile() returns null", async () => {
        setupDom();
        setActiveProfile(null);
        await import("../entry.js");

        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelector(".gc-credential-btn")).toBeNull();
    });

    it("fallback path: flag already true when entry.ts loads", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        // No event dispatch — the synchronous fallback inside entry.ts must mount.
        await import("../entry.js");

        expect(document.querySelector(".gl-rp-tabs .gc-credential-btn")).not.toBeNull();
    });

    it("is idempotent: second event does not duplicate the button", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");

        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        const buttons = document.querySelectorAll(".gl-rp-tabs .gc-credential-btn");
        expect(buttons.length).toBe(1);
    });
});

// `GeoLeaf.mount()` unmounts the application and boots it again. The credential button sits
// in the core's bars, which go with the application and are built anew. Measured in a real
// browser: two buttons after the first boot, NONE after the next mount — the two listeners
// were `{ once: true }` behind a one-way latch.
describe("entry.ts — the credential button, application after application", () => {
    beforeEach(() => {
        resetEnv();
    });

    afterEach(() => {
        resetEnv();
    });

    it("registers its teardown with the core's module registry, without a toolbar slot", async () => {
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");

        expect(registerModule).toHaveBeenCalledTimes(1);
        const module = registerModule.mock.calls[0]![0] as Record<string, unknown>;
        expect(module["id"]).toBe("connector");
        expect(module["destroy"]).toBeTypeOf("function");
        expect("ui" in module).toBe(false);
    });

    it("🛑 the teardown removes the button and its separator", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");
        expect(document.querySelectorAll(".gc-credential-btn").length).toBe(1);

        teardown();

        expect(document.querySelectorAll(".gc-credential-btn").length).toBe(0);
        expect(document.querySelectorAll(".gc-credential-separator").length).toBe(0);
    });

    it("🛑 the next boot installs the button again, in the bars of the new application", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");
        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        // unmount(): the bars leave the page, then the teardown runs.
        document.body.innerHTML = "";
        teardown();

        // mount(): a new boot, new bars, the same events.
        setupDom();
        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelectorAll(".gl-rp-tabs .gc-credential-btn").length).toBe(1);
    });

    it("the signals of ONE boot still install a single button", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");
        // The core emits `geoleaf:map:ready` several times per boot.
        document.dispatchEvent(new CustomEvent("geoleaf:profile:loaded"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelectorAll(".gc-credential-btn").length).toBe(1);
    });

    it("🛑 a CONFIGURED connector gets its button back too — and keeps window.fetch", async () => {
        setupDom();
        setActiveProfile({ showCredentialButton: true });
        await import("../entry.js");
        const { install, uninstall } = await import("../fetch-interceptor.js");
        const Connector = (
            (globalThis as Record<string, unknown>)["GeoLeaf"] as {
                Connector: { configure: (config: unknown) => Promise<void> };
            }
        ).Connector;
        // The host supplies the token; the profile asks for the button.
        await Connector.configure({
            baseUrl: "https://api.example.com",
            getToken: () => "host-token",
        });
        expect(document.querySelectorAll(".gc-credential-btn").length).toBe(1);
        expect(install).toHaveBeenCalledTimes(1);

        document.body.innerHTML = "";
        teardown();
        // The session is the host's: the teardown of an application does not give fetch back.
        expect(uninstall).not.toHaveBeenCalled();

        setupDom();
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));

        expect(document.querySelectorAll(".gl-rp-tabs .gc-credential-btn").length).toBe(1);
    });
});
