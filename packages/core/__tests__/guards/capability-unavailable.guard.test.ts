/**
 * Guard CU — a capability's absence is an observable FACT, not a log line.
 *
 * ## The defect this guard closes
 *
 * When a capability was missing, nothing said so: the registry returned
 * `undefined` and the caller went on. Worse in one precise place —
 * `ensureLoaded(id)` on an id nobody declared loaded nothing **and enrolled
 * the id in `_loaded`**, so `isLoaded(id)` then asserted the opposite of the
 * truth. Not "no answer", a false answer, and a caller does not recover from it.
 *
 * The live case is a **reduced bundle**: `capabilities/offline/lifecycle.ts`
 * calls `ensureLoaded("offline")` from shared module no. 8 as soon as a
 * profile enables `pwa` + `offline`. An entry not embarking the capability
 * loaded nothing, and `Storage.init()` then set off against an absent engine.
 *
 * ## Why the assertions bear on the MECHANISM and not a count
 *
 * ⚠️ The tempting form — "confront at boot a profile's `modules.<id>` keys
 * with the registered capabilities" — is **false by construction**, and that
 * is measured: plugins pour into the SAME registry and load lazily, so a
 * capability may register long after boot, or never. "Is X absent?" has no
 * answer at a given instant. A guard written on that form would have been
 * born green (5 `modules.*` keys of 5 known in `profiles/`) while being
 * false — exactly the kind of green that gets believed.
 *
 * Hence four assertions on what IS true at all times:
 *
 *   CU-01  `ensureLoaded()` on an undeclared id DECLARES the fact, and does
 *          NOT enrol the lie.
 *   CU-02  A late subscriber receives the CATCH-UP — otherwise the ordering
 *          problem this form exists to solve would come back one notch lower.
 *   CU-03  The declaration is idempotent per id, and unsubscribing really cuts.
 *   CU-04  The namespace is mounted on `GeoLeaf` with its TWO members —
 *          anti-empty-guard: without it, the previous three would stay green
 *          on a namespace never exposed, since they import the module directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CapabilityRegistry } from "../../src/kernel/api/capability-registry.ts";
import { Capabilities } from "../../src/kernel/api/unavailable-capabilities.ts";

describe("CU — l'absence d'une capacité est observable", () => {
    beforeEach(() => {
        CapabilityRegistry._reset();
    });

    it("CU-01 — ensureLoaded() sur un id non déclaré déclare le fait et n'inscrit pas le mensonge", async () => {
        const vu: { id: string; motif: string }[] = [];
        const off = Capabilities.onUnavailable((f) => vu.push({ ...f }));

        await expect(CapabilityRegistry.ensureLoaded("offline")).resolves.toBeUndefined();

        expect(vu).toHaveLength(1);
        expect(vu[0]?.id).toBe("offline");
        expect(vu[0]?.motif).toMatch(/\S/);
        // The second half, and the one that tells "mute" from "liar".
        expect(CapabilityRegistry.isLoaded("offline")).toBe(false);
        off();
    });

    it("CU-01 bis — une capacité DÉCLARÉE ne produit aucun fait, et reste marquée chargée", async () => {
        const vu: string[] = [];
        const off = Capabilities.onUnavailable((f) => vu.push(f.id));

        CapabilityRegistry.register({ id: "offline" });
        await CapabilityRegistry.ensureLoaded("offline");

        expect(vu).toEqual([]);
        expect(CapabilityRegistry.isLoaded("offline")).toBe(true);
        off();
    });

    it("CU-02 — un abonné tardif reçoit le rattrapage", async () => {
        await CapabilityRegistry.ensureLoaded("table");

        const vu: string[] = [];
        const off = Capabilities.onUnavailable((f) => vu.push(f.id));

        expect(vu).toEqual(["table"]);
        off();
    });

    it("CU-03 — déclaration idempotente par id, et le désabonnement coupe", () => {
        const vu: string[] = [];
        const off = Capabilities.onUnavailable((f) => vu.push(f.id));

        Capabilities.declareUnavailable("labels", "premier motif");
        Capabilities.declareUnavailable("labels", "second motif, ignoré");
        expect(vu).toEqual(["labels"]);

        off();
        Capabilities.declareUnavailable("print", "après désabonnement");
        expect(vu).toEqual(["labels"]);
    });

    it("CU-03 bis — un abonné qui jette n'empêche pas les autres d'être servis", () => {
        const vu: string[] = [];
        const offA = Capabilities.onUnavailable(() => {
            throw new Error("abonné fautif");
        });
        const offB = Capabilities.onUnavailable((f) => vu.push(f.id));

        expect(() => Capabilities.declareUnavailable("scale", "motif")).not.toThrow();
        expect(vu).toEqual(["scale"]);
        offA();
        offB();
    });

    it("CU-04 — le namespace est monté sur GeoLeaf avec ses deux membres", async () => {
        vi.resetModules();
        await import("../../src/globals/globals.api.ts");

        const ns = (globalThis as Record<string, unknown>).GeoLeaf as
            { Capabilities?: Record<string, unknown> } | undefined;

        expect(typeof ns?.Capabilities?.declareUnavailable).toBe("function");
        expect(typeof ns?.Capabilities?.onUnavailable).toBe("function");
    });
});
