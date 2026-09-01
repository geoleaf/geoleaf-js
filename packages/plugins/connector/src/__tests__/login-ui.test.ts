import { describe, it, expect, vi, afterEach } from "vitest";
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
    AuthError: class AuthError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "AuthError";
        }
    },
    AuthClient: {
        login: vi.fn().mockResolvedValue({ token: "tok.en.jwt", expiresIn: 3600 }),
        refresh: vi.fn().mockResolvedValue(null),
    },
}));

import { showLoginModal } from "../login-ui.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: { endpoint: "https://api.example.com/auth", ui: true },
};

const CONFIG_WITH_LINKS: ConnectorConfig = {
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/auth",
        ui: true,
        signupUrl: "https://app.example.com/signup",
        forgotPasswordUrl: "https://app.example.com/forgot",
    },
};

function getOverlay(): HTMLElement | null {
    return document.querySelector(".gc-overlay");
}

function getModal(): HTMLElement | null {
    return document.querySelector(".gc-modal");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("showLoginModal", () => {
    let promise: Promise<void> | undefined;

    afterEach(async () => {
        // Dismiss any open modal to avoid dangling promises
        const overlay = getOverlay();
        if (overlay) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        }
        if (promise) {
            await promise.catch(() => {});
            promise = undefined;
        }
        // Clean up any remaining overlays
        document.querySelectorAll(".gc-overlay").forEach((el) => el.remove());
        document.getElementById("gc-style")?.remove();
    });

    describe("close button", () => {
        it("renders a close button with aria-label 'Fermer'", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const closeBtn = getModal()!.querySelector<HTMLButtonElement>(".gc-close");
            expect(closeBtn).not.toBeNull();
            expect(closeBtn!.getAttribute("aria-label")).toBe("Fermer");
        });

        it("rejects promise when close button is clicked", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const closeBtn = getModal()!.querySelector<HTMLButtonElement>(".gc-close")!;
            closeBtn.click();

            await expect(promise).rejects.toThrow("Modal closed by user");
            expect(getOverlay()).toBeNull();
        });
    });

    describe("overlay click close", () => {
        it("rejects promise when overlay background is clicked", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const overlay = getOverlay()!;
            // Click directly on overlay (not modal)
            overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            await expect(promise).rejects.toThrow("Modal closed by user");
            expect(getOverlay()).toBeNull();
        });

        it("does NOT close when clicking inside the modal", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const modal = getModal()!;
            modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            // Modal should still be present
            expect(getOverlay()).not.toBeNull();
            // afterEach will clean up the dangling promise
        });
    });

    describe("Escape key close", () => {
        it("rejects promise when Escape is pressed", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

            await expect(promise).rejects.toThrow("Modal closed by user");
            expect(getOverlay()).toBeNull();
        });
    });

    describe("external links", () => {
        it("shows signup link when signupUrl is configured", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const signupLink = document.querySelector<HTMLAnchorElement>("#gc-link-signup");
            expect(signupLink).not.toBeNull();
            expect(signupLink!.hidden).toBe(false);
            expect(signupLink!.href).toContain("signup");
            expect(signupLink!.target).toBe("_blank");
            expect(signupLink!.rel).toBe("noopener noreferrer");

            // Clean up
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("shows forgot link when forgotPasswordUrl is configured", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const forgotLink = document.querySelector<HTMLAnchorElement>("#gc-link-forgot");
            expect(forgotLink).not.toBeNull();
            expect(forgotLink!.hidden).toBe(false);
            expect(forgotLink!.href).toContain("forgot");
            expect(forgotLink!.target).toBe("_blank");
            expect(forgotLink!.rel).toBe("noopener noreferrer");

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("hides links container when no URLs configured", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const linksDiv = getModal()!.querySelector<HTMLDivElement>(".gc-links");
            expect(linksDiv).not.toBeNull();
            expect(linksDiv!.hidden).toBe(true);

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("shows links container when at least one URL is configured", async () => {
            const config: ConnectorConfig = {
                baseUrl: "https://api.example.com",
                auth: {
                    endpoint: "https://api.example.com/auth",
                    ui: true,
                    signupUrl: "https://app.example.com/signup",
                },
            };
            promise = showLoginModal(config);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const linksDiv = getModal()!.querySelector<HTMLDivElement>(".gc-links");
            expect(linksDiv!.hidden).toBe(false);

            // forgotLink should still be hidden
            const forgotLink = document.querySelector<HTMLAnchorElement>("#gc-link-forgot");
            expect(forgotLink!.hidden).toBe(true);

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });
    });

    describe("cancelable link events", () => {
        it("dispatches geoleaf:connector:signup-requested on signup link click", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const handler = vi.fn();
            document.addEventListener("geoleaf:connector:signup-requested", handler);

            const signupLink = document.querySelector<HTMLAnchorElement>("#gc-link-signup")!;
            signupLink.click();

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].detail).toEqual({
                url: "https://app.example.com/signup",
            });

            document.removeEventListener("geoleaf:connector:signup-requested", handler);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("dispatches geoleaf:connector:forgot-password-requested on forgot link click", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const handler = vi.fn();
            document.addEventListener("geoleaf:connector:forgot-password-requested", handler);

            const forgotLink = document.querySelector<HTMLAnchorElement>("#gc-link-forgot")!;
            forgotLink.click();

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].detail).toEqual({
                url: "https://app.example.com/forgot",
            });

            document.removeEventListener("geoleaf:connector:forgot-password-requested", handler);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("blocks link navigation when app calls preventDefault on signup event", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            // App listener that cancels the event
            const handler = (e: Event) => e.preventDefault();
            document.addEventListener("geoleaf:connector:signup-requested", handler);

            const signupLink = document.querySelector<HTMLAnchorElement>("#gc-link-signup")!;
            const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
            signupLink.dispatchEvent(clickEvent);

            // The link click event should have been prevented
            expect(clickEvent.defaultPrevented).toBe(true);

            document.removeEventListener("geoleaf:connector:signup-requested", handler);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });
    });

    describe("submit handler", () => {
        function getForm(): HTMLFormElement {
            return document.querySelector<HTMLFormElement>("#gc-login-form")!;
        }
        function getError(): HTMLElement {
            return document.querySelector<HTMLElement>(".gc-error")!;
        }
        function getSubmitBtn(): HTMLButtonElement {
            return document.querySelector<HTMLButtonElement>("[type=submit]")!;
        }
        function getLoginInput(): HTMLInputElement {
            return document.querySelector<HTMLInputElement>("#gc-login")!;
        }
        function getPasswordInput(): HTMLInputElement {
            return document.querySelector<HTMLInputElement>("#gc-password")!;
        }

        it("shows error when fields are empty on submit", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("remplir");
        });

        it("shows error when only login is filled (password empty)", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("remplir");
        });

        it("disables fields while submitting (setLoading=true)", async () => {
            const { AuthClient } = await import("../auth-client.js");
            let resolveLogin: () => void;
            (AuthClient.login as ReturnType<typeof vi.fn>).mockReturnValue(
                new Promise<{ token: string; expiresIn: number }>((res) => {
                    resolveLogin = () => res({ token: "tok.en.jwt", expiresIn: 3600 });
                })
            );

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "password123";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getSubmitBtn().disabled).toBe(true));
            expect(getLoginInput().disabled).toBe(true);
            expect(getSubmitBtn().textContent).toContain("Connexion");

            resolveLogin!();
            await promise;
        });

        it("resolves the promise on successful login and dispatches geoleaf:connector:authenticated", async () => {
            const { AuthClient } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockResolvedValue({
                token: "tok.en.jwt",
                expiresIn: 3600,
            });

            const handler = vi.fn();
            document.addEventListener("geoleaf:connector:authenticated", handler);

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "secret";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await promise;
            expect(getOverlay()).toBeNull();
            expect(handler).toHaveBeenCalledTimes(1);

            document.removeEventListener("geoleaf:connector:authenticated", handler);
        });

        it("shows 'Identifiant ou mot de passe incorrect' on AuthError Invalid credentials", async () => {
            const { AuthClient, AuthError } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(
                new AuthError("Invalid credentials")
            );

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "wrong";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("Identifiant ou mot de passe incorrect");
            expect(getPasswordInput().value).toBe("");
        });

        it("shows network error message on AuthError Network unavailable", async () => {
            const { AuthClient, AuthError } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(
                new AuthError("Network unavailable")
            );

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "pw";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("Serveur inaccessible");
        });

        it("shows 'Erreur : ...' for other AuthError messages", async () => {
            const { AuthClient, AuthError } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(
                new AuthError("Account locked")
            );

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "pw";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("Erreur : Account locked");
        });

        it("shows unexpected error message for non-AuthError exceptions", async () => {
            const { AuthClient } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error("Unexpected network failure")
            );

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "pw";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("inattendue");
        });

        it("shows error when auth.endpoint is missing in config", async () => {
            const noEndpointConfig: ConnectorConfig = {
                baseUrl: "https://api.example.com",
                auth: { endpoint: "", ui: true },
            };

            promise = showLoginModal(noEndpointConfig);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "pw";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            await vi.waitFor(() => expect(getError().hidden).toBe(false));
            expect(getError().textContent).toContain("endpoint manquant");
        });
    });

    describe("focus trap includes links", () => {
        it("includes visible links in focusable elements selector", async () => {
            promise = showLoginModal(CONFIG_WITH_LINKS);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const overlay = getOverlay()!;
            const focusable = Array.from(
                overlay.querySelectorAll<HTMLElement>(
                    "input:not([disabled]), button:not([disabled]), a[href]:not([hidden])"
                )
            );

            // Expected: closeBtn, loginInput, passwordInput, submitBtn, signupLink, forgotLink
            expect(focusable.length).toBeGreaterThanOrEqual(6);

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });
    });

    describe("accessibility", () => {
        it("has proper dialog attributes", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const overlay = getOverlay()!;
            expect(overlay.getAttribute("role")).toBe("dialog");
            expect(overlay.getAttribute("aria-modal")).toBe("true");
            expect(overlay.getAttribute("aria-labelledby")).toBe("gc-modal-title");

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });

        it("close button contains an SVG icon", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());

            const closeBtn = getModal()!.querySelector<HTMLButtonElement>(".gc-close")!;
            const svg = closeBtn.querySelector("svg");
            expect(svg).not.toBeNull();
            expect(svg!.getAttribute("aria-hidden")).toBe("true");

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});
        });
    });
});
