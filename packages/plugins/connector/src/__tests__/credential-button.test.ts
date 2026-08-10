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

vi.mock("../login-ui.js", () => ({
    showLoginModal: vi.fn().mockResolvedValue(undefined),
}));

import { installCredentialButton, uninstallCredentialButton } from "../credential-button.js";
import { TokenStore } from "../token-store.js";
import { showLoginModal } from "../login-ui.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/auth",
        credentialButton: { enabled: true },
    },
};

const ICON_USER_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/auth",
        credentialButton: { enabled: true, iconVariant: "user" },
    },
};

function createDesktopTabs(): HTMLDivElement {
    const tabs = document.createElement("div");
    tabs.className = "gl-rp-tabs";
    document.body.appendChild(tabs);
    return tabs;
}

function createMobileToolbar(): HTMLDivElement {
    const toolbar = document.createElement("div");
    toolbar.className = "gl-map-toolbar";
    const scroll = document.createElement("div");
    scroll.className = "gl-map-toolbar__scroll";
    toolbar.appendChild(scroll);
    document.body.appendChild(toolbar);
    return toolbar;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("credential-button", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        uninstallCredentialButton();
        document.querySelectorAll(".gl-rp-tabs, .gl-map-toolbar").forEach((el) => el.remove());
        document.getElementById("gc-btn-style")?.remove();
        // Clean up global GeoLeaf
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    });

    describe("activation conditions", () => {
        it("no-op when credentialButton.enabled is false", () => {
            createDesktopTabs();
            const config: ConnectorConfig = {
                baseUrl: "https://api.example.com",
                auth: { endpoint: "https://api.example.com/auth" },
            };
            installCredentialButton(config);
            expect(document.querySelector(".gc-credential-btn")).toBeNull();
        });

        it("injects when credentialButton.enabled is true", () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);
            expect(document.querySelector(".gc-credential-btn")).not.toBeNull();
        });

        it("injects when GeoLeaf.Config.getActiveProfile().ui.showCredentialButton is true", () => {
            createDesktopTabs();
            (globalThis as Record<string, unknown>)["GeoLeaf"] = {
                Config: {
                    getActiveProfile: () => ({ ui: { showCredentialButton: true } }),
                },
            };
            const config: ConnectorConfig = {
                baseUrl: "https://api.example.com",
                auth: { endpoint: "https://api.example.com/auth" },
            };
            installCredentialButton(config);
            expect(document.querySelector(".gc-credential-btn")).not.toBeNull();
        });
    });

    describe("desktop injection", () => {
        it("injects button into .gl-rp-tabs", () => {
            const tabs = createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const btn = tabs.querySelector<HTMLButtonElement>(".gc-credential-btn");
            expect(btn).not.toBeNull();
            expect(btn!.dataset.variant).toBe("desktop");
            expect(btn!.getAttribute("aria-label")).toBe("Connexion");
            expect(btn!.title).toBe("Connexion");
        });

        it("injects a separator before the button", () => {
            const tabs = createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const separator = tabs.querySelector(".gc-credential-separator");
            expect(separator).not.toBeNull();
        });

        it("button contains an SVG icon", () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const btn = document.querySelector<HTMLButtonElement>(".gc-credential-btn")!;
            const svg = btn.querySelector("svg");
            expect(svg).not.toBeNull();
            expect(svg!.getAttribute("aria-hidden")).toBe("true");
        });
    });

    describe("mobile injection", () => {
        it("injects button into .gl-map-toolbar__scroll", () => {
            createMobileToolbar();
            installCredentialButton(BASE_CONFIG);

            const scroll = document.querySelector(".gl-map-toolbar__scroll")!;
            const btn = scroll.querySelector<HTMLButtonElement>(".gc-credential-btn");
            expect(btn).not.toBeNull();
            expect(btn!.dataset.variant).toBe("mobile");
            expect(btn!.classList.contains("gl-map-toolbar__btn")).toBe(true);
        });
    });

    describe("idempotence", () => {
        it("does not inject duplicate buttons on double install", () => {
            createDesktopTabs();
            createMobileToolbar();
            installCredentialButton(BASE_CONFIG);
            installCredentialButton(BASE_CONFIG);

            const buttons = document.querySelectorAll(".gc-credential-btn");
            expect(buttons.length).toBe(2); // 1 desktop + 1 mobile
        });
    });

    describe("uninstall", () => {
        it("removes buttons from DOM", () => {
            createDesktopTabs();
            createMobileToolbar();
            installCredentialButton(BASE_CONFIG);
            expect(document.querySelectorAll(".gc-credential-btn").length).toBe(2);

            uninstallCredentialButton();
            expect(document.querySelectorAll(".gc-credential-btn").length).toBe(0);
        });
    });

    describe("icon variants", () => {
        it("renders lock icon by default", () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const svg = document.querySelector(".gc-credential-btn svg")!;
            // Lock icon has a <rect> element
            expect(svg.querySelector("rect")).not.toBeNull();
        });

        it("renders user icon when iconVariant is 'user'", () => {
            createDesktopTabs();
            installCredentialButton(ICON_USER_CONFIG);

            const svg = document.querySelector(".gc-credential-btn svg")!;
            // User icon has a <circle> element
            expect(svg.querySelector("circle")).not.toBeNull();
        });
    });

    describe("click behavior", () => {
        it("dispatches connector:credential-button-clicked event", async () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const handler = vi.fn();
            document.addEventListener("connector:credential-button-clicked", handler);

            const btn = document.querySelector<HTMLButtonElement>(".gc-credential-btn")!;
            btn.click();

            // Allow async handler to execute
            await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

            expect(handler.mock.calls[0][0].detail).toEqual({
                baseUrl: "https://api.example.com",
                authenticated: false,
            });

            document.removeEventListener("connector:credential-button-clicked", handler);
        });

        it("opens login modal when not authenticated", async () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const btn = document.querySelector<HTMLButtonElement>(".gc-credential-btn")!;
            btn.click();

            await vi.waitFor(() => expect(showLoginModal).toHaveBeenCalledTimes(1));
            expect(showLoginModal).toHaveBeenCalledWith(BASE_CONFIG);
        });

        it("does not open modal when already authenticated", async () => {
            vi.mocked(TokenStore.getTokenAsync).mockResolvedValueOnce("valid.jwt.token");

            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            const handler = vi.fn();
            document.addEventListener("connector:credential-button-clicked", handler);

            const btn = document.querySelector<HTMLButtonElement>(".gc-credential-btn")!;
            btn.click();

            await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

            expect(handler.mock.calls[0][0].detail.authenticated).toBe(true);
            expect(showLoginModal).not.toHaveBeenCalled();

            document.removeEventListener("connector:credential-button-clicked", handler);
        });
    });

    describe("UI-only mode (no auth.endpoint)", () => {
        const UI_ONLY_CONFIG: ConnectorConfig = {
            baseUrl: "http://localhost",
            auth: {
                endpoint: "",
                credentialButton: { enabled: true },
            },
        };

        it("injects button when enabled via config even without auth.endpoint", () => {
            createDesktopTabs();
            installCredentialButton(UI_ONLY_CONFIG);
            expect(document.querySelector(".gc-credential-btn")).not.toBeNull();
        });

        it("click opens login modal and dispatches event (no token lookup)", async () => {
            createDesktopTabs();
            installCredentialButton(UI_ONLY_CONFIG);

            const handler = vi.fn();
            document.addEventListener("connector:credential-button-clicked", handler);

            const btn = document.querySelector<HTMLButtonElement>(".gc-credential-btn")!;
            btn.click();

            await vi.waitFor(() => expect(showLoginModal).toHaveBeenCalledTimes(1));
            expect(showLoginModal).toHaveBeenCalledWith(UI_ONLY_CONFIG);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].detail).toEqual({
                baseUrl: "http://localhost",
                authenticated: false,
            });
            // No endpoint → skip the token store, go straight to the modal.
            expect(TokenStore.getTokenAsync).not.toHaveBeenCalled();

            document.removeEventListener("connector:credential-button-clicked", handler);
        });
    });

    describe("CSS injection (CSP-safe — roadmap B.7)", () => {
        it("adopts the button stylesheet without creating a <style> element", () => {
            createDesktopTabs();
            installCredentialButton(BASE_CONFIG);

            // B.7: no <style> element is created (it would violate a strict
            // `style-src` without 'unsafe-inline').
            expect(document.getElementById("gc-btn-style")).toBeNull();

            // Styles are applied via a constructable stylesheet (adoptedStyleSheets).
            const adopted = Array.from(document.adoptedStyleSheets ?? []);
            const hasButtonRule = adopted.some((sheet) => {
                try {
                    return Array.from(sheet.cssRules).some((rule) =>
                        rule.cssText.includes(".gc-credential-btn")
                    );
                } catch {
                    return false;
                }
            });
            expect(hasButtonRule).toBe(true);
        });
    });
});
