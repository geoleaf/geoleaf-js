/**
 * @file doc-capability-config.guard.test.js
 * @description Guard test — each `docs/specs/capacites/<id>.md` sheet's
 * `## Configuration` table tells the truth about the code it describes.
 *
 * Why this guard exists (documentation rework, 27/07/2026)
 * --------------------------------------------------------------------
 * The documentation rework measured one thing: across the whole working
 * corpus, the only documentation regimes that produced still-true documents
 * are "generated + gated", "frozen under RFC" and "read by a program". The
 * fourth — end-of-session discipline — is the only one that failed, and it
 * covered almost the whole corpus. The 21 capability sheets + 13 plugin
 * sheets to write would fall into that fourth regime if nothing read them.
 *
 * The MOST falsifiable content of a capability sheet is its configuration
 * table: "parameter | type | default | where it is read". And it is the only
 * one whose source is machine-readable — the declaration's `configSchema`,
 * and the value the reader materialises. This guard thus closes the chain:
 *
 *     configSchema (announced)  ←→  DEFAULTS via the reader (applied)
 *         ↑ guarded by `__tests__/capabilities/config-schema-defaults.test.js`
 *         ↓ guarded HERE
 *     the sheet's `## Configuration` table (documented)
 *
 * What it cannot judge: the sheet's sentences' TRUTH. "Caches for 5 minutes"
 * on a function caching 10 stays indistinguishable — `CLAUDE.md`'s ⛔ rule,
 * and it stays with the human. This guard only claims the mechanisable part,
 * and covers it BOTH ways (a documented parameter that does not exist, as
 * well as an undocumented schema key).
 *
 * ## The subject list is not written, it is READ
 *
 * Same stance as `scaffold-taxonomy.test.js`: the subjects are the sheets on
 * disk. A 5th shipped sheet thus enters the guard without being enrolled —
 * which is what makes the remaining sheets BE BORN gated instead of caught up.
 *
 * ## A second document, the same oracle (04/10/2026)
 *
 * The configuration inventory (`docs/reference/inventaire_config_parametres.md`) carries a
 * row per parameter, with a `Défaut` column — and the gate that reads that column
 * (`check-doc-config-defaults.cjs`) confronts it to the integrator guide: a CONCORDANCE, which
 * two documents wrong together pass. Measured when it landed: on the defaults settled by
 * reading the code, the inventory was the wrong one. For the `modules.<capability>` rows an
 * oracle exists — the same `configSchema` the sheets are held to — so the second `describe`
 * below holds the inventory to it, at every depth the schema describes: each schema leaf
 * has a row — its own, rows under it, or the row of a container the inventory keeps opaque
 * (`modules.filter.fields`) —, no row falls under a key the schema ignores, and a default
 * written on a row is the announced one. The cell grammar is the gate's own, through
 * `scripts/lib/config-defaults-read.cjs`: two instruments reading one column must not read
 * it differently.
 *
 * What it does not see: a key the code reads and the `configSchema` does not declare — the
 * schema is the oracle here, not the code.
 *
 * ## A third oracle: the plugins' tables of defaults (05/10/2026)
 *
 * A plugin has no `configSchema`. What it has is ONE table — a root-level constant of its
 * `src/config.ts`, merged under the profile's `modules.<namespace>` block — and that table
 * is the only statement of a default a program can read. The third `describe` reads it with
 * `scripts/lib/ts-decl-read.cjs` and holds the inventory to it: each default of the table
 * has its row, the row states the table's value, and a default the inventory states for a
 * key the table does not carry is red: the table is the one place a default is written. The
 * subjects are derived, not listed: a plugin is one as soon as its `src/config.ts`
 * reads a `modules.*` block, and the namespace is taken from that read.
 *
 * Seen red on real rows the day it landed: a travel-mode key the routing plugin defaults
 * and the inventory did not list; a row whose unescaped `|` in the type cell shifted every
 * cell after it, so that its default read as prose; and the geocoding plugin, whose table
 * carried one key while five of its defaults were `??` fallbacks at the consumer — two of
 * them written at two sites. Those, and three of the table plugin, were first anchored by
 * name where the code applied them, then moved into their tables; the anchors left with them.
 *
 * What it does not see: a default a plugin applies where it consumes the value, as long as
 * no document states it — a `??` literal next to a read is invisible until someone writes
 * the figure down. And a row for a key the plugin never reads, as long as that row states
 * no default — the table knows the defaults, not the keys. And a plugin that reads its
 * block somewhere else than `src/config.ts` is caught only by the namespace case below,
 * which refuses an inventory namespace nobody here owns.
 *
 * ## And the document an integrator actually opens: the plugin's README
 *
 * A README ships in the tarball and is the page npm renders. Its `Default` column was read
 * by nothing: `check-plugin-readme-config.cjs` checks that each key is CITED, never the
 * value the README lends it. The same subjects therefore hold their README to the same
 * table, with the same three rules — and one more, because a README may document a block
 * on one row: a row whose key CONTAINS defaults of the table (`margins`, for
 * `margins.top` … `margins.left`) states the object they make. Every table of a subject's
 * README that carries a `Default` column is judged, keys read relative to the plugin's
 * block; the first backticked token of a row's first cell is its key.
 *
 * Seen red on real rows: four defaults written as prose or in a notation no program reads,
 * two defaults of the editor with no row at all, an export-format list the table plugin
 * applies and the inventory did not know, and a placeholder announced as one French
 * sentence when the code applies a label translated in every language it ships.
 *
 * The plugin's SHEET (`docs/specs/plugins/CDC_<plugin>.md`) carries the same table a fourth
 * time, and is held to the same rules: no value in it was wrong the day it joined, nine
 * were written in a notation the grammar does not read.
 *
 * ## And the core's own guides, where a table says which block it describes
 *
 * `packages/core/docs/` documents the same blocks a third time. A table there is judged
 * when a marker above it names its block — the marker the integrator guide's gate already
 * reads, so that one notation serves both:
 *
 *     <!-- geoleaf:docs:key-prefix modules.table -->
 *
 * A plugin's block is held to the plugin's table, a capability's to its `configSchema`.
 * The bound tables are LISTED below and the list is compared to what is found: a marker
 * that disappears would otherwise take its table out of the guard without a word. Every
 * other table of those guides is unjudged — no oracle exists for `ui.*`, `map.*` or a
 * layer's own keys, and this guard does not pretend otherwise.
 *
 * Seen red the day it landed: the minimum and maximum heights of the table panel, announced
 * with two values the plugin has never applied.
 *
 * ## A guard never seen red guards nothing
 *
 * Two anti-empty-guard assertions below (at least one sheet, at least one
 * parsed line), because this repo has already measured the case three times:
 * `verify-core-standalone`'s regex would have come out green guarding
 * nothing after a directory rename, and the boot probe stayed green with a
 * removed marker.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
// The docs root comes from `scripts/lib/docs-paths.cjs`, never a literal: a
// hardcoded path does not break when the directory moves, it yields 0 sheets
// — hence 0 tests, hence GREEN. The module THROWS if its root is absent.
const docsPaths = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/docs-paths.cjs")
);
const FICHES_DIR = docsPaths.specs("capacites");
// The inventory and the reading of its `Défaut` column: the path from the same module as
// the sheets', the grammar from the library the gate itself reads with.
const INVENTORY_PATH = docsPaths.reference("inventaire_config_parametres.md");
const configDefaults = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/config-defaults-read.cjs")
);
const CAPABILITIES_DIR = path.resolve(__dirname, "../../src/capabilities");
// The plugins come from the package registry, which THROWS when a package is not where it
// says: a literal path would stop matching on a move and leave the guard green on nothing.
const packagesRegistry = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/packages.cjs")
);
const tsDecl = createRequire(import.meta.url)(path.join(REPO_ROOT, "scripts/lib/ts-decl-read.cjs"));

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

// Every `config.ts` reader goes through this one seam (`_Config.get("modules.<id>", {})`), so
// mocking it once simulates "the profile carries no block for any capability" — which is
// exactly the state in which the DEFAULTS a fiche documents are the ones observed.
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

// Static globs: the modules are enumerated at transform time, so a capability directory that
// does not exist cannot be silently skipped by a failed dynamic import.
const DECLARATION_MODULES = import.meta.glob("../../src/capabilities/*/*-capability.ts");
const CONFIG_MODULES = import.meta.glob("../../src/capabilities/*/config.ts");

/**
 * Capabilities whose sheet DOES NOT carry a parameter table, with each one's
 * motive and the real configuration source the sheet must name.
 *
 * Unlike the rest of this guard, this list does not derive: it depends on
 * WHERE the configuration comes from, which the code declares nowhere. It is
 * therefore explicit — and that is the goal: a capability without a
 * `configSchema` will turn this guard red until someone has written here why
 * it may do without one, and where its configuration really lives.
 *
 * Same pattern as `NO_CONFIG_ACCESSOR` in `capabilities/scaffold-taxonomy.test.js`.
 */
const NO_CAPABILITY_CONFIG = {
    "vector-tiles": {
        motif: "config PAR COUCHE (`data.vectorTiles`), pas app-globale : aucun bloc `modules.*`, donc ni `gate` ni `configSchema`",
        /** String the sheet MUST contain — its real source of truth. */
        source: "layer-config.schema.json",
    },
};

/** Sentinel: the sheet explicitly declares "no default" (`—` cell). */
const NO_DEFAULT = Symbol("no-default");

/**
 * ANNOUNCED ≠ APPLIED divergences already known to the repo, **read** from
 * the guard that owns them —
 * `capabilities/config-schema-defaults.test.js` → `KNOWN_DEFAULT_DRIFT`.
 *
 * Why read its source rather than copy the list: the day that guard settles
 * an entry, this one must **immediately** require the key in the sheet. Two
 * copies would drift, and the sheet would keep documenting a repaired
 * divergence — exactly the regime the documentation rework repairs.
 *
 * These entries do NOT excuse the sheet from documenting the key: it must
 * appear with the default the schema ANNOUNCES. Only the comparison with the
 * APPLIED default is suspended, since the accessor does not materialise it yet.
 */
const KNOWN_DEFAULT_DRIFT = (() => {
    const sibling = path.join(__dirname, "../capabilities/config-schema-defaults.test.js");
    const src = fs.readFileSync(sibling, "utf8");
    const m = /KNOWN_DEFAULT_DRIFT\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
    // Never a silent fallback: an accidentally empty set would make this
    // guard stricter unknowingly, and an "everything allowed" set would blind it.
    if (!m) {
        throw new Error(
            "doc-capability-config.guard: KNOWN_DEFAULT_DRIFT introuvable dans " +
                "__tests__/capabilities/config-schema-defaults.test.js — la source de vérité " +
                "a été renommée ou reformatée. Ne pas recopier la liste : re-pointer la lecture."
        );
    }
    return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
})();

/** `theme-toggle` → `THEME_TOGGLE_CAPABILITY`. */
function declarationExportName(id) {
    return `${id.toUpperCase().replace(/-/g, "_")}_CAPABILITY`;
}

/** Loads the module whose path contains `/<id>/`, or `null`. */
async function loadFor(modules, id) {
    const key = Object.keys(modules).find((p) => p.includes(`/${id}/`));
    return key ? modules[key]() : null;
}

/** The sheets present on disk — the list is not written, it is read. */
function readFiches() {
    if (!fs.existsSync(FICHES_DIR)) return [];
    return fs
        .readdirSync(FICHES_DIR)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => ({
            file: f,
            id: f.replace(/\.md$/, ""),
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

/** Splits a markdown table row into already-trimmed cells. */
function cells(row) {
    return row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim());
}

/** Removes a cell's backticks (`` `false` `` → `false`). */
function unbacktick(cell) {
    return cell.replace(/^`|`$/g, "").trim();
}

/**
 * Extracts the GATED table of the `## Configuration` section: the one whose
 * header carries `Paramètre`. Choosing the header, and not "the section's
 * first table", is deliberate — a sheet may carry other tables under that
 * title (`theme-toggle`'s two gate tiers, `profile-switcher`'s harvested
 * fields, `vector-tiles`'s layer schema), and aiming at the first would have
 * caught them.
 *
 * @returns {{ rows: Array<{param: string, type: string, default: unknown|symbol, line: number}> }|null}
 */
function extractConfigTable(text) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Configuration\s*$/.test(l));
    if (start === -1) return null;
    let end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
    if (end === -1) end = lines.length;

    for (let i = start; i < end; i += 1) {
        const line = lines[i];
        if (!/^\s*\|/.test(line)) continue;
        const header = cells(line).map((c) => unbacktick(c).toLowerCase());
        if (!header.some((c) => c.startsWith("paramètre"))) continue;

        const iParam = header.findIndex((c) => c.startsWith("paramètre"));
        const iType = header.findIndex((c) => c === "type");
        const iDefault = header.findIndex((c) => c.startsWith("défaut"));
        if (iType === -1 || iDefault === -1) return { rows: [], malformedHeader: true };

        const rows = [];
        // +2: the header row, then the `| --- |` separator row.
        for (let j = i + 2; j < end; j += 1) {
            if (!/^\s*\|/.test(lines[j])) break;
            const c = cells(lines[j]);
            const raw = c[iDefault] ?? "";
            rows.push({
                param: unbacktick(c[iParam] ?? ""),
                type: unbacktick(c[iType] ?? ""),
                default: raw === "—" ? NO_DEFAULT : parseDefault(raw),
                rawDefault: raw,
                line: j + 1,
            });
        }
        return { rows };
    }
    return { rows: [] };
}

/** A default cell is a JSON literal between backticks — otherwise `undefined`. */
function parseDefault(raw) {
    try {
        return JSON.parse(unbacktick(raw));
    } catch {
        return undefined;
    }
}

/** Top-level `configSchema` fields carrying a `default`, as `{ key: default }`. */
function advertisedDefaults(configSchema) {
    const out = {};
    for (const [key, field] of Object.entries(configSchema ?? {})) {
        if (field && Object.hasOwn(field, "default")) out[key] = field.default;
    }
    return out;
}

const FICHES = readFiches();

describe("test-garde — la table `## Configuration` des fiches specs/capacites/ dit vrai", () => {
    beforeEach(() => {
        configGet.mockReset();
        // "No `modules.<id>` block" — what `Config.get(path, {})` returns for
        // a profile not declaring the capability. The state in which the
        // documented defaults are the ones observed.
        configGet.mockReturnValue({});
    });

    // ── Anti-empty-guard ────────────────────────────────────────────────────────
    // Without these two assertions, the guard would come out GREEN the day
    // the directory is renamed, the `## Configuration` title changes, or the
    // `Paramètre` header moves.
    it("trouve au moins une fiche (sinon ce garde ne garde rien)", () => {
        expect(FICHES.length, `aucune fiche .md dans ${FICHES_DIR}`).toBeGreaterThan(0);
    });

    it("parse au moins une ligne de paramètre, toutes fiches confondues", () => {
        const total = FICHES.filter((f) => !NO_CAPABILITY_CONFIG[f.id]).reduce(
            (n, f) => n + (extractConfigTable(f.text)?.rows.length ?? 0),
            0
        );
        expect(
            total,
            "aucune ligne parsée : le titre `## Configuration` ou l'en-tête `Paramètre` a bougé"
        ).toBeGreaterThan(0);
    });

    FICHES.forEach((fiche) => {
        describe(fiche.relPath, () => {
            it("son `capability_id` correspond au nom de fichier", () => {
                expect(frontmatterValue(fiche.text, "capability_id")).toBe(fiche.id);
            });

            it("décrit une capacité qui existe (pas une fiche fantôme)", () => {
                expect(
                    fs.existsSync(path.join(CAPABILITIES_DIR, fiche.id)),
                    `capabilities/${fiche.id}/ absent`
                ).toBe(true);
            });

            const exempt = NO_CAPABILITY_CONFIG[fiche.id];

            if (exempt) {
                it("n'a effectivement PAS de `configSchema` (l'exemption est justifiée)", async () => {
                    const mod = await loadFor(DECLARATION_MODULES, fiche.id);
                    const declaration = mod?.[declarationExportName(fiche.id)];
                    expect(declaration, `déclaration introuvable pour ${fiche.id}`).toBeDefined();
                    expect(
                        declaration.configSchema,
                        `${fiche.id} est exemptée alors qu'elle DÉCLARE un configSchema — retirer l'entrée de NO_CAPABILITY_CONFIG`
                    ).toBeUndefined();
                });

                it("ne documente pas de table de paramètres qui n'existent pas", () => {
                    const table = extractConfigTable(fiche.text);
                    expect(
                        table?.rows ?? [],
                        `la fiche porte une table \`Paramètre\` alors que la capacité n'a aucun bloc de configuration (${exempt.motif})`
                    ).toHaveLength(0);
                });

                it("nomme sa vraie source de configuration", () => {
                    expect(
                        fiche.text.includes(exempt.source),
                        `la fiche ne cite pas \`${exempt.source}\` — un lecteur ne saurait pas où la configuration vit`
                    ).toBe(true);
                });
                return;
            }

            it("porte une table `Paramètre | Type | Défaut | …` sous `## Configuration`", () => {
                const table = extractConfigTable(fiche.text);
                expect(table, "section `## Configuration` absente").not.toBeNull();
                expect(table.malformedHeader, "en-tête sans colonne Type ou Défaut").toBeFalsy();
                expect(table.rows.length, "table de paramètres vide").toBeGreaterThan(0);
            });

            it("documente exactement les clés du `configSchema`, dans les deux sens", async () => {
                const mod = await loadFor(DECLARATION_MODULES, fiche.id);
                const declaration = mod?.[declarationExportName(fiche.id)];
                expect(declaration, `déclaration introuvable pour ${fiche.id}`).toBeDefined();
                expect(
                    declaration.configSchema,
                    `${fiche.id} n'a pas de configSchema : ajouter une entrée motivée à NO_CAPABILITY_CONFIG`
                ).toBeDefined();

                const documented = extractConfigTable(fiche.text).rows.map((r) => r.param);
                const advertised = Object.keys(declaration.configSchema);

                expect(
                    documented.filter((p) => !advertised.includes(p)),
                    "paramètre(s) documenté(s) absent(s) du configSchema — API fantôme dans la doc"
                ).toEqual([]);
                expect(
                    advertised.filter((k) => !documented.includes(k)),
                    "clé(s) du configSchema non documentée(s) — fiche incomplète"
                ).toEqual([]);
            });

            it("documente le bon `type` pour chaque paramètre", async () => {
                const mod = await loadFor(DECLARATION_MODULES, fiche.id);
                const { configSchema } = mod[declarationExportName(fiche.id)];
                const wrong = extractConfigTable(fiche.text)
                    .rows.filter((r) => configSchema[r.param])
                    .filter((r) => r.type !== configSchema[r.param].type)
                    .map(
                        (r) =>
                            `${fiche.relPath}:${r.line} — \`${r.param}\` documenté \`${r.type}\`, schéma \`${configSchema[r.param].type}\``
                    );
                expect(wrong, wrong.join("\n")).toEqual([]);
            });

            it("documente le défaut ANNONCÉ par le configSchema", async () => {
                const mod = await loadFor(DECLARATION_MODULES, fiche.id);
                const { configSchema } = mod[declarationExportName(fiche.id)];
                const advertised = advertisedDefaults(configSchema);
                const wrong = [];

                for (const row of extractConfigTable(fiche.text).rows) {
                    const hasAdvertised = Object.hasOwn(advertised, row.param);
                    if (row.default === NO_DEFAULT) {
                        if (hasAdvertised) {
                            wrong.push(
                                `${fiche.relPath}:${row.line} — \`${row.param}\` documenté sans défaut, le schéma en annonce ${JSON.stringify(advertised[row.param])}`
                            );
                        }
                        continue;
                    }
                    if (!hasAdvertised) {
                        wrong.push(
                            `${fiche.relPath}:${row.line} — \`${row.param}\` documenté \`${row.rawDefault}\`, le schéma n'annonce aucun défaut (écrire \`—\`)`
                        );
                        continue;
                    }
                    if (row.default === undefined) {
                        wrong.push(
                            `${fiche.relPath}:${row.line} — défaut de \`${row.param}\` illisible (${row.rawDefault}) : écrire un littéral JSON entre accents graves, ou \`—\``
                        );
                        continue;
                    }
                    if (JSON.stringify(row.default) !== JSON.stringify(advertised[row.param])) {
                        wrong.push(
                            `${fiche.relPath}:${row.line} — \`${row.param}\` documenté ${JSON.stringify(row.default)}, schéma ${JSON.stringify(advertised[row.param])}`
                        );
                    }
                }
                expect(wrong, wrong.join("\n")).toEqual([]);
            });

            it("documente le défaut APPLIQUÉ par le lecteur de configuration", async () => {
                const mod = await loadFor(CONFIG_MODULES, fiche.id);
                // A capability may have no `config.ts` while declaring a
                // configSchema (installer-pushed config: offline, pwa…). Each
                // one's motive lives in `scaffold-taxonomy.test.js`
                // (`NO_CONFIG_ACCESSOR`); it is not duplicated here.
                if (!mod) return;
                const read = Object.entries(mod).find(
                    ([name, v]) => /^get[A-Za-z]+Config$/.test(name) && typeof v === "function"
                )?.[1];
                expect(
                    read,
                    `aucun lecteur \`get…Config\` exporté par ${fiche.id}/config.ts`
                ).toBeTypeOf("function");

                const applied = read();
                const wrong = [];
                for (const row of extractConfigTable(fiche.text).rows) {
                    // Divergence known and quarantined by the code↔code
                    // guard: the sheet must document the ANNOUNCED default
                    // (checked above), but the accessor does not materialise
                    // it yet. When the entry leaves quarantine, this line
                    // becomes checked again with no change here.
                    if (KNOWN_DEFAULT_DRIFT.has(`${fiche.id}.${row.param}`)) continue;
                    const hasApplied = Object.hasOwn(applied, row.param);
                    if (row.default === NO_DEFAULT) {
                        if (hasApplied) {
                            wrong.push(
                                `${fiche.relPath}:${row.line} — \`${row.param}\` documenté sans défaut, le lecteur matérialise ${JSON.stringify(applied[row.param])}`
                            );
                        }
                        continue;
                    }
                    if (!hasApplied) {
                        wrong.push(
                            `${fiche.relPath}:${row.line} — \`${row.param}\` documenté ${JSON.stringify(row.default)}, le lecteur ne le matérialise pas`
                        );
                        continue;
                    }
                    if (JSON.stringify(row.default) !== JSON.stringify(applied[row.param])) {
                        wrong.push(
                            `${fiche.relPath}:${row.line} — \`${row.param}\` documenté ${JSON.stringify(row.default)}, appliqué ${JSON.stringify(applied[row.param])}`
                        );
                    }
                }
                expect(wrong, wrong.join("\n")).toEqual([]);
            });
        });
    });
});

// ── The inventory, held to the same oracle ───────────────────────────────────────────────

/** The capabilities, read from the declaration files on disk: `<id>/<id>-capability.ts`. */
const CAPABILITY_IDS = Object.keys(DECLARATION_MODULES)
    .map((p) => /\/capabilities\/([^/]+)\//.exec(p)?.[1])
    .filter(Boolean)
    .sort();

/**
 * The inventory's rows under `modules.<id>.`, as `{ key, entries }` with `key` relative to
 * the block. `first` is the first segment of the key — the `configSchema` key it falls under.
 */
function inventoryRowsOf(inventory, id) {
    const prefix = `modules.${id}.`;
    return [...inventory.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, entries]) => {
            const rel = key.slice(prefix.length);
            return { key: rel, first: rel.split(/[.[]/)[0], entries };
        });
}

/**
 * Every leaf a `configSchema` describes, as `{ key, hasDefault, default }` with `key` dotted
 * from the block's root — `cache.maxCacheBytes`, `fields[].kind`. A field carrying
 * `properties` (or an array whose `items` do) is a container: it is descended, not listed.
 */
function schemaLeaves(schema, prefix = "", acc = []) {
    for (const [key, field] of Object.entries(schema ?? {})) {
        if (!field || typeof field !== "object") continue;
        if (field.properties) schemaLeaves(field.properties, `${prefix}${key}.`, acc);
        else if (field.items?.properties) {
            schemaLeaves(field.items.properties, `${prefix}${key}[].`, acc);
        } else {
            acc.push({
                key: prefix + key,
                hasDefault: Object.hasOwn(field, "default"),
                default: field.default,
            });
        }
    }
    return acc;
}

/** Whether `row` is the leaf's own row, a row under it, or the row of one of its containers. */
function covers(row, leaf) {
    return (
        row === leaf ||
        row.startsWith(`${leaf}.`) ||
        row.startsWith(`${leaf}[`) ||
        leaf.startsWith(`${row}.`) ||
        leaf.startsWith(`${row}[`)
    );
}

describe("test-garde — l'inventaire de configuration dit vrai sur les capacités in-core", () => {
    const inventory = configDefaults.readInventory(INVENTORY_PATH);

    beforeEach(() => {
        configGet.mockReset();
        configGet.mockReturnValue({});
    });

    // ── Anti-empty-guard ────────────────────────────────────────────────────────
    // A renamed capability directory, an inventory whose key column changed its header or a
    // `modules.` prefix that stopped matching would each leave every case below vacuously
    // green. The floors are far under the measured counts and far above zero.
    it("lit des capacités, des lignes et des défauts (sinon ce garde ne garde rien)", async () => {
        expect(CAPABILITY_IDS.length, "aucune déclaration de capacité trouvée").toBeGreaterThan(10);
        let rows = 0;
        let compared = 0;
        for (const id of CAPABILITY_IDS) {
            const mod = await loadFor(DECLARATION_MODULES, id);
            const schema = mod?.[declarationExportName(id)]?.configSchema;
            if (!schema) continue;
            const found = inventoryRowsOf(inventory, id);
            rows += found.length;
            const withDefault = new Set(
                schemaLeaves(schema)
                    .filter((l) => l.hasDefault)
                    .map((l) => l.key)
            );
            compared += found.filter((r) => withDefault.has(r.key)).length;
        }
        expect(rows, "aucune ligne `modules.<capacité>.*` lue dans l'inventaire").toBeGreaterThan(
            40
        );
        expect(compared, "aucun défaut confronté au configSchema").toBeGreaterThan(40);
    });

    CAPABILITY_IDS.forEach((id) => {
        describe(`modules.${id}`, () => {
            it("chaque feuille du `configSchema` a sa ligne, ou celle de son conteneur", async () => {
                const mod = await loadFor(DECLARATION_MODULES, id);
                const schema = mod?.[declarationExportName(id)]?.configSchema;
                if (!schema) return; // per-layer configuration: no `modules.<id>` block at all
                const rows = inventoryRowsOf(inventory, id).map((r) => r.key);
                expect(
                    schemaLeaves(schema)
                        .map((leaf) => leaf.key)
                        .filter((leaf) => !rows.some((row) => covers(row, leaf))),
                    "feuille(s) du configSchema sans aucune ligne d'inventaire"
                ).toEqual([]);
            });

            it("aucune ligne ne nomme une clé que le `configSchema` ignore", async () => {
                const mod = await loadFor(DECLARATION_MODULES, id);
                const schema = mod?.[declarationExportName(id)]?.configSchema;
                const rows = inventoryRowsOf(inventory, id);
                if (!schema) {
                    expect(
                        rows.map((r) => r.key),
                        "lignes d'inventaire pour une capacité sans bloc de configuration"
                    ).toEqual([]);
                    return;
                }
                expect(
                    [
                        ...new Set(
                            rows.filter((r) => !Object.hasOwn(schema, r.first)).map((r) => r.key)
                        ),
                    ],
                    "ligne(s) d'inventaire dont la clé de premier niveau est absente du configSchema"
                ).toEqual([]);
            });

            it("le défaut écrit est celui que le `configSchema` annonce", async () => {
                const mod = await loadFor(DECLARATION_MODULES, id);
                const schema = mod?.[declarationExportName(id)]?.configSchema;
                if (!schema) return;
                const advertised = new Map(
                    schemaLeaves(schema)
                        .filter((leaf) => leaf.hasDefault)
                        .map((leaf) => [leaf.key, leaf.default])
                );
                const wrong = [];
                for (const row of inventoryRowsOf(inventory, id)) {
                    if (!advertised.has(row.key)) continue;
                    const announced = configDefaults.canon(advertised.get(row.key));
                    for (const { stated, line } of row.entries) {
                        const where = `${docsPaths.rel(INVENTORY_PATH)}:${line} — \`modules.${id}.${row.key}\``;
                        if (stated.kind !== "lit") {
                            wrong.push(
                                `${where} n'énonce pas de défaut lisible, le schéma annonce ${announced} : écrire le littéral entre accents graves en tête de cellule`
                            );
                        } else if (configDefaults.canon(stated.value) !== announced) {
                            wrong.push(
                                `${where} écrit ${configDefaults.canon(stated.value)}, le schéma annonce ${announced}`
                            );
                        }
                    }
                }
                expect(wrong, wrong.join("\n")).toEqual([]);
            });
        });
    });
});

/** Which root-level constant of a plugin's `src/config.ts` is its table of defaults. */
const DEFAULTS_TABLE = /DEFAULTS$/;

/**
 * The plugins whose `src/config.ts` reads a `modules.<namespace>` block, each with its
 * table. A plugin that reads such a block and has no readable table makes the reader
 * THROW — it is never skipped.
 */
function pluginSubjects() {
    return packagesRegistry.plugins().flatMap((pkg) => {
        const file = path.join(pkg.absDir, "src", "config.ts");
        if (!fs.existsSync(file)) return [];
        const namespaces = [
            ...new Set(
                tsDecl
                    .readCallFirstStringArgs(file, "coreConfigGet", { throws: true })
                    .filter((arg) => /^modules\.[\w-]+$/.test(arg))
            ),
        ];
        if (namespaces.length === 0) return [];
        if (namespaces.length > 1) {
            throw new Error(
                `${pkg.name} : src/config.ts lit ${namespaces.join(" et ")} — un greffon n'a ` +
                    "qu'une branche du profil, et ce garde ne sait en lire qu'une."
            );
        }
        const table = tsDecl.readConstObjectLeaves(file, DEFAULTS_TABLE, { throws: true });
        return [{ pkg, id: namespaces[0].slice("modules.".length), table }];
    });
}

/**
 * Judges rows that document a plugin's block — `{ key, stated, line }`, keys relative to the
 * block — against what the plugin applies. Shared by the README and by the core guides.
 */
function judgePluginRows(rows, { table }, document) {
    const wrong = [];
    for (const row of rows) {
        const where = `${document}:${row.line} — \`${row.key}\``;
        const applied = appliedDefault(table, row.key);
        if (applied.kind === "none") {
            if (row.stated.kind !== "none") {
                wrong.push(
                    `${where} écrit ${configDefaults.render(row.stated)}, le code n'applique aucun défaut : écrire —`
                );
            }
        } else if (applied.kind === "lit") {
            if (row.stated.kind !== "lit") {
                wrong.push(
                    `${where} n'énonce pas de défaut lisible, le code applique ${configDefaults.canon(applied.value)} : écrire ce littéral JSON entre accents graves`
                );
            } else if (
                configDefaults.canon(row.stated.value) !== configDefaults.canon(applied.value)
            ) {
                wrong.push(
                    `${where} écrit ${configDefaults.canon(row.stated.value)}, le code applique ${configDefaults.canon(applied.value)}`
                );
            }
        } else if (row.stated.kind === "lit") {
            // Outside the table: a default the plugin does not apply from it is a default
            // written twice, or nowhere. The table is the one place.
            wrong.push(
                `${where} écrit ${configDefaults.canon(row.stated.value)}, que ${table.name} ne porte pas : ` +
                    "entrer le défaut à la table du greffon, ou écrire —"
            );
        }
    }
    return wrong;
}

/**
 * The tables of the core's guides that a `geoleaf:docs:key-prefix` marker binds to a
 * `modules.<id>` block. A guard that found none would be green on nothing: the list is
 * compared, both ways, to what the guides carry.
 */
const BOUND_CORE_GUIDE_TABLES = [
    "docs/PLUGIN_CONFIGURATION_GUIDE.md → modules.offline",
    "docs/PLUGIN_CONFIGURATION_GUIDE.md → modules.table",
    "docs/ui/PERMALINK.md → modules.permalink",
];

/** Every Markdown page of the core's guides — the generated API reference left out. */
function coreGuidePages(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "api") coreGuidePages(full, acc);
        } else if (entry.name.endsWith(".md")) acc.push(full);
    }
    return acc;
}

/** The bound tables, as `{ label, id, document, rows }` with rows keyed relative to the block. */
function boundCoreGuideTables() {
    const corePkg = packagesRegistry.requireByDirName("core");
    const found = [];
    for (const file of coreGuidePages(path.join(corePkg.absDir, "docs"))) {
        const rel = path.relative(corePkg.absDir, file).split(path.sep).join("/");
        for (const table of configDefaults.readTables(fs.readFileSync(file, "utf8"), () => "")) {
            const defCol = table.headers.findIndex((h) => configDefaults.DEFAULT_HEADER.test(h));
            const id = /^modules\.([\w-]+)$/.exec(table.prefix)?.[1];
            if (defCol < 0 || !id) continue;
            const rows = [];
            for (const row of table.rows) {
                const key = /`([^`]+)`/.exec(row.cells[0] || "")?.[1];
                if (!key) continue;
                rows.push({
                    key,
                    stated: configDefaults.parseStated(row.cells[defCol] || ""),
                    line: row.line,
                });
            }
            found.push({
                label: `${rel} → ${table.prefix}`,
                id,
                document: `${corePkg.dir}/${rel}`,
                rows,
            });
        }
    }
    return found;
}

/**
 * The rows of a document's `Default` tables: `{ key, stated, line }`, the key being the first
 * backticked token of the row's first cell — a second token there is an alias the row
 * mentions, not its subject.
 */
function defaultRowsOf(file) {
    const rows = [];
    for (const table of configDefaults.readTables(fs.readFileSync(file, "utf8"), () => "")) {
        const defCol = table.headers.findIndex((h) => configDefaults.DEFAULT_HEADER.test(h));
        if (defCol < 0) continue;
        for (const row of table.rows) {
            const key = /`([^`]+)`/.exec(row.cells[0] || "")?.[1];
            if (!key) continue;
            rows.push({
                key,
                stated: configDefaults.parseStated(row.cells[defCol] || ""),
                line: row.line,
            });
        }
    }
    return rows;
}

/**
 * What the table applies for a key written relative to the plugin's block: the leaf itself,
 * the OBJECT made of the leaves under it when the key names a block, or `outside` when the
 * table carries nothing there. An opaque leaf is `outside` here: the inventory cases
 * already refuse it by name.
 */
function appliedDefault(table, rel) {
    const leaf = table.leaves.get(rel);
    if (leaf) return leaf.kind === "opaque" ? { kind: "outside" } : leaf;
    const under = [...table.leaves].filter(([key]) => key.startsWith(`${rel}.`));
    if (under.length === 0) return { kind: "outside" };
    const block = {};
    for (const [key, inner] of under) {
        if (inner.kind !== "lit") continue;
        // Rebuilds the nesting the reader flattened.
        const steps = key.slice(rel.length + 1).split(".");
        let node = block;
        for (const step of steps.slice(0, -1)) node = node[step] ??= {};
        node[steps.at(-1)] = inner.value;
    }
    return { kind: "lit", value: block };
}

describe("test-garde — l'inventaire de configuration dit vrai sur les blocs des greffons", () => {
    const inventory = configDefaults.readInventory(INVENTORY_PATH);
    const subjects = pluginSubjects();
    const at = (line, key) => `${docsPaths.rel(INVENTORY_PATH)}:${line} — \`${key}\``;

    // ── Anti-empty-guard ─────────────────────────────────────────────────────────────
    // Same reasoning as above: a `coreConfigGet` renamed, or a `src/config.ts` moved, would
    // leave every case below green on nothing.
    it("lit des greffons, des tables et des défauts (sinon ce garde ne garde rien)", () => {
        expect(subjects.length, "aucun greffon lisant un bloc `modules.*`").toBeGreaterThan(5);
        const leaves = subjects.reduce((n, s) => n + s.table.leaves.size, 0);
        expect(leaves, "aucun défaut lu dans les tables des greffons").toBeGreaterThan(60);
        const compared = subjects.reduce(
            (n, s) =>
                n +
                [...s.table.leaves.keys()].filter((k) => inventory.has(`modules.${s.id}.${k}`))
                    .length,
            0
        );
        expect(compared, "aucun défaut de greffon confronté à l'inventaire").toBeGreaterThan(60);
    });

    it("tout espace `modules.*` de l'inventaire est celui d'une capacité ou d'un greffon lu ici", () => {
        const owned = new Set([...CAPABILITY_IDS, ...subjects.map((s) => s.id)]);
        const orphans = new Set();
        for (const key of inventory.keys()) {
            // `modules.*` is the row that points at these sections: it names no namespace.
            const id = /^modules\.([\w-]+)(?:[.[]|$)/.exec(key)?.[1];
            if (id && !owned.has(id)) orphans.add(id);
        }
        expect(
            [...orphans],
            "espace(s) de l'inventaire que ni une capacité ni la table d'un greffon ne tient"
        ).toEqual([]);
    });

    subjects.forEach(({ pkg, id, table }) => {
        describe(`modules.${id} — ${pkg.name}`, () => {
            it(`chaque défaut de \`${table.name}\` a sa ligne d'inventaire`, () => {
                expect(
                    [...table.leaves.keys()].filter((k) => !inventory.has(`modules.${id}.${k}`)),
                    "défaut(s) appliqué(s) par le code sans ligne d'inventaire"
                ).toEqual([]);
            });

            it(`le défaut écrit est celui de \`${table.name}\``, () => {
                const wrong = [];
                for (const [rel, leaf] of table.leaves) {
                    const key = `modules.${id}.${rel}`;
                    if (leaf.kind === "opaque") {
                        wrong.push(
                            `${pkg.dir}/src/config.ts — \`${rel}\` vaut \`${leaf.text}\`, que le lecteur ne ` +
                                "réduit pas à un littéral : l'écrire en littéral, ou par une constante qu'il sait suivre"
                        );
                        continue;
                    }
                    for (const { stated, line } of inventory.get(key) ?? []) {
                        if (leaf.kind === "none") {
                            if (stated.kind !== "none") {
                                wrong.push(
                                    `${at(line, key)} écrit ${configDefaults.render(stated)}, le code n'applique aucun défaut : écrire —`
                                );
                            }
                        } else if (stated.kind !== "lit") {
                            wrong.push(
                                `${at(line, key)} n'énonce pas de défaut lisible, le code applique ${configDefaults.canon(leaf.value)} : écrire le littéral entre accents graves`
                            );
                        } else if (
                            configDefaults.canon(stated.value) !== configDefaults.canon(leaf.value)
                        ) {
                            wrong.push(
                                `${at(line, key)} écrit ${configDefaults.canon(stated.value)}, le code applique ${configDefaults.canon(leaf.value)}`
                            );
                        }
                    }
                }
                expect(wrong, wrong.join("\n")).toEqual([]);
            });

            it("aucun défaut n'est écrit pour une clé que la table ne porte pas", () => {
                const wrong = [];
                for (const row of inventoryRowsOf(inventory, id)) {
                    if (table.leaves.has(row.key)) continue;
                    const key = `modules.${id}.${row.key}`;
                    for (const { stated, line } of row.entries) {
                        if (stated.kind !== "lit") continue;
                        wrong.push(
                            `${at(line, key)} écrit ${configDefaults.canon(stated.value)}, que ${table.name} ne porte pas : ` +
                                "entrer le défaut à la table du greffon, ou écrire —"
                        );
                    }
                }
                expect(wrong, wrong.join("\n")).toEqual([]);
            });

            const readme = defaultRowsOf(path.join(pkg.absDir, "README.md"));
            // Its sheet, by the plugin's directory name: a subject without one is red below,
            // on its first case, rather than skipped.
            const sheetPath = path.join(docsPaths.specs("plugins"), `CDC_${pkg.dirName}.md`);
            const sheet = fs.existsSync(sheetPath) ? defaultRowsOf(sheetPath) : [];
            // What the README's rows cover: a leaf by its own row, or by the row of a block
            // that contains it.
            const covered = (rel) =>
                readme.some((row) => row.key === rel || rel.startsWith(`${row.key}.`));

            it(`le README annonce chaque défaut de \`${table.name}\``, () => {
                expect(readme.length, `aucune ligne lue au README de ${pkg.name}`).toBeGreaterThan(
                    0
                );
                expect(
                    [...table.leaves.keys()].filter((rel) => !covered(rel)),
                    "défaut(s) appliqué(s) par le code sans ligne au tableau du README"
                ).toEqual([]);
            });

            it("le défaut que le README écrit est celui que le code applique", () => {
                const wrong = judgePluginRows(readme, { pkg, id, table }, `${pkg.dir}/README.md`);
                expect(wrong, wrong.join("\n")).toEqual([]);
            });

            it("la fiche du greffon annonce chaque défaut, et celui que le code applique", () => {
                const where = docsPaths.rel(sheetPath);
                expect(sheet.length, `aucune ligne de défaut lue dans ${where}`).toBeGreaterThan(0);
                expect(
                    [...table.leaves.keys()].filter(
                        (rel) =>
                            !sheet.some((row) => row.key === rel || rel.startsWith(`${row.key}.`))
                    ),
                    `défaut(s) appliqué(s) par le code sans ligne dans ${where}`
                ).toEqual([]);
                const wrong = judgePluginRows(sheet, { pkg, id, table }, where);
                expect(wrong, wrong.join("\n")).toEqual([]);
            });
        });
    });
});

describe("test-garde — les guides du cœur disent vrai sur les blocs qu'ils nomment", () => {
    const bound = boundCoreGuideTables();
    const subjects = pluginSubjects();

    beforeEach(() => {
        configGet.mockReset();
        configGet.mockReturnValue({});
    });

    it("les tableaux liés sont ceux de la liste, dans les deux sens", () => {
        const found = bound.map((t) => t.label);
        const unbound = BOUND_CORE_GUIDE_TABLES.filter((label) => !found.includes(label));
        const unlisted = found.filter((label) => !BOUND_CORE_GUIDE_TABLES.includes(label));
        expect(unbound, `plus aucun marqueur ne lie : ${unbound.join(" ; ")}`).toEqual([]);
        expect(
            unlisted,
            `lié par un marqueur, absent de la liste : ${unlisted.join(" ; ")}`
        ).toEqual([]);
        expect(
            bound.filter((t) => t.rows.length === 0).map((t) => t.label),
            "tableau(x) lié(s) dont aucune ligne n'a été lue"
        ).toEqual([]);
    });

    bound.forEach((guide) => {
        it(`${guide.label} — le défaut écrit est celui que le code applique`, async () => {
            const subject = subjects.find((s) => s.id === guide.id);
            if (subject) {
                const wrong = judgePluginRows(guide.rows, subject, guide.document);
                expect(wrong, wrong.join("\n")).toEqual([]);
                return;
            }
            const mod = await loadFor(DECLARATION_MODULES, guide.id);
            const schema = mod?.[declarationExportName(guide.id)]?.configSchema;
            expect(
                schema,
                `modules.${guide.id} n'est ni un greffon lu ici ni une capacité`
            ).toBeTruthy();
            const leaves = new Map(schemaLeaves(schema).map((leaf) => [leaf.key, leaf]));
            const wrong = [];
            for (const row of guide.rows) {
                const where = `${guide.document}:${row.line} — \`${row.key}\``;
                const leaf = leaves.get(row.key);
                if (!leaf) {
                    wrong.push(`${where} — clé que le configSchema de la capacité ignore`);
                } else if (!leaf.hasDefault) {
                    if (row.stated.kind === "lit") {
                        wrong.push(
                            `${where} écrit ${configDefaults.canon(row.stated.value)}, le schéma n'annonce aucun défaut`
                        );
                    }
                } else if (row.stated.kind !== "lit") {
                    wrong.push(
                        `${where} n'énonce pas de défaut lisible, le schéma annonce ${configDefaults.canon(leaf.default)} : écrire ce littéral JSON entre accents graves`
                    );
                } else if (
                    configDefaults.canon(row.stated.value) !== configDefaults.canon(leaf.default)
                ) {
                    wrong.push(
                        `${where} écrit ${configDefaults.canon(row.stated.value)}, le schéma annonce ${configDefaults.canon(leaf.default)}`
                    );
                }
            }
            expect(wrong, wrong.join("\n")).toEqual([]);
        });
    });
});
