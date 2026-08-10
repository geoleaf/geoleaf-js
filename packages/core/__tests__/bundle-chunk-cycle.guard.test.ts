/**
 * @vitest-environment node
 *
 * B.12 — no chunk of the shipped bundle may import a chunk that imports it back.
 *
 * A circular chunk is not a style issue. ES modules evaluate a cycle by running one side's body
 * before the other has finished initialising, so any call made at IMPORT TIME across the cycle
 * can land in a temporal dead zone. That is not hypothetical here: `kernel/geojson/shared.ts`
 * calls `registerLifecycleTeardown()` at top level, the two modules ended up in different
 * chunks, and the shipped bundle threw `Cannot access '_teardowns' before initialization` the
 * moment it was imported. Three `ci:local` gates went red and the cause read as unrelated.
 *
 * 🛑 **Rollup had been printing `Circular chunk: chunk-geojson -> chunk-core-utils ->
 * chunk-geojson` on every build, and exiting 0.** The warning was true, visible, and useless —
 * one line inside a hundred, with a green exit code after it. `rollup.config.mjs` now throws on
 * it, but that guard matches a message string Rollup gives no code for: a reword upstream and it
 * goes quiet. This test asserts the same property on the ARTEFACT, so the two fail
 * independently. Neither is redundant — one stops the build, one survives Rollup's phrasing.
 *
 * Reads `dist/` — requires a prior build, hence `vitest.bundle.config.ts`.
 */

import { describe, test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(__dirname, "../dist");

/** Static `import ... from "./x.js"` / `export ... from` specifiers, dynamic ones excluded. */
function staticImportsOf(file) {
    const src = fs.readFileSync(file, "utf8");
    const specs = new Set();
    for (const m of src.matchAll(/(?:^|[;\s}])(?:import|export)\b[^;]*?from\s*["']([^"']+)["']/g)) {
        specs.add(m[1]);
    }
    // Bare `import "./x.js"` — a side-effect import, which evaluates the target just the same.
    for (const m of src.matchAll(/(?:^|[;\s}])import\s*["']([^"']+)["']/g)) specs.add(m[1]);
    return [...specs];
}

describe("bundle — aucun cycle entre chunks (B.12)", () => {
    /** @type {Map<string, string[]>} basename → basenames it statically imports */
    let graph;

    beforeAll(() => {
        // ⚠️ On marche le graphe DEPUIS L'ENTRÉE, on ne liste pas `dist/chunks/`.
        //
        // Lister le répertoire paraît équivalent et ne l'est pas : Rollup n'efface pas ce qu'il
        // ne réémet pas, et les noms portent un hash de contenu. Un `rollup -c` sans purge
        // préalable laisse donc les générations précédentes côte à côte — mesuré ici même,
        // **quatre** générations en cinq minutes (c'est B-130). La première version de cette
        // garde les lisait toutes et rapportait comme cycles vivants ceux des builds d'AVANT le
        // correctif : un rouge parfaitement faux, sur un dépôt déjà réparé.
        //
        // Partir de l'entrée ne mesure que ce qui est réellement servi, et rend la garde
        // insensible aux résidus — sans l'aveugler, puisqu'un chunk vraiment atteint est
        // forcément atteignable.
        const entry = path.join(DIST, "geoleaf.esm.js");
        graph = new Map();

        const visit = (file) => {
            const name = path.basename(file);
            if (graph.has(name) || !fs.existsSync(file)) return;
            const edges = staticImportsOf(file)
                .filter((s) => s.startsWith("."))
                .map((s) => path.basename(s));
            graph.set(name, edges);
            for (const e of edges) {
                const candidates = [path.join(DIST, e), path.join(DIST, "chunks", e)];
                const found = candidates.find((c) => fs.existsSync(c));
                if (found) visit(found);
            }
        };
        visit(entry);
    });

    test("le graphe des chunks est bien peuplé (anti-gate-vide)", () => {
        // Without this, a rename of `dist/chunks/` would make every assertion below pass by
        // scanning nothing at all — the precise failure mode `probe-gate-visibility` exists for.
        expect(graph.size).toBeGreaterThanOrEqual(4);
        const withEdges = [...graph.values()].filter((e) => e.length > 0);
        expect(withEdges.length).toBeGreaterThanOrEqual(2);
    });

    test("aucun couple de chunks ne s'importe mutuellement", () => {
        const mutual = [];
        for (const [a, edges] of graph) {
            for (const b of edges) {
                if (graph.get(b)?.includes(a)) {
                    mutual.push([a, b].sort().join(" <-> "));
                }
            }
        }
        expect([...new Set(mutual)]).toEqual([]);
    });

    test("aucun cycle de longueur quelconque dans le graphe des chunks", () => {
        const cycles = [];
        const state = new Map(); // 0 = visiting, 1 = done

        const walk = (node, stack) => {
            if (state.get(node) === 1) return;
            if (state.get(node) === 0) {
                cycles.push([...stack.slice(stack.indexOf(node)), node].join(" -> "));
                return;
            }
            state.set(node, 0);
            for (const next of graph.get(node) ?? []) walk(next, [...stack, next]);
            state.set(node, 1);
        };

        for (const node of graph.keys()) walk(node, [node]);
        expect(cycles).toEqual([]);
    });
});
