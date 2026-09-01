/**
 * GATE — "what is on, and why".
 *
 * ## The question this surface answers, and the two it does NOT replace
 *
 * Three neighbouring methods, three distinct objects — the file's reason for being:
 *
 *   - `getAllCapabilities()` returns what is **declared** (the schema);
 *   - `getActiveModules()` returns what **runs** (the modules whose `init()` was called);
 *   - `getCapabilityStatus()` returns the **config verdict**: embarked? enabled? through which gate?
 *
 * ## The fixtures are REAL, deliberately
 *
 * `PERMALINK_INSTALLER`, `CLUSTER_INSTALLER` and `BRANDING_INSTALLER` are
 * imported from shipped code, not simulated. Three of the five assertions
 * below can only turn red on the real objects:
 *
 *   - `permalink` is **the only** installer in the repo whose module
 *     carries an id OTHER than its capability (`share`) — the
 *     counter-example forbidding deriving `hasModule` from the `ModuleRegistry`;
 *   - `permalink` is also the only one declaring a `moduleGate`, hence the
 *     only place where "the gate deciding the module" and "the
 *     capability's gate" differ;
 *   - `cluster` is one of the 5 installers (out of 21) without
 *     `createModule` — without it, `hasModule` would be true everywhere and
 *     the assertion would discriminate nothing.
 *
 * ## What the first run proves, and what it does not
 *
 * ⚠️ Written before the code, this file turns red by **symbol absence**
 * (`CapabilityRegistry.getAllStatuses is not a function`). A weaker red
 * than the profile gate's, which turned red on a behaviour. Better said
 * than disguised: what makes these five rules credible is the
 * **counter-proof** — each `it` below names the one-line mutation of
 * shipped code that must turn it red. Without it the file would guard nothing.
 *
 * **Counter-proof record, played on 08/08/2026** — 7 green at start, one
 * mutation at a time, restore between each:
 *
 * | Mutation | Green | Red rules |
 * |---|---|---|
 * | `hasModule: false` in Pass 1 | 6 | CS-01 |
 * | gate evaluated on `toCapConfig({})` (frozen verdict) | 5 | CS-02 **and** CS-05 |
 * | `embarked: true` hardcoded | 6 | CS-03 |
 * | invented `gate` (`share`'s) | 5 | CS-04 (both its `it`s) |
 * | `gate: decl.gate` without conditional spread | 6 | CS-04 (second `it`) |
 * | the facade passes `_NO_CONFIG` instead of `_config()` | 6 | CS-05 |
 *
 * ⚠️ **The second mutation turns TWO red, and that is correct**: CS-02 and
 * CS-05 guard the same property — "the verdict is reread, never frozen" —
 * at two levels, the registry and the facade. Claiming perfect isolation
 * would have required weakening one of the two.
 *
 * 🛑 **One mutation is structurally IMPOSSIBLE, and it is the lot's best
 * guarantee**: `getAllStatuses()` cannot be made to restitute the
 * `moduleGate`, because the information is not transported that far — the
 * installation facts only carry `hasModule`. CS-04 thus guards a design
 * choice the code makes undeniable, and its first assertion can only be
 * defeated by inventing a gate from whole cloth (mutation 4 above).
 *
 * @see packages/core/src/presets/apply-preset.ts — Pass 1, which records the installation facts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { CapabilityInstaller, PresetManifest } from "../../src/contracts/preset.contract.js";
import type { ICapabilityStatus } from "../../src/contracts/capability.contract.js";

const { CapabilityRegistry, toCapConfig } =
    await import("../../src/kernel/api/capability-registry.ts");
const { registerPresetDeclarations } = await import("../../src/presets/apply-preset.ts");
const { Introspection } = await import("../../src/kernel/introspection/facade.ts");
const { PERMALINK_INSTALLER } = await import("../../src/capabilities/permalink/install.ts");
const { CLUSTER_INSTALLER } = await import("../../src/capabilities/cluster/install.ts");
const { BRANDING_INSTALLER } = await import("../../src/capabilities/branding/install.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Plays Pass 1 on the given installers — the "embarked by the build" channel. */
function embark(...capabilities: CapabilityInstaller[]): void {
    registerPresetDeclarations(
        { id: "capability-status", capabilities } as unknown as PresetManifest,
        CapabilityRegistry,
        {}
    );
}

/** An id's status, or `undefined` — absence is an answer, not an error. */
function statusOf(
    statuses: readonly ICapabilityStatus[],
    id: string
): ICapabilityStatus | undefined {
    return statuses.find((s) => s.id === id);
}

beforeEach(() => {
    // Module singleton: declarations AND installation facts would leak between tests.
    CapabilityRegistry._reset();
});

afterEach(() => {
    delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
});

// ── CS-01 ─────────────────────────────────────────────────────────────────────

describe("CS-01 — `hasModule` est un fait de l'INSTALLEUR, jamais du registre de modules", () => {
    it("distingue permalink (module) de cluster (aucun), sans inventer d'entrée `share`", () => {
        embark(PERMALINK_INSTALLER, CLUSTER_INSTALLER);

        const statuses = CapabilityRegistry.getAllStatuses(toCapConfig({}));

        expect(statusOf(statuses, "permalink")?.hasModule).toBe(true);
        expect(statusOf(statuses, "cluster")?.hasModule).toBe(false);
        // `permalink`'s module is called `share`. Deriving it from the
        // ModuleRegistry would return `hasModule: false` for permalink AND
        // make a nonexistent capability appear.
        expect(statuses.map((s) => s.id)).not.toContain("share");
        // Anti-empty-gate: two embarked capabilities, two statuses.
        expect(statuses).toHaveLength(2);
    });

    // MUTATION: in `getAllStatuses`, replace `facts?.hasModule ?? false`
    // with a ModuleRegistry read → `permalink` flips to `false`.
});

// ── CS-02 ─────────────────────────────────────────────────────────────────────

describe("CS-02 — `enabled` est relu à l'appel, jamais figé à l'enregistrement", () => {
    it("rend deux verdicts opposés pour deux configs, sur un registre inchangé", () => {
        // `branding` is the repo's only opt-in capability owning an
        // `ICoreModule` — this work's very subject.
        embark(BRANDING_INSTALLER);

        const off = CapabilityRegistry.getAllStatuses(toCapConfig({}));
        const on = CapabilityRegistry.getAllStatuses(
            toCapConfig({ modules: { branding: { enabled: true } } })
        );

        expect(statusOf(off, "branding")?.enabled).toBe(false);
        expect(statusOf(on, "branding")?.enabled).toBe(true);
    });

    // MUTATION: compute `enabled` in `register()` and restitute it → the two
    // reads become identical. Exactly the pre-merge verdict the rework deleted.
});

// ── CS-03 ─────────────────────────────────────────────────────────────────────

describe("CS-03 — `embarked` distingue le canal d'enregistrement", () => {
    it("sépare ce que le build a embarqué de ce que le runtime a déclaré", () => {
        embark(CLUSTER_INSTALLER);
        // The runtime channel: `GeoLeaf.plugins.registerCapability` lands
        // here. No installer, hence no installation fact — and THAT fact is
        // what yields `embarked: false`.
        CapabilityRegistry.register({ id: "table", gate: { configPath: "modules.table.enabled" } });

        const statuses = CapabilityRegistry.getAllStatuses(toCapConfig({}));

        expect(statusOf(statuses, "cluster")?.embarked).toBe(true);
        expect(statusOf(statuses, "table")?.embarked).toBe(false);
        // A runtime declaration can assert nothing about a module: it carries none.
        expect(statusOf(statuses, "table")?.hasModule).toBe(false);
    });

    // MUTATION: `embarked: true` hardcoded → the second assertion turns
    // red. The field would become decorative — the unfalsifiable-verdict
    // failure mode.
});

// ── CS-04 ─────────────────────────────────────────────────────────────────────

describe("CS-04 — `gate` est la CAUSE de `enabled`, et les deux se correspondent", () => {
    it("restitue le gate de la déclaration, pas le `moduleGate` du sous-module", () => {
        embark(PERMALINK_INSTALLER);

        const status = statusOf(CapabilityRegistry.getAllStatuses(toCapConfig({})), "permalink");

        // `permalink` carries both: `modules.permalink.enabled` on its
        // declaration, and `modules.permalink.share.enabled` on its
        // installer. Returning the second under the capability's id would
        // join a cause and an effect that do not correspond.
        expect(status?.gate?.configPath).toBe("modules.permalink.enabled");
        expect(status?.gate?.enableWhenAbsent).toBe(true);
    });

    it("rend `gate` absent et `enabled` vrai pour une capacité non gatée", () => {
        const ungated: CapabilityInstaller = {
            declaration: { id: "ungated" },
            registerGlobals: () => {},
        };
        embark(ungated);

        const status = statusOf(CapabilityRegistry.getAllStatuses(toCapConfig({})), "ungated");

        // No gate ⟹ always enabled (`evaluateGate` returns `true`), and the
        // `gate` key is ABSENT, not present at `undefined` — the reader can
        // tell the difference.
        expect(status?.gate).toBeUndefined();
        expect(status && "gate" in status).toBe(false);
        expect(status?.enabled).toBe(true);
    });

    // MUTATION: `gate: inst.moduleGate ?? decl.gate` → `permalink` restitutes `share`'s key.
});

// ── CS-05 ─────────────────────────────────────────────────────────────────────

describe("CS-05 — la façade lit la config VIVANTE, elle ne la capture pas", () => {
    it("change de verdict quand la config change, sans re-boot", () => {
        embark(BRANDING_INSTALLER);
        // `loadActiveProfileResources()` enriches the config object IN PLACE
        // (it returns the same object, never a replacement). A facade
        // capturing its reader at the first call would stay on the pre-merge
        // verdict — the lie this surface must avoid.
        const cfg: Record<string, unknown> = { modules: {} };
        (globalThis as { GeoLeaf?: unknown }).GeoLeaf = { Config: toCapConfig(cfg) };

        expect(statusOf(Introspection.getCapabilityStatus(), "branding")?.enabled).toBe(false);

        cfg.modules = { branding: { enabled: true } };

        expect(statusOf(Introspection.getCapabilityStatus(), "branding")?.enabled).toBe(true);
    });

    it("dégrade sans jeter quand aucune config n'est chargée", () => {
        embark(BRANDING_INSTALLER, CLUSTER_INSTALLER);
        // Before boot there is no `GeoLeaf.Config`. The expected answer is
        // neither an exception nor an empty array, but the exact verdict of
        // "nothing is configured": each gate answers its `enableWhenAbsent`.
        const statuses = Introspection.getCapabilityStatus();

        expect(statuses).toHaveLength(2);
        expect(statusOf(statuses, "branding")?.enabled).toBe(false); // opt-in
        expect(statusOf(statuses, "cluster")?.enabled).toBe(true); // opt-out
    });

    // MUTATION: capture the reader in a module constant at the first call →
    // the first assertion turns red on the second `expect`.
});
