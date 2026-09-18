/**
 * @file deprecation-timing.guard.test.ts
 * @description Guard test — CC-10 judges WHEN an announced removal may land the way the
 * versioning policy says: inside the 3.x line, on a later minor, never in the version that
 * announces it.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * The policy states that no new MAJOR line is planned: 3.x is the only one, and a removal —
 * while the pre-adoption window is open — lands on a later 3.x minor, announced in an earlier
 * published one. The gate used to demand a `removeIn` of the form `x.0.0` above the current
 * major, i.e. a version that will never exist: any announcement written under the policy
 * would have been refused, and an announcement pointing at a phantom major accepted. These
 * cases pin the rule to the policy, in both directions.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface DeprecationTiming {
    judgeTiming(announcement: { since?: unknown; removeIn?: unknown }, current: string): string[];
}

const { judgeTiming }: DeprecationTiming = requireCjs(
    "../../../../scripts/lib/deprecation-timing.cjs"
);

const CURRENT = "3.4.0";

describe("CC-10 — calendrier d'une annonce de retrait", () => {
    it("accepte un retrait sur une mineure ultérieure de la ligne 3.x", () => {
        expect(judgeTiming({ since: "3.4.0", removeIn: "3.5.0" }, CURRENT)).toEqual([]);
    });

    it("accepte une annonce portée par un correctif, retirée à la mineure suivante", () => {
        expect(judgeTiming({ since: "3.4.2", removeIn: "3.5.0" }, "3.4.2")).toEqual([]);
    });

    it("refuse un retrait dans une majeure : la ligne 3.x est la seule", () => {
        const out = judgeTiming({ since: "3.4.0", removeIn: "4.0.0" }, CURRENT);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain("removeIn");
    });

    it("refuse un retrait dans la version en préparation — l'annonce serait datée du présent", () => {
        expect(judgeTiming({ since: "3.3.0", removeIn: "3.4.0" }, CURRENT)).toHaveLength(1);
    });

    it("refuse un retrait dans une version passée", () => {
        expect(judgeTiming({ since: "3.2.0", removeIn: "3.3.0" }, CURRENT)).toHaveLength(1);
    });

    it("refuse un retrait porté par un correctif : un retrait se publie sur une mineure", () => {
        expect(judgeTiming({ since: "3.4.0", removeIn: "3.5.1" }, CURRENT)).toHaveLength(1);
    });

    it("refuse une version qui annonce ET retire", () => {
        const out = judgeTiming({ since: "3.5.0", removeIn: "3.5.0" }, CURRENT);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain("since");
    });

    it("refuse une annonce hors de la ligne courante", () => {
        expect(judgeTiming({ since: "2.9.0", removeIn: "3.5.0" }, CURRENT)).toHaveLength(1);
    });

    it("refuse des versions illisibles, sans jeter", () => {
        expect(judgeTiming({ since: "bientôt", removeIn: "plus tard" }, CURRENT)).toHaveLength(2);
    });
});
