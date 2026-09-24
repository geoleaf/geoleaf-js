/*!
 * Tests — the draft awaiting its form, and how a host abandons it (`discardDraft`).
 *
 * The draft is identified by its HANDLE, not by its id: a form replaced by another fires
 * the old one's cancel after the new draft began, and that late cancel must not end the
 * new draft. Nor is an id always there — an AddForm capture has none.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { beginDraft, discardDraft } from "../draft-state.js";

beforeEach(() => {
    // Leave no current draft behind: a later test must start from "nothing to discard".
    discardDraft();
});

describe("discardDraft — which draft it abandons", () => {
    it("rend false quand aucun brouillon n'attend", () => {
        expect(discardDraft()).toBe(false);
        expect(discardDraft("abc")).toBe(false);
    });

    it("abandonne le brouillon courant, une seule fois", () => {
        const cleanup = vi.fn();
        const draft = beginDraft("abc", cleanup);
        expect(discardDraft()).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(draft.ended).toBe(true);
        expect(discardDraft()).toBe(false);
    });

    it("compare l'identifiant sous sa forme texte", () => {
        const cleanup = vi.fn();
        beginDraft("42", cleanup);
        expect(discardDraft(42)).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it("refuse un autre identifiant, et ne nettoie rien", () => {
        const cleanup = vi.fn();
        beginDraft("abc", cleanup);
        expect(discardDraft("xyz")).toBe(false);
        expect(cleanup).not.toHaveBeenCalled();
    });

    it("un brouillon sans identifiant ne s'abandonne que sans argument", () => {
        const cleanup = vi.fn();
        beginDraft(null, cleanup);
        expect(discardDraft("abc")).toBe(false);
        expect(discardDraft()).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
    });
});

describe("discardDraft — the form, and the write in flight", () => {
    it("ferme le formulaire ouvert, dont l'annulation fait le nettoyage", () => {
        const cleanup = vi.fn();
        const draft = beginDraft("abc", cleanup);
        // A forced close fires the form's cancel, which abandons the draft.
        const close = vi.fn(() => draft.abandon());
        draft.opened(close);
        expect(discardDraft()).toBe(true);
        expect(close).toHaveBeenCalledOnce();
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it("n'abandonne pas un brouillon dont l'écriture est en vol", async () => {
        const cleanup = vi.fn();
        const draft = beginDraft("abc", cleanup);
        let settle!: () => void;
        const saved = draft.saving(new Promise<void>((resolve) => (settle = resolve)));
        expect(discardDraft()).toBe(false);
        settle();
        await saved;
        // Saved: the draft is over, there is nothing left to abandon.
        expect(draft.ended).toBe(true);
        expect(discardDraft()).toBe(false);
        expect(cleanup).not.toHaveBeenCalled();
    });

    it("redevient abandonnable quand l'écriture échoue", async () => {
        const cleanup = vi.fn();
        const draft = beginDraft("abc", cleanup);
        await expect(draft.saving(Promise.reject(new Error("réseau")))).rejects.toThrow("réseau");
        expect(draft.ended).toBe(false);
        expect(discardDraft()).toBe(true);
        expect(cleanup).toHaveBeenCalledOnce();
    });
});

describe("beginDraft — a draft replaced by another", () => {
    it("l'annulation tardive de l'ancien nettoie l'ancien, et laisse le nouveau courant", () => {
        const oldCleanup = vi.fn();
        const newCleanup = vi.fn();
        const older = beginDraft("a", oldCleanup);
        beginDraft("b", newCleanup);
        older.abandon();
        expect(oldCleanup).toHaveBeenCalledOnce();
        expect(discardDraft("b")).toBe(true);
        expect(newCleanup).toHaveBeenCalledOnce();
    });
});
