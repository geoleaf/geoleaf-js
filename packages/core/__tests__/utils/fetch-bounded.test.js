/**
 * `fetchBounded` — et la garde de non-régression du périmètre (tâche 3.8).
 *
 * Deux objets distincts ici :
 *  1. le comportement du helper (échéance, chaînage du signal d'annulation, pas de fuite) ;
 *  2. une garde de SOURCE qui compte les `fetch` non bornés du périmètre hors-ligne, avec une
 *     liste d'exceptions NOMMÉES — parce qu'un décompte sans noms se relâche d'une unité à
 *     chaque sprint sans que personne ne le voie.
 */

import { fetchBounded, BoundedFetchError } from "../../src/utils/general/fetch-bounded.ts";

describe("fetchBounded — comportement", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test("rend la réponse telle quelle — un 404 est une RÉPONSE, pas un abandon", async () => {
        const res = { ok: false, status: 404 };
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => res)
        );
        await expect(fetchBounded("https://x.test/a")).resolves.toBe(res);
    });

    test("passe un signal au fetch sous-jacent, même sans signal d'appelant", async () => {
        const spy = vi.fn(async () => ({ ok: true }));
        vi.stubGlobal("fetch", spy);
        await fetchBounded("https://x.test/a", { method: "HEAD" });
        const init = spy.mock.calls[0][1];
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.method).toBe("HEAD");
    });

    test("l'échéance JETTE une erreur NOMMÉE `timeout` — pas un null silencieux", async () => {
        // Un abandon qui rend `null` est un échec silencieux déguisé : l'appelant ne peut plus
        // distinguer « le serveur n'a rien dit » de « le serveur a dit non ».
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url, init) =>
                    new Promise((_res, rej) => {
                        init.signal.addEventListener("abort", () =>
                            rej(new DOMException("aborted", "AbortError"))
                        );
                    })
            )
        );
        const p = fetchBounded("https://x.test/lent", {}, 20);
        await expect(p).rejects.toBeInstanceOf(BoundedFetchError);
        await expect(p).rejects.toMatchObject({ kind: "timeout", url: "https://x.test/lent" });
    });

    test("une panne réseau est distinguée d'une échéance", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("Failed to fetch");
            })
        );
        await expect(fetchBounded("https://x.test/a")).rejects.toMatchObject({ kind: "network" });
    });

    test("le signal de l'APPELANT reste honoré — les deux sont chaînés", async () => {
        // Un signal d'annulation utilisateur n'est pas une échéance, et une échéance ne doit
        // pas remplacer l'annulation : la requête meurt sur le premier des deux qui tombe.
        const caller = new AbortController();
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url, init) =>
                    new Promise((_res, rej) => {
                        init.signal.addEventListener("abort", () =>
                            rej(new DOMException("aborted", "AbortError"))
                        );
                    })
            )
        );
        const p = fetchBounded("https://x.test/a", { signal: caller.signal }, 60000);
        caller.abort();
        await expect(p).rejects.toBeInstanceOf(BoundedFetchError);
    });

    test("un signal d'appelant DÉJÀ avorté coupe immédiatement", async () => {
        const caller = new AbortController();
        caller.abort();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url, init) => {
                if (init.signal.aborted) throw new DOMException("aborted", "AbortError");
                return { ok: true };
            })
        );
        await expect(
            fetchBounded("https://x.test/a", { signal: caller.signal })
        ).rejects.toBeInstanceOf(BoundedFetchError);
    });

    test("le timer est libéré même sur rejet — pas de fuite par requête échouée", async () => {
        // La fuite que ce dépôt a déjà payée une fois (`offline-detector.ts`) : un timer par
        // ping raté, qui s'empile aussi longtemps que le réseau reste coupé.
        const clear = vi.spyOn(globalThis, "clearTimeout");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("boom");
            })
        );
        await expect(fetchBounded("https://x.test/a")).rejects.toBeTruthy();
        expect(clear).toHaveBeenCalled();
        clear.mockRestore();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Garde de non-régression du PÉRIMÈTRE (tâche 3.8)
// ═══════════════════════════════════════════════════════════════════════════════════════

import metricsSrc from "../../src/capabilities/offline/cache/metrics.ts?raw";
import storageSrc from "../../src/capabilities/offline/cache/storage.ts?raw";
import iconsSrc from "../../src/capabilities/offline/cache/profile-icons.ts?raw";
import styleSrc from "../../src/capabilities/offline/cache/style-resolver.ts?raw";
import calcSrc from "../../src/capabilities/offline/cache/calculator.ts?raw";
import enumSrc from "../../src/capabilities/offline/cache/resource-enumerator.ts?raw";
import fmSrc from "../../src/capabilities/offline/cache/fetch-manager.ts?raw";
import swSrc from "../../src/kernel/storage/sw-core.js?raw";

describe("3.8 — aucun `fetch` non borné ne revient dans le périmètre", () => {
    /**
     * Les fichiers scannés, et les EXCEPTIONS NOMMÉES avec leur motif.
     *
     * 🛑 Nommées, et pas comptées. La roadmap disait « les 14 chemins » ; le détecteur en
     * rendait 22 le 01/08, 21 le 02/08. Un décompte bouge à chaque commit et se relâche d'une
     * unité sans que personne ne le voie ; une liste d'exceptions oblige à écrire POURQUOI.
     */
    const SCANNED = [
        ["cache/metrics.ts", metricsSrc, []],
        ["cache/storage.ts", storageSrc, []],
        ["cache/profile-icons.ts", iconsSrc, []],
        ["cache/style-resolver.ts", styleSrc, []],
        ["cache/calculator.ts", calcSrc, []],
        ["cache/resource-enumerator.ts", enumSrc, []],
        ["cache/fetch-manager.ts", fmSrc, []],
        [
            "kernel/storage/sw-core.js",
            swSrc,
            [
                // Le helper LUI-MÊME : c'est lui qui pose le signal.
                "return await fetch(request, { signal: controller.signal });",
                // `syncProfile` — chemin MORT (aucun `registration.sync.register` dans le
                // dépôt), borné à la main par un AbortController local, retiré par 3.13.
                "response = await fetch(item.operation.endpoint, {",
            ],
        ],
    ];

    for (const [name, src, allowed] of SCANNED) {
        it(`${name} — tout \`fetch\` porte une échéance`, () => {
            const lines = src.split("\n");
            const offenders = [];
            lines.forEach((line, i) => {
                // ⚠️ L'INSTRUMENT NE DOIT PAS PORTER LE BIAIS QU'IL MESURE. Une première
                // version cherchait `\bfetch\(` et attrapait `async fetch(` (une DÉFINITION
                // de méthode) et `this.fetch(` (un appel à cette méthode, pas au fetch global).
                // Elle rougissait donc sur du code correct. On ne cherche que les appels au
                // `fetch` GLOBAL : ni précédé d'un point, ni précédé de `async`/`function`.
                if (!/(?<![.\w])fetch\(/.test(line)) return;
                if (/\b(async|function)\s+fetch\(/.test(line)) return;
                if (/fetchBounded|fetchWithTimeout/.test(line)) return;
                if (/^\s*(\*|\/\/)/.test(line)) return; // ni TSDoc ni commentaire de ligne
                if (allowed.some((a) => line.includes(a))) return;
                // Un `signal:` peut vivre quelques lignes plus bas, dans l'init.
                const window = lines.slice(i, i + 6).join("\n");
                if (/signal:/.test(window)) return;
                offenders.push(`${name}:${i + 1} → ${line.trim()}`);
            });
            expect(offenders, `sites non bornés :\n${offenders.join("\n")}`).toEqual([]);
        });
    }

    it("la garde n'est pas vide — elle voit bien des appels", () => {
        // Témoin : sans lui, un filtre trop large sortirait vert en ne scannant rien.
        const total = SCANNED.reduce(
            (n, [, src]) => n + (src.match(/\bfetch(Bounded|WithTimeout)?\(/g) || []).length,
            0
        );
        expect(total).toBeGreaterThan(10);
    });
});
