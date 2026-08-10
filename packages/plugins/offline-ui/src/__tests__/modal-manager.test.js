/**
 * Unit tests — `ui/cache-button/modal-manager.ts`, couverture des branches (R.31).
 *
 * Fichier à 61 % de branches : structure du modal, onglets, focus-trap, fermeture. Tout est
 * DOM + mocks (`$create`, `createFocusTrap`, `events` via `GeoLeaf.Utils`). On couvre
 * l'ouverture (création vs réutilisation), la navigation d'onglets (import/export, et le
 * garde `_ExportLogic` absent), la fermeture (overlay, croix, Échap) et `destroy`.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { ModalManager } from "../ui/cache-button/modal-manager.js";

let exportLogic;

beforeEach(() => {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    exportLogic = { initializeCacheContent: vi.fn(), initializeExportContent: vi.fn() };
    ModalManager._setExportLogic(exportLogic);
    ModalManager._eventCleanups = [];
    ModalManager._trap = null;
});

afterEach(() => {
    document.getElementById("gl-cache-modal")?.remove();
    vi.restoreAllMocks();
});

describe("openModal / createModal", () => {
    test("crée le modal, l'affiche, active le focus-trap et initialise le contenu", () => {
        ModalManager.openModal();

        const modal = document.getElementById("gl-cache-modal");
        expect(modal).toBeTruthy();
        expect(modal.style.display).toBe("flex");
        expect(modal.querySelector(".gl-cache-modal__tabs")).toBeTruthy();
        expect(modal.querySelector("#gl-cache-modal-body")).toBeTruthy();
        expect(exportLogic.initializeCacheContent).toHaveBeenCalled();
    });

    test("réutilise le modal existant au second appel (pas de doublon)", () => {
        ModalManager.openModal();
        ModalManager.openModal();
        expect(document.querySelectorAll("#gl-cache-modal").length).toBe(1);
    });
});

describe("fermeture", () => {
    test("clic sur la croix ferme le modal", () => {
        ModalManager.openModal();
        document.querySelector(".gl-cache-modal__close").click();
        expect(document.getElementById("gl-cache-modal").style.display).toBe("none");
    });

    test("clic sur l'overlay ferme le modal", () => {
        ModalManager.openModal();
        document.querySelector(".gl-cache-modal__overlay").click();
        expect(document.getElementById("gl-cache-modal").style.display).toBe("none");
    });

    test("touche Échap ferme le modal quand il est ouvert", () => {
        ModalManager.openModal();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.getElementById("gl-cache-modal").style.display).toBe("none");
    });

    test("closeModal sans modal → no-op", () => {
        expect(() => ModalManager.closeModal()).not.toThrow();
    });
});

describe("switchTab", () => {
    test("onglet « import » → active l'onglet et initialise le cache", () => {
        ModalManager.openModal();
        ModalManager.switchTab("import");
        const importTab = document.querySelector('[data-tab="import"]');
        expect(importTab.classList.contains("gl-cache-modal__tab--active")).toBe(true);
        expect(exportLogic.initializeCacheContent).toHaveBeenCalled();
    });

    test("onglet « export » → active l'onglet et initialise l'export", () => {
        ModalManager.openModal();
        ModalManager.switchTab("export");
        const exportTab = document.querySelector('[data-tab="export"]');
        expect(exportTab.classList.contains("gl-cache-modal__tab--active")).toBe(true);
        expect(exportLogic.initializeExportContent).toHaveBeenCalled();
    });

    test("le clic sur l'onglet export bascule via le handler câblé", () => {
        ModalManager.openModal();
        document.querySelector('[data-tab="export"]').click();
        expect(exportLogic.initializeExportContent).toHaveBeenCalled();
    });

    test("sans _ExportLogic → journalise et sort", () => {
        ModalManager.openModal();
        ModalManager._setExportLogic(null);
        expect(() => ModalManager.switchTab("import")).not.toThrow();
    });
});

describe("destroy", () => {
    test("exécute les cleanups enregistrés et retire le modal du DOM", () => {
        ModalManager.openModal();
        const cleanup = vi.fn();
        ModalManager._eventCleanups = [cleanup, "not-a-fn"];

        ModalManager.destroy();

        expect(cleanup).toHaveBeenCalled();
        expect(document.getElementById("gl-cache-modal")).toBeNull();
        expect(ModalManager._eventCleanups).toHaveLength(0);
    });

    test("sans cleanups ni modal → ne jette pas", () => {
        ModalManager._eventCleanups = [];
        expect(() => ModalManager.destroy()).not.toThrow();
    });
});
