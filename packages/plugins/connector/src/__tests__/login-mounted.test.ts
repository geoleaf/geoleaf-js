/**
 * The login form mounted in an element of the host (`auth.ui.mount`), and the options both
 * presentations share: the notice, the reload after a sign-in, the password emptied as the
 * request leaves, the countdown of a `429`, the `"pair"` contract's sign-in.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ConnectorConfig } from "../config.js";

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
        status?: number;
        retryAfter?: number;
        constructor(message: string, answer?: { status: number; retryAfter?: number }) {
            super(message);
            this.name = "AuthError";
            if (answer) {
                this.status = answer.status;
                if (answer.retryAfter !== undefined) this.retryAfter = answer.retryAfter;
            }
        }
    },
    AuthClient: {
        login: vi.fn().mockResolvedValue({ token: "tok.en.jwt", expiresIn: 3600 }),
        refresh: vi.fn(),
    },
}));

vi.mock("../auth-pair-client.js", () => ({
    PairAuthClient: {
        login: vi.fn().mockResolvedValue({ accessToken: "at", expiresIn: 900, refreshToken: "rt" }),
    },
}));

vi.mock("../pair-session.js", () => ({
    PairSessions: { establish: vi.fn().mockResolvedValue(undefined) },
}));

import { showLoginModal } from "../login-ui.js";
import { AuthClient, AuthError } from "../auth-client.js";
import { PairAuthClient } from "../auth-pair-client.js";
import { PairSessions } from "../pair-session.js";

const BASE = "https://api.example.com";
let panel: HTMLElement;

const mounted = (ui: Record<string, unknown> = {}): ConnectorConfig => ({
    baseUrl: BASE,
    auth: { endpoint: `${BASE}/auth`, ui: { mount: panel, ...ui } },
});

function fillAndSubmit(login = "user", password = "pw"): void {
    (document.getElementById("gc-login") as HTMLInputElement).value = login;
    (document.getElementById("gc-password") as HTMLInputElement).value = password;
    document
        .getElementById("gc-login-form")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
}

beforeEach(() => {
    panel = document.createElement("aside");
    panel.id = "host-panel";
    document.body.appendChild(panel);
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("formulaire monté dans un élément de l'hôte", () => {
    it("🛑 le formulaire est dans l'élément, sans voile ni dialogue modal", async () => {
        const promise = showLoginModal(mounted());
        promise.catch(() => undefined);
        expect(panel.querySelector("#gc-login-form")).not.toBeNull();
        expect(document.querySelector(".gc-overlay")).toBeNull();
        expect(document.querySelector("[aria-modal]")).toBeNull();
        const section = panel.querySelector("section.gc-mount")!;
        expect(section.getAttribute("aria-labelledby")).toBe("gc-modal-title");
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
        await expect(promise).rejects.toThrow("Modal closed by user");
    });

    it("une fonction de montage est appelée à l'ouverture", async () => {
        const mount = vi.fn(() => panel);
        const promise = showLoginModal({
            baseUrl: BASE,
            auth: { endpoint: `${BASE}/auth`, ui: { mount } },
        });
        promise.catch(() => undefined);
        expect(mount).toHaveBeenCalledTimes(1);
        expect(panel.querySelector("#gc-login-form")).not.toBeNull();
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
        await promise.catch(() => undefined);
    });

    it("🛑 le bouton de fermeture rend la main à l'hôte : onDismiss, formulaire retiré", async () => {
        const onDismiss = vi.fn();
        const promise = showLoginModal(mounted({ onDismiss }));
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
        await expect(promise).rejects.toThrow("Modal closed by user");
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(panel.childElementCount).toBe(0);
    });

    it("🛑 Échap sur le formulaire appelle onDismiss ; Échap ailleurs dans la page, non", async () => {
        const onDismiss = vi.fn();
        const promise = showLoginModal(mounted({ onDismiss }));
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onDismiss).not.toHaveBeenCalled();
        document
            .getElementById("gc-login")!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await expect(promise).rejects.toThrow("Modal closed by user");
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("le focus va au premier champ", async () => {
        const promise = showLoginModal(mounted());
        promise.catch(() => undefined);
        await vi.waitFor(() => expect(document.activeElement?.id).toBe("gc-login"));
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
    });

    it("pas de piège de focus : Tab sur le dernier élément n'est pas retenu", async () => {
        const promise = showLoginModal(mounted());
        promise.catch(() => undefined);
        const submit = panel.querySelector<HTMLButtonElement>("button[type=submit]")!;
        submit.focus();
        const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        submit.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(false);
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
    });

    it("une connexion réussie retire le formulaire et résout", async () => {
        const promise = showLoginModal(mounted());
        fillAndSubmit();
        await expect(promise).resolves.toBeUndefined();
        expect(panel.childElementCount).toBe(0);
    });

    it("un onDismiss qui lève ne retient pas la promesse", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const promise = showLoginModal(
            mounted({
                onDismiss: () => {
                    throw new Error("host bug");
                },
            })
        );
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
        await expect(promise).rejects.toThrow("Modal closed by user");
    });
});

describe("options communes aux deux présentations", () => {
    it.each([
        ["modale", (ui: Record<string, unknown>) => ({ ...ui })],
        ["montée", (ui: Record<string, unknown>) => ({ mount: panel, ...ui })],
    ])("le texte d'avertissement s'affiche au-dessus des champs (%s)", async (_name, ui) => {
        const promise = showLoginModal({
            baseUrl: BASE,
            auth: { endpoint: `${BASE}/auth`, ui: ui({ notice: "<b>Appareil partagé ?</b>" }) },
        });
        promise.catch(() => undefined);
        const notice = document.querySelector(".gc-notice")!;
        // Rendered as text, never parsed.
        expect(notice.textContent).toBe("<b>Appareil partagé ?</b>");
        expect(notice.querySelector("b")).toBeNull();
        expect(
            notice.compareDocumentPosition(document.getElementById("gc-login-form")!) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        (document.querySelector(".gc-close") as HTMLButtonElement).click();
        await promise.catch(() => undefined);
    });

    it("🛑 le mot de passe est effacé du champ dès l'envoi, avant la réponse", async () => {
        let answer!: (v: { token: string; expiresIn: number }) => void;
        vi.mocked(AuthClient.login).mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const promise = showLoginModal(mounted());
        fillAndSubmit("user", "pw-secret");
        expect((document.getElementById("gc-password") as HTMLInputElement).value).toBe("");
        expect(AuthClient.login).toHaveBeenCalledWith(`${BASE}/auth`, "user", "pw-secret");
        answer({ token: "t", expiresIn: 60 });
        await promise;
    });

    it("rechargement de la page après une connexion réussie, sur demande", async () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        const promise = showLoginModal(mounted({ reloadOnSuccess: true }));
        fillAndSubmit();
        await promise;
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("pas de rechargement sans la demande", async () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        const promise = showLoginModal(mounted());
        fillAndSubmit();
        await promise;
        expect(reload).not.toHaveBeenCalled();
    });

    it("🛑 429 avec Retry-After : bouton désactivé, compte à rebours, puis rendu", async () => {
        vi.useFakeTimers();
        vi.mocked(AuthClient.login).mockRejectedValueOnce(
            new AuthError("Too many attempts", { status: 429, retryAfter: 3 })
        );
        const promise = showLoginModal(mounted());
        promise.catch(() => undefined);
        fillAndSubmit();
        await vi.advanceTimersByTimeAsync(0);
        const submit = panel.querySelector<HTMLButtonElement>("button[type=submit]")!;
        const error = document.getElementById("gc-error")!;
        expect(submit.disabled).toBe(true);
        expect(error.textContent).toContain("3 s");
        await vi.advanceTimersByTimeAsync(1000);
        expect(error.textContent).toContain("2 s");
        await vi.advanceTimersByTimeAsync(2000);
        expect(submit.disabled).toBe(false);
        expect(error.hidden).toBe(true);
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
    });

    it("429 sans Retry-After : un message, le bouton rendu", async () => {
        vi.mocked(AuthClient.login).mockRejectedValueOnce(
            new AuthError("Too many attempts", { status: 429 })
        );
        const promise = showLoginModal(mounted());
        promise.catch(() => undefined);
        fillAndSubmit();
        await vi.waitFor(() =>
            expect(document.getElementById("gc-error")!.textContent).toContain("plus tard")
        );
        expect(panel.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(false);
        (panel.querySelector(".gc-close") as HTMLButtonElement).click();
    });
});

describe("connexion sous le contrat pair", () => {
    it("passe par le client pair, et stocke la paire par la session pair", async () => {
        const promise = showLoginModal({
            baseUrl: BASE,
            auth: {
                endpoint: `${BASE}/auth/token`,
                contract: "pair",
                refreshEndpoint: `${BASE}/auth/refresh`,
                ui: { mount: panel },
            },
        });
        fillAndSubmit("user", "pw");
        await promise;
        expect(PairAuthClient.login).toHaveBeenCalledWith(`${BASE}/auth/token`, "user", "pw");
        expect(PairSessions.establish).toHaveBeenCalledWith(BASE, {
            accessToken: "at",
            expiresIn: 900,
            refreshToken: "rt",
        });
        expect(AuthClient.login).not.toHaveBeenCalled();
    });
});
