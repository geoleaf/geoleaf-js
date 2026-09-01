/**
 * Tests of the only in-core listener of `geoleaf:cache:evicted`
 * (`kernel/storage/eviction-notice.ts`).
 *
 * 🛑 WHAT THESE TESTS GUARD, AND WHY THEY DO NOT SUFFICE ALONE.
 *
 * They exercise the notice's LOGIC: the level, the counting, the
 * interpolation, the guard on the missing size, idempotence. They do NOT
 * prove the original fact — that the notice reaches the screen on
 * `deploy-core`. A listener can be perfect here and never be wired into the
 * shipped bundle; that is exactly the original defect, seen from the other
 * end. The end-to-end proof is E2E, not unit.
 */
"use strict";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/notify/notify.primitive.js", () => ({
    notifyPrimitive: { notify: vi.fn() },
}));
import { notifyPrimitive } from "../../src/utils/notify/notify.primitive.js";

/** The mock above replaces `notify` with a spy; this cast makes it queryable. */
const notifySpy = notifyPrimitive.notify as unknown as ReturnType<typeof vi.fn>;

// ⚠️ `getLabel` IS NOT MOCKED, deliberately. This batch's most likely defect
// is an interpolation that does not bite — the original plugin wrote
// `{count}` where the core's engine reads `{0}`, and a naive copy would have
// shown "{count}" on screen. Mocking the translation would make that defect
// structurally invisible: the test would be green on a label nobody resolved.
import {
    wireEvictionNotice,
    unwireEvictionNotice,
} from "../../src/kernel/storage/eviction-notice.js";

/** Emits the event exactly as both producers do: on `document`. */
function emitEviction(detail: Record<string, unknown>): void {
    document.dispatchEvent(new CustomEvent("geoleaf:cache:evicted", { detail }));
}

describe("eviction-notice", () => {
    beforeEach(() => {
        notifySpy.mockClear();
        unwireEvictionNotice();
        wireEvictionNotice();
    });

    afterEach(() => {
        unwireEvictionNotice();
    });

    describe("l'avis lui-même", () => {
        it("notifie en AVERTISSEMENT, avec le compte interpolé et la taille libérée", () => {
            emitEviction({ evicted: 3, freedBytes: 2048 });

            expect(notifySpy).toHaveBeenCalledTimes(1);
            const [message, level] = notifySpy.mock.calls[0];

            // 🛑 The TONE is half the subject: an eviction is not an outage.
            // The quota is an ERROR — a write was refused — and it stays plugin-side.
            expect(level).toBe("warning");
            // The count is really interpolated: `{0}` is gone from the rendered message.
            expect(message).toContain("3");
            expect(message).not.toContain("{0}");
            expect(message).not.toContain("{count}");
            // The key itself must not leak on screen: it is resolved.
            expect(message).not.toContain("storage.notif.cacheEvicted");
            // ⚠️ The decimal separator follows `DEFAULT_LOCALE` (`fr-FR` →
            // "2,00 KB"). Anchoring on the exact spelling would turn this
            // case red at the first default-locale change, with no behaviour moved.
            expect(message).toMatch(/2[.,]00\s*KB/);
        });

        it("se tait sur la taille quand le producteur ne la renseigne pas", () => {
            // ⚠️ THE CACHE API CASE, and the defect this batch fixes. The
            // Service Worker exposes `freedBytes` for NO entry. The original
            // listener guarded on the formatted STRING, yet
            // `formatFileSize(undefined)` returns `"0 B"` — truthy — so it
            // showed "(0 B)" at every worker eviction. The guard now bears on
            // the raw number.
            emitEviction({ evicted: 4, store: "cache-api", reason: "pressure" });

            expect(notifySpy).toHaveBeenCalledTimes(1);
            const [message] = notifySpy.mock.calls[0];

            expect(message).toContain("4");
            expect(message).not.toContain("0 B");
            // ⚠️ Do NOT assert `not.toContain("(")` — the label itself
            // carries some ("élément(s)"), in all six languages. The subject
            // is the absence of the SIZE SUFFIX, not of a parenthesis: that is what we anchor.
            expect(message).not.toMatch(/\(\s*[\d.,]+\s*(B|KB|MB|GB|TB)\s*\)/);
        });

        it("se tait aussi quand `freedBytes` vaut zéro", () => {
            emitEviction({ evicted: 2, freedBytes: 0 });

            const [message] = notifySpy.mock.calls[0];
            expect(message).not.toContain("0 B");
        });
    });

    describe("les silences voulus", () => {
        it("NE notifie RIEN quand zéro entrée a été évincée", () => {
            // A "0 entries removed" notification teaches the user to stop reading them.
            emitEviction({ evicted: 0, freedBytes: 0 });

            expect(notifySpy).not.toHaveBeenCalled();
        });

        it("NE notifie RIEN quand le détail est absent", () => {
            document.dispatchEvent(new CustomEvent("geoleaf:cache:evicted"));

            expect(notifySpy).not.toHaveBeenCalled();
        });

        it("NE notifie RIEN quand `evicted` n'est pas un nombre", () => {
            emitEviction({ evicted: "trois" });

            expect(notifySpy).not.toHaveBeenCalled();
        });
    });

    describe("cycle de vie", () => {
        it("un second câblage ne double PAS l'avis", () => {
            // `setupStorage()` is re-callable. Without idempotence, the user
            // would see two toasts for one eviction.
            wireEvictionNotice();
            wireEvictionNotice();

            emitEviction({ evicted: 1, freedBytes: 1024 });

            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("le décâblage retire réellement l'écouteur", () => {
            unwireEvictionNotice();

            emitEviction({ evicted: 5, freedBytes: 4096 });

            expect(notifySpy).not.toHaveBeenCalled();
        });

        it("après décâblage puis re-câblage, l'avis revient", () => {
            // ⚠️ Without this case, the previous one would be
            // indistinguishable from a listener that never gets set: "nothing
            // notified" is also what broken wiring produces.
            unwireEvictionNotice();
            wireEvictionNotice();

            emitEviction({ evicted: 1, freedBytes: 1024 });

            expect(notifySpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("les DEUX émetteurs, un seul écouteur", () => {
        it("couvre les deux formes de détail avec le même écouteur", () => {
            // The SW bridge (`sw-register.ts`) and `cache-manager.ts`
            // dispatch the SAME name on the SAME `document` — what makes a
            // single listener sufficient, and the reason not to add a second one.
            emitEviction({ evicted: 2, freedBytes: 512 }); // IndexedDB — complete detail
            emitEviction({ evicted: 7, store: "cache-api" }); // Cache API — sans freedBytes

            expect(notifySpy).toHaveBeenCalledTimes(2);
            expect(notifySpy.mock.calls[0][0]).toContain("512 B");
            expect(notifySpy.mock.calls[1][0]).toContain("7");
        });
    });
});
