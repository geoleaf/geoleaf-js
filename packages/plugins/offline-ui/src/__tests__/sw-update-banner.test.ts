/**
 * « A NEW VERSION IS READY » — THE BANNER THAT ASKS BEFORE THE APPLICATION CHANGES.
 *
 * 🛑 A new service worker no longer takes a page that is in use (`@geoleaf/core`): it waits,
 * and says so — `geoleaf:sw:update-waiting`. A worker that waits with no interface waits for
 * every tab to be closed. This banner is that interface: it asks, and its button is the
 * answer — `GeoLeaf.PWA.applyUpdate()`.
 *
 * ⚠️ What is held here: the banner shows on the FACT (the event, or the state read at a
 * boot), never by itself; it reloads nothing by itself; and it goes away with the application
 * it belongs to.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { removeSwUpdateBanner, wireSwUpdateBanner } from "../core/sw-update-banner.js";

let pwa: { isUpdateWaiting: ReturnType<typeof vi.fn>; applyUpdate: ReturnType<typeof vi.fn> };

function installGeoLeaf(waiting = false): void {
    pwa = { isUpdateWaiting: vi.fn(() => waiting), applyUpdate: vi.fn(() => true) };
    (globalThis as any).GeoLeaf = { PWA: pwa };
}

const banner = () => document.getElementById("gl-sw-update-banner");
const button = (action: string) =>
    banner()?.querySelector<HTMLButtonElement>(`[data-gl-action="${action}"]`) ?? null;
const emit = (name: string) => document.dispatchEvent(new CustomEvent(name, { detail: {} }));

// The module keeps its wiring at MODULE level, and wiring again replaces it: each case starts
// from a wiring of its own — listeners, and the « later » answered — whatever the previous one
// left.
beforeEach(() => {
    installGeoLeaf();
    wireSwUpdateBanner();
});

afterEach(() => {
    delete (globalThis as any).GeoLeaf;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("le bandeau de mise à jour", () => {
    test("rien n'attend : pas de bandeau", () => {
        expect(banner()).toBeNull();
        emit("geoleaf:app:ready");
        expect(banner()).toBeNull();
    });

    test("🛑 une mise à jour en attente l'affiche — une fois, avec un geste et une sortie", () => {
        emit("geoleaf:sw:update-waiting");
        emit("geoleaf:sw:update-waiting");

        expect(document.querySelectorAll("#gl-sw-update-banner")).toHaveLength(1);
        // Announced to assistive technology without taking the focus from a form being filled.
        expect(banner()?.getAttribute("role")).toBe("status");
        expect(banner()?.textContent).toBeTruthy();
        expect(button("sw-update-apply")?.textContent).toBeTruthy();
        expect(button("sw-update-later")?.textContent).toBeTruthy();
        // Showing it applied nothing.
        expect(pwa.applyUpdate).not.toHaveBeenCalled();
    });

    test("🛑 « Recharger » fait le geste — et ne se refait pas deux fois", () => {
        emit("geoleaf:sw:update-waiting");
        const apply = button("sw-update-apply");

        apply?.click();
        apply?.click();

        expect(pwa.applyUpdate).toHaveBeenCalledTimes(1);
        // The page is about to reload: the button says the gesture was taken.
        expect(apply?.disabled).toBe(true);
    });

    test("le geste sans rien à appliquer retire le bandeau, plutôt qu'un bouton mort", () => {
        emit("geoleaf:sw:update-waiting");
        pwa.applyUpdate.mockReturnValue(false);

        button("sw-update-apply")?.click();

        expect(banner()).toBeNull();
    });

    test("🛑 « Plus tard » le retire, et un boot de plus ne le ramène pas", () => {
        installGeoLeaf(true);
        emit("geoleaf:sw:update-waiting");

        button("sw-update-later")?.click();
        expect(banner()).toBeNull();
        expect(pwa.applyUpdate).not.toHaveBeenCalled();

        // The application is mounted again on the same page: the answer was « later ».
        emit("geoleaf:app:ready");
        expect(banner()).toBeNull();
    });

    test("une AUTRE mise à jour le ramène, même après « Plus tard »", () => {
        emit("geoleaf:sw:update-waiting");
        button("sw-update-later")?.click();

        emit("geoleaf:sw:update-waiting");

        expect(banner()).not.toBeNull();
    });

    test("🛑 une application remontée sur une mise à jour toujours en attente le retrouve", () => {
        // The event is said once per worker: a second boot on the same page hears nothing.
        installGeoLeaf(true);
        emit("geoleaf:sw:update-waiting");
        removeSwUpdateBanner(); // the unmount
        expect(banner()).toBeNull();

        emit("geoleaf:app:ready");

        expect(banner()).not.toBeNull();
    });

    test("🛑 le worker neuf a pris la page sans attendre : le bandeau n'a plus d'objet", () => {
        emit("geoleaf:sw:update-waiting");
        pwa.isUpdateWaiting.mockReturnValue(false);

        emit("geoleaf:sw:updated");

        expect(banner()).toBeNull();
    });

    test("appliquée depuis un autre onglet, la mise à jour reste proposée ici", () => {
        // The core then still answers `true`: this page runs the previous version's code.
        emit("geoleaf:sw:update-waiting");
        pwa.isUpdateWaiting.mockReturnValue(true);

        emit("geoleaf:sw:updated");

        expect(banner()).not.toBeNull();
    });

    test("un core qui ne sait pas attendre : rien ne casse, rien ne s'affiche", () => {
        (globalThis as any).GeoLeaf = { PWA: { init() {} } };
        emit("geoleaf:app:ready");
        expect(banner()).toBeNull();

        // And a banner shown by an event such a core cannot emit has a button that gives up.
        emit("geoleaf:sw:update-waiting");
        button("sw-update-apply")?.click();
        expect(banner()).toBeNull();
    });

    test("🛑 câblé deux fois, il n'écoute qu'une fois — et repart sans bandeau", () => {
        // The entry wires at load; a bundle evaluated twice on one page must not leave two
        // sets of listeners answering one event.
        const added = vi.spyOn(document, "addEventListener");
        wireSwUpdateBanner();
        const first = added.mock.calls.map(([name, listener]) => [name, listener]);
        expect(first.map(([name]) => name).sort()).toEqual([
            "geoleaf:app:ready",
            "geoleaf:sw:update-waiting",
            "geoleaf:sw:updated",
        ]);
        emit("geoleaf:sw:update-waiting");
        expect(banner()).not.toBeNull();

        const removed = vi.spyOn(document, "removeEventListener");
        wireSwUpdateBanner();

        // Taken off: the very functions that had been put on, not look-alikes.
        expect(removed.mock.calls.map(([name, listener]) => [name, listener])).toEqual(first);
        expect(banner()).toBeNull();
    });
});
