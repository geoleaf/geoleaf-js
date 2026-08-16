/**
 * B-163 — Tests de l'unique écouteur in-core de `geoleaf:cache:evicted`
 * (`kernel/storage/eviction-notice.ts`).
 *
 * 🛑 CE QUE CES TESTS GARDENT, ET POURQUOI ILS NE SUFFISENT PAS SEULS.
 *
 * Ils éprouvent la LOGIQUE de l'avis : le niveau, le comptage, l'interpolation, le garde sur
 * la taille absente, l'idempotence. Ils NE prouvent PAS le fait qui a ouvert B-163 — que
 * l'avis parvienne à l'écran sur `deploy-core`. Un écouteur peut être parfait ici et n'être
 * jamais câblé dans le bundle livré ; c'est très exactement le défaut d'origine, vu depuis
 * l'autre bout. La preuve du bout en bout est E2E (tâche 1.4 de R9), pas unitaire.
 */
"use strict";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/notify/notify.primitive.js", () => ({
    notifyPrimitive: { notify: vi.fn() },
}));
import { notifyPrimitive } from "../../src/utils/notify/notify.primitive.js";

/** Le mock ci-dessus remplace `notify` par un espion ; ce cast le rend interrogeable. */
const notifySpy = notifyPrimitive.notify as unknown as ReturnType<typeof vi.fn>;

// ⚠️ `getLabel` N'EST PAS MOCKÉ, délibérément. Le défaut le plus probable de ce lot est une
// interpolation qui ne mord pas — le plugin d'origine écrivait `{count}` là où le moteur du
// core lit `{0}`, et une copie naïve aurait affiché « {count} » à l'écran. Mocker la
// traduction rendrait ce défaut-là structurellement invisible : le test serait vert sur un
// libellé que personne n'a résolu.
import {
    wireEvictionNotice,
    unwireEvictionNotice,
} from "../../src/kernel/storage/eviction-notice.js";

/** Émet l'événement exactement comme les deux producteurs le font : sur `document`. */
function emitEviction(detail: Record<string, unknown>): void {
    document.dispatchEvent(new CustomEvent("geoleaf:cache:evicted", { detail }));
}

describe("eviction-notice (B-163)", () => {
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

            // 🛑 Le TON est la moitié du sujet : une éviction n'est pas une panne. Le quota,
            // lui, est une ERREUR — une écriture a été refusée — et il reste côté plugin.
            expect(level).toBe("warning");
            // Le compte est réellement interpolé : `{0}` a disparu du message rendu.
            expect(message).toContain("3");
            expect(message).not.toContain("{0}");
            expect(message).not.toContain("{count}");
            // La clé elle-même ne doit pas fuir à l'écran : elle est résolue.
            expect(message).not.toContain("storage.notif.cacheEvicted");
            // ⚠️ Le séparateur décimal suit `DEFAULT_LOCALE` (`fr-FR` → « 2,00 KB »). Ancrer
            // sur la graphie exacte ferait rougir ce cas au premier changement de locale par
            // défaut, sans qu'aucun comportement ait bougé.
            expect(message).toMatch(/2[.,]00\s*KB/);
        });

        it("se tait sur la taille quand le producteur ne la renseigne pas", () => {
            // ⚠️ LE CAS DE LA CACHE API, et le défaut que ce lot corrige. Le Service Worker
            // n'expose `freedBytes` pour AUCUNE entrée. L'écouteur d'origine gardait sur la
            // CHAÎNE formatée, or `formatFileSize(undefined)` rend `"0 B"` — truthy — donc il
            // affichait « (0 B) » à chaque éviction du worker. Le garde porte désormais sur le
            // nombre brut.
            emitEviction({ evicted: 4, store: "cache-api", reason: "pressure" });

            expect(notifySpy).toHaveBeenCalledTimes(1);
            const [message] = notifySpy.mock.calls[0];

            expect(message).toContain("4");
            expect(message).not.toContain("0 B");
            // ⚠️ NE PAS asserter `not.toContain("(")` — le libellé lui-même en porte
            // (« élément(s) »), dans les six langues. Le sujet est l'absence du SUFFIXE DE
            // TAILLE, pas l'absence de parenthèse : c'est lui qu'on ancre.
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
            // Une notification « 0 entrée retirée » apprend à l'utilisateur à ne plus les lire.
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
            // `setupStorage()` est re-callable. Sans l'idempotence, l'utilisateur verrait deux
            // toasts pour une seule éviction.
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
            // ⚠️ Sans ce cas, le précédent serait indiscernable d'un écouteur qui ne se pose
            // jamais : « rien n'a notifié » est aussi ce que produit un câblage cassé.
            unwireEvictionNotice();
            wireEvictionNotice();

            emitEviction({ evicted: 1, freedBytes: 1024 });

            expect(notifySpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("les DEUX émetteurs, un seul écouteur", () => {
        it("couvre les deux formes de détail avec le même écouteur", () => {
            // Le pont SW (`sw-register.ts`) et `cache-manager.ts` dispatchent le MÊME nom sur
            // le MÊME `document` — c'est ce qui rend un écouteur unique suffisant, et c'est la
            // raison pour laquelle il ne faut pas en ajouter un second.
            emitEviction({ evicted: 2, freedBytes: 512 }); // IndexedDB — détail complet
            emitEviction({ evicted: 7, store: "cache-api" }); // Cache API — sans freedBytes

            expect(notifySpy).toHaveBeenCalledTimes(2);
            expect(notifySpy.mock.calls[0][0]).toContain("512 B");
            expect(notifySpy.mock.calls[1][0]).toContain("7");
        });
    });
});
