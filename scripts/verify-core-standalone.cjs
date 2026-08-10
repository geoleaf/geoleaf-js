#!/usr/bin/env node
/**
 * Enforces the `no-plugin-in-core` rule: `packages/core/src/` must stay
 * standalone and never reference a plugin package, so the core remains
 * autonomous and tree-shakeable. A consumer who installs only `@geoleaf/core`
 * must get an engine that boots, with nothing pulled in behind it. See CLAUDE.md.
 *
 * SYNC-01:  no plugin reference in packages/core/src (.ts .js .json) nor in
 *           packages/core/package.json.
 * SYNC-03:  no offline-ui cache UI selector in packages/core/src (.css).
 * SYNC-04:  no CacheSection remnant in packages/core/src (.ts .js .json).
 * SYNC-01b: same as SYNC-01 for the connector plugin (chemin résolu par le registre).
 * SYNC-02:  in packages/core/docs/, every import/require specifier naming a plugin
 *           must be one a reader can RESOLVE from an `npm install`.
 *
 * SYNC-02 was scoped to the sync-core-public.yml mirror, which ARCHI S9.0
 * deleted; S0 recorded that it would go with it. It is KEPT deliberately. Its
 * subject is publication hygiene of packages/core/docs/ — the docs shipped on
 * npm — and that concern outlives the mirror. It also grows once ARCHI S3.6
 * makes the monorepo public: the check then applies to the repository itself
 * rather than to a copy of it.
 *
 * ⚠️ SYNC-02 A CHANGÉ D'AXE LE 10/08/2026 (B-214). Elle interdisait toute ligne
 * d'import citant `@geoleaf-plugins/*` — mais seulement quand cette ligne portait un
 * `from` ou un `require(`. La forme CANONIQUE de chargement d'un plugin GeoLeaf,
 * l'import à effet de bord nu (`import "@geoleaf-plugins/cog";`), lui était invisible,
 * et 9 lignes de cette forme vivaient déjà dans `packages/core/docs/`. Le partage
 * `from`/nu ne recouvrait AUCUNE propriété que quiconque cherchait à garder : il
 * rougissait `import { createConnector } from "@geoleaf-plugins/connector"` et laissait
 * passer `import "@geoleaf-plugins/connector"` — deux écritures du même geste
 * d'intégrateur. C'était un artefact de regex, pas un découpage.
 *
 * **La question de fond, et la réponse retenue.** Un import écrit dans un `.md` du core
 * n'est JAMAIS un import que le core exécute : c'est celui de l'INTÉGRATEUR. La règle
 * ne peut donc pas se lire « les imports que le core exécuterait » (elle serait vide),
 * ni « toute référence » (elle interdirait à une page qui enseigne le chargement d'un
 * plugin de montrer son import — elle serait désarmée en une semaine). Ce qui reste à
 * garder, c'est que ce que la doc fait COPIER soit résoluble par le lecteur du tarball :
 *
 *     le specifier publié `@geoleaf-plugins/<nom>` est AUTORISÉ sous toutes ses formes
 *     syntaxiques ; ce qui est INTERDIT, c'est un specifier que `npm install` ne rend
 *     pas — chemin interne au monorepo, chemin profond dans un plugin, nom de plugin
 *     que le registre ne connaît pas.
 *
 * PROSE vs BLOC DE CODE. C'est la transposition en Markdown de l'exemption dont
 * bénéficient déjà les lignes de commentaire en SYNC-01/03/04 : décrire est permis,
 * faire exécuter ne l'est pas. Un bloc clôturé est ce qu'un lecteur copie ; la prose
 * décrit l'écosystème, et le docblock l'admettait déjà. Conséquence mesurée : l'arme
 * « plugin inconnu du registre » ne s'applique QU'AUX BLOCS DE CODE, parce qu'un
 * CHANGELOG nomme légitimement un paquet par le nom qu'il portait à sa date
 * (`CHANGELOG.md:443` cite `@geoleaf-plugins/storage`, renommé `offline-ui` depuis —
 * l'énoncé est vrai à sa date). Les deux autres armes valent partout : un chemin de
 * monorepo n'a JAMAIS été résoluble pour un lecteur du tarball, à aucune date.
 *
 * 🖐 CE QU'AUCUNE GATE NE PORTE, et il faut le dire : qu'un document du core soit
 * bien un document DU CORE. `CONNECTOR_GUIDE.md` — le guide d'un plugin logé dans les
 * docs du core — était le seul cas que SYNC-02 ait jamais attrapé, et elle l'attrapait
 * PAR PROCURATION, sur une de ses deux lignes, par accident de regex. C'est un problème
 * de PLACEMENT, pas d'import : il relève de la règle tranchée en B-215 — « un paquet
 * expédie la documentation qui le décrit » — et d'une relecture humaine.
 *
 * ⚠️ Limite assumée : les blocs de code INDENTÉS (4 espaces) ne sont pas reconnus comme
 * du code. Le corpus est formaté par Prettier, qui n'en produit pas ; le jour où il y en
 * aurait, ils seraient lus comme de la prose. Écrit ici plutôt que découvert plus tard.
 *
 * Usage: node scripts/verify-core-standalone.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const registry = require("./lib/packages.cjs");

// ARCHI S10.2 — le connector se déplace sous `packages/plugins/` au S10 ; ses chemins
// viennent donc du registre, qui JETTE si le package est introuvable. Sans cela, SYNC-01b
// aurait cessé de scanner le connector en silence : `collectSources` sort sur son
// `existsSync` et la gate annonce « aucune fuite » sans avoir rien lu.
//
// ⚠️ T5.5 — les chemins du CORE étaient restés littéraux, avec pour justification écrite
// que « le core reste ». C'est l'argument qui précède toujours un déplacement, et il ne
// protège de rien : la gate ne devient pas rouge quand le chemin cesse de matcher, elle
// devient MUETTE — `collectSources` sort sur `existsSync`, exactement comme pour le
// connector. Les deux moitiés passent maintenant par le même registre, et cette gate est
// celle que CLAUDE.md qualifie de non négociable.
const CORE_DIR = registry.requireByDirName("core").absDir;
const CORE_SRC = path.join(CORE_DIR, "src");
const CORE_PKG = path.join(CORE_DIR, "package.json");
const CONNECTOR_DIR = registry.requireByDirName("connector").absDir;
const CONNECTOR_SRC = path.join(CONNECTOR_DIR, "src");
const CONNECTOR_PKG = path.join(CONNECTOR_DIR, "package.json");
const DOCS_DIR = path.join(CORE_DIR, "docs");

// Patterns forbidden in core JS/TS sources and package.json.
// `@geoleaf-plugins` covers every published plugin at once (storage, editor,
// cog, editor, measure, print, table…) and is the canonical form of the
// violation; the three workspace paths cover relative/monorepo imports.
//
// ⚠️ R.15 (24/07/2026) — les répertoires ont perdu leur préfixe `plugin-`
// (`packages/plugins/plugin-storage` → `packages/plugins/storage`). Les trois
// alternatives DEVAIENT suivre : laissées à `plugin-storage`, elles auraient cessé
// de matcher le moindre chemin et cette gate serait sortie VERTE en n'ayant plus
// rien gardé — la frontière `no-plugin-in-core` est précisément ce qu'on ne peut
// pas se permettre de perdre en silence. Elles sont désormais `plugins/<nom>`, ce
// qui couvre aussi le specifier scopé (`@geoleaf-plugins/offline-ui` contient
// `plugins/offline-ui`) : redondant avec la première alternative, et c'est voulu.
//
// ⚠️ STRUCT S3 (26/07/2026) — le MÊME mode d'échec, une seconde fois, dix-neuf mois
// après le premier : `packages/plugins/storage` est devenu `packages/plugins/offline-ui`,
// et l'alternative — alors écrite `plugins/storage` — aurait cessé de matcher SANS
// rougir. Elle a été vue rouge avant correction (import planté dans `packages/core/src/`),
// conformément à « toute garde doit être VUE rougir ».
//
// ⚠️ Et un troisième mode, propre à ce sprint : un `sed` de renommage passé sur ce
// fichier RÉÉCRIT ces commentaires-ci, transformant le récit historique en contresens
// (« R.15 a renommé vers offline-ui » — faux, R.15 renommait vers `storage`). Les
// commentaires qui datent un renommage doivent être relus après toute passe mécanique.
//
// Do NOT generalise to `plugins?/[a-z-]+`: `plugin-registry.ts` est un fichier du
// core, et `connector` est un plugin dont le core ne dépend pas — les deux seraient
// des faux positifs.
const PLUGIN_REF_RE = /(@geoleaf-plugins|plugins\/offline-ui|plugins\/editor|plugins\/cog)/;

// SYNC-03: Patterns forbidden in core CSS (selectors used exclusively by the offline-ui cache UI)
const PLUGIN_CSS_RE =
    /\.(?:gl-cache-(?:modal|control|status|actions|progress|layers|btn|section|button)|geoleaf-ctrl-cache-button)\b/;

// SYNC-04: Patterns forbidden in core TS/JS (CacheSection remnants)
const CORE_CACHE_REMNANTS_RE =
    /\b(?:CacheSection|_LayerManagerCacheSection)\b|["'][^"']*cache-section[^"']*["']/;

// ─── SYNC-02 — l'outillage ────────────────────────────────────────────────────
//
// Extraction du SPECIFIER de toute construction d'import/require, quelle que soit sa
// forme syntaxique. Les quatre alternatives couvrent les six formes du banc d'essai de
// B-214 : `from "…"` prend l'import nommé et le ré-export, `require(` et `import(`
// prennent le CommonJS et le dynamique, `import "…"` prend l'import à effet de bord nu
// — celui que l'ancien motif ratait, et qui est la forme canonique.
//
// ⚠️ Le motif ne se généralise PAS à « toute chaîne entre guillemets » : il faut une
// construction d'import. Sans cela, une phrase de CHANGELOG citant un chemin entre
// backticks deviendrait une violation, et la gate se ferait désarmer sur des faux
// positifs — c'est le mode d'échec que B-214 cherchait précisément à éviter.
const DOCS_SPECIFIER_RE =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

// Ouverture/fermeture d'un bloc clôturé Markdown (``` ou ~~~, 3 marqueurs ou plus).
const DOCS_FENCE_RE = /^\s*(`{3,}|~{3,})/;

const PLUGIN_SCOPE = "@geoleaf-plugins";

// ⚠️ Dérivé du registre, JAMAIS écrit à la main. `PLUGIN_REF_RE` ci-dessus épingle trois
// noms de répertoire en dur (`offline-ui`, `editor`, `cog`) et ils ont dû être corrigés
// DEUX FOIS — R.15 puis STRUCT S3 — chaque fois avec le même risque de sortir verte en
// n'ayant plus rien gardé. SYNC-02 ne rejoue pas cette partie : elle demande au registre,
// qui JETTE si les globs de workspaces cessent de matcher. Les 12 plugins sont couverts,
// pas 3, et un plugin ajouté demain l'est sans toucher à ce fichier.
const KNOWN_PLUGIN_NAMES = new Set(registry.plugins().map((p) => p.pluginName));
const PLUGIN_DIR_ALTERNATIVES = registry
    .plugins()
    .map((p) => p.dirName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
const MONOREPO_PLUGIN_PATH_RE = new RegExp(`(?:^|/)plugins/(?:${PLUGIN_DIR_ALTERNATIVES})(?:$|/)`);

/**
 * SYNC-02 — un specifier de `packages/core/docs/` est-il résoluble par le lecteur ?
 *
 * Voir le docblock de tête pour le motif du découpage. Trois armes, dont deux valent
 * partout et une ne vaut que dans un bloc de code :
 *
 *   1. chemin interne au monorepo (`../../plugins/cog`, `packages/plugins/editor/…`)
 *      → jamais résoluble hors du dépôt, à aucune date. Vaut aussi en prose.
 *   2. chemin profond dans un plugin (`@geoleaf-plugins/editor/src/entry.ts`)
 *      → enseigne un chemin privé que le paquet n'a jamais promis. Vaut aussi en prose.
 *   3. plugin inconnu du registre (`@geoleaf-plugins/storage`, renommé depuis)
 *      → BLOC DE CODE SEULEMENT : un CHANGELOG nomme légitimement un paquet par le nom
 *        qu'il portait à sa date. Ce que la doc fait COPIER, en revanche, doit exister.
 *
 * ⚠️ L'arme 3 mesure l'existence du plugin DANS CE DÉPÔT, pas sur le registre npm.
 * L'écart entre les deux est un objet distinct, suivi en B-141, et il ne se vérifie pas
 * hors ligne — confondre les deux ferait dépendre cette gate du réseau.
 *
 * @param {string} spec - le specifier extrait, tel qu'écrit.
 * @param {boolean} inCode - vrai si la ligne est dans un bloc clôturé.
 * @returns {string|null} le motif du refus, ou null si le specifier est résoluble.
 */
function docSpecifierVerdict(spec, inCode) {
    if (spec.startsWith(`${PLUGIN_SCOPE}/`)) {
        const [name, ...deep] = spec.slice(PLUGIN_SCOPE.length + 1).split("/");
        if (deep.length > 0) {
            return `chemin profond dans un plugin — "${PLUGIN_SCOPE}/${name}" est la seule forme publiée`;
        }
        if (inCode && !KNOWN_PLUGIN_NAMES.has(name)) {
            return `plugin inconnu du registre — aucun paquet "${PLUGIN_SCOPE}/${name}" dans ce dépôt`;
        }
        return null;
    }
    if (MONOREPO_PLUGIN_PATH_RE.test(spec)) {
        return "chemin interne au monorepo — irrésoluble pour un lecteur du tarball";
    }
    return null;
}

function isCommentOnly(line) {
    const t = line.trim();
    return (
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("*/") ||
        t === ""
    );
}

function scanDir(dir, results) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!["node_modules", "dist", ".git"].includes(e.name)) {
                scanDir(full, results);
            }
        } else if (/\.(ts|js|json)$/.test(e.name)) {
            const content = fs.readFileSync(full, "utf8");
            const lines = content.split("\n");
            lines.forEach((line, i) => {
                if (PLUGIN_REF_RE.test(line) && !isCommentOnly(line)) {
                    results.push({
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: line.trim(),
                    });
                }
                if (CORE_CACHE_REMNANTS_RE.test(line) && !isCommentOnly(line)) {
                    results.push({
                        kind: "SYNC-04",
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: line.trim(),
                    });
                }
            });
        } else if (/\.css$/.test(e.name)) {
            const content = fs.readFileSync(full, "utf8");
            const lines = content.split("\n");
            let inBlockComment = false;
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                // Track /* ... */ block comments (single-line or spanning)
                if (inBlockComment) {
                    if (trimmed.includes("*/")) inBlockComment = false;
                    return;
                }
                if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
                    inBlockComment = true;
                    return;
                }
                if (trimmed.startsWith("/*") || trimmed === "" || trimmed.startsWith("*")) return;
                if (PLUGIN_CSS_RE.test(line)) {
                    results.push({
                        kind: "SYNC-03",
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: trimmed,
                    });
                }
            });
        }
    }
}

function collectMarkdown(dir, results) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            collectMarkdown(full, results);
        } else if (/\.md$/.test(e.name)) {
            results.push(full);
        }
    }
}

/**
 * Cherche une référence à un plugin dans les DÉPENDANCES d'un `package.json`, pas dans son
 * texte brut.
 *
 * ⚠️ API publique S4.6 — la version d'avant testait `PLUGIN_REF_RE` sur le contenu du fichier
 * entier. Ça a tenu tant que le connector s'appelait `@geoleaf/connector` : dès qu'il a été
 * renommé `@geoleaf-plugins/connector`, la gate a signalé une fuite dans son propre
 * `package.json` — parce qu'il y déclare son NOM. Un paquet qui se nomme n'est pas un
 * paquet qui dépend.
 *
 * Le motif restant est correct pour les SOURCES (un import est un import) ; il ne l'était pas
 * pour un manifeste, où le même mot occupe deux rôles. On lit donc les 4 cartes de dépendances,
 * et rien d'autre.
 *
 * @param {string} pkgPath - chemin du package.json.
 * @returns {string|null} le specifier fautif, ou null.
 */
function pluginDependency(pkgPath) {
    let json;
    try {
        json = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
        // Un manifeste illisible n'est pas « propre » : on refuse de conclure plutôt que de
        // rendre null, sinon la gate sort verte sur un fichier qu'elle n'a pas su lire.
        console.error(`ERROR [SYNC-01]: ${path.relative(ROOT, pkgPath)} illisible.`);
        process.exit(2);
    }
    for (const champ of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ]) {
        for (const nom of Object.keys(json[champ] ?? {})) {
            if (PLUGIN_REF_RE.test(nom)) return `${champ}.${nom}`;
        }
    }
    return null;
}

// ─── SYNC-01: Scan core sources ───────────────────────────────────────────────
const leaks = [];
scanDir(CORE_SRC, leaks);

if (fs.existsSync(CORE_PKG)) {
    const dep = pluginDependency(CORE_PKG);
    if (dep) leaks.push({ file: "packages/core/package.json", line: null, content: dep });
}

const sync01 = leaks.filter((l) => !l.kind);
const sync03 = leaks.filter((l) => l.kind === "SYNC-03");
const sync04 = leaks.filter((l) => l.kind === "SYNC-04");

if (sync01.length > 0) {
    console.error("ERROR [SYNC-01]: Plugin import or dependency detected in packages/core:");
    sync01.forEach(({ file, line, content }) => {
        console.error(`  ${file}${line != null ? `:${line}` : ""} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-01] No plugin imports in core.");

if (sync03.length > 0) {
    console.error("ERROR [SYNC-03]: Plugin cache CSS selector leaked into core CSS:");
    sync03.forEach(({ file, line, content }) => {
        console.error(`  ${file}:${line} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-03] No plugin cache CSS selectors in core CSS.");

if (sync04.length > 0) {
    console.error("ERROR [SYNC-04]: CacheSection remnant reintroduced in core TS/JS:");
    sync04.forEach(({ file, line, content }) => {
        console.error(`  ${file}:${line} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-04] No CacheSection remnants in core TS/JS.");

// ─── SYNC-01b: Scan connector sources ─────────────────────────────────────────
const connectorLeaks = [];
scanDir(CONNECTOR_SRC, connectorLeaks);

if (fs.existsSync(CONNECTOR_PKG)) {
    const dep = pluginDependency(CONNECTOR_PKG);
    if (dep) {
        connectorLeaks.push({
            file: path.relative(ROOT, CONNECTOR_PKG),
            line: null,
            content: dep,
        });
    }
}

if (connectorLeaks.length > 0) {
    console.error(
        `ERROR [SYNC-01b]: Plugin import or dependency detected in ${path.relative(ROOT, CONNECTOR_DIR)}:`
    );
    connectorLeaks.forEach(({ file, line, content }) => {
        console.error(`  ${file}${line != null ? `:${line}` : ""} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-01b] No plugin imports in connector.");

// ─── SYNC-02: Scan packages/core/docs ─────────────────────────────────────────
// No whitelist needed: packages/core/docs/ documents the core only, by construction.
const allDocFiles = [];
collectMarkdown(DOCS_DIR, allDocFiles);
const docLeaks = [];
/**
 * Exemptions de SYNC-02 — chemin relatif → motif. Chaque entrée doit porter sa raison : une
 * exemption muette est indiscernable d'un cas que quelqu'un a cessé de poursuivre.
 *
 * ✅ **VIDE depuis le 10/08/2026, et c'est le sujet qui est parti, pas la règle.** L'unique
 * entrée exemptait `packages/core/docs/CONNECTOR_GUIDE.md` — le guide d'un plugin, livré dans
 * le tarball du core. La question de fond, ouverte en **D-16** et explicitement provisoire, a
 * été tranchée par le Sprint 8 de `roadmap_passage-public-npm` : le guide a été déplacé vers
 * `packages/plugins/connector/docs/`, le paquet qu'il documente. L'exemption disparaît donc
 * **avec son sujet**, pas par relâchement.
 *
 * 🛑 Deux mesures ont été prises pour que ce ne soit pas un affaiblissement muet :
 *   1. après le seul `git mv`, cette gate est sortie en **exit 2** sur « exemption périmée » —
 *      c'est la boucle de contrôle ci-dessous, et elle a fait exactement son travail ;
 *   2. la Map une fois vidée, un import de plugin réintroduit dans `packages/core/docs/` a été
 *      **vu faire rougir SYNC-02**. La règle mord toujours ; c'est sa seule dérogation qui
 *      n'existe plus.
 *
 * ⚠️ La Map reste en place, vide, plutôt que d'être supprimée : le prochain cas d'exemption
 * doit trouver ici l'obligation d'écrire son motif ET la boucle qui périme les exemptions
 * mortes. C'est la machinerie qui a rendu ce déménagement visible.
 */
const DOCS_EXEMPT = new Map([]);

/**
 * Relève les violations SYNC-02 d'un `.md`, en distinguant PROSE et BLOC DE CODE.
 *
 * L'état de clôture se suit ligne à ligne : la ligne d'ouverture porte l'info-string
 * (` ```js `), pas du code, donc elle n'est pas inspectée ; la ligne de fermeture non
 * plus. Un marqueur plus long ferme un marqueur plus court, jamais l'inverse — c'est la
 * règle CommonMark, et c'est ce qui permet à un bloc d'en contenir un autre.
 *
 * @param {string} abs - chemin absolu du fichier.
 * @param {string} rel - chemin relatif au dépôt, séparateurs POSIX.
 * @returns {{file: string, line: number, content: string, why: string}[]}
 */
function scanDocFile(abs, rel) {
    const found = [];
    let fence = null;
    fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
            const m = DOCS_FENCE_RE.exec(line);
            if (m) {
                if (fence === null) {
                    fence = m[1];
                    return;
                }
                if (m[1][0] === fence[0] && m[1].length >= fence.length) {
                    fence = null;
                    return;
                }
            }
            DOCS_SPECIFIER_RE.lastIndex = 0;
            let hit;
            while ((hit = DOCS_SPECIFIER_RE.exec(line)) !== null) {
                const why = docSpecifierVerdict(hit[1], fence !== null);
                if (why) found.push({ file: rel, line: i + 1, content: line.trim(), why });
            }
        });
    return found;
}

// ⚠️ Assertion anti-gate-vide. `collectMarkdown` sort silencieusement sur un répertoire
// absent : si `packages/core/docs/` déménage, SYNC-02 annonçait « aucune référence » en
// n'ayant lu AUCUN fichier — exit 0, verte, aveugle. C'est la classe que
// `probe-gate-visibility.cjs` surveille, et cette gate n'y était pas immunisée.
if (allDocFiles.length === 0) {
    console.error(
        `ERROR [SYNC-02]: aucun .md trouvé sous ${path.relative(ROOT, DOCS_DIR)} — ` +
            `le répertoire a bougé ou est vide. La gate refuse de conclure sur un corpus nul.`
    );
    process.exit(2);
}

for (const filePath of allDocFiles) {
    const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
    if (DOCS_EXEMPT.has(rel)) continue;
    docLeaks.push(...scanDocFile(filePath, rel));
}

// Une exemption qui ne vise plus rien est un mensonge silencieux : si le fichier disparaît, ou
// s'il cesse de contenir ce qu'on exempte, la gate doit le dire plutôt que de l'ignorer.
for (const [rel, motif] of DOCS_EXEMPT) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
        console.error(`ERROR [SYNC-02]: exemption périmée — ${rel} n'existe plus (${motif}).`);
        process.exit(2);
    }
    if (scanDocFile(abs, rel).length === 0) {
        console.error(
            `ERROR [SYNC-02]: exemption périmée — ${rel} ne contient plus de référence à ` +
                `exempter. Retirez-la de DOCS_EXEMPT (${motif}).`
        );
        process.exit(2);
    }
}

if (docLeaks.length > 0) {
    console.error("ERROR [SYNC-02]: specifier de plugin irrésoluble dans packages/core/docs:");
    docLeaks.forEach(({ file, line, content, why }) => {
        console.error(`  ${file}:${line} — ${why}`);
        console.error(`      ${content}`);
    });
    process.exit(1);
}

// Le périmètre s'imprime en fin de run — un chiffre qu'on peut relire vaut mieux qu'une
// affirmation qu'on doit croire. Le nombre de plugins vient du registre : s'il tombe à 0,
// `packages.cjs` jette avant d'arriver ici.
console.log(
    `✅ [SYNC-02] Tout specifier de plugin est résoluble dans les docs du core ` +
        `(${allDocFiles.length} .md scannés, ${KNOWN_PLUGIN_NAMES.size} plugins au registre).`
);

process.exit(0);
