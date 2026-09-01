/**
 * Guard — every fallback default of `data.profilesBasePath` belongs to a pinned set.
 *
 * ## The defect this closes
 *
 * The same config key was read at many sites, each with its own inline fallback literal, and
 * nothing compared them: `"data/profiles"` in the profile loader against `"profiles"`
 * everywhere else meant that, with no explicit configuration, the profile was fetched from one
 * directory and its layers resolved from another — a silent incoherence an integrator could
 * neither see nor have written anywhere. A fourth value (`"/profiles/"`) lived only in the
 * configuration guide, false of every site. Aligned on 25/08/2026; this file is what keeps the
 * class from growing back — a default is a published surface of fact: whoever declares nothing
 * depends on it without knowing.
 *
 * ## What is pinned
 *
 * The census maps each file to the fallback literals it uses. `"profiles"` is THE default.
 * The two `"../profiles"` of the offline cache are deliberate and documented on site
 * (`resource-enumerator.ts` explains the divergence): the cache runs from a service-worker
 * scope one level below the page. The assertion is an exact equality, so it reddens in BOTH
 * directions: a new divergent literal anywhere, or a documented site silently disappearing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const { all } = require(path.join(ROOT, "scripts", "lib", "packages.cjs"));

/** file (repo-relative) → sorted fallback literals found for the key. */
function census(): Record<string, string[]> {
    const found = new Map<string, string[]>();
    const visit = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (["node_modules", "dist", "coverage", "__tests__", "__mocks__"].includes(e.name))
                continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) visit(p);
            else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) {
                const src = fs.readFileSync(p, "utf8");
                if (!src.includes("profilesBasePath")) continue;
                const lits: string[] = [];
                // Default passed to a config getter: get("data.profilesBasePath", "<lit>").
                for (const m of src.matchAll(/"data\.profilesBasePath",\s*"([^"]+)"/g))
                    if (m[1] !== undefined) lits.push(m[1]);
                // Inline fallback on the read value: … profilesBasePath … ?? / || "<lit>".
                for (const m of src.matchAll(
                    /profilesBasePath\b[^;\n]{0,80}?(?:\?\?|\|\|)\s*\n?\s*"([^"]+)"/g
                ))
                    if (m[1] !== undefined) lits.push(m[1]);
                // The two-line idiom: `profilesBasePath =\n  (…)?.profilesBasePath || "<lit>"`.
                for (const m of src.matchAll(/\?\.profilesBasePath\s*(?:\?\?|\|\|)\s*"([^"]+)"/g))
                    if (m[1] !== undefined) lits.push(m[1]);
                if (lits.length)
                    found.set(
                        path.relative(ROOT, p).replace(/\\/g, "/"),
                        [...new Set(lits)].sort()
                    );
            }
        }
    };
    for (const pkg of all() as Array<{ absDir: string }>) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) visit(src);
    }
    return Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

describe("profilesBasePath — le jeu de défauts est fermé", () => {
    it("chaque site de repli porte un littéral du jeu autorisé, et aucun site documenté ne disparaît", () => {
        const observed = census();
        // Anti-vacuity: the walk found the corpus, not an empty glob.
        expect(Object.keys(observed).length).toBeGreaterThanOrEqual(8);
        expect(observed).toEqual({
            "packages/core/src/capabilities/legend/legend.ts": ["profiles"],
            "packages/core/src/capabilities/offline/cache/resource-enumerator.ts": ["../profiles"],
            "packages/core/src/capabilities/offline/cache/storage.ts": ["../profiles"],
            "packages/core/src/capabilities/vector-tiles/vector-tiles.ts": ["profiles"],
            "packages/core/src/kernel/config/profile.ts": ["profiles"],
            "packages/core/src/kernel/geojson/layer-config-manager.ts": ["profiles"],
            "packages/core/src/kernel/geojson/loader/single-layer.ts": ["profiles"],
            "packages/core/src/utils/loaders/style-loader-core.ts": ["profiles"],
            "packages/plugins/flatgeobuf/src/config-loader.ts": ["profiles"],
            "packages/plugins/offline-ui/src/cache/layer-selector/config-cache.ts": ["profiles"],
            "packages/plugins/offline-ui/src/cache/layer-selector/core.ts": ["profiles"],
            "packages/plugins/offline-ui/src/cache/layer-selector/data-fetching.ts": ["profiles"],
            "packages/plugins/offline-ui/src/cache/layer-selector/selection-cache.ts": ["profiles"],
            "packages/plugins/realtime-layer/src/realtime-runtime.ts": ["profiles"],
            "packages/plugins/realtime-layer/src/url-resolver.ts": ["profiles"],
        });
    });
});
