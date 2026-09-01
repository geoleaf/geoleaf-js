/**
 * `fetchBounded` — and the perimeter's non-regression guard.
 *
 * Two distinct objects here:
 *  1. the helper's behaviour (deadline, abort-signal chaining, no leak);
 *  2. a SOURCE guard counting the offline perimeter's unbounded `fetch`es,
 *     with a list of NAMED exceptions — because a nameless count loosens by
 *     one unit every sprint with nobody seeing it.
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
        // An abandonment returning `null` is a disguised silent failure: the
        // caller can no longer tell "the server said nothing" from "the
        // server said no".
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
        // A user abort signal is not a deadline, and a deadline must not
        // replace the abort: the request dies on whichever of the two falls first.
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
        // The leak this repo already paid for once (`offline-detector.ts`):
        // one timer per failed ping, stacking as long as the network stays down.
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
// PERIMETER non-regression guard
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
     * The files scanned, and the NAMED EXCEPTIONS with their motive.
     *
     * 🛑 Named, not counted. The plan said "the 14 paths"; the detector
     * returned 22 on 01/08, 21 on 02/08. A count moves at every commit and
     * loosens by one unit with nobody seeing it; an exception list forces
     * writing WHY.
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
                // The helper ITSELF: it is what sets the signal.
                "return await fetch(request, { signal: controller.signal });",
                // `syncProfile` — DEAD path (no `registration.sync.register`
                // in the repo), hand-bounded by a local AbortController, since removed.
                "response = await fetch(item.operation.endpoint, {",
            ],
        ],
    ];

    for (const [name, src, allowed] of SCANNED) {
        it(`${name} — tout \`fetch\` porte une échéance`, () => {
            const lines = src.split("\n");
            const offenders = [];
            lines.forEach((line, i) => {
                // ⚠️ THE INSTRUMENT MUST NOT CARRY THE BIAS IT MEASURES. A
                // first version searched `\bfetch\(` and caught
                // `async fetch(` (a method DEFINITION) and `this.fetch(` (a
                // call to that method, not the global fetch). It thus turned
                // red on correct code. Only calls to the GLOBAL `fetch` are
                // sought: neither dot-preceded, nor preceded by `async`/`function`.
                if (!/(?<![.\w])fetch\(/.test(line)) return;
                if (/\b(async|function)\s+fetch\(/.test(line)) return;
                if (/fetchBounded|fetchWithTimeout/.test(line)) return;
                if (/^\s*(\*|\/\/)/.test(line)) return; // ni TSDoc ni commentaire de ligne
                if (allowed.some((a) => line.includes(a))) return;
                // A `signal:` may live a few lines below, in the init.
                const window = lines.slice(i, i + 6).join("\n");
                if (/signal:/.test(window)) return;
                offenders.push(`${name}:${i + 1} → ${line.trim()}`);
            });
            expect(offenders, `sites non bornés :\n${offenders.join("\n")}`).toEqual([]);
        });
    }

    it("la garde n'est pas vide — elle voit bien des appels", () => {
        // Witness: without it, an over-broad filter would come out green scanning nothing.
        const total = SCANNED.reduce(
            (n, [, src]) => n + (src.match(/\bfetch(Bounded|WithTimeout)?\(/g) || []).length,
            0
        );
        expect(total).toBeGreaterThan(10);
    });
});
