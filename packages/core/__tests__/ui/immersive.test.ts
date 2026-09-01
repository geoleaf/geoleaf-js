/**
 * `kernel/ui/immersive` — the UI mode that strips the chrome, and its fullscreen claim.
 *
 * 🛑 The interesting half is the CLAIM, not the class. Two callers can now ask the document for
 * fullscreen — this module and the toolbar button — and neither can read back who asked:
 * `document.fullscreenElement` says the page IS fullscreen, never why. Exiting on that alone
 * would throw a user out of a fullscreen they entered themselves. So ownership is tracked, and
 * these tests are mostly about the paths where it must NOT act.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setImmersive, isImmersive } from "../../src/kernel/ui/immersive.js";

/** Installs a doubled Fullscreen API on the jsdom document, which ships none. */
function stubFullscreen(): { request: ReturnType<typeof vi.fn>; exit: ReturnType<typeof vi.fn> } {
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: request,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(document, "exitFullscreen", {
        value: exit,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
        writable: true,
    });
    return { request, exit };
}

/** Pretends the browser granted (or ended) fullscreen, and fires the event the browser fires. */
function setFullscreenElement(el: Element | null): void {
    Object.defineProperty(document, "fullscreenElement", {
        value: el,
        configurable: true,
        writable: true,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
}

describe("setImmersive", () => {
    beforeEach(() => {
        document.body.className = "";
    });
    afterEach(() => {
        setImmersive(false);
        vi.restoreAllMocks();
    });

    it("pose et retire la classe, et l'état SE LIT dans le DOM", () => {
        // No shadow variable: the class IS the state, so the answer cannot drift from what the
        // user sees.
        expect(isImmersive()).toBe(false);
        setImmersive(true);
        expect(document.body.classList.contains("gl-immersive")).toBe(true);
        expect(isImmersive()).toBe(true);
        setImmersive(false);
        expect(isImmersive()).toBe(false);
    });

    it("est idempotent dans les deux sens", () => {
        setImmersive(true);
        setImmersive(true);
        expect(
            document.body.className.split(/\s+/).filter((c) => c === "gl-immersive")
        ).toHaveLength(1);
        setImmersive(false);
        setImmersive(false);
        expect(isImmersive()).toBe(false);
    });

    it("🛑 ne demande le plein écran QUE si on le lui demande", () => {
        const { request } = stubFullscreen();
        setImmersive(true);
        expect(request).not.toHaveBeenCalled();
    });

    it("vise `documentElement`, jamais un conteneur — sinon les toasts cessent d'être rendus", () => {
        // Anything outside the fullscreen subtree is not mispositioned, it is NOT RENDERED. The
        // notification container is appended to `document.body`, and guidance is precisely when
        // "GPS lost" and "could not recompute" need to reach the driver.
        const { request } = stubFullscreen();
        setImmersive(true, { fullscreen: true });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.instances[0]).toBe(document.documentElement);
    });

    it("🛑 ne SORT pas d'un plein écran qu'il n'a pas demandé", () => {
        // The user pressed the toolbar button first, then started a session. Ending the session
        // must not eject them from a fullscreen they chose.
        const { request, exit } = stubFullscreen();
        setFullscreenElement(document.documentElement);
        setImmersive(true, { fullscreen: true });
        expect(request).not.toHaveBeenCalled();
        setImmersive(false, { fullscreen: true });
        expect(exit).not.toHaveBeenCalled();
    });

    it("sort du plein écran qu'il a demandé", async () => {
        const { exit } = stubFullscreen();
        setImmersive(true, { fullscreen: true });
        await Promise.resolve();
        setFullscreenElement(document.documentElement);
        setImmersive(false, { fullscreen: true });
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it("🛑 un `Échap` de l'utilisateur relâche la revendication, il n'annule PAS le mode", () => {
        // Leaving fullscreen does not end whatever asked for the mode. Stripping the chrome back
        // in mid-session would be a second surprise on top of the first — and the caller, not
        // this module, decides when the mode is over.
        const { exit } = stubFullscreen();
        setImmersive(true, { fullscreen: true });
        setFullscreenElement(document.documentElement);
        setFullscreenElement(null); // Escape
        expect(isImmersive()).toBe(true);
        setImmersive(false, { fullscreen: true });
        expect(exit).not.toHaveBeenCalled();
    });

    it("un navigateur SANS API plein écran garde le mode — il ne jette pas", () => {
        // `requestFullscreen` is absent from jsdom and refused by several embedded browsers. A
        // mode that threw there would fail on the setups where the rest of it works.
        // The cast is what makes the delete legal — no `@ts-expect-error` needed, and an unused
        // one is itself a type error under this repository's ratchet.
        delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
        expect(() => setImmersive(true, { fullscreen: true })).not.toThrow();
        expect(isImmersive()).toBe(true);
    });

    it("un refus du navigateur n'emporte rien", async () => {
        const request = vi.fn(() => Promise.reject(new Error("no transient activation")));
        Object.defineProperty(document.documentElement, "requestFullscreen", {
            value: request,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(document, "fullscreenElement", {
            value: null,
            configurable: true,
            writable: true,
        });
        expect(() => setImmersive(true, { fullscreen: true })).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();
        expect(isImmersive()).toBe(true);
    });
});
