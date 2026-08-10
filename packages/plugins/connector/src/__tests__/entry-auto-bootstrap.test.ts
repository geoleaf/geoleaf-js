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
    };
}

function resetEnv(): void {
    document.body.innerHTML = "";
    document.getElementById("gc-btn-style")?.remove();
    delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    // Reset module graph so entry.ts re-runs its top-level code per test
    vi.resetModules();
}

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
