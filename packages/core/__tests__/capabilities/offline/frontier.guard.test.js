/**
 * Frontier guard — the offline engine must stay OFF the boot static closure (S14 Phase B, B3).
 *
 * The heavy offline engine (IndexedDB / cache / download / sync / poi-restore, ~7.4 kLOC)
 * is loaded on demand via `OFFLINE_CAPABILITY.loader = () => import("./offline-engine-entry.js")`.
 * That dynamic `import()` keeps it out of the boot bundle: `check-bundle-size.cjs` follows only
 * STATIC `import`/`export … from`, so a dynamic-only engine is mechanically off-budget.
 *
 * This guard is the code-level proof of that invariant (complements the golden-master bootGz):
 *   1. No core/src file STATICALLY imports an engine module — except the engine's own
 *      composition root (`offline-engine-entry.ts`) and intra-engine imports.
 *   2. `offline-engine-entry.ts` itself is NEVER statically imported (only via `import()`).
 *   3. The capability loader reaches the engine through a dynamic `import()`.
 *
 * If any of these fail, a static edge has re-anchored the engine into the boot closure and
 * bootGz will jump ~20 KB gz — the frontier is broken.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src");
const OFFLINE = join(SRC, "capabilities", "offline");
// ⚠️ LISTE EN DUR, DONC À TENIR — et elle a déjà pris du retard une fois. `pull/` est arrivé
// avec la tâche 4.1 et n'y a PAS été ajouté : la garde est restée verte en cessant simplement
// de couvrir un répertoire du moteur, exactement la classe de cécité que
// `probe-gate-visibility.cjs` surveille ailleurs. `write/` (tâche 4.4) l'a fait rougir en
// important `db/local-edit.js`, ce qui a révélé l'omission précédente.
//
// Un répertoire neuf sous `capabilities/offline/` est un répertoire de MOTEUR par défaut :
// il part dans le chunk différé et ne doit jamais entrer dans la clôture statique du boot.
// ⚠️ LISTE EN DUR — tout répertoire neuf du moteur doit y être déclaré, sinon cette garde
// reste VERTE en cessant simplement de scanner le nouveau code. Elle a déjà été prise en
// défaut ainsi : 4.1 a créé `pull/` sans l'y ajouter, et la garde a couvert un répertoire de
// moins sans rien dire (tâche 4.4). `report/` ajouté par 4.8.
const ENGINE_DIRS = ["core", "db", "cache", "poi-restore", "pull", "report", "write"].map((d) =>
    join(OFFLINE, d)
);
const ENGINE_ENTRY = join(OFFLINE, "offline-engine-entry.ts");

/** True when `abs` is a heavy-engine module (or its composition root). */
function isEngineFile(abs) {
    if (abs === ENGINE_ENTRY) return true;
    return ENGINE_DIRS.some((d) => !relative(d, abs).startsWith(".."));
}

/** All non-declaration .ts files under `dir`, recursively. */
function allTsFiles(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) out.push(...allTsFiles(full));
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

/** STATIC import specifiers only — `from "x"` and side-effect `import "x"`; NOT `import()`. */
function staticImportSpecifiers(code) {
    const specs = new Set();
    let m;
    const fromRe = /(?<![\w$.])from\s*["']([^"']+)["']/g;
    while ((m = fromRe.exec(code))) specs.add(m[1]);
    const sideRe = /(?<![\w$.])import\s*["']([^"']+)["']/g;
    while ((m = sideRe.exec(code))) specs.add(m[1]);
    return [...specs];
}

/** Resolve a relative specifier to an absolute .ts file, or null if not local. */
function resolveSpec(fromFile, spec) {
    if (!spec.startsWith(".")) return null;
    const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
    for (const cand of [base + ".ts", join(base, "index.ts")]) {
        try {
            if (statSync(cand).isFile()) return cand;
        } catch {
            /* not this candidate */
        }
    }
    return null;
}

describe("frontier — offline engine stays off the boot static closure (S14 Phase B)", () => {
    const files = allTsFiles(SRC);

    it("no core/src file statically imports the engine (except intra-engine + its composition root)", () => {
        const offenders = [];
        for (const f of files) {
            if (isEngineFile(f)) continue; // intra-engine + the entry may import the engine
            for (const spec of staticImportSpecifiers(readFileSync(f, "utf8"))) {
                const target = resolveSpec(f, spec);
                if (target && isEngineFile(target)) {
                    offenders.push(`${relative(SRC, f)} → ${spec}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("offline-engine-entry.ts is imported ONLY dynamically (never a static import)", () => {
        const staticImporters = [];
        for (const f of files) {
            if (f === ENGINE_ENTRY) continue;
            for (const spec of staticImportSpecifiers(readFileSync(f, "utf8"))) {
                if (resolveSpec(f, spec) === ENGINE_ENTRY) staticImporters.push(relative(SRC, f));
            }
        }
        expect(staticImporters).toEqual([]);
    });

    it("the offline capability loader reaches the engine via a dynamic import()", () => {
        const cap = readFileSync(join(OFFLINE, "offline-capability.ts"), "utf8");
        expect(cap).toMatch(/loader\s*:/);
        expect(cap).toMatch(/import\(\s*["']\.\/offline-engine-entry\.js["']\s*\)/);
    });
});
