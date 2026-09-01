/**
 * @file namespace-local-views.guard.test.ts
 * @description Guard test — every LOCAL VIEW of the namespace names only
 * members `GeoLeafGlobal` declares (`packages/core/src/global.d.ts`).
 *
 * ## What a "local view" is, and why the repo is full of them
 *
 * A module needing only a piece of the namespace declares it in place:
 *
 * ```ts
 * const g = globalThis as unknown as { GeoLeaf?: { DEBUG?: boolean } };
 * ```
 *
 * A good pattern — it says exactly what the module depends on, and nothing
 * more. It has one defect, and only one: **nothing confronts it with the
 * contract**. The view is an independent declaration; the compiler takes it
 * at its word and has no reason to compare it with `GeoLeafGlobal`. A view
 * can thus name a member that does not exist, or no longer does.
 *
 * ## Why this guard
 *
 * `verify-host-contract-sync.cjs` compares NAMES between the contract and
 * the mounted surface, and `plugin-namespace-declared.guard.test.js` guards
 * the WRITE direction — every namespace a plugin mounts is declared. Both
 * watch what the library SETS. Nobody watched what it READS, and that is the
 * other half: a read is a contract as much as a write.
 *
 * 🔺 **The first survey found one member, and it was a PUBLIC API defect.**
 * `kernel/config/debug-flag.ts` reads `GeoLeaf.DEBUG`, a toggle the
 * INTEGRATOR sets (`window.GeoLeaf.DEBUG = true`) and the library never
 * writes. No gate of the time could see it: all follow what the code
 * MOUNTS. The published contract did not declare it, the
 * `[key: string]: unknown` tail that absorbed it was removed on purpose, and
 * an integrator following the instruction written in the accessor itself
 * received `TS2339: Property 'DEBUG' does not exist on type 'GeoLeafGlobal'`.
 *
 * ## What this guard does NOT verify, and it must be known before trusting it
 *
 * It compares first-level NAMES, not SHAPES. A view declaring
 * `Log?: { warn?(): void }` where the contract declares another signature would pass.
 *
 * ⚠️ **Going one level down was MEASURED, then ruled out.** Of the contract's
 * 102 members, **only 2** are closed object literals — the others are named
 * types or carry their own index signature. A depth-2 mechanism would thus
 * have borne on 2% of the contract while reading as shape coverage. Better a
 * guard that says what it does than one that suggests what it does not.
 *
 * ## A guard never seen red guards nothing
 *
 * Three anti-empty-guard assertions: the contract must yield members, the
 * corpus must yield files, and the survey must find views. If one falls to
 * zero, the guard throws instead of coming out green — an empty set agrees
 * with anything.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readGeoLeafGlobalKeys } from "../_helpers/geoleaf-global-keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const GLOBAL_DTS = path.join(REPO_ROOT, "packages/core/src/global.d.ts");
const PACKAGES_ROOTS = ["packages/core", "packages/libs", "packages/plugins"];
const SKIP_DIRS = new Set(["__tests__", "__mocks__", "node_modules", "dist", "coverage"]);

/**
 * Every `.ts` source under the workspaces, tests and generated output excluded.
 *
 * ⚠️ Read from the DISK and not from a hand-written list: a list would have to be updated by
 * whoever adds a package, and a forgotten entry is a package this guard silently stops covering.
 *
 * @returns {string[]} Absolute file paths.
 */
function collectSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (!SKIP_DIRS.has(e.name)) walk(p);
            } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
                out.push(p);
            }
        }
    };
    for (const root of PACKAGES_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            const src = path.join(abs, e.name, "src");
            if (e.isDirectory() && fs.existsSync(src)) walk(src);
        }
        // `packages/core` carries its `src/` directly, not a package level.
        const own = path.join(abs, "src");
        if (fs.existsSync(own)) walk(own);
    }
    return [...new Set(out)].sort();
}

/** One member named by one local view — the unit this guard confronts to the contract. */
interface LocalViewMember {
    file: string;
    line: number;
    member: string;
}

/**
 * Every member named by a local view of the namespace.
 *
 * A local view is any property named `GeoLeaf` whose type is an object literal — which covers
 * both shapes the repo uses: a named `interface … { GeoLeaf?: { … } }` and an inline cast
 * `globalThis as { GeoLeaf?: { … } }`. Both parse to the same node, so one rule catches both.
 *
 * @param {string[]} files - Sources to scan.
 * @returns {{file: string, line: number, member: string}[]} One entry per named member.
 */
function collectLocalViewMembers(files: string[]): LocalViewMember[] {
    const found: LocalViewMember[] = [];
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("GeoLeaf")) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const visit = (node: ts.Node): void => {
            if (
                ts.isPropertySignature(node) &&
                node.name &&
                node.name.getText(sf) === "GeoLeaf" &&
                node.type &&
                ts.isTypeLiteralNode(node.type)
            ) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                for (const m of node.type.members) {
                    if (!m.name) continue;
                    found.push({
                        file: path.relative(REPO_ROOT, file),
                        line,
                        member: m.name.getText(sf).replace(/^["']|["']$/g, ""),
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return found;
}

describe("test-garde — une vue locale ne nomme que des membres déclarés du namespace", () => {
    const declared = readGeoLeafGlobalKeys(GLOBAL_DTS);
    const files = collectSources();
    const views = collectLocalViewMembers(files);

    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("le contrat rend des membres (sinon toute vue serait déclarée fautive)", () => {
        expect(declared.size).toBeGreaterThan(50);
    });

    it("le corpus rend des fichiers (sinon ce garde ne garde rien)", () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it("le relevé trouve des vues locales (sinon la comparaison porte sur le vide)", () => {
        expect(
            views.length,
            "aucune vue locale trouvée — soit le patron a disparu du dépôt, soit ce garde ne " +
                "sait plus le reconnaître. Les deux demandent une lecture, pas un assouplissement."
        ).toBeGreaterThan(10);
    });

    // ── NS-VIEW-01 ──────────────────────────────────────────────────────────────
    it("aucune vue locale ne nomme un membre absent du contrat", () => {
        const orphans = views
            .filter((v) => !declared.has(v.member))
            .map((v) => `${v.file}:${v.line} — GeoLeaf.${v.member}`);

        expect(
            orphans,
            `Une vue locale nomme un membre que \`GeoLeafGlobal\` ne déclare pas. Deux lectures, ` +
                `et il faut trancher laquelle : soit le membre existe au runtime et le contrat ` +
                `publié est INCOMPLET — un intégrateur reçoit alors TS2339 sur un membre bien ` +
                `réel —, soit il n'existe pas et la vue lit du vide en croyant lire quelque ` +
                `chose. Déclarer le membre, ou retirer la vue. L'ajouter au contrat est le geste ` +
                `par défaut quand c'est l'INTÉGRATEUR qui le pose : rien dans la bibliothèque ne ` +
                `l'écrit, donc aucune gate qui suit les écritures ne le verra jamais.`
        ).toEqual([]);
    });
});
