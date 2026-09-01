/**
 * Guard MFC — the shipped manifest embarks ALL the in-core capabilities, and
 * it proves it against the disk rather than a hand-written number.
 *
 * ## The defect, measured
 *
 * Four headers in the repo announced the in-core capability count, and **none
 * was right**: `presets/manifest.full.ts` said "18", `app/boot.ts` said "17",
 * and the true count was **21** — both are removed. Remained on 07/08/2026 —
 * `bundle-esm-entry.ts` ("all 18") and `kernel-exports.ts` ("all 17"), plus a
 * worse case: `kernel-exports.ts` announced **9** capabilities next to the
 * name of `examples/minimal/entry.ts`, which embarks **6** — 9 being
 * `consumer`'s count. A line pointing at one file and giving another's number.
 *
 * ## Why a guard, and not one more fix
 *
 * A number in prose is a **second source of truth**: it can only diverge, and
 * its divergence is indistinguishable from correctness for every tool in the
 * repo. The doctrine is therefore **not to write it** — which the four
 * headers now do. What remains to hold is the promise itself: *"the shipped
 * entry embarks everything"*. It is held here, against `readdirSync`.
 *
 * ⚠️ What the guard really catches is not the comment — it is **a capability
 * that exists on disk and the manifest does not embark**. It would then be
 * absent from the shipped bundle, silently: no capability test turns red for
 * a capability never installed.
 *
 * ## The three rules
 *
 *   MFC-01  **No orphan capability.** Every `src/capabilities/` directory
 *           carrying an `install.ts` must see its installer in `FULL.capabilities`.
 *   MFC-02  **No ghost installer.** Reciprocally, every member of
 *           `FULL.capabilities` must come from an `install.ts` present on
 *           disk — otherwise the manifest embarks a capability the directory
 *           no longer carries.
 *   MFC-03  **The corpus cannot be empty.** A green guard that scanned
 *           nothing is the worst outcome — same class as DIST-03, JTD-03 and
 *           EOD-03. Here the trap is real: a glob that stops matching would
 *           return `{}`, and the two rules above would pass on the empty set.
 *
 * ## Proof by mutation — to replay before believing this guard
 *
 * `mkdir packages/core/src/capabilities/__fake22__ && cp …/scale/install.ts …/__fake22__/`
 * must turn **MFC-01** red naming `__fake22__`. Seen red on 07/08/2026 at the
 * pose. Removing a line from `FULL.capabilities` must turn it red likewise.
 *
 * @see packages/core/src/presets/manifest.full.ts — le sujet
 */
import { describe, expect, it } from "vitest";

const { FULL } = await import("../../src/presets/manifest.full.ts");

// Static glob: the modules are enumerated at transform, so a vanishing
// capability directory cannot be silently skipped by a failing dynamic
// import. Same pattern as `doc-capability-config.guard.test.js`.
const INSTALL_MODULES = import.meta.glob("../../src/capabilities/*/install.ts");

/** `../../src/capabilities/<nom>/install.ts` → `<nom>`. */
function capabilityDirOf(globKey) {
    return globKey.replace(/^.*\/capabilities\//, "").replace(/\/install\.ts$/, "");
}

/**
 * The single installer an `install.ts` exports.
 *
 * Each exports only one (`<NAME>_INSTALLER`), but we do not trust the NAME:
 * deriving it from the directory would reintroduce exactly the implicit
 * convention this guard exists not to have to assume. We take the export
 * carrying a `declaration`.
 */
function installerOf(mod, dir) {
    const found = Object.values(mod).filter(
        (v) => v && typeof v === "object" && "declaration" in v
    );
    if (found.length !== 1) {
        throw new Error(
            `[MFC] ${dir}/install.ts exporte ${found.length} installer(s) — il en faut exactement 1.`
        );
    }
    return found[0];
}

describe("MFC — manifeste livré ↔ répertoires de capacités (lus sur le disque)", () => {
    it("MFC-03 — le corpus scanné n'est pas vide", () => {
        // Anti-empty-gate: if the glob stops matching (`capabilities/` moved,
        // `install.ts` renamed), the next two rules would pass on the empty
        // set and this guard would come out green guarding nothing any more.
        expect(Object.keys(INSTALL_MODULES).length).toBeGreaterThan(0);
        expect(FULL.capabilities.length).toBeGreaterThan(0);
    });

    it("MFC-01 — toute capacité présente sur le disque est embarquée par FULL", async () => {
        const embarked = new Set(FULL.capabilities);
        const missing = [];

        for (const [key, load] of Object.entries(INSTALL_MODULES)) {
            const dir = capabilityDirOf(key);
            const installer = installerOf(await load(), dir);
            if (!embarked.has(installer)) missing.push(dir);
        }

        expect(
            missing,
            `Capacité(s) présente(s) dans src/capabilities/ mais ABSENTE(S) de FULL.capabilities : ` +
                `${missing.join(", ")}. Elles ne partent pas dans le bundle livré. ` +
                `Ajouter leur installer à packages/core/src/presets/manifest.full.ts.`
        ).toEqual([]);
    });

    it("MFC-02 — FULL n'embarque aucun installer sans répertoire sur le disque", async () => {
        const onDisk = new Set();
        for (const [key, load] of Object.entries(INSTALL_MODULES)) {
            onDisk.add(installerOf(await load(), capabilityDirOf(key)));
        }

        const ghosts = FULL.capabilities
            .filter((inst) => !onDisk.has(inst))
            .map((inst) => inst?.declaration?.id ?? "<sans id>");

        expect(
            ghosts,
            `FULL.capabilities embarque ${ghosts.length} installer(s) qu'aucun ` +
                `src/capabilities/*/install.ts ne fournit : ${ghosts.join(", ")}.`
        ).toEqual([]);
    });

    it("les deux ensembles ont donc la même taille — le compte n'est écrit nulle part", () => {
        // ⚠️ This assertion does NOT write the number. It derives it from both
        // sides, which is precisely the difference between "structurally
        // true" and "true the day someone typed it".
        expect(FULL.capabilities.length).toBe(Object.keys(INSTALL_MODULES).length);
    });

    /**
     * MFC-04 — the THIRD extractor of `FULL.capabilities` is finally cross-checked.
     *
     * 🛑 The repo carries **three** independent extractors of the same array,
     * and until now only two held each other:
     *   ① `manifestOrder()` from `scripts/gen-entry.cjs` — TEXTUAL read of
     *      `manifest.full.ts`, bounded by bracket depth, comments removed;
     *   ② `capabilitiesImportedBy()` from `scripts/check-example-bundle.cjs`
     *      — regex over the `capabilities/<id>/install.js` imports;
     *   ③ the real import of `FULL.capabilities`, above.
     * **GEN-04 holds ① against ③. ② was held by nothing** — exactly the kind
     * of oracle that diverges with nothing turning red.
     *
     * ⚠️ **The function is IMPORTED, not reimplemented.** Rewriting its logic
     * here would create a **fourth** extractor — the very defect this rule
     * treats. `require()` of the script is side-effect free: its execution is
     * gated by `require.main === module`.
     *
     * 🔗 **Prerequisite of publishing the preset.** Publishing the preset
     * moves `check-example-bundle.cjs`'s reference point. One does not move
     * an oracle known to have two other unaligned peers: they get aligned first.
     *
     * 📌 What this rule concretely catches: ② does **not** strip comments,
     * where ① deliberately does. A `capabilities/<id>/install.js` cited in a
     * `manifest.full.ts` comment — a `@see`, an example, a history line —
     * would over-count ② with neither of the other two moving. Measured at
     * the pose: **0** such mentions today, the 21 occurrences all being real imports.
     */
    it("MFC-04 — l'extracteur de `check-example-bundle.cjs` voit le même manifeste que l'import", async () => {
        const { createRequire } = await import("node:module");
        const path = await import("node:path");
        const fs = await import("node:fs");

        // ⚠️ Resolution by cwd, NOT by `import.meta.url`: under Vitest the
        // latter is not a `file:` URL (Vite serves the modules), and
        // `fileURLToPath` throws `ERR_INVALID_URL_SCHEME`. Measured at the
        // pose, on 17/08/2026.
        //
        // 🛑 BUT THE CWD IS NOT `packages/core` EVERYWHERE, and the first
        // draft assumed it. `turbo run test` launches vitest PER PACKAGE (cwd
        // = the package); `ci.yml` launches `npx vitest run` in workspace
        // mode FROM THE ROOT. The `../..` climb then exited two levels ABOVE
        // the repo — measured on 18/08/2026 on the runner:
        // `/home/runner/work/scripts/check-example-bundle.cjs`, not found.
        //
        // ⚠️ And the guard had never been EXERCISED remotely: the previous
        // runs died before reaching the unit tests. It had thus been red
        // since its pose, with nothing able to say so. The root is now
        // SEARCHED for, no longer assumed: we climb to `turbo.json`, which
        // exists only at the repo root (verified).
        const findRepoRoot = (from: string): string => {
            let dir = from;
            for (;;) {
                if (fs.existsSync(path.join(dir, "turbo.json"))) return dir;
                const up = path.dirname(dir);
                if (up === dir) {
                    throw new Error(
                        `racine du dépôt introuvable depuis ${from} — aucun \`turbo.json\` en remontant. ` +
                            `Sans elle, cette règle comparerait deux listes vides et sortirait verte.`
                    );
                }
                dir = up;
            }
        };
        const REPO = findRepoRoot(process.cwd());
        const CORE = path.join(REPO, "packages", "core");
        const SCRIPT_CJS = path.join(REPO, "scripts", "check-example-bundle.cjs");
        const MANIFEST_ABS = path.join(CORE, "src", "presets", "manifest.full.ts");

        // Both paths are ASSERTED: a wrong path would yield two empty lists,
        // and this rule would come out green having cross-checked nothing at all.
        expect(fs.existsSync(SCRIPT_CJS), `script introuvable : ${SCRIPT_CJS}`).toBe(true);
        expect(fs.existsSync(MANIFEST_ABS), `manifeste introuvable : ${MANIFEST_ABS}`).toBe(true);

        const requireCjs = createRequire(path.join(CORE, "package.json"));
        const { capabilitiesImportedBy } = requireCjs(SCRIPT_CJS);

        /** ② — what the tree-shaking proof script's extractor sees. */
        const parLeTexte = [...capabilitiesImportedBy(MANIFEST_ABS)].sort();

        /** ③ — the directories whose installer really is in `FULL.capabilities`. */
        const embarques = new Set(FULL.capabilities);
        const parLImport = [];
        for (const [key, load] of Object.entries(INSTALL_MODULES)) {
            const dir = capabilityDirOf(key);
            if (embarques.has(installerOf(await load(), dir))) parLImport.push(dir);
        }
        parLImport.sort();

        // Anti-empty-gate: without it, a wrong path to the script or the
        // manifest would yield two empty lists and this rule would come out
        // green having cross-checked nothing at all.
        expect(parLeTexte.length).toBeGreaterThan(0);

        expect(
            parLeTexte,
            `Les deux extracteurs de \`FULL.capabilities\` ne voient pas la même chose.\n` +
                `  ② par le TEXTE (check-example-bundle.cjs) : ${parLeTexte.join(", ")}\n` +
                `  ③ par l'IMPORT (ce fichier)                : ${parLImport.join(", ")}\n` +
                `Le script de preuve de tree-shaking juge donc un univers de capacités différent ` +
                `de celui que le bundle embarque réellement — son verdict porte sur autre chose ` +
                `que ce qu'il annonce.`
        ).toEqual(parLImport);
    });
});
