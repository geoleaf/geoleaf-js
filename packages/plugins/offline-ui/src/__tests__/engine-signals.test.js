/**
 * `core/engine-signals.ts` — the engine's signals, made visible.
 *
 * What these tests guard is not "a notification shows" but **the distinction
 * between the two signals and their tone**:
 *
 *   · `storage:quota-exceeded` is an **error** — the browser REFUSED a write, so
 *     the next field capture may not fit;
 *   · `cache:evicted` is a **warning** — data the user had asked to download is
 *     no longer there. ⚠️ Never unsynchronised work (the contract's hard rule),
 *     but indeed what they had asked for, and they must know BEFORE leaving.
 *
 * Swapping them would keep both green on a test that only counted calls — hence
 * an assertion on the METHOD, not only on the fact of notifying.
 *
 * 🛑 AND THE CASE THAT COUNTS AS MUCH AS THE OTHER TWO: a zero-entry eviction
 * notifies NOTHING. `_enforceCacheQuota` emits when records are removed, but a
 * zero detail stays possible; "0 items removed" teaches the user to stop
 * reading notifications, which costs more than silence.
 */
"use strict";

const notify = {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
};

vi.mock("@geoleaf/host-runtime", () => ({
    getUINotifications: () => notify,
    // The mock returns the KEY: an assertion can thus catch a regression to a
    // hard-coded string, which a mock returning translated text would not
    // allow.
    tLabel: (key) => key,
}));

vi.mock("../utils/core-utils.js", () => ({
    formatFileSize: (bytes) => (typeof bytes === "number" ? `${bytes} o` : ""),
}));

const { wireEngineSignals, unwireEngineSignals } = await import("../core/engine-signals.js");

describe("engine-signals — les trois signaux orphelins", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        wireEngineSignals();
    });

    afterEach(() => unwireEngineSignals());

    describe("storage:quota-exceeded → ERREUR", () => {
        it("notifie en erreur, avec la taille refusée quand elle est connue", () => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:storage:quota-exceeded", {
                    detail: { id: "tile-1", size: 4096 },
                })
            );

            expect(notify.error).toHaveBeenCalledTimes(1);
            expect(notify.error.mock.calls[0][0]).toBe("storage.notif.quotaExceeded (4096 o)");
            // The TONE is half the subject: a warning would not say a write was
            // refused.
            expect(notify.warning).not.toHaveBeenCalled();
        });

        it("se tait sur la taille plutôt que d'afficher une mesure absente", () => {
            // ⚠️ A notification displaying "undefined" is worse than one showing
            // nothing: it teaches the user to stop reading them.
            document.dispatchEvent(new CustomEvent("geoleaf:storage:quota-exceeded"));

            expect(notify.error).toHaveBeenCalledTimes(1);
            expect(notify.error.mock.calls[0][0]).toBe("storage.notif.quotaExceeded");
        });
    });

    describe("cache:evicted — REMONTÉ DANS LE CORE, donc plus rien ici", () => {
        // 🛑 The eviction rendering no longer belongs to this plugin: it lived
        // here and NOWHERE else, so `deploy-core` — which does not embed it —
        // never displayed the notice. It is now in
        // `core/src/kernel/storage/eviction-notice.ts`, on an unconditional boot
        // path. The behaviour is proven THERE; here we keep only the absence, so
        // a restoration "for the rich UI" gets seen: two listeners would show
        // TWO toasts on `deploy-full`.
        it("ne notifie PLUS — l'écouteur a quitté le plugin", () => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:evicted", {
                    detail: { evicted: 3, freedBytes: 2048, totalBefore: 10, totalAfter: 8 },
                })
            );

            expect(notify.warning).not.toHaveBeenCalled();
            expect(notify.error).not.toHaveBeenCalled();
            expect(notify.info).not.toHaveBeenCalled();
        });
    });

    describe("storage:ready — SUPPRIMÉ du moteur, donc rien à écouter", () => {
        it("ne notifie pas, même si le signal est émis à la main", () => {
            // The engine no longer emits it. If someone brings it back, it must
            // not produce one notification per startup — exactly what motivated
            // its removal.
            document.dispatchEvent(new CustomEvent("geoleaf:storage:ready"));

            expect(notify.info).not.toHaveBeenCalled();
            expect(notify.warning).not.toHaveBeenCalled();
            expect(notify.error).not.toHaveBeenCalled();
        });
    });

    describe("cycle de vie", () => {
        // ⚠️ THESE TWO CASES BORE ON `cache:evicted` — the event the plugin no
        // longer listens to since its move into the core. They would have become
        // VACUOUSLY GREEN: "nothing notified" is exactly what an absent listener
        // produces, so they would have guarded nothing while staying green. They
        // now bear on `quota-exceeded`, the half that legitimately stays here —
        // the proven property (idempotence, real unwiring) is the same.
        it("un second câblage ne double PAS les notifications", () => {
            // Without idempotence, two entry imports would set two listeners and
            // the user would see every event twice.
            wireEngineSignals();
            document.dispatchEvent(
                new CustomEvent("geoleaf:storage:quota-exceeded", { detail: { size: 4096 } })
            );

            expect(notify.error).toHaveBeenCalledTimes(1);
        });

        it("le décâblage retire réellement les écouteurs", () => {
            unwireEngineSignals();
            document.dispatchEvent(
                new CustomEvent("geoleaf:storage:quota-exceeded", { detail: { size: 4096 } })
            );

            expect(notify.error).not.toHaveBeenCalled();
        });
    });
});
