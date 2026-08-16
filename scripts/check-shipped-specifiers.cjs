#!/usr/bin/env node
/**
 * @fileoverview SHIP-SPEC — les specifiers NUS que le tarball emporte doivent se résoudre
 * chez l'intégrateur, pas seulement dans ce monorepo.
 *
 * ## Le défaut que cette gate existe pour attraper
 *
 * Six `.d.ts` publiables importaient des paquets qui rendent **404 sur npm**. Aucune gate ne
 * pouvait le voir, et la raison est structurelle : **les liens symboliques des workspaces npm
 * masquent la classe entière.** `@geoleaf/host-runtime` résout parfaitement ici — il est dans
 * `node_modules/` par symlink — et il n'existe nulle part sur le registre. Vert en local,
 * `TS2307` chez l'intégrateur.
 *
 * Les deux gates voisines passent à côté, chacune pour son propre motif, et il faut les avoir
 * en tête pour ne pas croire que celle-ci fait double emploi :
 *
 *   - `verify-published-types.cjs` (PUB-TYPES) **ne compile rien** : il lit `package.json` et le
 *     disque. Il vérifie l'ATTEIGNABILITÉ de l'entrée `types`, jamais la RÉSOLVABILITÉ de ses
 *     imports transitifs.
 *   - `typecheck:consumer` compile bien, mais il compile depuis `packages/core/examples/`, donc
 *     **à l'intérieur du monorepo** : les symlinks y sont, et `@geoleaf/host-runtime` s'y résout.
 *     Le compilateur ne peut pas voir ce qui ne sera absent que chez quelqu'un d'autre.
 *
 * La seule façon de trancher hors ligne est de comparer le specifier au CONTRAT que le paquet
 * publie — ses `dependencies` — et à ce que le dépôt sait de la cible : un workspace `private`
 * ne sera jamais sur le registre, quelle que soit la façon dont on le déclare.
 *
 * ## 🛑 LE RECOUVREMENT DES GATES DU TARBALL — écrit ICI, et nulle part ailleurs (B-87, B-232)
 *
 * Quatre instruments jugent ce qui part dans un tarball. **Aucun ne disait ce qu'il NE couvre
 * PAS**, et c'est ce silence qui a coûté : on lit un vert, on en déduit une garantie plus large
 * que la sienne. Le tableau est ici parce que ce fichier est le plus récent des quatre et le
 * seul qui compare déjà ses voisins ; les trois autres y renvoient.
 *
 * | Gate | La question qu'elle pose | Ce qu'elle ne peut PAS voir |
 * | --- | --- | --- |
 * | **SHIP-SPEC** (ici) | un specifier NU d'un fichier atteignable se résout-il chez l'intégrateur ? | la VISIBILITÉ d'un symbole — un type non exporté qui atteint le `.d.ts` publié ne fait apparaître aucun specifier étranger |
 * | **PUB-TYPES** (`verify-published-types.cjs`) | l'entrée `types` est-elle atteignable ? | ce que cette entrée IMPORTE, transitivement — elle ne compile rien |
 * | **check 4** (`check-versions.cjs`) | les cartes de dépendances sont-elles cohérentes ? | les `.d.ts` — elle lit des `package.json`, jamais du code émis |
 * | **`typecheck:consumer`** | le paquet compile-t-il chez un consommateur ? | ce qui n'est absent que HORS du monorepo : elle compile depuis `packages/core/examples/`, où les symlinks de workspace résolvent tout |
 *
 * ⚠️ **LA CASE VIDE EST B-87, ET AUCUNE QUATRIÈME GATE NE LA REMPLIRA PAR ADDITION.** Un type
 * interne non exporté qui atteint la déclaration publiée est invisible à SHIP-SPEC **par
 * construction** — il n'introduit aucun specifier étranger, donc son zéro n'en dit rien. La
 * baseline vide de SHIP-SPEC (`entries: 0`) peut donc coexister avec la classe entière de B-87
 * ouverte : **deux questions différentes sur le même fichier**, l'une sur la CIBLE d'un import,
 * l'autre sur la VISIBILITÉ d'un symbole.
 *
 * 📌 Ce tableau est le geste que B-87 demandait — « c'est le recouvrement lui-même qu'il faut
 * écrire, pas une quatrième gate ». Un vert ne vaut que ce que sa question vaut, et une question
 * qu'on ne peut pas lire se lit comme une garantie.
 *
 * ## Les trois règles
 *
 *   SHIP-SPEC-01  Tout specifier NU d'un fichier ATTEIGNABLE doit être déclaré dans les
 *                 dépendances d'exécution du paquet (`dependencies`, `peerDependencies`,
 *                 `optionalDependencies`). Un specifier absent des trois n'est résolu chez
 *                 l'intégrateur que par chance — un hissage transitif qu'aucun contrat ne
 *                 promet. Cliquet : baseline qui ne peut que RÉTRÉCIR.
 *                 ⚠️ UNE seule équivalence, et elle est CONDITIONNÉE au type de fichier :
 *                 dans un fichier de DÉCLARATION (`.d.ts`/`.d.mts`/`.d.cts`), déclarer
 *                 `@types/X` satisfait le specifier `X`. Voir « L'équivalence DefinitelyTyped »
 *                 ci-dessous — sans elle, la gate réclamait une chose IMPOSSIBLE.
 *   SHIP-SPEC-02  Aucun fichier atteignable ne peut nommer un workspace `private: true`.
 *                 **Aucune baseline, aucune exemption** : cette cible n'ira jamais sur le
 *                 registre, donc la déclarer en `dependencies` ne réparerait rien — ça
 *                 satisferait 01 en rendant le paquet non installable. C'est très exactement
 *                 la fausse issue que 02 ferme, et c'est pourquoi les deux règles existent
 *                 séparément plutôt qu'en une seule.
 *   SHIP-SPEC-03  Plancher de corpus. Une gate qui sort verte en n'ayant rien scanné est le
 *                 pire des résultats — et ici le risque est concret : le corpus est `dist/`,
 *                 qui n'existe pas avant un build. Sans plancher, un run pré-build annoncerait
 *                 « 0 fuite » en lisant zéro octet.
 *
 * ## Ce qui définit le corpus, et pourquoi ce n'est PAS `files[]`
 *
 * Le corpus est DÉRIVÉ de la carte `exports` de chaque paquet : la racine de chaque cible
 * (`./dist/types/index.d.ts` → `dist/`). C'est l'ensemble de ce qu'un consommateur peut
 * atteindre, et c'est ce qui donne son sens au verdict.
 *
 * `files[]` est plus large, et la différence n'est pas un détail : **13 des 14 paquets
 * publiables embarquent `src/` dans leur tarball**, où 82 fichiers importent
 * `@geoleaf/host-runtime`. Mesuré le 09/08/2026 : **aucun de ces 14 paquets n'expose de
 * sous-chemin `./src/*`** — leur carte `exports` ne porte que `.` et `./package.json`. Ces 82
 * fichiers sont donc du POIDS DE TARBALL, pas des fuites de types : ni `tsc` (en résolution
 * `node16`/`bundler`) ni Node ne peuvent les ouvrir. Les confondre reviendrait à annoncer 84
 * fuites là où le compilateur d'un intégrateur n'en rencontre que 2.
 *
 * ⚠️ La distinction est SURVEILLÉE, pas supposée : le compte des fichiers embarqués-mais-non-
 * atteignables portant un specifier douteux est imprimé à chaque run, et le jour où un paquet
 * exposerait `./src/*`, la dérivation ci-dessus élargit le corpus toute seule — sans qu'on ait
 * à y penser. Le sort de `src/` dans le tarball est une décision du Sprint 2 (tâches 2.10-2.12),
 * pas de celui-ci.
 *
 * ## Pourquoi les paquets PRIVÉS sont scannés eux aussi
 *
 * Le filtre naturel serait `registry.publishable()` — un paquet privé n'a pas de tarball. Le
 * corpus est pourtant `registry.all()`, pour deux raisons, et la première est de fond :
 * **`@geoleaf/host-runtime` est BUNDLÉ INLINE dans les 12 plugins publiés.** Un specifier 404
 * dans SES sources voyage donc jusque dans des bundles publiés, sans jamais apparaître dans son
 * propre tarball — qui n'existe pas. Le restreindre aux publiables laisserait ce chemin sans
 * gardien. Mesuré le 09/08/2026 : l'élargissement ajoute 18 fichiers et **0 violation**, il ne
 * coûte donc rien aujourd'hui et ferme un chemin réel.
 * La seconde raison est instrumentale : elle rend la gate SONDABLE. La sonde
 * `probe-gate-visibility.cjs` plante un paquet `private: true` ; avec le filtre étroit, la
 * fixture aurait été invisible et l'assertion aurait passé au vert sans rien prouver.
 *
 * ## AST, jamais grep — et ce n'est pas une préférence de style
 *
 * Un relevé au grep sur ce même corpus remonte `@geoleaf-plugins/table` comme import non déclaré
 * de `@geoleaf/core` — c'est-à-dire une violation de la frontière que `CLAUDE.md` appelle non
 * négociable. **C'est un faux positif** : les cinq sites sont des `import('@geoleaf-plugins/table')`
 * à l'intérieur d'un `@example` TSDoc. Un stripper de commentaires suffirait, mais celui du dépôt
 * (`lib/test-load-sites.cjs`) blanchit aussi le CONTENU des chaînes — correct pour son usage,
 * fatal pour celui-ci, où la chaîne EST la donnée. Le lecteur TypeScript n'a ni l'un ni l'autre
 * défaut : il ne voit pas les commentaires, et il rend le specifier tel quel.
 *
 * ## Usage
 *
 *        node scripts/check-shipped-specifiers.cjs
 *        node scripts/check-shipped-specifiers.cjs --update-baseline
 *
 * ⚠️ Tourne APRÈS un build — le corpus est `dist/`. `--update-baseline` se lance APRÈS avoir
 * corrigé, jamais pour faire taire : chaque entrée doit porter son propriétaire dans
 * `_proprietaires`, faute de quoi la liste devient un permis au lieu d'un registre.
 * Ce champ est REPRIS du fichier à chaque régénération et élagué des specifiers soldés —
 * il l'était depuis un gabarit codé ici jusqu'au 10/08/2026, ce qui a silencieusement annulé
 * la correction de propriétaire écrite à la main au Sprint 2 (voir le bloc `if (UPDATE)`).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = registry.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "shipped-specifiers.json");
const UPDATE = process.argv.includes("--update-baseline");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
const err = (m) => console.error(`${C.r}${m}${C.x}`);
const dim = (m) => console.error(`${C.d}${m}${C.x}`);

/**
 * Planchers témoins — mesure du 09/08/2026 : 15 paquets contributeurs, 1 361 fichiers de corpus.
 *
 * Délibérément SOUS la mesure : ils détectent un EFFONDREMENT (corpus vide, registre qui cesse
 * d'énumérer, build absent), pas une unité en moins. Un plancher au ras de la mesure se
 * recliquette à chaque build et finit par être remonté sans qu'on y pense — c'est-à-dire désarmé.
 *
 * ⚠️ C'est ce plancher, et non une fixture, qui garde la CÉCITÉ AUX PAQUETS IMBRIQUÉS. 14 des 15
 * contributeurs vivent sous `packages/plugins/**` ou `packages/libs/**` : le jour où le registre
 * cesserait de les énumérer, `packagesScanned` tomberait à 1 et le plancher rougirait au lieu
 * d'annoncer « 0 fuite » sur un corpus amputé.
 */
const FLOOR = { packages: 12, files: 800 };

/** Extensions d'un module que TypeScript ou Node peuvent ouvrir. `.map` et `.css` sont hors sujet. */
const CODE_EXT = /\.(d\.[cm]?ts|[cm]?ts|[cm]?js)$/;

// ─── Corpus ──────────────────────────────────────────────────────────────────

/**
 * Toutes les cibles d'une carte `exports`, quelle qu'en soit la forme (chaîne, objet de
 * conditions, sous-chemins, tableaux de secours).
 *
 * @param {unknown} node Une valeur d'`exports`.
 * @param {string[]} [out] Accumulateur.
 * @returns {string[]} Les chemins relatifs cibles, `./` compris.
 */
function exportTargets(node, out = []) {
    if (typeof node === "string") {
        out.push(node);
    } else if (Array.isArray(node)) {
        for (const v of node) exportTargets(v, out);
    } else if (node && typeof node === "object") {
        for (const v of Object.values(node)) exportTargets(v, out);
    }
    return out;
}

/**
 * Les répertoires qu'un consommateur peut atteindre par la carte `exports`.
 *
 * On remonte à la RACINE de chaque cible (`./dist/types/index.d.ts` → `dist`) plutôt que de
 * suivre la clôture des imports : suivre la clôture ferait dépendre le corpus d'une résolution
 * qui, précisément, est ce qu'on met en doute. Prendre le répertoire est plus large, donc plus
 * sûr — une gate ne doit jamais rétrécir son corpus par raffinement.
 *
 * @param {object} manifest Le `package.json` du paquet.
 * @returns {Set<string>} Racines relatives, séparateurs POSIX (ex. `"dist"`).
 */
function reachableRoots(manifest) {
    const roots = new Set();
    for (const target of exportTargets(manifest.exports)) {
        if (typeof target !== "string" || !target.startsWith(".")) continue;
        const rel = target.replace(/^\.\//, "");
        const first = rel.split("/")[0];
        if (!first || first === "." || first === "..") continue;
        roots.add(first);
    }
    return roots;
}

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, out);
        else if (CODE_EXT.test(entry.name)) out.push(abs);
    }
    return out;
}

// ─── Lecture des specifiers ──────────────────────────────────────────────────

/**
 * Tous les specifiers de module d'un fichier, lus sur l'AST.
 *
 * Cinq formes portent un specifier, et les cinq comptent — un `.d.ts` n'en utilise pas les
 * mêmes qu'un bundle. `import("x").T` (`ImportTypeNode`) est la forme la plus facile à oublier :
 * c'est celle qu'émet `tsc` quand il inline un type importé.
 *
 * @param {string} file Chemin absolu.
 * @returns {string[]} Les specifiers, dans l'ordre de lecture.
 */
function specifiersOf(file) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, /* setParentNodes */ false);
    const found = [];
    const push = (node) => {
        if (node && ts.isStringLiteralLike(node)) found.push(node.text);
    };
    const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            push(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node)) {
            if (ts.isLiteralTypeNode(node.argument)) push(node.argument.literal);
        } else if (ts.isImportEqualsDeclaration(node)) {
            if (ts.isExternalModuleReference(node.moduleReference))
                push(node.moduleReference.expression);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
            push(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * Builtins sans préfixe `node:` — un paquet ne les déclare jamais.
 *
 * DÉRIVÉE de Node lui-même, jamais recopiée : une liste écrite à la main vieillit en silence,
 * et le jour où elle rate un nom la gate réclame une `dependencies` sur un module du cœur.
 */
const NODE_BUILTINS = new Set(require("node:module").builtinModules);

/**
 * L'équivalence DefinitelyTyped — `geojson` ⇐ `@types/geojson`.
 *
 * ## Pourquoi cette fonction existe, et ce qu'elle RÉPARE
 *
 * Mesuré le 10/08/2026 (B-212) : la gate comparait le specifier `geojson` aux CLÉS de
 * `dependencies`, où le paquet à déclarer s'appelle `@types/geojson`. Les deux chaînes ne
 * peuvent pas être égales — **le geste que le message d'erreur prescrivait ne pouvait donc
 * PAS faire verdir la gate**, et les 6 entrées de baseline seraient restées à demeure quoi
 * qu'on déclare. Ce n'est pas un assouplissement : c'est la règle de résolution que la gate
 * prétendait modéliser. `tsc` résout `import type { … } from "geojson"` en ouvrant
 * `node_modules/@types/geojson` — le contrat correct est donc bien `@types/geojson` en
 * `dependencies`, et c'est ce que cette fonction rend reconnaissable.
 *
 * ## 🛑 Ce qu'elle ne fait PAS, et pourquoi la restriction est le cœur de la règle
 *
 * Elle n'est consultée que pour les fichiers de DÉCLARATION. `@types/X` ne publie **aucun
 * runtime** : un `require("geojson")` dans un `.js` embarqué reste une violation, et il DOIT
 * le rester — sinon la ligne ci-dessous serait une échappatoire qui blanchirait, sur tout le
 * corpus, la classe même que SHIP-SPEC-01 existe pour attraper. La restriction est éprouvée
 * par mutation : un `.js` plantant `require("geojson")` dans un paquet qui déclare
 * `@types/geojson` fait rougir la gate (témoin anti-échappatoire, B-212).
 *
 * @param {string} name Nom de paquet (`"geojson"`, `"@scope/nom"`).
 * @returns {string} Le nom DefinitelyTyped correspondant (`"@types/geojson"`,
 *   `"@types/scope__nom"`) — la convention de nommage de DefinitelyTyped.
 */
function typesPackageOf(name) {
    return name.startsWith("@") ? `@types/${name.slice(1).replace("/", "__")}` : `@types/${name}`;
}

/** Un fichier de DÉCLARATION — le seul endroit où l'équivalence `@types/` vaut. */
const DECL_EXT = /\.d\.[cm]?ts$/;

/**
 * Le NOM DE PAQUET d'un specifier, ou `null` s'il n'en désigne aucun.
 *
 * @param {string} spec Specifier brut.
 * @returns {string|null} `"@scope/nom"`, `"nom"`, ou `null` (relatif, absolu, builtin, URL).
 */
function packageOf(spec) {
    if (!spec) return null;
    // `#imports` = imports internes (`package.json#imports`) : jamais un paquet du registre.
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) return null;
    // `node:fs`, `data:…`, `https://…` — un protocole, pas un paquet.
    if (/^[a-z][a-z0-9.+-]*:/i.test(spec)) return null;
    const parts = spec.split("/");
    const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (!name || NODE_BUILTINS.has(name)) return null;
    return name;
}

// ─── Balayage ────────────────────────────────────────────────────────────────

const privateWorkspaces = new Set(
    registry
        .all()
        .filter((p) => p.private)
        .map((p) => p.name)
);

/** @type {{code: string, key: string, message: string}[]} */
const violations02 = [];
/** @type {string[]} */
const found01 = [];
/** @type {Map<string, string>} clé 01 → message lisible. */
const detail01 = new Map();
/** @type {string[]} Paquets dont une racine atteignable manque sur le disque. */
const missingRoots = [];

let packagesScanned = 0;
let filesScanned = 0;
/** Fichiers EMBARQUÉS mais NON atteignables portant un specifier douteux — voir l'en-tête. */
let shippedUnreachable = 0;

for (const pkg of registry.all()) {
    const manifest = pkg.manifest;
    const declared = new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.peerDependencies || {}),
        ...Object.keys(manifest.optionalDependencies || {}),
    ]);

    const roots = reachableRoots(manifest);
    /** @type {string[]} */
    const corpus = [];
    for (const root of roots) {
        const abs = path.join(pkg.absDir, root);
        if (!fs.existsSync(abs)) {
            // Une cible d'`exports` peut être un FICHIER (`./package.json`) — normal.
            if (!/\.[a-z]+$/i.test(root)) missingRoots.push(`${pkg.dir}/${root}`);
            continue;
        }
        if (fs.statSync(abs).isDirectory()) corpus.push(...walk(abs));
    }
    if (corpus.length > 0) packagesScanned += 1;
    filesScanned += corpus.length;

    for (const file of corpus) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        for (const spec of new Set(specifiersOf(file))) {
            const name = packageOf(spec);
            if (!name || name === manifest.name) continue;

            if (privateWorkspaces.has(name)) {
                violations02.push({
                    code: "SHIP-SPEC-02",
                    key: `${rel} → ${name}`,
                    message:
                        `${rel}\n        importe \`${spec}\` — workspace \`private: true\`, ` +
                        `donc 404 sur le registre pour TOUJOURS.\n        Le déclarer en ` +
                        `\`dependencies\` ne répare rien : ça rendrait le paquet non installable.`,
                });
                continue;
            }
            // L'équivalence DefinitelyTyped, CONDITIONNÉE au fichier de déclaration —
            // voir `typesPackageOf` pour le motif et pour ce qu'elle refuse de couvrir.
            const viaTypes = DECL_EXT.test(file) && declared.has(typesPackageOf(name));

            if (!declared.has(name) && !viaTypes) {
                const key = `${rel} → ${name}`;
                found01.push(key);
                detail01.set(
                    key,
                    `${rel}\n        importe \`${spec}\` — \`${name}\` n'est ni dependency, ` +
                        `ni peerDependency, ni optionalDependency de ${manifest.name}` +
                        (DECL_EXT.test(file)
                            ? `,\n        et \`${typesPackageOf(name)}\` non plus.`
                            : `.`)
                );
            }
        }
    }

    // ── Le hors-corpus, compté et nommé (jamais bloquant ici) ────────────────
    const shippedRoots = new Set(
        (manifest.files || [])
            .filter((f) => typeof f === "string" && !f.startsWith("!"))
            .map((f) => f.replace(/^\.\//, "").replace(/\/$/, "").split("/")[0])
    );
    for (const root of shippedRoots) {
        if (roots.has(root)) continue;
        const abs = path.join(pkg.absDir, root);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
        for (const file of walk(abs)) {
            const suspect = [...new Set(specifiersOf(file))].some((spec) => {
                const name = packageOf(spec);
                return (
                    Boolean(name) &&
                    name !== manifest.name &&
                    (privateWorkspaces.has(name) || !declared.has(name))
                );
            });
            if (suspect) shippedUnreachable += 1;
        }
    }
}

// ─── SHIP-SPEC-03 — le plancher, AVANT tout verdict ──────────────────────────

if (missingRoots.length > 0) {
    err(
        `\n❌ [SHIP-SPEC-03] ${missingRoots.length} racine(s) atteignable(s) absente(s) du disque :`
    );
    for (const m of missingRoots) err(`     - ${m}`);
    dim("  Le corpus de cette gate est `dist/` : elle tourne APRÈS un build.");
    dim("  Lancer `npx turbo run build`, puis relancer. REFUSE DE CONCLURE.");
    process.exit(1);
}
if (packagesScanned < FLOOR.packages || filesScanned < FLOOR.files) {
    err(
        `\n❌ [SHIP-SPEC-03] corpus sous le plancher — ${packagesScanned} paquet(s) ` +
            `(plancher ${FLOOR.packages}), ${filesScanned} fichier(s) (plancher ${FLOOR.files}).`
    );
    dim("  Un « 0 fuite » depuis ce corpus serait vrai et vide de sens. REFUSE DE CONCLURE.");
    process.exit(1);
}

// ─── Régénération de la baseline ─────────────────────────────────────────────

if (UPDATE) {
    const entries = [...new Set(found01)].sort();

    // ── `_proprietaires` : REPRIS du fichier, jamais réécrit depuis un gabarit ──
    //
    // 🛑 Ce bloc était CODÉ EN DUR ici, et c'est un piège qui a mordu. Le Sprint 2 avait
    // corrigé à la main le propriétaire de la classe `geojson` DANS le JSON — le pointeur
    // « Sprint 2, tâches 2.3/2.6 » était faux, relu chez le destinataire. La première
    // régénération l'a silencieusement remplacé par le gabarit d'origine, donc par l'énoncé
    // faux : une correction documentaire annulée par un `--update-baseline`, sans un mot.
    // Un champ que l'outil réécrit ne peut pas porter un fait que l'humain corrige.
    //
    // Et la reprise seule ne suffirait pas : un propriétaire dont la dette est SOLDÉE
    // deviendrait un commentaire qui décrit un état disparu — exactement la classe que
    // `CLAUDE.md` §règle documentaire nomme. D'où l'élagage : un propriétaire ne survit
    // que tant qu'au moins une entrée le concerne.
    let proprietaires = {};
    if (fs.existsSync(BASELINE)) {
        try {
            const prev = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
            for (const [spec, motif] of Object.entries(prev._proprietaires || {})) {
                if (entries.some((e) => e.endsWith(`→ ${spec}`))) proprietaires[spec] = motif;
            }
        } catch (_e) {
            proprietaires = {}; // baseline illisible — on repart d'un registre vide, jamais d'un gabarit
        }
    }

    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment: [
                    "Specifiers NUS non déclarés, CONNUS, de SHIP-SPEC-01 — un permis daté, pas un droit acquis.",
                    "",
                    "⚠️ SHIP-SPEC-02 n'a PAS de baseline et n'en aura pas : un workspace `private` ne sera",
                    "jamais sur le registre, donc aucune entrée ne pourrait être autre chose qu'un renoncement.",
                    "",
                    "Cette liste ne peut que RÉTRÉCIR. Régénérer avec --update-baseline APRÈS correction,",
                    "jamais pour faire taire. Chaque entrée doit nommer son propriétaire ci-dessous —",
                    "`_proprietaires` est REPRIS de ce fichier à chaque régénération, et élagué des",
                    "specifiers qui n'ont plus d'entrée. Un motif écrit ici survit donc à l'outil.",
                    "",
                    "📌 Elle est tombée à ZÉRO le 10/08/2026 (B-212) : la classe `geojson` — 6 `.d.ts`",
                    "publiés d'editor, file-import et flatgeobuf — a été soldée en déclarant",
                    "`@types/geojson` en `dependencies` sur les trois manifestes. Une entrée qui",
                    "réapparaîtrait ici serait donc une RÉGRESSION, pas une première observation.",
                ],
                _proprietaires: proprietaires,
                _generated: "node scripts/check-shipped-specifiers.cjs --update-baseline",
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `✅ [SHIP-SPEC] baseline régénérée — ${new Set(found01).size} entrée(s) SHIP-SPEC-01.`
    );
    process.exit(0);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(BASELINE)) {
    err("\n❌ [SHIP-SPEC] baseline absente.");
    dim("  Une baseline absente n'est PAS une liste vide : ce serait déclarer propre");
    dim("  tout le corpus. Run: node scripts/check-shipped-specifiers.cjs --update-baseline");
    process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(found01);
const fresh = [...seen].filter((k) => !baseline.has(k)).sort();
const stale = [...baseline].filter((k) => !seen.has(k)).sort();

let failed = false;

if (violations02.length > 0) {
    failed = true;
    err(
        `\n❌ [SHIP-SPEC-02] ${violations02.length} fichier(s) atteignable(s) nomment un workspace PRIVÉ :`
    );
    for (const v of violations02) err(`     - ${v.message}`);
    dim("  Geste : remplacer le symbole importé par une déclaration LOCALE (interface ou");
    dim("  enveloppe à signature écrite). Ne pas dériver par `typeof` — ça re-référencerait");
    dim("  l'import, donc la fuite.");
}

if (fresh.length > 0) {
    failed = true;
    err(`\n❌ [SHIP-SPEC-01] ${fresh.length} specifier(s) NON DÉCLARÉ(S) et hors baseline :`);
    for (const k of fresh) err(`     - ${detail01.get(k)}`);
    dim("  Deux issues, et une seule est honnête selon le cas : déclarer le paquet dans");
    dim("  `dependencies`, ou cesser de l'importer depuis un fichier atteignable.");
    dim("  Pour un import de TYPE dans un `.d.ts`, le paquet à déclarer est `@types/<nom>` —");
    dim("  c'est ce que `tsc` ouvre, et la gate le reconnaît (jamais dans un `.js`).");
}

if (stale.length > 0) {
    failed = true;
    err(`\n❌ [SHIP-SPEC-01/cliquet] ${stale.length} entrée(s) de baseline PÉRIMÉE(S) :`);
    for (const k of stale) err(`     - ${k}`);
    dim("  La baseline est un registre de dette, pas un droit acquis : elle ne peut que");
    dim("  rétrécir. node scripts/check-shipped-specifiers.cjs --update-baseline");
}

if (failed) process.exit(1);

console.log(
    `✅ [SHIP-SPEC] ${filesScanned} fichier(s) atteignable(s) sur ${packagesScanned} paquet(s) du ` +
        `registre — 0 workspace privé (SHIP-SPEC-02), ${baseline.size} specifier(s) non ` +
        `déclaré(s) en baseline (SHIP-SPEC-01).`
);
console.log(
    `${C.d}   ${shippedUnreachable} fichier(s) EMBARQUÉ(S) mais non atteignable(s) par \`exports\` ` +
        `portent un specifier douteux — poids de tarball, pas fuite de types ; le sort de \`src/\` ` +
        `dans le tarball est tranché au Sprint 2 (tâches 2.10-2.12).${C.x}`
);
process.exit(0);
