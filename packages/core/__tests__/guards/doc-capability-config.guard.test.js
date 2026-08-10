/**
 * @file doc-capability-config.guard.test.js
 * @description Test-garde — la table `## Configuration` de chaque fiche
 * `docs/specs/capacites/<id>.md` dit la vérité sur le code qu'elle décrit.
 *
 * Pourquoi ce garde existe (refonte documentaire V3, §2.4, 27/07/2026)
 * --------------------------------------------------------------------
 * Le §Verdict de `travail/roadmaps/roadmap_documentation-v3.md` mesure une chose : dans tout
 * `_docs_projet/`, les seuls régimes documentaires qui ont produit des documents encore vrais
 * sont « généré + gaté », « gelé sous RFC » et « lu par un programme ». Le quatrième — la
 * discipline de fin de session — est le seul qui ait échoué, et il couvrait presque tout le
 * corpus. Les 21 fiches de capacités + 13 fiches de plugins à écrire tomberaient dans ce
 * quatrième régime si rien ne les lisait.
 *
 * Le contenu le PLUS falsifiable d'une fiche de capacité est sa table de configuration :
 * « paramètre | type | défaut | où c'est lu ». Et il est le seul dont la source soit lisible
 * par une machine — `configSchema` de la déclaration, et la valeur que le lecteur matérialise.
 * Ce garde ferme donc la chaîne :
 *
 *     configSchema (annoncé)  ←→  DEFAULTS via le lecteur (appliqué)
 *         ↑ gardé par `__tests__/capabilities/config-schema-defaults.test.js`
 *         ↓ gardé ICI
 *     table `## Configuration` de la fiche (documenté)
 *
 * Ce qu'il ne peut pas juger : la VÉRACITÉ des phrases de la fiche. « Met en cache 5 minutes »
 * sur une fonction qui en cache 10 reste indiscernable — c'est la règle ⛔ de `CLAUDE.md`, et
 * elle reste à l'humain. Ce garde ne prétend qu'à la partie mécanisable, et la couvre dans les
 * DEUX sens (un paramètre documenté inexistant, comme une clé de schéma non documentée).
 *
 * ## La liste des sujets n'est pas écrite, elle est LUE
 *
 * Même parti que `scaffold-taxonomy.test.js` : les sujets sont les fiches présentes sur le
 * disque. Une 5ᵉ fiche livrée entre donc dans le garde sans qu'on l'y inscrive — c'est ce qui
 * fait que les 33 fiches restantes du §2.4 NAISSENT gatées au lieu d'être rattrapées.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Deux assertions anti-garde-vide ci-dessous (au moins une fiche, au moins une ligne parsée),
 * parce que ce dépôt a déjà mesuré trois fois le cas : la regex de `verify-core-standalone`
 * serait sortie verte en ne gardant plus rien après un renommage de répertoire, et la sonde
 * de boot est restée verte avec un marqueur supprimé.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
// La racine de la doc vient de `scripts/lib/docs-paths.cjs`, jamais d'un littéral : un
// chemin en dur ne casse pas au déplacement du répertoire, il rend 0 fiche — donc 0 test,
// donc VERT. Le module JETTE si sa racine est absente.
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
 * Capacités dont la fiche NE PORTE PAS de table de paramètres, avec le motif de chacune et
 * la source de configuration réelle que la fiche doit nommer.
 *
 * Contrairement au reste de ce garde, cette liste ne se dérive pas : elle dépend d'OÙ vient la
 * configuration, ce que le code ne déclare nulle part. Elle est donc explicite — et c'est le
 * but : une capacité sans `configSchema` fera rougir ce garde tant que personne n'aura écrit
 * ici pourquoi elle a le droit de s'en passer, et où sa configuration vit vraiment.
 *
 * Même patron que `NO_CONFIG_ACCESSOR` dans `capabilities/scaffold-taxonomy.test.js`.
 */
const NO_CAPABILITY_CONFIG = {
    "vector-tiles": {
        motif: "config PAR COUCHE (`data.vectorTiles`), pas app-globale : aucun bloc `modules.*`, donc ni `gate` ni `configSchema`",
        /** Chaîne que la fiche DOIT contenir — sa vraie source de vérité. */
        source: "layer-config.schema.json",
    },
};

/** Sentinelle : la fiche déclare explicitement « aucun défaut » (cellule `—`). */
const NO_DEFAULT = Symbol("no-default");

/**
 * Divergences ANNONCÉ ≠ APPLIQUÉ déjà connues du dépôt, **lues** dans le garde qui les
 * possède — `capabilities/config-schema-defaults.test.js` → `KNOWN_DEFAULT_DRIFT`.
 *
 * Pourquoi lire son source plutôt que recopier la liste : le jour où ce garde-là en solde une
 * entrée, celui-ci doit **immédiatement** exiger la clé dans la fiche. Deux copies dériveraient,
 * et la fiche continuerait de documenter une divergence réparée — exactement le régime que la
 * refonte documentaire répare.
 *
 * Ces entrées ne dispensent PAS la fiche de documenter la clé : elle doit y figurer avec le
 * défaut que le schéma ANNONCE. Seule la comparaison au défaut APPLIQUÉ est suspendue, puisque
 * l'accesseur ne le matérialise pas encore.
 */
const KNOWN_DEFAULT_DRIFT = (() => {
    const sibling = path.join(__dirname, "../capabilities/config-schema-defaults.test.js");
    const src = fs.readFileSync(sibling, "utf8");
    const m = /KNOWN_DEFAULT_DRIFT\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
    // Jamais de repli silencieux : un ensemble vide par accident rendrait ce garde plus
    // strict sans qu'on le sache, et un ensemble « tout permis » le rendrait aveugle.
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

/** Charge le module dont le chemin contient `/<id>/`, ou `null`. */
async function loadFor(modules, id) {
    const key = Object.keys(modules).find((p) => p.includes(`/${id}/`));
    return key ? modules[key]() : null;
}

/** Les fiches présentes sur le disque — la liste n'est pas écrite, elle est lue. */
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

/** Valeur d'une clé du frontmatter YAML de tête (lecture volontairement minimale). */
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

/** Découpe une ligne de tableau markdown en cellules déjà rognées. */
function cells(row) {
    return row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim());
}

/** Retire les accents graves d'une cellule (`` `false` `` → `false`). */
function unbacktick(cell) {
    return cell.replace(/^`|`$/g, "").trim();
}

/**
 * Extrait la table GATÉE de la section `## Configuration` : celle dont l'en-tête porte
 * `Paramètre`. Le choix de l'en-tête, et non « la première table de la section », est
 * délibéré — une fiche peut porter d'autres tables sous ce titre (les deux étages de gate de
 * `theme-toggle`, les champs récoltés de `profile-switcher`, le schéma de couche de
 * `vector-tiles`), et viser la première les aurait attrapées.
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
        // +2 : la ligne d'en-tête, puis la ligne de séparation `| --- |`.
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

/** Une cellule de défaut est un littéral JSON entre accents graves — sinon `undefined`. */
function parseDefault(raw) {
    try {
        return JSON.parse(unbacktick(raw));
    } catch {
        return undefined;
    }
}

/** Champs de premier niveau du `configSchema` portant un `default`, en `{ clé: défaut }`. */
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
        // « Aucun bloc `modules.<id>` » — ce que rend `Config.get(path, {})` pour un profil
        // qui ne déclare pas la capacité. C'est l'état dans lequel les défauts documentés
        // sont ceux qu'on observe.
        configGet.mockReturnValue({});
    });

    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    // Sans ces deux assertions, le garde sortirait VERT le jour où le répertoire est
    // renommé, où le titre `## Configuration` change, ou où l'en-tête `Paramètre` bouge.
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
                // Une capacité peut n'avoir pas de `config.ts` tout en déclarant un
                // configSchema (config poussée par l'installeur : offline, pwa…). Le
                // motif de chacune vit dans `scaffold-taxonomy.test.js`
                // (`NO_CONFIG_ACCESSOR`) ; il n'est pas redupliqué ici.
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
                    // Divergence connue et quarantainée par le garde code↔code : la fiche doit
                    // documenter le défaut ANNONCÉ (vérifié plus haut), mais l'accesseur ne le
                    // matérialise pas encore. Quand l'entrée sortira de sa quarantaine, cette
                    // ligne redeviendra vérifiée sans qu'on touche ici.
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
