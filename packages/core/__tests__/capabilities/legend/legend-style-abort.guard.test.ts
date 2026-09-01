/**
 * GUARD — an in-flight style request no longer writes into a torn-down legend.
 *
 * 🛑 THE DEFECT, AND WHY ITS `.catch()` DID NOT COVER IT.
 *
 * `loadLayerLegend()` fired a **bare** `fetch(stylePath)` whose continuation
 * calls `_applyStyleToLegend`, which **writes into the DOM and repopulates
 * `_allLayers`**. Its `.catch()` covers network failure and HTTP — it does
 * not cover the target vanishing between request and response. A `_reset()`
 * in that window let the continuation rebuild a torn-down module: exactly the
 * defect `_reset()`'s three timers are bound to prevent, except this one was
 * held by nothing.
 *
 * ── THE TWO WINDOWS, AND WHY A SIGNAL ALONE IS NOT ENOUGH ──────────────────────────────────
 *
 *   · **network window** — the response has not arrived: `abort()` makes the
 *     request reject and the continuation is never scheduled;
 *   · **microtask window** — the response HAS arrived, its continuation is
 *     **already scheduled**, and `abort()` can no longer do anything. Only
 *     the `signal.aborted` test at the continuation's head stops it. **The
 *     one a signal-only fix would let through.**
 *
 * ── WHAT THIS FILE PROVES, AND WHAT IT DOES NOT ────────────────────────────────────────────
 *
 * ✅ **LOAD-BEARING ON BOTH WINDOWS since 17/08/2026, seen turning red by two
 * INDEPENDENT mutations** — each reaching only the test that concerns it:
 *
 *   · removing the `fetch`'s `signal` → **2 tests** fail (transmission, network window);
 *   · removing `if (signal?.aborted) return;` → **the microtask test** fails, alone.
 *
 * 🔻 **THIS FILE HAS BEEN NON-LOAD-BEARING, AND THE ACCOUNT IS KEPT BECAUSE
 * IT CARRIES THE TRAP.** The first oracle — "`_allLayers` stays empty after
 * teardown" — left the file **GREEN** with the guard removed:
 * `_applyStyleToLegend` only repopulates the table **if** a `legendData`
 * computes, which no fixture guarantees without pinning a style shape. The
 * test thus told the truth for a reason other than the one it announced —
 * worse than no test.
 *
 * ✅ **What made it load-bearing: changing the ORACLE, not the fixture.** The
 * generator (`GeoLeaf._LegendGenerator.generateLegendFromStyle`) is called
 * **as the first useful instruction** of `_applyStyleToLegend`, before any
 * condition on what it returns. Spying on the **call** rather than the
 * **effect** removes any dependency on the style's shape.
 *
 * 📌 **The lesson, worth beyond this file**: on `PollingSource`, the same
 * guard was provable at the first try because the effect IS the handler call
 * — and a handler is a spy. The guard was not stronger there; what could be
 * OBSERVED of it was. When a guard seems unprovable, look for the observation
 * point before thickening the fixture.
 *
 * ⚠️ The fourth test is a **counter-proof** and is not decorative: a
 * `not.toHaveBeenCalled()` is true of anything that does not run. Without it,
 * a badly primed fixture would pass for a guard that bites.
 *
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { Legend } = await import("../../../src/capabilities/legend/legend.js");

const CONFIG_COUCHE = {
    id: "couche-test",
    styles: { directory: "styles", default: "defaut.json" },
} as never;

/** A `fetch` whose resolution is held by hand. */
function fetchPilotable() {
    let resoudre!: (v: unknown) => void;
    let signalRecu: AbortSignal | undefined;
    const attente = new Promise<unknown>((r) => (resoudre = r));
    const faux = vi.fn((_url: string, init?: RequestInit) => {
        signalRecu = init?.signal ?? undefined;
        return attente.then(
            (corps) =>
                ({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(corps),
                }) as unknown as Response
        );
    });
    return {
        faux,
        repondre: (corps: unknown) => resoudre(corps),
        get signal() {
            return signalRecu;
        },
    };
}

/** Brings the module to the minimal state where `loadLayerLegend` really fires its request. */
function amorcer(): void {
    Legend.init({ getContainer: () => document.body, addControl: () => {} } as never);
    // `getAllLayers()` returns the module's LIVE Map: seeding it is within its public surface.
    Legend.getAllLayers().set("couche-test", {
        label: "Couche de test",
        visible: true,
        geometryType: "point",
        order: 1,
    } as never);
}

/**
 * Sets a spy on `GeoLeaf._LegendGenerator.generateLegendFromStyle` and returns it.
 *
 * 🛑 **The observation point is what makes the microtask window provable**,
 * and the choice is not indifferent. `_applyStyleToLegend` calls the
 * generator **as the first useful instruction**, BEFORE any condition on what
 * it returns — while its effects (`_allLayers`, the DOM) only happen IF a
 * `legendData` computes, which no fixture can guarantee without pinning a
 * style shape. Observing the **call** instead of the **effect** removes that
 * dependency.
 *
 * 📌 Exactly what distinguished this test from its `PollingSource` twin,
 * where the effect IS the handler call — and a handler is a spy. The guard
 * was not weaker here: what could be observed of it was.
 */
function espionnerGenerateur() {
    const g = globalThis as unknown as {
        GeoLeaf?: { _LegendGenerator?: { generateLegendFromStyle?: unknown } };
    };
    g.GeoLeaf ??= {};
    const espion = vi.fn(() => null);
    g.GeoLeaf._LegendGenerator = { generateLegendFromStyle: espion };
    return espion;
}

/** Lets the microtask queue AND one event-loop turn drain. */
async function viderLesMicroTaches(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
}

let fetchOrigine: typeof globalThis.fetch;

beforeEach(() => {
    fetchOrigine = globalThis.fetch;
    document.body.innerHTML = "";
    Legend._reset();
});

afterEach(() => {
    globalThis.fetch = fetchOrigine;
    Legend._reset();
    vi.restoreAllMocks();
});

describe("garde — le fetch de style est annulé par le cycle de vie de la légende", () => {
    it("le signal est TRANSMIS à `fetch` — sans quoi rien de ce qui suit ne veut dire quelque chose", () => {
        const p = fetchPilotable();
        globalThis.fetch = p.faux as unknown as typeof globalThis.fetch;
        amorcer();

        Legend.loadLayerLegend("couche-test", "defaut", CONFIG_COUCHE);

        // 🛑 Anti-empty-guard. If `loadLayerLegend` fired nothing — changed
        // signature, upstream configuration guard, unseeded precondition —
        // the next two tests would pass exercising nothing. This assertion
        // already bit when this file was first set.
        expect(p.faux, "aucun fetch n'a été lancé : la garde ne garderait rien").toHaveBeenCalled();
        expect(p.signal, "`fetch` a été appelé SANS signal").toBeInstanceOf(AbortSignal);
        expect(p.signal?.aborted).toBe(false);
    });

    it("fenêtre RÉSEAU — `_reset()` avant la réponse avorte la requête en vol", () => {
        const p = fetchPilotable();
        globalThis.fetch = p.faux as unknown as typeof globalThis.fetch;
        amorcer();

        Legend.loadLayerLegend("couche-test", "defaut", CONFIG_COUCHE);
        const signal = p.signal;
        expect(signal, "précondition : aucun fetch lancé").toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        Legend._reset();

        expect(signal?.aborted, "`_reset()` n'a pas avorté la requête en vol").toBe(true);
    });

    /**
     * 🛑 THIS TEST COVERS ONLY HALF OF WHAT IT SEEMS TO, AND THAT IS WRITTEN
     * HERE RATHER THAN DISCOVERED LATER.
     *
     * It exercises that the signal is **aborted before** the microtask queue
     * drains — hence that `legend.ts`'s `if (signal?.aborted) return;` guard
     * has something to bite on. It does **not** exercise that the
     * continuation refrains from writing.
     *
     * **Measured on 17/08/2026, by mutation**: removing that guard from the
     * source leaves this file **GREEN** (3/3). The oracle tried first —
     * "`_allLayers` stays empty" — does not bite, because
     * `_applyStyleToLegend` only repopulates the table if a `legendData`
     * computes, which this fixture does not guarantee. **A test green for a
     * reason other than the one it announces is worse than no test**: it
     * certifies a guard it does not exercise.
     *
     * ⚠️ The guard is **kept in the source** — its reasoning holds: an
     * already-received response has its continuation already scheduled, and
     * `abort()` can no longer do anything. What is missing is its PROOF, not
     * its justification.
     *
     * **What it would take to make it load-bearing**: style data that really
     * produces a `legendData` (hence the shape `_buildLegendData` expects),
     * or an oracle observing the call rather than its effect. Both require
     * pinning a style shape into the fixture — a committing choice, and not
     * this batch's.
     */
    it("fenêtre MICRO-TÂCHE — la continuation N'APPELLE PAS le générateur après démontage", async () => {
        const p = fetchPilotable();
        globalThis.fetch = p.faux as unknown as typeof globalThis.fetch;
        amorcer();
        const generateur = espionnerGenerateur();

        Legend.loadLayerLegend("couche-test", "defaut", CONFIG_COUCHE);
        const signal = p.signal;
        expect(p.faux, "précondition : aucun fetch lancé").toHaveBeenCalled();

        // The response arrives: the continuation is now SCHEDULED, and
        // nothing can keep it from running any more — `abort()` included.
        p.repondre({ layers: [{ id: "couche-test", type: "circle", paint: {} }] });

        // The teardown happens in that very window.
        Legend._reset();
        expect(Legend.getAllLayers().size, "`_reset()` n'a pas vidé la table").toBe(0);

        await viderLesMicroTaches();

        // THE ORACLE: `_applyStyleToLegend` calls the generator BEFORE any
        // condition on what it returns. Not having called it proves the
        // continuation stopped at the guard.
        expect(
            generateur,
            "le générateur a été appelé APRÈS `_reset()` : la garde `if (signal?.aborted) return;` n'a pas arrêté la continuation"
        ).not.toHaveBeenCalled();

        // Backing: that is indeed the fact the guard consults.
        expect(signal?.aborted, "le signal n'était pas avorté au moment de la continuation").toBe(
            true
        );
    });

    it("CONTRE-ÉPREUVE — SANS démontage, la même continuation appelle bien le générateur", async () => {
        // 🛑 Without this test, the previous one would also pass if the
        // continuation NEVER ran — badly primed fixture, unresolved `fetch`,
        // never-kept promise. A `not.toHaveBeenCalled()` is true of anything
        // that does not run.
        const p = fetchPilotable();
        globalThis.fetch = p.faux as unknown as typeof globalThis.fetch;
        amorcer();
        const generateur = espionnerGenerateur();

        Legend.loadLayerLegend("couche-test", "defaut", CONFIG_COUCHE);
        p.repondre({ layers: [{ id: "couche-test", type: "circle", paint: {} }] });

        await viderLesMicroTaches();

        expect(
            generateur,
            "le générateur n'est pas appelé même SANS démontage : la fixture n'exerce pas le chemin que le test au-dessus prétend garder"
        ).toHaveBeenCalled();
    });
});
