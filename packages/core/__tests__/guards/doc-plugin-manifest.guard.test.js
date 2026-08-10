/**
 * @file doc-plugin-manifest.guard.test.js
 * @description Test-garde — le `## Manifeste d'enregistrement` de chaque fiche
 * `docs/specs/plugins/CDC_<id>.md` dit la vérité sur `src/entry.ts` et `package.json`.
 *
 * Pourquoi ce garde existe (refonte documentaire V3, §2.4, 27/07/2026)
 * --------------------------------------------------------------------
 * Jumeau de `doc-capability-config.guard.test.js`, pour l'autre moitié du §2.4. Le raisonnement
 * est le même — une fiche que rien ne lit retombe dans le seul régime documentaire qui ait
 * échoué dans ce dépôt — mais la matière falsifiable n'est pas la même.
 *
 * Sur un plugin, le fait le plus falsifiable et le plus coûteux à laisser dériver est son
 * **manifeste d'enregistrement** : `requires` / `optional` déterminent l'ordre de chargement,
 * `label` s'affiche dans les toasts et les rapports, et le namespace monté est l'unique porte
 * d'entrée de l'intégrateur. Les quatre se lisent mécaniquement dans `entry.ts`, dont la forme
 * est **figée** par `PLUGIN_ARCHITECTURE_SPEC.md §4`.
 *
 * ## Ce que ce garde N'EST PAS
 *
 * Ce n'est pas un doublon de `scripts/verify-plugin-contract.cjs`. Celui-là vérifie que le
 * plugin est **conforme** (PC-01…PC-13) ; celui-ci vérifie que la **fiche** dit ce que le
 * plugin fait. Un plugin peut être parfaitement conforme et documenté de travers.
 *
 * ## Pourquoi un TEST et non un script de `scripts/`
 *
 * C'est le choix architecturalement le moins évident de ce fichier, donc il est écrit ici. Un
 * gate transverse aux paquets appartiendrait plutôt à `scripts/`, à côté de
 * `verify-plugin-contract.cjs`. Mais un script neuf y est **refusé tant qu'il n'est pas suivi
 * par git ET inscrit dans `SCRIPTS_ALLOWLIST`** (`verify-repo-hygiene.cjs`,
 * `verify-ci-scripts-tracked.cjs`) — c'est-à-dire que `ci:local` reste rouge jusqu'au commit.
 * Un test sous `__tests__/guards/` entre dans la suite déjà câblée, sans ce préalable. La
 * contrepartie assumée : ce fichier LIT des sources de `packages/plugins/` depuis le paquet
 * `core`.
 *
 * ⚠️ **Il les lit en TEXTE, jamais par import.** `entry.ts` a des effets de bord à l'évaluation
 * — il monte un namespace global, s'enregistre au registre, branche des écouteurs de document.
 * L'importer ici polluerait l'environnement des autres tests du fichier.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Deux assertions anti-garde-vide (au moins une fiche, au moins une ligne parsée), et **aucun
 * repli silencieux** : quand un motif attendu est introuvable dans `entry.ts`, le garde jette
 * avec le chemin en clair plutôt que de sauter la vérification.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_OWN_NAMESPACE } from "../_helpers/no-own-namespace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
// La racine de la doc vient de `scripts/lib/docs-paths.cjs`, jamais d'un littéral : un
// chemin en dur ne casse pas au déplacement du répertoire, il rend 0 fiche — donc 0 test,
// donc VERT. Le module JETTE si sa racine est absente.
const docsPaths = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/docs-paths.cjs")
);
const FICHES_DIR = docsPaths.specs("plugins");
const PLUGINS_DIR = path.join(REPO_ROOT, "packages/plugins");

/** Les champs du manifeste que la fiche doit porter, dans sa table `Champ | Valeur`. */
const REQUIRED_FIELDS = ["name", "label", "requires", "optional", "namespace", "paquet npm"];

/** Les fiches présentes sur le disque — la liste n'est pas écrite, elle est lue. */
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

/** Découpe une ligne de tableau markdown en cellules rognées, accents graves retirés. */
function cells(row) {
    return row
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => c.trim().replace(/^`|`$/g, "").trim());
}

/**
 * Extrait la table GATÉE de la section `## Manifeste d'enregistrement` : celle dont l'en-tête
 * porte `Champ`. Le choix de l'en-tête, et non « la première table de la section », est
 * délibéré — une fiche peut en porter d'autres sous ce titre.
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
        // +2 : la ligne d'en-tête, puis la ligne de séparation `| --- |`.
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
 * Extrait l'argument objet de `plugins.register("<id>", { … })` par comptage d'accolades.
 *
 * Même parti que `verify-plugin-contract.cjs` (PC-03), et même limite connue : un littéral de
 * chaîne contenant une accolade fausserait le comptage. Aucun `entry.ts` n'en porte, et un
 * futur `entry.ts` qui en porterait ferait échouer ce garde de façon VISIBLE plutôt que
 * silencieuse — ce qui est le comportement voulu.
 */
function extractRegisterMeta(entrySource, relEntry) {
    // Les deux formes d'appel coexistent dans le dépôt, et il a fallu le mesurer : `cog`,
    // `flatgeobuf` et `file-import` écrivent `plugins.register(`, `geocoding` écrit
    // `plugins?.register?.(`. Le chaînage optionnel doit donc être toléré sur CHAQUE maillon —
    // la première version de ce garde ne l'était que sur le premier, et jetait à la collecte.
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
     * Lit une valeur de chaîne du méta, en respectant le guillemet OUVRANT.
     *
     * ⚠️ La forme naïve `["']([^"']*)["']` est fausse, et elle l'était ici — mesuré en écrivant
     * la fiche de `print`, dont le label est `"Print (carte à l'échelle → PDF / JPG)"` : la
     * classe négative s'arrête à l'apostrophe de « l'échelle » et rend `Print (carte à l`.
     *
     * Le mode d'échec est le pire des deux possibles. Le garde ne jette pas — il **tronque**,
     * puis compare. Une fiche qui recopierait la valeur tronquée le ferait donc sortir **VERT
     * sur un label faux**, et le champ que ce garde existe pour protéger cesserait d'être gardé
     * sans que rien ne rougisse. C'est exactement la classe « une garde jamais vue rouge ne
     * garde rien », vue ici par l'autre bout : une garde vue VERTE à tort.
     *
     * La forme ci-dessous capture le guillemet ouvrant (`\1`), lit jusqu'au **même** guillemet,
     * et tolère les échappements — donc `"… l'échelle …"` et `'… "cité" …'` se lisent tous deux.
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

/** Extrait le namespace monté — `…\.<Nom> = buildPublicApi()`. */
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

    // ── Fermeture de la classe B-66 ────────────────────────────────────────────
    // `requires` / `optional` désignent des PLUGINS, résolus par `PluginRegistry.isLoaded()`.
    // Quatre manifestes ont cité `storage` des mois après son renommage en `offline-ui`, et
    // `print` y nommait en plus `legend`, une capacité IN-CORE qu'aucun `isLoaded()` ne verra
    // jamais. L'effet à l'exécution est nul — `optional` est stocké et jamais lu —, ce qui est
    // exactement pourquoi rien ne rougissait : le champ ne sert QU'À documenter, et il était le
    // seul à n'avoir aucun lecteur pour le contredire.
    //
    // Ce test lit les identifiants RÉELLEMENT enregistrés (le 1er argument de `plugins.register`)
    // et refuse toute citation qui n'en fait pas partie. La liste n'est pas écrite, elle est
    // dérivée — un 14ᵉ plugin y entre sans qu'on y pense.
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
        // Anti-garde-vide : sans au moins une citation, la boucle ne compare rien.
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
            // Exemption PARTAGÉE avec `plugin-namespace-declared.guard.test.js` — une source,
            // deux lecteurs. Voir le helper pour le motif et pour ce qui rend l'entrée falsifiable.
            const exempt = NO_OWN_NAMESPACE[fiche.id];
            // ⚠️ `extractMountedNamespace` JETTE quand elle ne trouve rien. L'appeler ICI, dans le
            // corps du `describe`, en ferait une erreur de COLLECTE : tout le fichier de garde
            // tomberait à l'arrivée de la première fiche d'un plugin sans façade. Elle est donc
            // appelée dans le `it` de la branche non exemptée, et nulle part ailleurs.

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
                    // La fiche écrit un littéral JSON : `[]` ou `["core"]`.
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
                    // Miroir exact de l'assertion `configSchema → toBeUndefined()` de
                    // NO_CAPABILITY_CONFIG : l'exemption doit rougir le jour où elle cesse d'être
                    // vraie, sinon elle survit à son motif.
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
