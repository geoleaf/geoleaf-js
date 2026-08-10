#!/usr/bin/env node
/**
 * @fileoverview ESM-PURITY — aucun spécificateur NU ne doit survivre dans un `dist/`.
 *
 * ## Le défaut que cette garde attrape
 *
 * Un module publié qui porte `import … from 'gtfs-realtime-bindings'` est **irrésoluble en
 * navigateur** : sans import map, un spécificateur nu n'a pas d'URL. Le fichier se charge chez
 * l'intégrateur, et il casse — silencieusement pour la CI, bruyamment pour l'utilisateur.
 *
 * Le témoin historique était réel : `realtime-layer/dist/geoleaf-realtime-layer.gtfs-rt-BMaf7NPc.js`,
 * 3,3 Ko, référencé par rien, **copié tel quel dans les 4 variantes de `deploy/`**. Il a été
 * emporté depuis par `purge-dist.cjs`, ce qui rend cette garde impossible à voir rougir sur le
 * dépôt tel quel : son témoin se **fabrique** par mutation (cf. §Comment la voir rouge).
 *
 * ## La ligne de partage : `peerDependencies` OUI, `dependencies` NON
 *
 * Tout spécificateur nu n'est pas un défaut. `maplibre-gl` en est un cas légitime et voulu :
 * moteur WebGL **externe au bundle**, déclaré en `peerDependencies` du paquet ET en `external:`
 * du rollup (`packages/core/rollup.config.mjs`). L'intégrateur le fournit ; le laisser nu est
 * le contrat, pas l'accident.
 *
 * D'où l'allowlist, et sa forme exacte :
 *
 *   - **DÉRIVÉE**, jamais écrite en dur — les clés de `peerDependencies` lues sur le manifeste,
 *     via `packages.cjs` (qui **jette** si un paquet est introuvable). Un chemin en dur ne
 *     casse pas au déplacement : il cesse silencieusement de matcher, et la gate sort verte en
 *     n'ayant rien gardé. Classe surveillée par `probe-gate-visibility.cjs`.
 *   - **PAR PAQUET**, pas globale. `maplibre-gl` est tolérée dans les 6 paquets qui la
 *     déclarent, et refusée partout ailleurs. Une allowlist globale rendrait la déclaration
 *     décorative.
 *
 * Et c'est bien `peerDependencies` qui trace la ligne, pas `dependencies` : le témoin historique
 * `gtfs-realtime-bindings` est une **`dependencies`** de `realtime-layer`. Une dépendance
 * d'exécution qui fuit en spécificateur nu est exactement le défaut ; une paire déclarée en
 * `peer` est le contrat. La règle n'aurait pas laissé passer le témoin.
 *
 * ## Les trois règles
 *
 *   ESM-00   **Le corpus ne peut pas être vide.** Évaluée EN PREMIER, sur le patron de DIST-03
 *            (`check-dist-integrity.cjs`) : avant tout build il n'y a AUCUN `dist/`, et la gate
 *            sortirait verte en ne regardant rien. Une garde jamais vue rouge ne garde rien.
 *   ESM-00b  **Le corpus ne peut pas être PARTIEL.** Tout workspace déclarant un script `build`
 *            doit avoir produit au moins un `.js`. 🛑 Ajoutée le jour même de la pose, sur un
 *            incident réel : un `npm run build` lancé par une session concurrente a fait
 *            tourner cette gate pendant que `purge-dist.cjs` avait vidé les `dist/`, et elle
 *            est sortie **✅ verte sur 101 fichiers au lieu de 584** — 17 % du corpus, sans un
 *            mot. **ESM-00 ne pouvait pas le voir : 101 n'est pas 0.** Le critère est dérivé
 *            des manifestes, jamais un seuil en dur — un « au moins N » se périmerait au
 *            premier paquet ajouté et ne dirait pas LEQUEL manque.
 *   ESM-01   **Aucun spécificateur nu** dans un `import … from`, `export … from`, `import "x"`
 *            ou `import("x")` — hors allowlist du périmètre.
 *
 * ## Pourquoi un scanner, et pas un grep
 *
 * Un `grep` sur `from ['"]…` produit **deux faux positifs sur le dépôt tel quel**, tous deux
 * mesurés au pré-vol du 07/08/2026 :
 *
 *   1. `packages/core/dist/esm/capabilities/legend/legend.js:198` porte
 *      `* import maplibregl from "maplibre-gl";` — dans un `@example` **TSDoc**.
 *   2. `geoleaf-print.plugin.js` porte `"[GeoLeaf.Print] maplibre-gl global not found."` —
 *      dans une **chaîne de caractères**.
 *
 * Une gate bruyante apprend à être ignorée, ce qui est pire qu'une gate absente — le dépôt
 * l'a déjà écrit après l'incident `maplibre-layer-builders` de DIST-01. Le scanner ci-dessous
 * neutralise donc commentaires, chaînes et littéraux regex **avant** de chercher, et ne juge
 * que des positions d'import réelles. Ces deux occurrences sont, par construction, sa
 * non-régression permanente : elles vivent sur le disque, et un vert les traverse.
 *
 * ## Périmètre
 *
 * Dérivé de `packages.cjs` (`all()`), jamais d'un glob `packages/*​/dist` — qui ne matche ni
 * `packages/plugins/*` ni `packages/libs/*`. Marche **récursive** : le glob plat
 * `packages/*​/*​/dist/*.js` de l'énoncé d'origine laissait `packages/core/dist/esm/**` — la
 * moitié du livrable — hors champ. `deploy/` est scanné à part, avec l'**union** des
 * `peerDependencies` : une variante de déploiement est un assemblage de `dist/` de paquets,
 * elle hérite du contrat d'externals de ses sources.
 *
 * Seuls les `.js` sont lus : les `.d.ts` sont des déclarations (TypeScript résout les nus), et
 * il n'y a ni `.mjs` ni `.cjs` dans les `dist/`.
 *
 * ## Comment la voir rouge
 *
 * ```bash
 * # ① témoin d'ESM-01 — une `dependencies` qui fuit ⟹ sortie 1
 * echo "export * from 'gtfs-realtime-bindings';" > packages/plugins/realtime-layer/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/plugins/realtime-layer/dist/_witness.js
 *
 * # ② témoin de l'allowlist — la même paire, dans un paquet qui NE la déclare PAS ⟹ sortie 1
 * echo "export * from 'maplibre-gl';" > packages/plugins/realtime-layer/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/plugins/realtime-layer/dist/_witness.js
 *
 * # ③ contre-témoin — la même paire dans un paquet qui la déclare ⟹ sortie 0
 * echo "export * from 'maplibre-gl';" > packages/core/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/core/dist/_witness.js
 * ```
 *
 * ② et ③ vont par paire : c'est l'écart entre les deux qui prouve que l'allowlist est **par
 * paquet**. Une allowlist jamais éprouvée est indiscernable d'un `return true`.
 *
 * ```bash
 * # ④ témoin d'ESM-00b — un seul dist/ manquant ⟹ sortie 1, en nommant le paquet
 * mv packages/plugins/table/dist /tmp/d && node scripts/verify-esm-purity.cjs
 * mv /tmp/d packages/plugins/table/dist
 * ```
 *
 * @see scripts/check-dist-integrity.cjs — DIST-03, le patron de l'anti-gate-vide
 * @see scripts/check-subpath-resolve.cjs — écarte les nus (« not ours to check ») ; c'est ce
 *   trou que cette gate ferme
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) § Sprint 2, tâche 2.1′
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const ROOT = packages.ROOT;

/** Mots-clés après lesquels un `/` ouvre un littéral regex, jamais une division. */
const REGEX_AFTER_KEYWORD =
    /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Un `/` ouvre-t-il un littéral regex, ou est-ce une division ?
 *
 * L'heuristique standard : après une valeur (identifiant, littéral, `)`, `]`, `}`) c'est une
 * division ; après un opérateur, un séparateur ou un mot-clé, c'est une regex. Se tromper est
 * sans conséquence sur le verdict — au pire un littéral regex est lu comme du code, et il
 * faudrait qu'il contienne une position d'import complète pour produire un faux positif.
 *
 * @param {string} maskedSoFar Le texte déjà neutralisé, dont on lit la queue.
 * @returns {boolean}
 */
function opensRegex(maskedSoFar) {
    const t = maskedSoFar.replace(/\s+$/, "");
    if (t === "") return true;
    if ("([{,;:=!&|?+-*%~^<>".includes(t[t.length - 1])) return true;
    return REGEX_AFTER_KEYWORD.test(t);
}

/**
 * Neutralise commentaires, chaînes et littéraux regex, en préservant les offsets.
 *
 * Le texte rendu a **exactement la même longueur** que l'entrée : chaque caractère neutralisé
 * devient une espace (ou un `x` dans le corps d'une chaîne, pour que la position des guillemets
 * reste lisible), et les `\n` sont conservés pour que le calcul de ligne reste juste. C'est
 * cette conservation des offsets qui permet de retrouver la valeur réelle d'une chaîne à partir
 * de la position de son guillemet ouvrant.
 *
 * ⚠️ Limite connue et assumée : un `${…}` de gabarit est traité comme du corps de chaîne. Un
 * `import` vivant à l'intérieur d'une interpolation ne serait pas vu. Le cas n'existe pas dans
 * une sortie de bundler, et l'erreur va dans le sens du silence, pas du bruit.
 *
 * @param {string} text Source d'un fichier `.js`.
 * @returns {{masked: string, strings: Map<number, string>}} Le texte neutralisé, et les valeurs
 *   littérales des chaînes indexées par la position de leur guillemet ouvrant.
 */
function neutralise(text) {
    /** @type {Map<number, string>} */
    const strings = new Map();
    let masked = "";
    let i = 0;
    const n = text.length;

    while (i < n) {
        const c = text[i];
        const c2 = i + 1 < n ? text[i + 1] : "";

        // Commentaire de ligne.
        if (c === "/" && c2 === "/") {
            while (i < n && text[i] !== "\n") {
                masked += " ";
                i++;
            }
            continue;
        }

        // Commentaire de bloc — c'est lui qui porte le TSDoc, donc le faux positif n° 1.
        if (c === "/" && c2 === "*") {
            masked += "  ";
            i += 2;
            while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
                masked += text[i] === "\n" ? "\n" : " ";
                i++;
            }
            if (i < n) {
                masked += "  ";
                i += 2;
            }
            continue;
        }

        // Littéral regex — consommé en bloc, sinon un `"` ou un `//` à l'intérieur ferait
        // dérailler le scanner sur TOUT le reste du fichier.
        if (c === "/" && opensRegex(masked)) {
            masked += " ";
            i++;
            let inClass = false;
            while (i < n) {
                const r = text[i];
                if (r === "\\") {
                    masked += "  ";
                    i += 2;
                    continue;
                }
                if (r === "\n") break; // regex non terminée : on rend la main plutôt que tout avaler
                if (r === "[") inClass = true;
                else if (r === "]") inClass = false;
                else if (r === "/" && !inClass) break;
                masked += " ";
                i++;
            }
            if (i < n && text[i] === "/") {
                masked += " ";
                i++;
            }
            continue;
        }

        // Chaîne — c'est elle qui porte le faux positif n° 2.
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            const openedAt = i;
            let value = "";
            masked += quote;
            i++;
            while (i < n && text[i] !== quote) {
                if (text[i] === "\\") {
                    value += text[i] + (i + 1 < n ? text[i + 1] : "");
                    masked += i + 1 < n ? "xx" : "x";
                    i += 2;
                    continue;
                }
                value += text[i];
                masked += text[i] === "\n" ? "\n" : "x";
                i++;
            }
            if (i < n) {
                masked += quote;
                i++;
            }
            strings.set(openedAt, value);
            continue;
        }

        masked += c;
        i++;
    }

    return { masked, strings };
}

/**
 * Les positions d'import d'un fichier, avec le spécificateur réellement écrit.
 *
 * Les deux motifs couvrent les quatre formes ESM : `import … from "x"`, `export … from "x"`,
 * `import "x"` (effet de bord) et `import("x")` (dynamique). Ils sont cherchés dans le texte
 * NEUTRALISÉ, donc jamais dans un commentaire ni dans une chaîne ; la valeur, elle, se relit
 * dans la table des chaînes à la position du guillemet.
 *
 * @param {string} text Source d'un fichier `.js`.
 * @returns {{spec: string, line: number}[]}
 */
function specifiers(text) {
    const { masked, strings } = neutralise(text);

    // Offsets de début de ligne, pour rendre un numéro de ligne cliquable.
    const lineStarts = [0];
    for (let k = 0; k < masked.length; k++) if (masked[k] === "\n") lineStarts.push(k + 1);
    const lineOf = (idx) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= idx) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };

    /** @type {{spec: string, line: number}[]} */
    const out = [];
    const patterns = [/\bfrom\s*["']/g, /\bimport\s*\(?\s*["']/g];

    for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(masked)) !== null) {
            const quoteAt = m.index + m[0].length - 1;
            const spec = strings.get(quoteAt);
            if (spec === undefined) continue; // pas une chaîne reconnue : on ne devine pas
            out.push({ spec, line: lineOf(quoteAt) });
        }
    }
    return out;
}

/**
 * Un spécificateur est-il NU ?
 *
 * Nu = ni relatif (`./`, `../`), ni absolu (`/`), ni URL absolue. Tout le reste demande une
 * résolution que le navigateur ne sait pas faire sans import map — y compris `node:fs`, qui
 * dans un bundle navigateur est un défaut et non un cas limite.
 *
 * @param {string} spec
 * @returns {boolean}
 */
function isBare(spec) {
    if (spec.startsWith(".") || spec.startsWith("/")) return false;
    if (/^(https?|data|blob):/.test(spec)) return false;
    return true;
}

/**
 * Scanne récursivement un `dist/` et rend les violations d'ESM-01.
 *
 * @param {string} label Nom lisible du périmètre.
 * @param {string} distDir Chemin absolu du `dist/`.
 * @param {Set<string>} allow Spécificateurs nus tolérés — les `peerDependencies` du périmètre.
 * @returns {{label: string, scanned: number, allow: string[], violations: object[]}}
 */
function analyse(label, distDir, allow) {
    const violations = [];
    let scanned = 0;

    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const q = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(q);
                continue;
            }
            if (!e.name.endsWith(".js")) continue;
            scanned++;
            for (const { spec, line } of specifiers(fs.readFileSync(q, "utf8"))) {
                if (!isBare(spec) || allow.has(spec)) continue;
                violations.push({ file: path.relative(ROOT, q), line, spec });
            }
        }
    })(distDir);

    return { label, scanned, allow: [...allow].sort(), violations };
}

// ── Périmètres ────────────────────────────────────────────────────────────────
// Un par paquet, avec SES peerDependencies ; puis un par variante de `deploy/`, avec l'union.

/** @type {object[]} */
const results = [];
/** @type {Set<string>} */
const unionPeers = new Set();

for (const p of packages.all()) {
    for (const k of Object.keys(p.manifest.peerDependencies || {})) unionPeers.add(k);
}

/** Paquets qui déclarent un `build` mais dont le `dist/` ne contient aucun `.js`. */
const notBuilt = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    const declaresBuild = Boolean(p.manifest.scripts && p.manifest.scripts.build);

    if (!fs.existsSync(dist)) {
        if (declaresBuild) notBuilt.push(`${p.name} — aucun dist/`);
        continue;
    }

    const r = analyse(p.name, dist, new Set(Object.keys(p.manifest.peerDependencies || {})));
    if (declaresBuild && r.scanned === 0) notBuilt.push(`${p.name} — dist/ sans aucun .js`);
    results.push(r);
}

const deployRoot = path.join(ROOT, "deploy");
if (fs.existsSync(deployRoot)) {
    for (const variant of fs.readdirSync(deployRoot)) {
        const dist = path.join(deployRoot, variant, "dist");
        if (!fs.existsSync(dist)) continue;
        results.push(analyse("deploy/" + variant, dist, unionPeers));
    }
}

// ── Verdict ───────────────────────────────────────────────────────────────────

const totalScanned = results.reduce((n, r) => n + r.scanned, 0);
const offenders = results.filter((r) => r.violations.length);

const BAR = "─".repeat(72);
console.log(BAR);

let failed = false;

// ESM-00 — anti-gate-vide, évaluée EN PREMIER : sans elle, un dépôt jamais buildé sort vert
// en n'ayant rien regardé, ce qui est le résultat le plus trompeur possible.
if (totalScanned === 0) {
    console.error("❌ [ESM-00] corpus VIDE — aucun fichier .js scanné dans aucun dist/.");
    console.error("   Une gate verte qui n'a rien scanné ne garde rien. Lancer un build d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

// ESM-00b — corpus PARTIEL. Le zéro absolu n'est pas le seul silence possible, et ce n'est
// même pas le plus probable.
//
// 🛑 Observé le 07/08/2026, le jour de la pose : un `npm run build` lancé en parallèle par une
// autre session a fait tourner cette gate pendant que `purge-dist.cjs` avait vidé les `dist/`
// et que turbo reconstruisait. Elle est sortie **✅ verte sur 101 fichiers au lieu de 584** —
// 17 % du corpus, sans un mot. ESM-00 ne pouvait pas le voir : 101 n'est pas 0.
//
// Le critère est donc DÉRIVÉ, pas un seuil : tout workspace qui déclare un script `build` doit
// avoir produit au moins un `.js`. Un chiffre en dur (« au moins N fichiers ») se périmerait au
// premier paquet ajouté, et ne dirait pas LEQUEL manque.
if (notBuilt.length) {
    console.error(
        "❌ [ESM-00b] corpus PARTIEL — des paquets déclarent `build` sans avoir produit :"
    );
    for (const n of notBuilt) console.error(`     ${n}`);
    console.error("   La gate ne peut pas répondre pour ce qu'elle n'a pas lu. Builder d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

for (const r of offenders) {
    failed = true;
    console.error(
        `❌ [ESM-01] ${r.label} — spécificateur(s) NU(S), irrésoluble(s) en navigateur :`
    );
    for (const v of r.violations) {
        console.error(`     ${v.file}:${v.line} → ${JSON.stringify(v.spec)}`);
    }
    console.error(
        `     Toléré ici : ${r.allow.length ? r.allow.join(", ") : "(aucune peerDependency déclarée)"}`
    );
}

if (failed) {
    // Le remède n'est imprimé que s'il RÉPOND à ce qui a échoué. ESM-00 porte déjà le sien
    // (« lancer un build ») ; lui accoler celui d'ESM-01 offrirait de déclarer une
    // peerDependency à quelqu'un dont le seul tort est de n'avoir rien buildé. Une gate qui
    // conseille à côté apprend à être ignorée, ce que ce fichier existe pour éviter.
    if (offenders.length) {
        console.error("");
        console.error("   Deux issues, et une seule est la bonne selon le cas :");
        console.error("     • la paire est un EXTERNAL voulu  → la déclarer en `peerDependencies`");
        console.error("       du paquet ET en `external:` de son rollup — l'allowlist en dérive.");
        console.error("     • sinon, c'est une fuite          → la bundler, ou couper l'import.");
    }
    console.error(BAR);
    process.exit(1);
}

console.log(
    `✅ [ESM-PURITY] ${totalScanned} fichier(s) .js scanné(s) sur ${results.length} périmètre(s) — ` +
        `0 spécificateur nu hors allowlist (${unionPeers.size} paire(s) déclarée(s) en peer).`
);
console.log(BAR);
