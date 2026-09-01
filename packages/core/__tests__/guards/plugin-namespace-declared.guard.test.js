/**
 * @file plugin-namespace-declared.guard.test.js
 * @description Guard test — every namespace a plugin MOUNTS is DECLARED in
 * `GeoLeafGlobal` (`packages/core/src/global.d.ts`).
 *
 * Why this guard exists (27/07/2026)
 * -------------------------------------------
 * The namespace's strict typing removed `GeoLeafGlobal`'s
 * `[key: string]: unknown` tail and declared 7 plugin namespaces. **Five
 * were missing** — `FileImport`, `Measure`, `Print`, `Editor`, `Ws` — and
 * the tail's removal made them **unreachable at the type level**: an
 * integrator compiling against the published types received TS2339 on
 * `GeoLeaf.FileImport`, while the plugin does mount it at runtime.
 *
 * Both effects came from the SAME gesture — 8 documented ghost APIs dropped
 * on one side, 5 published plugins closed off on the other. Only the first
 * was intended, and **nothing said so**: plugins write through `GeoLeafHost`
 * (`@geoleaf/host-runtime`), which still carries its tail, so their own
 * compilation stays green. The two contracts are not at the same stage, and
 * that offset is what made the gap invisible while `ci:local` came out 54/54.
 *
 * This guard closes the class, not the five cases: a 14th plugin mounting an
 * undeclared namespace would turn red here, with nobody having to think of it.
 *
 * ## What it does NOT verify
 *
 * Neither the mounted surface's SHAPE (the members are declared `unknown` —
 * the remaining deposit, progressing per member), nor the reverse (a
 * declaration with no plugin mounting it). The second direction would be
 * desirable but is not symmetric: the core legitimately declares members no
 * plugin mounts.
 *
 * ## Why a TEST and not a `scripts/` script
 *
 * Same reason as `doc-plugin-manifest.guard.test.js`, written in its header:
 * a new script is refused until git-tracked AND enrolled in
 * `SCRIPTS_ALLOWLIST`, so `ci:local` would stay red until the commit.
 * Assumed trade-off: this file reads `packages/plugins/` sources from
 * `core`, **as text, never by import** — an `entry.ts` mounts a global
 * namespace and wires listeners at evaluation.
 *
 * ## The `GeoLeafGlobal` reader is SHARED since 19/08/2026
 *
 * It lived here, by brace counting. `namespace-local-views.guard.test.js`
 * needed the same — the other direction of the same question — and two
 * copies drift. Extracted into `_helpers/geoleaf-global-keys.js`, and
 * rewritten on the AST in passing: brace counting failed silently on a brace
 * in a comment, a member over two lines or a quoted name, and a silent
 * failure yields an INCOMPLETE set, hence a guard that exempts.
 *
 * ## A guard never seen red guards nothing
 *
 * Two anti-empty-guard assertions, and **no silent fallback**: if
 * `GeoLeafGlobal` becomes unfindable or no `entry.ts` is read, the guard
 * throws instead of coming out green.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_OWN_NAMESPACE } from "../_helpers/no-own-namespace.js";
import { readGeoLeafGlobalKeys } from "../_helpers/geoleaf-global-keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLUGINS_DIR = path.join(REPO_ROOT, "packages/plugins");
const GLOBAL_DTS = path.join(REPO_ROOT, "packages/core/src/global.d.ts");

// The list of plugins without their own facade is SHARED with
// `doc-plugin-manifest.guard.test.js`: it states a repo fact belonging to
// neither guard, and two copies would drift. Full motive in the helper.

/**
 * The namespace an `entry.ts` mounts, or `null`.
 *
 * Two forms coexist, and they had to be measured: direct assignment
 * (`_g.GeoLeaf.COG = buildPublicApi()`, `_host.Table = …`) and — until
 * 27/07/2026 — the indexed write behind a cast
 * (`(… as Record<string, unknown>)["AddPOI"] = …`). The second is gone, but
 * it is recognised here **on purpose**: if it reappeared, the guard must see
 * it rather than conclude "this plugin mounts nothing".
 */
function extractMountedNamespace(entrySource) {
    const direct = /\.([A-Z][A-Za-z0-9]*)\s*=\s*buildPublicApi\s*\(/.exec(entrySource);
    if (direct) return direct[1];
    const indexed = /\[\s*["']([A-Z][A-Za-z0-9]*)["']\s*\]\s*=\s*buildPublicApi\s*\(/.exec(
        entrySource
    );
    return indexed ? indexed[1] : null;
}

const PLUGINS = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, e.name, "src/entry.ts")))
    .map((e) => e.name)
    .sort();

describe("test-garde — tout namespace monté par un plugin est déclaré dans GeoLeafGlobal", () => {
    const declared = readGeoLeafGlobalKeys(GLOBAL_DTS);

    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("lit au moins un plugin (sinon ce garde ne garde rien)", () => {
        expect(PLUGINS.length, `aucun src/entry.ts sous ${PLUGINS_DIR}`).toBeGreaterThan(0);
    });

    it("lit des clés dans `GeoLeafGlobal` (sinon tout serait déclaré « manquant »)", () => {
        expect(
            declared.size,
            "aucune clé de premier niveau extraite de global.d.ts"
        ).toBeGreaterThan(0);
    });

    it("chaque namespace monté est déclaré côté core", () => {
        const missing = [];
        let mountedCount = 0;

        for (const plugin of PLUGINS) {
            const entry = fs.readFileSync(path.join(PLUGINS_DIR, plugin, "src/entry.ts"), "utf8");
            const ns = extractMountedNamespace(entry);

            if (ns === null) {
                // The plugin mounts nothing: the exemption must be written, with its motive.
                if (!NO_OWN_NAMESPACE[plugin]) {
                    missing.push(
                        `${plugin} : aucun namespace monté détecté, et aucune entrée dans ` +
                            `NO_OWN_NAMESPACE. Soit il monte sa surface d'une forme que ce garde ne ` +
                            `connaît pas (l'apprendre explicitement), soit il n'en monte aucune ` +
                            `(l'inscrire avec son motif).`
                    );
                }
                continue;
            }

            mountedCount += 1;
            if (NO_OWN_NAMESPACE[plugin]) {
                missing.push(
                    `${plugin} : exempté dans NO_OWN_NAMESPACE alors qu'il MONTE \`${ns}\` — retirer l'entrée.`
                );
                continue;
            }
            if (!declared.has(ns)) {
                missing.push(
                    `${plugin} : monte \`GeoLeaf.${ns}\` mais \`${ns}\` n'est pas déclaré dans ` +
                        `packages/core/src/global.d.ts → un intégrateur compilant contre les types ` +
                        `publiés reçoit TS2339.`
                );
            }
        }

        // Third anti-empty-guard: without at least one namespace REALLY
        // confronted, the loop above could pass having compared nothing.
        expect(
            mountedCount,
            "aucun namespace monté n'a été confronté à global.d.ts"
        ).toBeGreaterThan(0);
        expect(missing, missing.join("\n")).toEqual([]);
    });

    // ── The exemption must be FALSIFIABLE ───────────────────────────────────────
    // Without these two checks, `NO_OWN_NAMESPACE` would be a courtesy
    // dispensation: any plugin having FORGOTTEN its facade could be enrolled
    // and silence the guard. A plugin that forgot its facade drives NOTHING
    // — it thus cannot satisfy the `drives` assertion, which is what tells
    // "no facade, by decision" from "forgotten facade".
    it("chaque exemption nomme une surface du core qu'elle pilote VRAIMENT", () => {
        const wrong = [];
        for (const [plugin, ex] of Object.entries(NO_OWN_NAMESPACE)) {
            if (!fs.existsSync(path.join(REPO_ROOT, ex.owner))) {
                wrong.push(`${plugin} : \`owner\` introuvable — ${ex.owner}`);
            }
            // ⚠️ COMMENTS are removed BEFORE the search, and that is not
            // cosmetic: `offline-ui`'s `entry.ts` names `GeoLeaf.Storage`
            // three times in prose to explain its own exemption. Without the
            // cleanup, the assertion was satisfied by those mentions —
            // measured: re-pointing the `healthCheck` to another surface left
            // the guard GREEN. An exemption is proven by what the code
            // REACHES, not by what it tells.
            // `?.` normalised next: `entry.ts` writes `_g.GeoLeaf?.Storage`.
            const entry = fs
                .readFileSync(path.join(PLUGINS_DIR, plugin, "src/entry.ts"), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, " ")
                .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
                .replace(/\?\./g, ".");
            const re = new RegExp(`\\b${ex.drives.replace(/\./g, "\\.")}\\b`);
            if (!re.test(entry)) {
                wrong.push(
                    `${plugin} : exempté au motif qu'il pilote \`${ex.drives}\`, mais son ` +
                        `entry.ts ne l'atteint nulle part. Une exemption « pas de façade » n'est ` +
                        `PAS une exemption « façade oubliée ».`
                );
            }
        }
        expect(wrong, wrong.join("\n")).toEqual([]);
    });
});
