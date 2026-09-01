/**
 * Guard PNC — no plugin carries a name the boot report treats as core.
 *
 * ## The defect, and why it is silent
 *
 * `reportPlugins()` (`kernel/api/plugin-registry.ts`) filters its list with
 * `_isCoreName()`, a **hardcoded** name list. The risk is not the list — it
 * is the **collision**: a plugin registering as `themes`, `legend`, `route`,
 * `labels` or `layerManager` would vanish from every boot's report,
 * **exiting 0**. It would be loaded, functional, and invisible. The file
 * already carries the trace of a real case: `"table"` sat in that list while
 * `plugins/table` had been a standalone plugin for several sprints, and
 * "keeping it here silently hid a real plugin from every boot report".
 *
 * ## Two rules, and a third guarding the instrument
 *
 *   PNC-01  **No plugin directory name in `_isCoreName()`.** The form
 *           `registry.plugins()` knows, and the one the build manipulates.
 *   PNC-02  **No REALLY registered name in `_isCoreName()`.** The string
 *           `reportPlugins()` compares at runtime — the only one that truly
 *           decides. It coincides today with the directory name for the 12
 *           plugins, but nothing in the code enforces it: PNC-01 alone would
 *           be blind to a plugin registering under a name other than its folder.
 *   PNC-03  **Both extractors must have found something.» The rule guarding
 *           the guard, and it is not theoretical here: this survey's first
 *           version looked for `plugins.register(` and saw **only 7 plugins
 *           out of 12** — the other 5 write `plugins?.register?.(`, with
 *           optional chaining. A short-sighted extractor yields a guard
 *           green on the subset it can read.
 *
 * ## Proof by mutation — to replay before believing this guard
 *
 * Renaming `packages/plugins/measure/` to `packages/plugins/themes/` must
 * turn **PNC-01** red naming `themes`; replacing `register?.("measure"` with
 * `register?.("legend"` in its `entry.ts` must turn **PNC-02** red. Seen red
 * on both on 07/08/2026.
 *
 * @see packages/core/src/kernel/api/plugin-registry.ts — `_isCoreName()`, le sujet
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

// `packages.cjs` is the packages' single registry — it THROWS if nothing is
// found, which is precisely why `packages/plugins/*` is not hand-globbed here.
const packages = createRequire(import.meta.url)(path.join(REPO, "scripts/lib/packages.cjs"));

const PLUGIN_REGISTRY_SRC = path.join(REPO, "packages/core/src/kernel/api/plugin-registry.ts");

/**
 * The names treated as core, READ from `_isCoreName()`'s body.
 *
 * Read rather than copied: a copy diverges, and the guard would then certify
 * a list the runtime no longer uses. Same pattern as `KNOWN_DEFAULT_DRIFT`
 * in `capabilities/config-schema-defaults.test.js`, which reads its
 * neighbour instead of duplicating it.
 *
 * Not exported from the module: `check-orphan-exports.cjs` excludes
 * `__tests__` from its corpus, so an export whose only consumer is this file
 * would enter the baseline as an orphan.
 */
function readCoreNames() {
    const src = fs.readFileSync(PLUGIN_REGISTRY_SRC, "utf8");
    const body = src.slice(src.indexOf("function _isCoreName"));
    const arr = body.slice(body.indexOf("["), body.indexOf("]") + 1);
    // ⚠️ Comments MUST fall before the extraction. The array carries a note
    // explaining why `"table"` was REMOVED from it — citing the name in
    // quotes, inside the literal. A naive extractor rereads it as a live
    // entry and accuses `plugins/table` of a collision that was precisely
    // repaired. Seen at this guard's pose: it turned red on `table`, and it
    // was the one that was wrong.
    const code = arr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    return [...code.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The name each plugin REALLY passes to `plugins.register(...)`, chaining included. */
function readRegisteredNames(pluginDir) {
    const names = new Set();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
                continue;
            }
            if (!/\.(ts|js)$/.test(e.name)) continue;
            const src = fs.readFileSync(p, "utf8");
            // ⚠️ The `\??` on EACH link is what the first survey lacked:
            // `plugins?.register?.(` is the form of the 5 host-runtime plugins.
            for (const m of src.matchAll(/plugins\??\.register\??\.?\(\s*"([^"]+)"/g)) {
                names.add(m[1]);
            }
        }
    };
    const srcDir = path.join(pluginDir, "src");
    if (fs.existsSync(srcDir)) walk(srcDir);
    return [...names];
}

const CORE_NAMES = readCoreNames();
const PLUGINS = packages.plugins().map((p) => ({
    dirName: p.dirName,
    registered: readRegisteredNames(p.absDir),
}));

describe("PNC — noms de plugin ↔ liste `_isCoreName()` du rapport de boot", () => {
    it("PNC-03 — les deux extracteurs ont trouvé quelque chose", () => {
        // Without it, PNC-01 and PNC-02 would pass on the empty set: a green
        // guard that read nothing. The failure mode this repo calls "anti-empty-gate".
        expect(CORE_NAMES.length).toBeGreaterThan(0);
        expect(CORE_NAMES).toContain("core"); // canari : si l'extraction dérape, elle rougit ici
        expect(PLUGINS.length).toBeGreaterThan(0);

        const mute = PLUGINS.filter((p) => p.registered.length === 0).map((p) => p.dirName);
        expect(
            mute,
            `Plugin(s) dont aucun appel \`plugins.register("…")\` n'a été trouvé dans src/ : ` +
                `${mute.join(", ")}. Soit ils ne s'enregistrent plus, soit la forme d'appel a ` +
                `changé et PNC-02 est devenue aveugle à eux — les deux se corrigent ici, ` +
                `jamais en retirant le plugin de la liste.`
        ).toEqual([]);
    });

    it("PNC-01 — aucun nom de répertoire de plugin n'est traité comme du core", () => {
        const clashes = PLUGINS.filter((p) => CORE_NAMES.includes(p.dirName)).map((p) => p.dirName);
        expect(
            clashes,
            `Répertoire(s) de plugin dont le nom figure dans _isCoreName() : ${clashes.join(", ")}. ` +
                `Ces plugins disparaîtraient du rapport de boot en sortant 0. Renommer le plugin, ` +
                `ou retirer le nom de _isCoreName() dans plugin-registry.ts.`
        ).toEqual([]);
    });

    it("PNC-02 — aucun nom réellement enregistré n'est traité comme du core", () => {
        const clashes = PLUGINS.flatMap((p) =>
            p.registered.filter((n) => CORE_NAMES.includes(n)).map((n) => `${p.dirName} → "${n}"`)
        );
        expect(
            clashes,
            `Plugin(s) s'enregistrant sous un nom que _isCoreName() masque : ${clashes.join(", ")}. ` +
                `C'est la chaîne que reportPlugins() compare à l'exécution — la collision est réelle, ` +
                `pas potentielle.`
        ).toEqual([]);
    });
});
