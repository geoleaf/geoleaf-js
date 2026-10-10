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

        // ── The server's own motive (RFC 9457), and the event that carries it ───────────────

        /** Submits the form against a sign-in that rejects with `error`. */
        async function submitRefused(error: unknown): Promise<void> {
            const { AuthClient } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(error);
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());
            getLoginInput().value = "user@example.com";
            getPasswordInput().value = "pwd";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(getError().hidden).toBe(false));
        }

        /** An `AuthError` as `auth-client` throws it for a refusal that declared a problem. */
        async function refused(status: number, problem?: Record<string, unknown>) {
            const { AuthError } = await import("../auth-client.js");
            return Object.assign(new AuthError(`Authentication failed (${status})`), {
                status,
                ...(problem && { problem: { ...problem, body: problem } }),
            });
        }

        it("shows the server's `detail` under the generic label", async () => {
            await submitRefused(
                await refused(403, { title: "Refusé", detail: "Un second facteur est exigé." })
            );
            expect(getError().textContent).toContain("Authentication failed (403)");
            expect(getError().querySelector(".gc-error-reason")?.textContent).toBe(
                "Un second facteur est exigé."
            );
        });

        it("shows the `title` when the problem carries no `detail`", async () => {
            await submitRefused(await refused(403, { title: "Compte verrouillé" }));
            expect(getError().querySelector(".gc-error-reason")?.textContent).toBe(
                "Compte verrouillé"
            );
        });

        it("shows nothing more when the refusal declared no problem", async () => {
            await submitRefused(await refused(403));
            expect(getError().querySelector(".gc-error-reason")).toBeNull();
        });

        it("renders the motive as text, never as markup", async () => {
            const hostile = '<img src=x onerror="window.__pwned = true"><b>bold</b>';
            await submitRefused(await refused(403, { detail: hostile }));
            expect(getError().querySelector("img, b")).toBeNull();
            expect(getError().querySelector(".gc-error-reason")?.textContent).toBe(hostile);
        });

        it("bounds what it shows of a long motive", async () => {
            await submitRefused(await refused(403, { detail: "x".repeat(2000) }));
            const shown = getError().querySelector(".gc-error-reason")?.textContent ?? "";
            expect(shown.length).toBeLessThanOrEqual(301);
            expect(shown.endsWith("…")).toBe(true);
        });

        it("a second attempt does not keep the motive of the first", async () => {
            const { AuthClient, AuthError } = await import("../auth-client.js");
            await submitRefused(await refused(403, { detail: "Un second facteur est exigé." }));
            (AuthClient.login as ReturnType<typeof vi.fn>).mockRejectedValue(
                new AuthError("Invalid credentials")
            );
            getPasswordInput().value = "other";
            getForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await vi.waitFor(() =>
                expect(getError().textContent).toContain("Identifiant ou mot de passe incorrect")
            );
            expect(getError().querySelector(".gc-error-reason")).toBeNull();
        });

        it("dispatches geoleaf:connector:login-failed with the status and the problem", async () => {
            const seen: unknown[] = [];
            const listener = (e: Event) => seen.push((e as CustomEvent).detail);
            document.addEventListener("geoleaf:connector:login-failed", listener);
            try {
                const problem = { type: "about:blank", title: "Refusé", detail: "2FA", code: 7 };
                await submitRefused(await refused(403, problem));
                expect(seen).toEqual([
                    {
                        baseUrl: BASE_CONFIG.baseUrl,
                        error: "Authentication failed (403)",
                        status: 403,
                        problem: { ...problem, body: problem },
                    },
                ]);
            } finally {
                document.removeEventListener("geoleaf:connector:login-failed", listener);
            }
        });

        it("dispatches it for a failure that never reached the server, without a status", async () => {
            const { AuthError } = await import("../auth-client.js");
            const seen: unknown[] = [];
            const listener = (e: Event) => seen.push((e as CustomEvent).detail);
            document.addEventListener("geoleaf:connector:login-failed", listener);
            try {
                await submitRefused(new AuthError("Network unavailable"));
                expect(seen).toEqual([
                    { baseUrl: BASE_CONFIG.baseUrl, error: "Network unavailable" },
                ]);
            } finally {
                document.removeEventListener("geoleaf:connector:login-failed", listener);
            }
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

    describe("a single window", () => {
        it("a second call joins the open window instead of stacking another", async () => {
            const { AuthClient } = await import("../auth-client.js");
            (AuthClient.login as ReturnType<typeof vi.fn>).mockResolvedValue({
                token: "tok.en.jwt",
                expiresIn: 3600,
            });

            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());
            const second = showLoginModal(BASE_CONFIG);

            // Two windows carried the same ids (`gc-login`, `gc-password`…), each with its
            // own promise: signing in through one left the other open.
            expect(document.querySelectorAll(".gc-overlay")).toHaveLength(1);
            expect(document.querySelectorAll("#gc-login")).toHaveLength(1);

            const modal = getModal()!;
            modal.querySelector<HTMLInputElement>("#gc-login")!.value = "user@example.com";
            modal.querySelector<HTMLInputElement>("#gc-password")!.value = "secret";
            modal
                .querySelector("form")!
                .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

            // One sign-in settles both callers.
            await expect(promise).resolves.toBeUndefined();
            await expect(second).resolves.toBeUndefined();
            expect(getOverlay()).toBeNull();
        });

        it("dismissing the window rejects every caller that joined it", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());
            const second = showLoginModal(BASE_CONFIG);
            const settled = Promise.allSettled([promise, second]);

            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

            expect((await settled).map((r) => r.status)).toEqual(["rejected", "rejected"]);
        });

        it("opens a new window once the previous one has settled", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await promise.catch(() => {});

            promise = showLoginModal(BASE_CONFIG);
            expect(document.querySelectorAll(".gc-overlay")).toHaveLength(1);
        });

        it("does not join a window something else took out of the page", async () => {
            promise = showLoginModal(BASE_CONFIG);
            await vi.waitFor(() => expect(getOverlay()).not.toBeNull());
            // A host that clears the page: the first promise never settles, and joining it
            // would hand back a window nobody can see.
            getOverlay()!.remove();

            const second = showLoginModal(BASE_CONFIG);
            expect(document.querySelectorAll(".gc-overlay")).toHaveLength(1);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            await second.catch(() => {});
            promise = undefined;
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
