/**
 * Tests for the offline pending-queue badge + detail modal — Sprint S11
 * (EDT.11.3-UI / EDT.11.5). Covers badge show/hide, the click callback, and the
 * pending-queue detail modal rendering.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    initEditorMenu,
    updatePendingQueueCount,
    destroyEditorMenu,
} from "../sub-menu/floating-menu.js";
import { openPendingQueueModal } from "../sub-menu/pending-queue-modal.js";
import { getEditorConfig } from "../config.js";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";

describe("floating-menu — pending badge", () => {
    let container: HTMLElement;

    beforeEach(() => {
        const nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        container = nativeMap.getContainer() as HTMLElement;
    });

    afterEach(() => {
        destroyEditorMenu();
        uninstallMockGeoLeaf();
    });

    it("badge is hidden when the queue is empty", () => {
        initEditorMenu(getEditorConfig(), {});
        const badge = container.querySelector<HTMLElement>(".gl-editor-queue-badge")!;
        expect(badge).not.toBeNull();
        expect(badge.style.display).toBe("none");
    });

    it("updatePendingQueueCount(n>0) shows the badge with the count", () => {
        initEditorMenu(getEditorConfig(), {});
        updatePendingQueueCount(3);
        const badge = container.querySelector<HTMLElement>(".gl-editor-queue-badge")!;
        expect(badge.style.display).not.toBe("none");
        expect(badge.textContent).toContain("3");
        expect(badge.getAttribute("aria-hidden")).toBe("false");
    });

    it("updatePendingQueueCount(0) hides the badge again", () => {
        initEditorMenu(getEditorConfig(), {});
        updatePendingQueueCount(2);
        updatePendingQueueCount(0);
        const badge = container.querySelector<HTMLElement>(".gl-editor-queue-badge")!;
        expect(badge.style.display).toBe("none");
    });

    it("clicking the badge invokes onPendingBadgeClick", () => {
        const onPendingBadgeClick = vi.fn();
        initEditorMenu(getEditorConfig(), { onPendingBadgeClick });
        updatePendingQueueCount(1);
        container.querySelector<HTMLElement>(".gl-editor-queue-badge")!.click();
        expect(onPendingBadgeClick).toHaveBeenCalledOnce();
    });
});

describe("pending-queue-modal", () => {
    beforeEach(() => installMockGeoLeaf());
    afterEach(() => {
        document.querySelectorAll(".gl-form-modal-overlay").forEach((n) => n.remove());
        uninstallMockGeoLeaf();
    });

    it("lists each pending operation", () => {
        openPendingQueueModal(
            [
                { id: "1", kind: "create", layerId: "layerA", localId: "a" },
                { id: "2", kind: "delete", layerId: "layerB", localId: "b" },
            ],
            { onRetry: vi.fn() }
        );
        const rows = document.querySelectorAll(".gl-editor-queue-detail__row");
        expect(rows.length).toBe(2);
    });

    // 🛑 TÂCHE 4.9 — CE TEST N'EXISTAIT PAS, ET SON ABSENCE EST CE QUI A LAISSÉ PASSER LE
    // DÉFAUT. Le test au-dessus n'assertait qu'un NOMBRE DE LIGNES : il sortait vert quel que
    // soit le libellé rendu, donc il est resté vert quand `_kindLabel` a cessé de reconnaître
    // le vocabulaire. Ses fixtures portaient en plus `type:` là où l'entrée porte `kind:`, et
    // `src/__tests__` est exclu du typecheck (`tsconfig.json`) — rien ne pouvait le dire.
    //
    // On asserte donc le LIBELLÉ, pas le décompte : c'est ce que la modale existe pour rendre.
    it("traduit le vocabulaire du contrat, et ne laisse jamais fuiter le kind brut", () => {
        openPendingQueueModal(
            [
                { id: "1", kind: "create", layerId: "L", localId: "a" },
                { id: "2", kind: "update", layerId: "L", localId: "b" },
                { id: "3", kind: "delete", layerId: "L", localId: "c" },
            ],
            { onRetry: vi.fn() }
        );
        const labels = Array.from(
            document.querySelectorAll(".gl-editor-queue-detail__kind"),
            (n) => n.textContent
        );
        // Le repli `return kind` rend la chaîne telle quelle : si le dispatch retombe dedans,
        // c'est le vocabulaire machine qui s'affiche à l'utilisateur, en toutes langues.
        expect(labels).not.toContain("create");
        expect(labels).not.toContain("update");
        expect(labels).not.toContain("delete");
        expect(new Set(labels).size).toBe(3);
    });

    it("retry button invokes onRetry and closes the modal", () => {
        const onRetry = vi.fn();
        openPendingQueueModal([{ id: "1", kind: "create", layerId: "L", localId: "a" }], {
            onRetry,
        });
        const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                // PLUGINS S10: these modal-footer buttons moved from the editor's
                // round-icon base `gl-editor-action-btn` to field-renderer's modal
                // base `gl-form-modal__btn` (the two collided; see chantier C).
                ".gl-editor-queue-detail .gl-form-modal__btn"
            )
        );
        // [close, retry]
        buttons[buttons.length - 1].click();
        expect(onRetry).toHaveBeenCalledOnce();
        expect(document.querySelector(".gl-form-modal-overlay")).toBeNull();
    });

    it("shows an empty message when there is nothing pending", () => {
        openPendingQueueModal([], { onRetry: vi.fn() });
        expect(document.querySelector(".gl-form-modal__delete-body")).not.toBeNull();
        expect(document.querySelectorAll(".gl-editor-queue-detail__row").length).toBe(0);
    });
});
