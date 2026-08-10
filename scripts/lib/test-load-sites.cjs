#!/usr/bin/env node
/**
 * test-load-sites.cjs — l'inventaire des `require()` de source dans les tests.
 *
 * ## Pourquoi ce module existe
 *
 * `verify-test-load-mode.cjs` (le gate du S1) et `audit-test-load-conversion.cjs`
 * (l'instrument des S2 à S5) posent la MÊME question — quels tests chargent une source
 * par `require()` — et en portaient chacun leur réponse. Elles ont divergé : au S2, le
 * classifieur qui range un fichier en « mécanique » a dû être corrigé **dans les deux
 * scripts** (`vi.isolateModules` comptait comme mécanique alors qu'il recharge un module).
 *
 * Une seconde divergence de ce genre n'est pas hypothétique, elle est déjà arrivée. La
 * définition vit donc ici, en un seul endroit.
 *
 * ## Ce qui compte comme un site, et ce qui n'en est pas un
 *
 * Un site est un `require()` dont le specifier résout vers un **module source `.ts` réel**.
 * Un `require()` de fixture, de mock ou de paquet npm ne charge aucune source mesurée : il
 * ne peut pas fausser d'attribution de couverture, et il est rapporté à part.
 *
 * Deux formes de specifier :
 *   - **relatif** (`./x.js`, `../x.ts`) — résolu depuis le fichier qui le porte ;
 *   - **nu** (`@core/…`, `@core-offline/…`) — résolu par les `paths` du tsconfig du paquet.
 *
 * ⚠️ **La forme nue était invisible aux deux scripts jusqu'au S5.** Mesuré le 22/07 :
 * 22 sites nus dans `plugin-addpoi` et `plugin-storage`, dont **7 chargent de la vraie
 * source du core** — donc 7 sites de fausse attribution que la baseline ne comptait pas, et
 * un fichier de test entier (`cache-workflow-cross.integration.test.js`) absent de
 * l'inventaire parce qu'il n'emploie QUE des specifiers nus.
 *
 * ## Limite assumée
 *
 * La détection est **syntaxique**. Un `require()` dont le specifier est construit à
 * l'exécution (`require(base + name)`), ainsi que `createRequire()` et `module.require()`,
 * lui échappent. Aucun site de cette forme n'est connu ; le backlog B.3 le vérifie
 * repo-wide. Une limite écrite vaut mieux qu'une exhaustivité affirmée.
 *
 * Elle ne distingue pas non plus un `require()` de code d'un `require()` cité **dans un
 * commentaire** — `storage-helper-validation.test.js:12` en contient un. Comportement repris
 * tel quel du gate du S1, dont il reproduit le compte à l'unité (276 sites relatifs) : le
 * corriger changerait la baseline, ce qui est une décision, pas un détail d'implémentation.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Un fichier de test, au sens des configs Vitest du dépôt.
 *
 * ⚠️ `setup.js` et les helpers n'en sont PAS : ils ne sont pas collectés par Vitest comme
 * suites, et les compter mêlerait deux questions distinctes (l'attribution de couverture,
 * et la règle « ESM pur » de `CLAUDE.md`).
 */
const TEST_FILE_RE = /\.test\.(js|ts)$/;

/** Répertoires jamais parcourus. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

/**
 * Tous les fichiers de test d'un répertoire, récursivement.
 *
 * @param {string} dir Répertoire de départ.
 * @param {string[]} [out] Accumulateur.
 * @returns {string[]} Chemins absolus.
 */
function walkTests(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walkTests(full, out);
        } else if (TEST_FILE_RE.test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Lit un `tsconfig.json` tolérant aux commentaires, au BOM et aux virgules traînantes.
 *
 * ⚠️ Les tsconfig du dépôt ne sont PAS du JSON strict : ils portent des commentaires (et
 * `plugin-addpoi/tsconfig.json` un tableau `_comment` de 20 lignes). Un `require()` direct
 * casse dessus. Le stripping ignore ce qui se trouve dans une chaîne, sans quoi un chemin
 * contenant `//` serait mutilé.
 *
 * @param {string} file Chemin absolu du tsconfig.
 * @returns {object} Le tsconfig analysé.
 */
function readJsonc(file) {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    let out = "";
    let inStr = false;
    let quote = "";
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        const next = raw[i + 1];
        if (inStr) {
            out += c;
            if (c === "\\") {
                out += next ?? "";
                i++;
            } else if (c === quote) {
                inStr = false;
            }
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            quote = c;
            out += c;
            continue;
        }
        if (c === "/" && next === "/") {
            while (i < raw.length && raw[i] !== "\n") i++;
            out += "\n";
            continue;
        }
        if (c === "/" && next === "*") {
            i += 2;
            while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
            i++;
            continue;
        }
        out += c;
    }
    // Virgules traînantes : légales en tsconfig, refusées par JSON.parse.
    out = out.replace(/,(\s*[}\]])/g, "$1");
    try {
        return JSON.parse(out);
    } catch (err) {
        throw new Error(`test-load-sites: ${path.relative(ROOT, file)} illisible — ${err.message}`);
    }
}

/** Mémoïsation des `paths` par paquet : le tsconfig ne bouge pas pendant un run. */
const pathsCache = new Map();

/**
 * Les `compilerOptions.paths` d'un paquet, aplatis en couples préfixe → répertoires.
 *
 * L'héritage (`extends`) est suivi, parce que les `paths` peuvent venir de
 * `@geoleaf/build-config/tsconfig.base.json`. Un `extends` irrésolu n'est pas une erreur :
 * il signifie seulement qu'il n'y a rien de plus à hériter.
 *
 * @param {object} pkg Entrée de registre (`lib/packages.cjs`).
 * @returns {{prefix: string, targets: string[], wildcard: boolean}[]} Règles, plus spécifiques d'abord.
 */
function tsconfigPaths(pkg) {
    if (pathsCache.has(pkg.absDir)) return pathsCache.get(pkg.absDir);

    /** @type {Map<string, {targets: string[], base: string}>} */
    const merged = new Map();

    let file = path.join(pkg.absDir, "tsconfig.json");
    const seen = new Set();
    while (file && fs.existsSync(file) && !seen.has(file)) {
        seen.add(file);
        const cfg = readJsonc(file);
        const dir = path.dirname(file);
        for (const [k, v] of Object.entries(cfg.compilerOptions?.paths ?? {})) {
            // Le plus proche gagne : un parent ne réécrit pas une règle déjà posée.
            if (!merged.has(k)) merged.set(k, { targets: v, base: dir });
        }
        const ext = cfg.extends;
        if (!ext) break;
        try {
            file = ext.startsWith(".")
                ? path.resolve(dir, ext)
                : require.resolve(ext, { paths: [dir] });
        } catch {
            break;
        }
    }

    const rules = [...merged.entries()]
        .map(([prefix, { targets, base }]) => ({
            prefix,
            wildcard: prefix.includes("*"),
            targets: targets.map((t) => path.resolve(base, t)),
        }))
        // Le plus long préfixe d'abord : `@core/utils/general/*` doit battre `@core/utils/*`.
        .sort((a, b) => b.prefix.replace("*", "").length - a.prefix.replace("*", "").length);

    pathsCache.set(pkg.absDir, rules);
    return rules;
}

/**
 * Un chemin candidat désigne-t-il un module source `.ts` réel ?
 *
 * ⚠️ **`.ts` seulement.** Un `.js` d'un `src/` (il en existe un : `sw-core.js`) n'est pas
 * instrumenté comme source TypeScript et ne relève pas du défaut d'attribution. L'inclure
 * gonflerait la dette d'un site qu'aucune conversion ne réparerait.
 *
 * @param {string} base Chemin absolu sans extension garantie.
 * @returns {string|null}
 */
function asSourceTs(base) {
    for (const c of [
        base,
        base.replace(/\.js$/, ".ts"),
        `${base}.ts`,
        path.join(base, "index.ts"),
    ]) {
        if (c.endsWith(".ts") && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

/**
 * Résout un specifier de test vers un module source `.ts` réel.
 *
 * @param {string} fromFile Fichier qui porte le specifier (absolu).
 * @param {string} spec Specifier, tel qu'écrit.
 * @param {object} [pkg] Paquet propriétaire — requis pour résoudre un specifier NU.
 * @returns {{abs: string, kind: "relative"|"bare"}|null} `null` si ce n'est pas une source.
 */
function resolveSource(fromFile, spec, pkg) {
    if (spec.startsWith(".")) {
        const abs = asSourceTs(path.resolve(path.dirname(fromFile), spec));
        return abs ? { abs, kind: "relative" } : null;
    }
    if (!pkg) return null;

    for (const rule of tsconfigPaths(pkg)) {
        if (rule.wildcard) {
            const [head, tail = ""] = rule.prefix.split("*");
            if (!spec.startsWith(head) || !spec.endsWith(tail)) continue;
            const middle = spec.slice(head.length, spec.length - tail.length);
            for (const t of rule.targets) {
                const abs = asSourceTs(t.replace("*", middle));
                if (abs) return { abs, kind: "bare" };
            }
        } else if (spec === rule.prefix) {
            for (const t of rule.targets) {
                const abs = asSourceTs(t);
                if (abs) return { abs, kind: "bare" };
            }
        }
    }
    return null;
}

/**
 * Neutralise les `vi.mock("…")` avant analyse.
 *
 * **Déclarer un mock ne charge pas le module réel.** C'est l'oubli de ce détail qui a fait
 * annoncer « 139 modules » à l'entrée B.46 là où il y en a 79 : le compte incluait les
 * cibles de `vi.mock()`.
 *
 * @param {string} src Source du fichier de test.
 * @returns {string}
 */
function scrubMocks(src) {
    return src.replace(/vi\.mock\(\s*(['"])[^'"]*\1/g, "vi.mock(MOCKED");
}

/**
 * Retire commentaires et contenu de chaînes, en scannant plutôt qu'en regexant.
 *
 * Une regex ne sait pas distinguer `// commentaire` de `"https://…"`, ni un `/*` cité dans
 * une chaîne d'un vrai bloc. Le scanner suit l'état du source (chaîne simple / double /
 * gabarit / commentaire) et rend un texte de **même longueur**, les zones neutralisées
 * remplacées par des espaces — les numéros de ligne et les décalages restent valides.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
    const out = src.split("");
    const blank = (from, to) => {
        for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
    };
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (c === "/" && d === "/") {
            const end = src.indexOf("\n", i);
            blank(i, end === -1 ? src.length : end);
            i = end === -1 ? src.length : end;
        } else if (c === "/" && d === "*") {
            const end = src.indexOf("*/", i + 2);
            const stop = end === -1 ? src.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            let j = i + 1;
            while (j < src.length) {
                if (src[j] === "\\") j += 2;
                else if (src[j] === quote) break;
                else j += 1;
            }
            blank(i + 1, Math.min(j, src.length));
            i = Math.min(j + 1, src.length);
        } else {
            i += 1;
        }
    }
    return out.join("");
}

/**
 * La famille de conversion d'un fichier de test — c'est elle qui range un fichier dans un
 * sprint plutôt qu'un autre, et elle doit rester UNE seule définition.
 *
 * ⚠️ `vi.isolateModules` compte avec `resetModules` : même geste, recharger dans un
 * registre neuf. Les ranger en « mécanique » a été une erreur du gate du S1, corrigée au
 * S2 (2.5) — dans deux scripts à la fois, ce que ce module existe pour empêcher.
 *
 * ⚠️ **Le classement se fait sur le source SANS commentaires**, et c'est une correction du
 * S4. `app/helpers.test.js` portait « Re-require in each describe via vi.isolateModules() »
 * dans un commentaire, sans un seul appel : il était rangé « reload », compté au périmètre
 * du sprint 4, et le harnais `--prove-reload` lui a fabriqué une sonde qui ne neutralisait
 * rien. Retirer ce commentaire en convertissant a fait rougir le contrôle — sur un fichier
 * parfaitement converti. Trois fichiers du dépôt changent de famille une fois les
 * commentaires retirés.
 *
 * ⚠️ La limite écrite en tête de module — « elle ne distingue pas un `require()` cité dans
 * un commentaire » — reste vraie pour {@link collectSites}, et **volontairement** : le
 * corriger déplacerait la baseline du S1, ce qui est une décision et non un détail. Ici, le
 * classement ne nourrit aucune baseline : il ne décide que du sprint propriétaire.
 *
 * @param {string} src Source du fichier de test.
 * @returns {"reload"|"mock"|"mechanical"}
 */
function classify(src) {
    const code = stripComments(src);
    if (/resetModules|isolateModules/.test(code)) return "reload";
    if (/vi\.mock\(/.test(code)) return "mock";
    return "mechanical";
}

/** Capture un `require("…")` et son specifier, quelle qu'en soit la forme. */
const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/;

/**
 * Capture un `require(`…${x}…`)` — specifier CONSTRUIT à l'exécution.
 *
 * ⚠️ Cette forme était déclarée « limite connue, aucun site observé ». **C'était faux** :
 * `geojson/geojson-core.test.js` boucle sur 9 modules source du core par
 * `` require(`../../src/kernel/${subModule}`) ``. Neuf sites de fausse attribution qu'aucun
 * inventaire ne comptait — ni la baseline, ni le triage.
 *
 * On ne cherche PAS à les résoudre : il faudrait évaluer la boucle. On les rend
 * **visibles**, pour qu'ils cessent d'être hors de tout compte et qu'un site neuf de cette
 * forme ne passe pas inaperçu. Leur conversion relève des sprints 3 et 4.
 */
const REQUIRE_TEMPLATE_RE = /require\(\s*`([^`]*)`\s*\)/;

/** Modules du cœur de Node : jamais des sources du dépôt. */
const NODE_BUILTINS = /^(node:)?(module|fs|path|url|util|os|crypto|child_process|assert)$/;

/**
 * Tous les sites `require()` des tests d'un paquet.
 *
 * @param {object} pkg Entrée de registre.
 * @returns {{file: string, spec: string, mod: string|null, kind: string, line: number,
 *            deferred: boolean, family: string}[]}
 */
function collectSites(pkg) {
    const sites = [];
    for (const tf of walkTests(pkg.absDir)) {
        const raw = fs.readFileSync(tf, "utf8");
        const family = classify(raw);
        scrubMocks(raw)
            .split("\n")
            .forEach((line, i) => {
                const tpl = line.match(REQUIRE_TEMPLATE_RE);
                if (tpl) {
                    sites.push({
                        file: path.relative(ROOT, tf).split(path.sep).join("/"),
                        spec: "`" + tpl[1] + "`",
                        mod: null,
                        kind: "dynamic",
                        line: i + 1,
                        deferred: /^\s/.test(line),
                        family,
                    });
                    return;
                }
                const m = line.match(REQUIRE_RE);
                if (!m) return;
                const spec = m[2];
                if (NODE_BUILTINS.test(spec)) return;
                const hit = resolveSource(tf, spec, pkg);
                sites.push({
                    file: path.relative(ROOT, tf).split(path.sep).join("/"),
                    spec,
                    mod: hit ? path.relative(ROOT, hit.abs).split(path.sep).join("/") : null,
                    kind: hit ? hit.kind : spec.startsWith(".") ? "relative" : "bare",
                    line: i + 1,
                    // Indentation = le `require` est dans un hook, un `describe` ou un `it`,
                    // donc DIFFÉRÉ. Heuristique, mais dérivée du source et non d'une lecture.
                    deferred: /^\s/.test(line),
                    family,
                });
            });
    }
    return sites;
}

module.exports = {
    ROOT,
    walkTests,
    readJsonc,
    tsconfigPaths,
    resolveSource,
    scrubMocks,
    stripComments,
    classify,
    collectSites,
    REQUIRE_RE,
    REQUIRE_TEMPLATE_RE,
};
