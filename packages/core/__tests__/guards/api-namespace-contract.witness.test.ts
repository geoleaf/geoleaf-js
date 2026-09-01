/**
 * Witness — `GeoLeafAPINamespace` is confronted with the objects it describes.
 *
 * ## Why this file exists, and why it is a test rather than an @example
 *
 * The contract's own header says it: since the type that extended it became standalone (to be
 * publishable), nothing confronted this shape with reality — "the contract has gone from
 * constraint to prose". The obvious witness — an `@example` documenting an assignment — was
 * TRIED AND REFUTED: the example type-checker classifies assignability errors as non-defect
 * diagnostics, so a deliberately false relation compiled green. A witness that cannot be seen
 * to fail is worse than none. This file is type-checked for real (per-package options via the
 * TTC gate, and by vitest's transform), so a drifting contract reddens the build.
 *
 * ## Why MEMBER-WISE, not whole-shape
 *
 * The contract is deliberately a NARROW VIEW ("shape of the global as seen by api/ files"),
 * all-optional with an index signature. A whole-shape witness is red in both directions by
 * construction — `global.d.ts` types `_APIController` as `unknown` where this contract
 * promises `{ init(): boolean }` — so the honest confrontation is each NAMED member against
 * the real implementation it stands for. `import type` only: zero bytes reach any bundle.
 */
import { describe, expect, it } from "vitest";

import type {
    GeoLeafAPINamespace,
    IGeoLeafAPIConstructors,
} from "../../src/contracts/api.contract.ts";
import type { APIController } from "../../src/kernel/api/controller.ts";
import type { APIModuleManager } from "../../src/kernel/api/module-manager.ts";
import type { CONSTANTS } from "../../src/utils/constants/constants.ts";

/** Resolves to `true` only when A is assignable to B — the failure text names the drift. */
type MustExtend<A, B> = A extends B ? true : "LE CONTRAT A DÉRIVÉ DE L'OBJET QU'IL DÉCRIT";

// ① The real controller honours what the contract promises for `_APIController`.
const controllerHonoursContract: MustExtend<
    InstanceType<typeof APIController>,
    NonNullable<GeoLeafAPINamespace["_APIController"]>
> = true;

// ② The real manager constructor honours the ctor shape `IGeoLeafAPIConstructors` promises.
const moduleManagerHonoursContract: MustExtend<
    typeof APIModuleManager,
    NonNullable<IGeoLeafAPIConstructors["APIModuleManager"]>
> = true;

// ③ The real CONSTANTS bag honours the (loose, but named) promise.
const constantsHonourContract: MustExtend<
    typeof CONSTANTS,
    NonNullable<GeoLeafAPINamespace["CONSTANTS"]>
> = true;

describe("GeoLeafAPINamespace — le contrat a un témoin de type", () => {
    it("les trois membres nommés sont confrontés à leur implémentation réelle", () => {
        // The proof is the compilation above; the run only keeps the file in the suite so
        // its type-check is exercised by every gate that compiles tests.
        expect(controllerHonoursContract).toBe(true);
        expect(moduleManagerHonoursContract).toBe(true);
        expect(constantsHonourContract).toBe(true);
    });
});
