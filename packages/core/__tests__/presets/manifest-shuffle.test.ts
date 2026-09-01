/**
 * SHUFFLE HARNESS — what the order of `FULL.capabilities` must STOP deciding.
 *
 * ## The problem this file guards
 *
 * `presets/manifest.full.ts` is a list, and its order long decided things
 * unrelated to one another. Reordering for one silently moved the others.
 * One coupling was already cut — the mobile toolbar's layout — by making it
 * explicit (`mobileIcon.order`) instead of emergent. This harness is what
 * keeps the coupling from returning unseen.
 *
 * ## What is NOT asserted here, and why
 *
 * ⚠️ The initial survey asked for "post-boot surface and `app:ready` effects
 * IDENTICAL" under permutation. **The 07/08/2026 preflight measured that
 * this is false**, and requiring it would turn this file red on the
 * following properties, which are wanted:
 *
 *   - `route` before `filter` — Kahn's topological sort tie-breaks on
 *     registration order (both depend on `geojson`);
 *   - `theme-selector` last — same Kahn tie-break, which fixes the order of
 *     `geoleaf:app:ready` listeners.
 *
 * A guard turning red on that would be noisy, and a noisy gate learns to be
 * ignored. This file thus asserts the invariance of what MUST be invariant —
 * the composed set and the toolbar — and leaves the init order alone,
 * naming it rather than silencing it.
 *
 * 🛑 **A THIRD property sat in this list until 08/08/2026: "`pwa` before
 * `offline` — their `sharedLifecycle` run in that order (#7 → #8), and
 * `offline` reads `modules.pwa.enabled`".** It was REFUTED. It is removed
 * from here because this file cited it as *wanted*, i.e. as a reason not to
 * test it — and it was neither wanted nor true.
 *
 * ⚠️ **And the corresponding assertion was NOT added here, deliberately.**
 * This harness only runs `registerPresetDeclarations` /
 * `registerPresetModules`: it **never calls `SharedModule`**, so it is
 * structurally unable to see a `sharedLifecycle` coupling. `pwa` and
 * `offline` having neither `createModule` nor `mobileIcon`, permuting them
 * here changes nothing *by construction* — a rule set there would be green
 * no matter what, including under the mutation that counts.
 * `shared-lifecycle-order.test.ts` carries it, with the only harness that
 * executes the lifecycles.
 *
 * @see packages/core/src/presets/manifest.full.ts — the remaining constraints, and the TWO
 *   removed because they had stopped being true (or never were)
 * @see packages/core/__tests__/presets/shared-lifecycle-order.test.ts — the refutation
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ICoreModule } from "../../src/contracts/core-module.contract.js";
import type { PresetManifest } from "../../src/contracts/preset.contract.js";
// Extracted on 08/08/2026, when `shared-lifecycle-order.test.ts` needed it
// too: two copies of a congruential generator are two diverging seed sequences.
import { shuffled } from "./_helpers/shuffle.ts";

const { FULL } = await import("../../src/presets/manifest.full.ts");
const { registerPresetDeclarations, registerPresetModules } =
    await import("../../src/presets/apply-preset.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { ModuleRegistry } = await import("../../src/app/module-registry.ts");

/** A manifest's installers — the only type this file needs. */
type Capabilities = PresetManifest["capabilities"];

/** Composes a manifest and returns what came out of it, initialising nothing. */
function compose(capabilities: Capabilities): { declared: string[]; modules: ICoreModule[] } {
    CapabilityRegistry._reset();
    const declared: string[] = [];
    const modules: ICoreModule[] = [];
    const capReg = {
        register: (d: { id: string }) => {
            declared.push(d.id);
            CapabilityRegistry.register(d as Parameters<typeof CapabilityRegistry.register>[0]);
        },
        // Pass 1 records the installation facts. This harness does not read
        // them, but the collaborator is required — an absent stub would be a `TypeError`.
        noteInstaller: () => {},
        isEnabled: () => true,
    };
    const preset = { id: "shuffled", capabilities } as PresetManifest;
    registerPresetDeclarations(preset, capReg, {});
    registerPresetModules(preset, capReg, {
        register: (m: ICoreModule) => modules.push(m),
    });
    return { declared, modules };
}

/**
 * Reproduces `_appendRegistryIcons`'s comparator (`kernel/ui/mobile/mobile-toolbar-pill.ts`).
 *
 * ⚠️ It is inline in a DOM-touching function, hence not importable.
 * Duplicating it would test the copy; that is not what is done here — the
 * assertion that counts is `SEEDS`-invariant AND backed by
 * `PILLS_CARRY_EXPLICIT_ORDER` below, which is the real condition of its
 * independence from the manifest order.
 */
function pillOrder(modules: readonly ICoreModule[]): string[] {
    return [...modules]
        .sort((a, b) => {
            const oa = a.ui?.mobileIcon?.order;
            const ob = b.ui?.mobileIcon?.order;
            if (oa === undefined && ob === undefined) return 0;
            if (oa === undefined) return 1;
            if (ob === undefined) return -1;
            return oa - ob;
        })
        .filter((m) => m.ui?.mobileIcon)
        .map((m) => m.id);
}

/**
 * Runs the REAL topological sort on the composed graph, and returns the observed order.
 *
 * ## Why this second harness exists (completed on 08/08/2026)
 *
 * `compose()` stops at registration: it sees neither Kahn's sort nor the
 * traversal following from it. Yet the sort decides the `init()` order,
 * hence that of `geoleaf:app:ready` listeners — the very property the
 * initial wording aimed at. The 08/08 check found that hole: the file
 * composed where its plan line said "boot".
 *
 * ## Why probes rather than the real modules
 *
 * Each wrapper is replaced by a probe that **keeps `id` and
 * `dependencies`** — so the sorted graph is the real one — but never calls
 * the real module's `init()`. Running the 16 shipped `init()`s would demand
 * a MapLibre adapter and a full DOM, and would exercise the capabilities'
 * behaviour, not the sort's invariance. The subject here is the sort.
 *
 * The two kernel modules the capabilities depend on (`geojson`, `config`)
 * are registered **LAST**, deliberately: `ModuleRegistry` throws on a
 * missing dependency, so they must be there — but at the head, insertion
 * order would already satisfy the graph *by accident*, and the "each after
 * its dependencies" rule would stay green even with the sort deleted.
 * Putting them at the end means only a real sort can satisfy it. Seen red
 * by replacing `_topoSort()` with raw registration order.
 *
 * @param capabilities The installers, in the order to exercise.
 * @returns The ids in the order the registry initialised them.
 */
async function bootOrder(capabilities: Capabilities): Promise<string[]> {
    const seen: string[] = [];
    // `init` and `destroy` go together — `ModuleRegistry.register()`
    // validates the disjunction and throws. A probe with only one of the two
    // would not be a module.
    const probe = (id: string, dependencies: readonly string[]): ICoreModule =>
        ({
            id,
            dependencies,
            init: () => {
                seen.push(id);
            },
            destroy: () => {},
        }) as unknown as ICoreModule;

    const registry = new ModuleRegistry();
    for (const m of compose(capabilities).modules) {
        registry.register(probe(m.id, m.dependencies ?? []));
    }
    registry.register(probe("geojson", []));
    registry.register(probe("config", []));

    await registry.init({} as never, {} as never);
    return seen;
}

const SEEDS = [1, 7, 42, 1337, 90210];

beforeEach(() => {
    CapabilityRegistry._reset();
    vi.restoreAllMocks();
});

describe("mélange du manifeste — ce qui doit rester invariant", () => {
    it("compose le MÊME ensemble de déclarations, quel que soit l'ordre", () => {
        const reference = [...compose(FULL.capabilities).declared].sort();
        expect(reference.length).toBeGreaterThan(10); // anti-gate-vide : un manifeste creux passerait tout

        for (const seed of SEEDS) {
            const got = [...compose(shuffled(FULL.capabilities, seed)).declared].sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    it("compose le MÊME ensemble de modules, quel que soit l'ordre", () => {
        const reference = compose(FULL.capabilities)
            .modules.map((m) => m.id)
            .sort();
        expect(reference.length).toBeGreaterThan(10);

        for (const seed of SEEDS) {
            const got = compose(shuffled(FULL.capabilities, seed))
                .modules.map((m) => m.id)
                .sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    // THE toolbar-order ASSERTION, and this file's reason for being.
    it("rend les pastilles de la toolbar dans le MÊME ordre, quel que soit l'ordre du manifeste", () => {
        const reference = pillOrder(compose(FULL.capabilities).modules);
        expect(reference.length).toBeGreaterThan(0); // anti-gate-vide

        for (const seed of SEEDS) {
            const got = pillOrder(compose(shuffled(FULL.capabilities, seed)).modules);
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    /**
     * The condition making the previous assertion TRUE — and the only one able to betray it.
     *
     * The comparator ranks modules without `order` **after** all those with
     * one, keeping their relative registration order (stable sort). So as
     * soon as a SECOND `order`-less badge appears, their order becomes the
     * manifest's again — and the cut coupling returns, silently, with none
     * of the assertions above moving as long as the tested seeds do not
     * invert them.
     *
     * This guard depends on no seed: it forbids the condition itself.
     */
    it("PILLS_CARRY_EXPLICIT_ORDER — toute pastille déclare son ordre", () => {
        const pills = compose(FULL.capabilities).modules.filter((m) => m.ui?.mobileIcon);
        expect(pills.length).toBeGreaterThan(0);

        const sansOrdre = pills
            .filter((m) => m.ui?.mobileIcon?.order === undefined)
            .map((m) => m.id);

        expect(
            sansOrdre,
            "une pastille sans `order` retombe sur l'ordre d'enregistrement — c'est exactement " +
                "le couplage que socle-init 7.5 a coupé. Lui donner un `mobileIcon.order`."
        ).toEqual([]);
    });
});

// ── The sort, under permutation ───────────────────────────────────────────────

describe("tri topologique — ce qu'un vrai registre décide, sous permutation", () => {
    it("initialise le MÊME ensemble de modules, quel que soit l'ordre du manifeste", async () => {
        const reference = [...(await bootOrder(FULL.capabilities))].sort();
        expect(reference.length).toBeGreaterThan(10); // anti-gate-vide

        for (const seed of SEEDS) {
            const got = [...(await bootOrder(shuffled(FULL.capabilities, seed)))].sort();
            expect(got, `graine ${seed}`).toEqual(reference);
        }
    });

    /**
     * ⚠️ **The exact order is NOT asserted, and that is not a renouncement — it is the measure.**
     *
     * The preflight recorded two real order constraints (`route` before
     * `filter`, `theme-selector` last) that come out of Kahn's tie-break at
     * equality, which follows registration order. They MOVE under
     * permutation, legitimately. Requiring order invariance would turn this
     * file red on wanted behaviour.
     *
     * What must be true, though, under every permutation, is that the sort
     * **honours the graph**: no module initialises before one of its
     * dependencies. The property the sort exists to produce, and the only
     * one a permutation must never dent.
     */
    it("place toujours chaque module APRÈS ses dépendances", async () => {
        for (const seed of SEEDS) {
            const capabilities = shuffled(FULL.capabilities, seed);
            const order = await bootOrder(capabilities);
            const rank = new Map(order.map((id, i) => [id, i]));

            const deps = compose(capabilities).modules.flatMap((m) =>
                (m.dependencies ?? []).map((d) => [m.id, d] as const)
            );
            expect(deps.length, `graine ${seed}`).toBeGreaterThan(0); // anti-gate-vide

            for (const [id, dep] of deps) {
                expect(rank.get(id), `graine ${seed} — ${id} dépend de ${dep}`).toBeGreaterThan(
                    rank.get(dep)!
                );
            }
        }
    });
});
