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
const CAPABILITIES_DIR = path.resolve(__dirname, "../../src/capabilities");

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
