/**
 * @file feature-info-structure.guard.test.js
 * @description Structural guard test of the `feature-info` capability.
 *
 * ## Why this guard exists
 *
 * A reclassification (04/07/2026) moved `feature-info` from external plugin
 * to in-core capability. The **2 specs locking its file list** were removed
 * from `extracted-features.guard.test.js` on that occasion — rightly: that
 * guard forbids an EXTRACTED feature to leave residue in the core, and
 * `feature-info` is now deliberately IN the core. The contract no longer applied.
 *
 * But nothing took over. That removal is what made a later rename painless,
 * and what has left the capability without a net since.
 *
 * ## What this guard verifies — and what it does NOT
 *
 * The removed guard's naive mirror would be "no feature-info mention outside
 * its directory". Measured on 24/07: **33 core files carry one, all
 * legitimate** (boot module, `geoleaf.featureinfo.ts` facade, contracts,
 * i18n, CSS, and the whole `taxonomy` capability consuming it). A per-token
 * guard would produce 33 false positives the day of its pose — so that is
 * not the invariant to write.
 *
 * The three invariants below are the ones that break silently:
 *
 *   FI-01  The STRUCTURING files exist. Not an exhaustive inventory (it
 *          would turn red at every legitimate addition): the files whose
 *          disappearance or move changes the capability's architecture.
 *   FI-02  The facade stays a facade (INV-FACADE). `public-api.ts` delegates
 *          to the surfaces; if it starts importing `render/*` directly, it
 *          has absorbed presentation logic — exactly the drift the
 *          facade/implementation separation forbids.
 *   FI-03  The capability is mounted on the namespace through its facade.
 *
 * The 5-method public surface is already covered by
 * `__tests__/capabilities/feature-info/public-api.test.js` — not duplicated here.
 *
 * ⚠️ Written in ESM and not CJS like the 3 other guards: the package is
 * `"type": "module"`, and CJS `.js` files are precisely what maintains the
 * tsx dependency (measured, see `ensure-tsx-node-options.mjs`). Do not
 * reintroduce a `require()` here.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, "../../src");
const CAP = resolve(CORE_SRC, "capabilities/feature-info");

/**
 * The capability's structuring files. Each carries a share of the
 * architecture: removing or moving one is a decision, not a detail.
 */
const STRUCTURAL_FILES = [
    // Facade and contract
    "public-api.ts",
    "types.ts",
    "config.ts",
    // Lifecycle and registration
    "install.ts",
    "lifecycle.ts",
    "feature-info-capability.ts",
    // The 3 surfaces — the public API's promise
    "surfaces/popup.ts",
    "surfaces/sidepanel.ts",
    "surfaces/tooltip.ts",
    // Per-layer binding resolution
    "convert.ts",
    "resolve.ts",
];

describe("feature-info — garde structurelle (R.20, filet repris après le retrait SR0)", () => {
    it("FI-01 — les fichiers structurants de la capacité existent", () => {
        const missing = STRUCTURAL_FILES.filter((rel) => !existsSync(resolve(CAP, rel)));
        expect(
            missing,
            `Fichier(s) structurant(s) absent(s) de capabilities/feature-info/.\n` +
                `Si le déplacement est voulu, mettre à jour STRUCTURAL_FILES dans ce garde ` +
                `— c'est le point : la liste ne bouge que sciemment.`
        ).toEqual([]);
    });

    it("FI-02 — la façade délègue aux surfaces et n'importe pas render/ directement", () => {
        const source = readFileSync(resolve(CAP, "public-api.ts"), "utf8");
        const renderImports = source
            .split("\n")
            .filter((line) => /^\s*import\s/.test(line) && /["']\.\/render\//.test(line));
        expect(
            renderImports,
            `public-api.ts importe render/ directement — la façade a absorbé de la logique ` +
                `de présentation. Elle doit passer par surfaces/.`
        ).toEqual([]);

        // And it does delegate: at least one surface imported.
        expect(source).toMatch(/from\s+["']\.\/surfaces\//);
    });

    it("FI-03 — la façade monte l'objet CONSTRUIT, pas un objet quelconque", async () => {
        const facade = resolve(CORE_SRC, "api/geoleaf.featureinfo.ts");
        expect(existsSync(facade), "api/geoleaf.featureinfo.ts est absent").toBe(true);

        // ⚠️ This test's first writing: two `toMatch` on the SOURCE
        // (`/buildPublicApi/` and `/export const FeatureInfo/`). Proven
        // non-covering by mutation — replacing `buildPublicApi()` with `{}`,
        // the import line stayed and both regexes still passed. A test
        // looking for a token the mutation does not remove guards nothing:
        // so the module is imported and what it really mounts is looked at.
        const { FeatureInfo } = await import(facade);
        for (const method of ["isEnabled", "close", "openPopup", "openSidePanel", "getConfig"]) {
            expect(typeof FeatureInfo[method], `FeatureInfo.${method} n'est pas monté`).toBe(
                "function"
            );
        }
    });
});
