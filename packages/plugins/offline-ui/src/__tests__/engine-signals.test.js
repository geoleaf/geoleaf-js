/**
 * `core/engine-signals.ts` — les signaux du moteur, rendus visibles (B-72).
 *
 * Ce que ces tests gardent n'est pas « une notification s'affiche » mais **la distinction
 * entre les deux signaux et leur ton** :
 *
 *   · `storage:quota-exceeded` est une **erreur** — le navigateur a REFUSÉ une écriture, donc
 *     la prochaine saisie de terrain peut ne pas tenir ;
 *   · `cache:evicted` est un **avertissement** — des données que l'utilisateur avait demandé à
 *     télécharger ne sont plus là. ⚠️ Jamais du travail non synchronisé (règle dure du
 *     contrat), mais bien ce qu'il avait demandé, et il doit le savoir AVANT de partir.
 *
 * Les inverser rendrait les deux verts sur un test qui ne compterait que les appels — d'où
 * une assertion sur la MÉTHODE, pas seulement sur le fait qu'on notifie.
 *
 * 🛑 ET LE CAS QUI COMPTE AUTANT QUE LES DEUX AUTRES : une éviction à zéro entrée ne notifie
 * RIEN. `_enforceCacheQuota` émet quand des enregistrements sont retirés, mais un détail à
 * zéro reste possible ; « 0 élément supprimé » apprend à l'utilisateur à ne plus lire les
 * notifications, ce qui coûte plus cher que le silence.
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
    // Le mock rend la CLÉ : une assertion peut donc attraper une régression vers une chaîne
    // en dur, ce qu'un mock rendant un texte traduit ne permettrait pas.
    tLabel: (key) => key,
}));

vi.mock("../utils/core-utils.js", () => ({
    formatFileSize: (bytes) => (typeof bytes === "number" ? `${bytes} o` : ""),
}));

const { wireEngineSignals, unwireEngineSignals } = await import("../core/engine-signals.js");

describe("engine-signals — les trois orphelins de B-72", () => {
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
            // Le TON est la moitié du sujet : un avertissement ne dirait pas qu'une écriture
            // a été refusée.
            expect(notify.warning).not.toHaveBeenCalled();
        });

        it("se tait sur la taille plutôt que d'afficher une mesure absente", () => {
            // ⚠️ Une notification qui affiche « undefined » est pire que celle qui n'affiche
            // rien : elle apprend à l'utilisateur à ne plus les lire.
            document.dispatchEvent(new CustomEvent("geoleaf:storage:quota-exceeded"));

            expect(notify.error).toHaveBeenCalledTimes(1);
            expect(notify.error.mock.calls[0][0]).toBe("storage.notif.quotaExceeded");
        });
    });

    describe("cache:evicted → AVERTISSEMENT", () => {
        it("notifie en avertissement, avec le compte et les octets libérés", () => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:evicted", {
                    detail: { evicted: 3, freedBytes: 2048, totalBefore: 10, totalAfter: 8 },
                })
            );

            expect(notify.warning).toHaveBeenCalledTimes(1);
            expect(notify.warning.mock.calls[0][0]).toBe("storage.notif.cacheEvicted (2048 o)");
            // L'éviction n'est pas une erreur : elle ne doit pas se déguiser en panne.
            expect(notify.error).not.toHaveBeenCalled();
        });

        it("NE notifie RIEN quand zéro entrée a été évincée", () => {
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:evicted", { detail: { evicted: 0, freedBytes: 0 } })
            );

            expect(notify.warning).not.toHaveBeenCalled();
            expect(notify.error).not.toHaveBeenCalled();
        });
    });

    describe("storage:ready — SUPPRIMÉ du moteur, donc rien à écouter", () => {
        it("ne notifie pas, même si le signal est émis à la main", () => {
            // Le moteur ne l'émet plus (B-72). Si quelqu'un le remet, il ne doit pas produire
            // une notification par démarrage — c'est exactement ce qui a motivé sa suppression.
            document.dispatchEvent(new CustomEvent("geoleaf:storage:ready"));

            expect(notify.info).not.toHaveBeenCalled();
            expect(notify.warning).not.toHaveBeenCalled();
            expect(notify.error).not.toHaveBeenCalled();
        });
    });

    describe("cycle de vie", () => {
        it("un second câblage ne double PAS les notifications", () => {
            // Sans l'idempotence, deux imports de l'entrée poseraient deux écouteurs et
            // l'utilisateur verrait chaque événement deux fois.
            wireEngineSignals();
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:evicted", { detail: { evicted: 1 } })
            );

            expect(notify.warning).toHaveBeenCalledTimes(1);
        });

        it("le décâblage retire réellement les écouteurs", () => {
            unwireEngineSignals();
            document.dispatchEvent(
                new CustomEvent("geoleaf:cache:evicted", { detail: { evicted: 5 } })
            );

            expect(notify.warning).not.toHaveBeenCalled();
        });
    });
});
