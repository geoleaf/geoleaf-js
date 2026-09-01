/**
 * @file doc-plugin-manifest.guard.test.js
 * @description Guard test — each `docs/specs/plugins/CDC_<id>.md` sheet's
 * `## Manifeste d'enregistrement` tells the truth about `src/entry.ts` and `package.json`.
 *
 * Why this guard exists (documentation rework, 27/07/2026)
 * --------------------------------------------------------------------
 * Twin of `doc-capability-config.guard.test.js`, for the other half of the
 * batch. The reasoning is the same — a sheet nothing reads falls back into
 * the only documentation regime that ever failed in this repo — but the
 * falsifiable matter is not the same.
 *
 * On a plugin, the most falsifiable and most costly fact to let drift is its
 * **registration manifest**: `requires` / `optional` determine load order,
 * `label` shows in toasts and reports, and the mounted namespace is the
 * integrator's only door. All four read mechanically from `entry.ts`, whose
 * shape is **pinned** by `PLUGIN_ARCHITECTURE_SPEC.md §4`.
 *
 * ## What this guard is NOT
 *
 * Not a duplicate of `scripts/verify-plugin-contract.cjs`. That one verifies
 * the plugin is **conformant** (PC-01…PC-13); this one verifies the **sheet**
 * says what the plugin does. A plugin can be perfectly conformant and
 * documented wrong.
 *
 * ## Why a TEST and not a `scripts/` script
 *
 * The architecturally least obvious choice of this file, so it is written
 * here. A cross-package gate would rather belong to `scripts/`, next to
 * `verify-plugin-contract.cjs`. But a new script there is **refused until it
 * is git-tracked AND enrolled in `SCRIPTS_ALLOWLIST`**
 * (`verify-repo-hygiene.cjs`, `verify-ci-scripts-tracked.cjs`) — i.e.
 * `ci:local` stays red until the commit. A test under `__tests__/guards/`
 * enters the already-wired suite, without that prerequisite. The assumed
 * trade-off: this file READS `packages/plugins/` sources from the `core` package.
 *
 * ⚠️ **It reads them as TEXT, never by import.** `entry.ts` has evaluation
 * side effects — it mounts a global namespace, registers with the registry,
 * wires document listeners. Importing it here would pollute the other tests'
 * environment.
 *
 * ## A guard never seen red guards nothing
 *
 * Two anti-empty-guard assertions (at least one sheet, at least one parsed
 * line), and **no silent fallback**: when an expected pattern is not found in
 * `entry.ts`, the guard throws with the path in clear rather than skipping
 * the check.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_OWN_NAMESPACE } from "../_helpers/no-own-namespace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
// The docs root comes from `scripts/lib/docs-paths.cjs`, never a literal: a
// hardcoded path does not break when the directory moves, it yields 0 sheets
// — hence 0 tests, hence GREEN. The module THROWS if its root is absent.
const docsPaths = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/docs-paths.cjs")
);
const FICHES_DIR = docsPaths.specs("plugins");
const PLUGINS_DIR = path.join(REPO_ROOT, "packages/plugins");

/** The manifest fields the sheet must carry, in its `Champ | Valeur` table. */
const REQUIRED_FIELDS = ["name", "label", "requires", "optional", "namespace", "paquet npm"];

/** The sheets present on disk — the list is not written, it is read. */
function readFiches() {
    if (!fs.existsSync(FICHES_DIR)) return [];
    return fs
        .readdirSync(FICHES_DIR)
        .filter((f) => /^CDC_.+\.md$/.test(f))
        .sort()
        .map((f) => ({
            file: f,
            id: f.replace(/^CDC_/, "").replace(/\.md$/, ""),
            relPath: docsPaths.rel(path.join(FICHES_DIR, f)),
            text: fs.readFileSync(path.join(FICHES_DIR, f), "utf8"),
        }));
}

/** Value of a key from the leading YAML frontmatter (deliberately minimal read). */
function frontmatterValue(text, key) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!fm) return null;
    const line = fm[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line
        ? line
              .slice(key.length + 1)
              .trim()
              .replace(/^["']|["']$/g, "")
        : null;
}

/** Splits a markdown table row into trimmed cells, backticks removed. */
function cells(row) {
    return row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim().replace(/^`|`$/g, "").trim());
}

/**
 * Extracts the GATED table of the `## Manifeste d'enregistrement` section:
 * the one whose header carries `Champ`. Choosing the header, and not "the
 * section's first table", is deliberate — a sheet may carry others under that title.
 *
 * @returns {{ rows: Record<string, {value: string, line: number}> }|null}
 */
function extractManifestTable(text) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Manifeste d'enregistrement\s*$/.test(l));
    if (start === -1) return null;
    let end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
    if (end === -1) end = lines.length;

    for (let i = start; i < end; i += 1) {
        if (!/^\s*\|/.test(lines[i])) continue;
        const header = cells(lines[i]).map((c) => c.toLowerCase());
        const iField = header.findIndex((c) => c.startsWith("champ"));
        const iValue = header.findIndex((c) => c.startsWith("valeur"));
        if (iField === -1 || iValue === -1) continue;

        const rows = {};
        // +2: the header row, then the `| --- |` separator row.
        for (let j = i + 2; j < end; j += 1) {
            if (!/^\s*\|/.test(lines[j])) break;
            const c = cells(lines[j]);
            const field = (c[iField] ?? "").toLowerCase();
            if (field) rows[field] = { value: c[iValue] ?? "", line: j + 1 };
        }
        return { rows };
    }
    return { rows: {} };
}

/**
 * Extracts the object argument of `plugins.register("<id>", { … })` by brace counting.
 *
 * Same stance as `verify-plugin-contract.cjs` (PC-03), and same known limit:
 * a string literal containing a brace would skew the count. No `entry.ts`
 * carries one, and a future `entry.ts` that did would fail this guard
 * VISIBLY rather than silently — the intended behaviour.
 */
function extractRegisterMeta(entrySource, relEntry) {
    // Both call forms coexist in the repo, and it had to be measured: `cog`,
    // `flatgeobuf` and `file-import` write `plugins.register(`, `geocoding`
    // writes `plugins?.register?.(`. Optional chaining must thus be tolerated
    // on EACH link — this guard's first version only tolerated it on the
    // first, and threw at collection.
    const m = /plugins\s*(?:\?\.|\.)\s*register\s*(?:\?\.)?\(\s*["']([^"']+)["']\s*,\s*\{/.exec(
        entrySource
    );
    if (!m) {
        throw new Error(
            `doc-plugin-manifest.guard: aucun appel \`plugins.register("<id>", { … })\` trouvé dans ${relEntry}. ` +
                `La forme est FIGÉE par PLUGIN_ARCHITECTURE_SPEC.md §4 — si elle a changé, re-pointer ce garde, ne pas l'assouplir.`
        );
    }
    const openIdx = entrySource.indexOf("{", m.index + m[0].length - 1);
    let depth = 0;
    let close = -1;
    for (let i = openIdx; i < entrySource.length; i += 1) {
        if (entrySource[i] === "{") depth += 1;
        else if (entrySource[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                close = i;
                break;
            }
        }
    }
    if (close === -1) {
        throw new Error(
            `doc-plugin-manifest.guard: argument de register() non refermé dans ${relEntry}`
        );
    }
    const body = entrySource.slice(openIdx + 1, close);

    /**
     * Reads a string value from the meta, honouring the OPENING quote.
     *
     * ⚠️ The naive form `["']([^"']*)["']` is wrong, and it was here —
     * measured while writing `print`'s sheet, whose label is
     * `"Print (carte à l'échelle → PDF / JPG)"`: the negative class stops at
     * the apostrophe of « l'échelle » and yields `Print (carte à l`.
     *
     * The failure mode is the worse of the two possible. The guard does not
     * throw — it **truncates**, then compares. A sheet copying the truncated
     * value would thus make it come out **GREEN on a wrong label**, and the
     * field this guard exists to protect would stop being guarded with
     * nothing turning red. Exactly the "a guard never seen red guards
     * nothing" class, seen here from the other end: a guard WRONGLY seen green.
     *
     * The form below captures the opening quote (`\1`), reads to the **same**
     * quote, and tolerates escapes — so `"… l'échelle …"` and `'… "cité" …'` both read.
     */
    const str = (key) => {
        const r = new RegExp(`${key}\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`).exec(body);
        return r ? r[2].replace(/\\(['"\\])/g, "$1") : null;
    };
    const arr = (key) => {
        const r = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(body);
        if (!r) return null;
        const inner = r[1].trim();
        return inner === "" ? [] : [...inner.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    };

    return { id: m[1], label: str("label"), requires: arr("requires"), optional: arr("optional") };
}

/** Extracts the mounted namespace — `…\.<Name> = buildPublicApi()`. */
function extractMountedNamespace(entrySource, relEntry) {
    const m = /\.([A-Z][A-Za-z0-9]*)\s*=\s*buildPublicApi\s*\(/.exec(entrySource);
    if (!m) {
        throw new Error(
            `doc-plugin-manifest.guard: aucun montage \`.<Namespace> = buildPublicApi()\` trouvé dans ${relEntry}. ` +
                `DEUX cas, et ils ne se traitent PAS pareil : soit le plugin monte sa façade sous une ` +
                `forme que ce garde ne connaît pas (l'apprendre ici — \`plugin-namespace-declared.guard.test.js\` ` +
                `en connaît deux), soit il n'en monte AUCUNE, et il faut une entrée motivée dans ` +
                `\`__tests__/_helpers/no-own-namespace.js\` avec la surface du core qu'il pilote à la place.`
        );
    }
    return `GeoLeaf.${m[1]}`;
}

const FICHES = readFiches();

describe("test-garde — le manifeste des fiches specs/plugins/ dit vrai", () => {
    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("trouve au moins une fiche (sinon ce garde ne garde rien)", () => {
        expect(FICHES.length, `aucun CDC_*.md dans ${FICHES_DIR}`).toBeGreaterThan(0);
    });

    it("garde au moins une fiche NON exemptée (sinon la vérification de namespace ne s'exerce plus)", () => {
        expect(
            FICHES.filter((f) => !NO_OWN_NAMESPACE[f.id]).length,
            "toutes les fiches sont exemptées de namespace : la vérification principale ne s'exerce sur rien"
        ).toBeGreaterThan(0);
    });

    it("parse au moins une ligne de manifeste, toutes fiches confondues", () => {
        const total = FICHES.reduce(
            (n, f) => n + Object.keys(extractManifestTable(f.text)?.rows ?? {}).length,
            0
        );
        expect(
            total,
            "aucune ligne parsée : le titre `## Manifeste d'enregistrement` ou l'en-tête `Champ` a bougé"
        ).toBeGreaterThan(0);
    });

    // ── Closing the "renamed plugin" class ──────────────────────────────────────────────────
    // `requires` / `optional` name PLUGINS, resolved by
    // `PluginRegistry.isLoaded()`. Four manifests cited `storage` months
    // after its rename to `offline-ui`, and `print` moreover named `legend`,
    // an IN-CORE capability no `isLoaded()` will ever see. The runtime effect
    // is nil — `optional` is stored and never read —, which is exactly why
    // nothing turned red: the field ONLY documents, and it was the only one
    // with no reader to contradict it.
    //
    // This test reads the ids REALLY registered (`plugins.register`'s 1st
    // argument) and refuses any citation not among them. The list is not
    // written, it is derived — a 14th plugin enters without a thought.
    it("tout id cité dans `requires`/`optional` désigne un plugin réellement enregistré", () => {
        const dirs = fs
            .readdirSync(PLUGINS_DIR, { withFileTypes: true })
            .filter(
                (e) =>
                    e.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, e.name, "src/entry.ts"))
            )
            .map((e) => e.name);
        const registered = new Set();
        const declared = [];
        for (const dir of dirs) {
            const rel = `packages/plugins/${dir}/src/entry.ts`;
            const src = fs.readFileSync(path.join(PLUGINS_DIR, dir, "src/entry.ts"), "utf8");
            const meta = extractRegisterMeta(src, rel);
            registered.add(meta.id);
            for (const key of ["requires", "optional"]) {
                for (const id of meta[key] ?? []) declared.push({ dir, key, id, rel });
            }
        }
        expect(registered.size, "aucun plugin enregistré lu").toBeGreaterThan(0);
        // Anti-empty-guard: without at least one citation, the loop compares nothing.
        expect(declared.length, "aucune citation `requires`/`optional` lue").toBeGreaterThan(0);

        const unknown = declared
            .filter((d) => !registered.has(d.id))
            .map(
                (d) =>
                    `${d.rel} — \`${d.key}\` cite \`${d.id}\`, qui n'est l'identifiant d'aucun plugin enregistré ` +
                    `(connus : ${[...registered].sort().join(", ")}). Une capacité in-core n'est pas adressable ici.`
            );
        expect(unknown, unknown.join("\n")).toEqual([]);
    });

    FICHES.forEach((fiche) => {
        describe(fiche.relPath, () => {
            const pluginDir = path.join(PLUGINS_DIR, fiche.id);
            const relEntry = `packages/plugins/${fiche.id}/src/entry.ts`;

            it("son `plugin_id` correspond au nom de fichier", () => {
                expect(frontmatterValue(fiche.text, "plugin_id")).toBe(fiche.id);
            });

            it("décrit un plugin qui existe (pas une fiche fantôme)", () => {
                expect(fs.existsSync(pluginDir), `packages/plugins/${fiche.id}/ absent`).toBe(true);
            });

            if (!fs.existsSync(pluginDir)) return;

            const entrySource = fs.readFileSync(path.join(pluginDir, "src/entry.ts"), "utf8");
            const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
            const meta = extractRegisterMeta(entrySource, relEntry);
            const table = extractManifestTable(fiche.text);
            // Exemption SHARED with `plugin-namespace-declared.guard.test.js`
            // — one source, two readers. See the helper for the motive and
            // what makes the entry falsifiable.
            const exempt = NO_OWN_NAMESPACE[fiche.id];
            // ⚠️ `extractMountedNamespace` THROWS when it finds nothing.
            // Calling it HERE, in the `describe` body, would make it a
            // COLLECTION error: the whole guard file would fall at the first
            // sheet of a facade-less plugin. It is thus called in the
            // non-exempt branch's `it`, and nowhere else.

            it("porte une table `Champ | Valeur` sous `## Manifeste d'enregistrement`", () => {
                expect(table, "section `## Manifeste d'enregistrement` absente").not.toBeNull();
                const missing = REQUIRED_FIELDS.filter((f) => !(f in table.rows));
                expect(
                    missing,
                    `champ(s) manquant(s) dans la table : ${missing.join(", ")}`
                ).toEqual([]);
            });

            it("documente le `name` réellement enregistré", () => {
                const row = table.rows.name;
                expect(row, "ligne `name` absente").toBeDefined();
                expect(
                    row.value,
                    `${fiche.relPath}:${row?.line} — documenté \`${row?.value}\`, entry.ts enregistre \`${meta.id}\``
                ).toBe(meta.id);
            });

            it("documente le `label` réellement enregistré", () => {
                const row = table.rows.label;
                expect(
                    meta.label,
                    `aucun \`label\` dans le register() de ${relEntry}`
                ).not.toBeNull();
                expect(
                    row.value,
                    `${fiche.relPath}:${row.line} — documenté \`${row.value}\`, entry.ts déclare \`${meta.label}\``
                ).toBe(meta.label);
            });

            it("documente `requires` et `optional` à l'identique", () => {
                for (const key of ["requires", "optional"]) {
                    const row = table.rows[key];
                    const actual = meta[key] ?? [];
                    // The sheet writes a JSON literal: `[]` or `["core"]`.
                    let documented;
                    try {
                        documented = JSON.parse(row.value.replace(/'/g, '"'));
                    } catch {
                        throw new Error(
                            `${fiche.relPath}:${row.line} — \`${key}\` illisible (${row.value}) : écrire un littéral JSON, ex. \`[]\` ou \`["core"]\``
                        );
                    }
                    expect(
                        documented,
                        `${fiche.relPath}:${row.line} — \`${key}\` documenté ${JSON.stringify(documented)}, entry.ts déclare ${JSON.stringify(actual)}`
                    ).toEqual(actual);
                }
            });

            if (exempt) {
                it("n'a effectivement AUCUNE façade montée (l'exemption est justifiée)", () => {
                    // Exact mirror of NO_CAPABILITY_CONFIG's
                    // `configSchema → toBeUndefined()` assertion: the
                    // exemption must turn red the day it stops being true,
                    // otherwise it outlives its motive.
                    expect(
                        /(?:\.|\[\s*["'])[A-Z][A-Za-z0-9]*(?:["']\s*\])?\s*=\s*buildPublicApi\s*\(/.test(
                            entrySource
                        ),
                        `${fiche.id} est exempté dans NO_OWN_NAMESPACE alors que ${relEntry} MONTE une façade — retirer l'entrée`
                    ).toBe(false);
                    expect(
                        fs.existsSync(path.join(pluginDir, "src/public-api.ts")),
                        `${fiche.id} est exempté alors qu'il porte un src/public-api.ts — retirer l'entrée`
                    ).toBe(false);
                });

                it("écrit `—` dans sa ligne `namespace`, et nomme la surface qu'il pilote", () => {
                    const row = table.rows.namespace;
                    expect(
                        row.value,
                        `${fiche.relPath}:${row.line} — documenté \`${row.value}\`. Ce plugin ne monte ` +
                            `AUCUN namespace : la cellule vaut \`—\`. Écrire \`${exempt.drives}\` ` +
                            `reviendrait à s'attribuer une façade du CORE.`
                    ).toBe("—");
                    expect(
                        fiche.text.includes(exempt.drives),
                        `la fiche ne cite pas \`${exempt.drives}\` — un lecteur ne saurait pas par où le plugin parle au core`
                    ).toBe(true);
                    expect(
                        fiche.text.includes(exempt.owner),
                        `la fiche ne cite pas \`${exempt.owner}\` — la surface est nommée, pas son propriétaire`
                    ).toBe(true);
                });
            } else {
                it("documente le namespace réellement monté", () => {
                    const namespace = extractMountedNamespace(entrySource, relEntry);
                    const row = table.rows.namespace;
                    expect(
                        row.value,
                        `${fiche.relPath}:${row.line} — documenté \`${row.value}\`, entry.ts monte \`${namespace}\``
                    ).toBe(namespace);
                });
            }

            it("documente le nom de paquet npm réel", () => {
                const row = table.rows["paquet npm"];
                expect(
                    row.value,
                    `${fiche.relPath}:${row.line} — documenté \`${row.value}\`, package.json déclare \`${pkg.name}\``
                ).toBe(pkg.name);
            });
        });
    });
});
