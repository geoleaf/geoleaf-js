#!/usr/bin/env node
/**
 * @fileoverview JS-TEST-DEBT — le cliquet qui empêche la dette D-23 / D-24 de grossir, et
 * la garde qui empêche sa conversion de perdre un test EN SILENCE.
 *
 * ## Pourquoi cette gate existe, et pourquoi elle n'existait pas
 *
 * `dette_technique.md` § D-23 l'écrit noir sur blanc depuis le 31/07/2026 :
 *
 *     « Ce qui empêche la dette de grossir : RIEN, et c'est assumé. […] Le geste qui
 *       rendrait ce coût réellement plat est connu — un cliquet à baseline décroissante
 *       sur le nombre de fichiers de test `.js`, sur le patron de NONNULL-ASSERTION-DEBT /
 *       EXACT-OPTIONAL-DEBT, vu rougir avant d'être cru. Il n'a pas été posé. »
 *
 * Il l'est ici. Et la dérive qu'il gèle n'est pas hypothétique : D-24 mesure le core à
 * **431 le 24/07**, **447 le 31/07**, et le pré-vol de S5c à **457 le 05/08** — soit
 * +10 en cinq jours, pendant que la ligne de registre disait « ~2 fichiers par jour ».
 *
 * ## 🛑 La règle qui compte n'est PAS le compteur — c'est JTD-04
 *
 * Un cliquet sur un nombre de fichiers a un mode d'échec qui le retourne contre lui-même,
 * et il est **mesuré** dans ce dépôt :
 *
 *     `packages/plugins/offline-ui/vitest.config.ts:37` déclare
 *     `include: ["**​/__tests__/**​/*.test.js"]` — l'extension est dans le motif.
 *
 * Renommer `a.test.js` en `a.test.ts` sans toucher au config rend le fichier **invisible à
 * vitest**. La suite reste **verte avec un test de moins**, la baseline **rétrécit**, et le
 * cliquet applaudit une régression. C'est exactement la classe « une garde jamais vue rouge
 * ne garde rien », appliquée à la garde elle-même.
 *
 * D'où **JTD-04**, sans baseline et sans exception : tout fichier de test présent sur le
 * disque doit être **collecté par au moins un config vitest de son paquet**. C'est la seule
 * règle d'ici qui protège la conversion ; les trois autres ne protègent que son rythme.
 *
 * ## Les quatre règles
 *
 *   JTD-04  **Zéro test orphelin de collecte** — chaque `*.test.*` / `*.spec.*` doit être
 *           matché par le `include` d'un config vitest du paquet, et non retiré par son
 *           `exclude`. Pas de baseline, par construction : un test non collecté ne prouve
 *           rien, et rien d'autre dans le dépôt ne le voit.
 *   JTD-01  Un fichier de test `.js` ne peut pas NAÎTRE en dette. Absent de la baseline
 *           ⟹ erreur.
 *   JTD-02  La baseline ne peut que RÉTRÉCIR. Une entrée sans fichier sur le disque est une
 *           erreur tant qu'elle n'est pas retirée.
 *   JTD-03  Le corpus ne peut pas être vide. Une gate verte qui n'a rien scanné est le pire
 *           des résultats (même classe que NNA-03 et EOD-03).
 *
 * ## Trois décisions de conception
 *
 * **Le périmètre vient du registre** (`scripts/lib/packages.cjs`), jamais d'un glob
 * `packages/<nom>` en dur ni de `packages/*​/src` — qui ne matche NI `packages/plugins/*` NI
 * `packages/libs/*`, donc mettrait la totalité des plugins hors compteur sans que rien ne
 * rougisse. Classe surveillée par `probe-gate-visibility.cjs`.
 *
 * **Le motif par défaut est DÉRIVÉ de `build-config/vitest/base.mjs`, pas recopié ici.**
 * Onze paquets sur seize n'ont aucun `include` local et héritent de la fabrique commune.
 * Recopier `"**​/__tests__/**​/*.test.ts"` dans ce fichier en ferait une valeur à deux
 * domiciles, donc une divergence qui attend son heure.
 *
 * **La dette compte les SUITES, pas les fichiers de support.** `*.test.js` et `*.spec.js`
 * seuls, pour que le chiffre reste comparable à D-23 et D-24, qui comptent la même chose.
 * Les `__mocks__/` et helpers `.js` sont **imprimés à part** : ils font partie du coût réel
 * d'une conversion — le précédent `3125e0f6` a dû remplacer `config-harness.js` — mais les
 * additionner rendrait le compteur incomparable aux deux lignes de registre qu'il sert.
 *
 * ## Usage
 *
 *        node scripts/check-js-test-debt.cjs
 *        node scripts/check-js-test-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` se lance APRÈS avoir converti un lot, jamais pour faire taire un
 * fichier neuf — qui doit être écrit en TypeScript, pas gelé. Et il ne peut RIEN pour
 * JTD-04, qui n'a pas de baseline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "js-test-debt.json");
const BASE_CONFIG = path.join(ROOT, "packages", "build-config", "vitest", "base.mjs");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".turbo", ".vite"]);
const SUITE_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|tsx)$/;
const JS_SUITE_RE = /\.(test|spec)\.(js|mjs|cjs)$/;

/**
 * Convertit un glob vitest en expression régulière ancrée.
 *
 * Les motifs manipulés ici sont ceux des `include` / `exclude` de vitest, relatifs à la
 * racine du paquet : `**​/__tests__/**​/*.test.js`, `**​/node_modules/**`, `**​/__tests__/bundle.test.js`.
 *
 * ⚠️ Le globstar suivi d'un séparateur se traduit en groupe OPTIONNEL, pas en
 * « au moins un répertoire » : le segment doit pouvoir matcher **zéro** répertoire, sans
 * quoi `__tests__/foo.test.js` échapperait au motif du core — c'est-à-dire que la gate
 * déclarerait orphelins ses 457 fichiers, qui sont précisément à cette profondeur.
 *
 * @param {string} glob motif vitest
 * @returns {RegExp} ancrée sur la chaîne entière
 */
function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") {
                    out += "(?:.*/)?";
                    i += 2;
                } else {
                    out += ".*";
                    i += 1;
                }
            } else {
                out += "[^/]*";
            }
        } else if (c === "?") {
            out += "[^/]";
        } else {
            out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}

/**
 * Lit les tableaux `include` / `exclude` **directs** de l'objet `test` d'un config vitest.
 *
 * ⚠️ La visite s'arrête aux propriétés directes de `test`. `test.coverage.include` porte le
 * même nom et désigne tout autre chose — les sources mesurées, pas les suites collectées.
 * Les confondre ferait juger la collecte d'un test sur le périmètre de couverture.
 *
 * @param {string} file chemin absolu d'un config vitest
 * @returns {{ include: string[] | null, exclude: string[] | null }} `null` = non déclaré,
 *   ce qui signifie « hérité de la fabrique », et se distingue d'un tableau vide
 */
function readTestGlobs(file) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );

    /** @type {{ include: string[] | null, exclude: string[] | null }} */
    const found = { include: null, exclude: null };

    /**
     * @param {import("typescript").ObjectLiteralExpression} obj
     * @returns {void}
     */
    const readDirect = (obj) => {
        for (const prop of obj.properties) {
            if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
            const key = prop.name.getText(sf).replace(/['"]/g, "");
            if (key !== "include" && key !== "exclude") continue;
            if (!ts.isArrayLiteralExpression(prop.initializer)) continue;
            const values = prop.initializer.elements
                .filter((el) => ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el))
                .map((el) => el.text);
            found[key] = values;
        }
    };

    const visit = (node) => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name &&
            node.name.getText(sf).replace(/['"]/g, "") === "test" &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            readDirect(node.initializer);
            return; // ne pas redescendre : `coverage.include` vit en dessous
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);

    return found;
}

/**
 * Le motif de collecte par défaut, **lu dans la fabrique partagée** plutôt que recopié.
 *
 * @returns {{ include: string[], exclude: string[] }}
 * @throws {Error} si la fabrique ne déclare plus de `include` — auquel cas ce serait cette
 *   gate qui deviendrait fausse en silence, et il vaut mieux qu'elle s'arrête.
 */
function inheritedGlobs() {
    const globs = readTestGlobs(BASE_CONFIG);
    if (!globs.include || globs.include.length === 0) {
        throw new Error(
            `[JS-TEST-DEBT] ${path.relative(ROOT, BASE_CONFIG)} ne déclare plus de ` +
                "`test.include` — le défaut hérité ne peut plus être dérivé. Corriger la " +
                "lecture plutôt que recopier un motif ici."
        );
    }
    return { include: globs.include, exclude: globs.exclude ?? [] };
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]} tous les fichiers du sous-arbre, artefacts exclus
 */
function collectFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectFiles(path.join(dir, entry.name), out);
        } else {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

/**
 * @param {import("./lib/packages.cjs")} pkg
 * @returns {{ include: RegExp[], exclude: RegExp[] }[]} un jeu de motifs par config vitest
 */
function collectConfigs(pkgDirAbs, fallback) {
    const configs = fs
        .readdirSync(pkgDirAbs)
        .filter((f) => /^vitest(\..+)?\.config\.(ts|mts|cts|js|mjs|cjs)$/.test(f))
        .sort();

    return configs.map((name) => {
        const globs = readTestGlobs(path.join(pkgDirAbs, name));
        const include = globs.include ?? fallback.include;
        const exclude = globs.exclude ?? fallback.exclude;
        return {
            name,
            include: include.map(globToRegExp),
            exclude: exclude.map(globToRegExp),
        };
    });
}

/**
 * @returns {{ debt: string[], orphans: string[], support: string[], scanned: number,
 *   packages: number }}
 */
function scan() {
    const fallback = inheritedGlobs();
    const debt = [];
    const orphans = [];
    const support = [];
    let scanned = 0;
    let packages = 0;

    for (const pkg of registry.all()) {
        const pkgDirAbs = path.join(ROOT, pkg.dir);
        if (!fs.existsSync(pkgDirAbs)) continue;
        packages++;

        const configs = collectConfigs(pkgDirAbs, fallback);

        for (const file of collectFiles(pkgDirAbs)) {
            const rel = path.relative(ROOT, file).split(path.sep).join("/");
            const relPkg = path.relative(pkgDirAbs, file).split(path.sep).join("/");
            const base = path.basename(file);
            const inTestDir = /(^|\/)(__tests__|__mocks__)(\/|$)/.test(relPkg);

            if (SUITE_RE.test(base)) {
                scanned++;

                // JTD-04 — collectée par au moins un config du paquet ?
                const collected = configs.some(
                    (c) =>
                        c.include.some((re) => re.test(relPkg)) &&
                        !c.exclude.some((re) => re.test(relPkg))
                );
                if (!collected) {
                    orphans.push(
                        `${rel}  (configs du paquet : ${configs.map((c) => c.name).join(", ") || "AUCUN"})`
                    );
                }

                if (JS_SUITE_RE.test(base)) debt.push(rel);
            } else if (inTestDir && /\.(js|mjs|cjs)$/.test(base)) {
                support.push(rel);
            }
        }
    }

    return {
        debt: debt.sort(),
        orphans: orphans.sort(),
        support: support.sort(),
        scanned,
        packages,
    };
}

const { debt, orphans, support, scanned, packages } = scan();
const bar = "─".repeat(72);

// ── JTD-03 — une gate qui n'a rien scanné n'a rien prouvé ────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [JS-TEST-DEBT/JTD-03]: corpus vide — 0 suite de test scannée.");
    console.error(
        `  ${packages} paquet(s) parcouru(s) depuis le registre. Si le dépôt a des tests,\n` +
            "  c'est la gate qui est aveugle, pas le dépôt qui est propre."
    );
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4 : Prettier possède `scripts/**/*.json` en `tabWidth: 4` et
        // reformaterait tout le fichier au commit, rendant illisible le retrait d'une ligne.
        JSON.stringify(
            {
                _comment:
                    "JS-TEST-DEBT — suites de test encore en JavaScript (dettes D-23 et " +
                    "D-24). Cette liste ne peut que RÉTRÉCIR (JTD-02) et aucune entrée ne " +
                    "peut y NAÎTRE (JTD-01) : un test neuf s'écrit en TypeScript. Elle ne " +
                    "contient PAS les fichiers de support (`__mocks__/`, helpers) — ils " +
                    "sont imprimés à part par la gate, pour que ce compteur reste " +
                    "comparable à D-23 et D-24, qui comptent les suites. ⚠️ Elle ne dit " +
                    "rien de JTD-04, qui n'a pas de baseline : convertir un fichier sans " +
                    "élargir le `include` de son vitest.config le rend INVISIBLE, et " +
                    "rétrécit cette liste en perdant un test. Régénérer avec " +
                    "--update-baseline UNIQUEMENT après conversion, jamais pour faire taire.",
                _generated: "node scripts/check-js-test-debt.cjs --update-baseline",
                count: debt.length,
                entries: debt,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [JS-TEST-DEBT] baseline régénérée — ${debt.length} suite(s) JS.`);
    process.exit(0);
}

// ── JTD-04 — pas de baseline, pas d'exception ────────────────────────────────────────────
if (orphans.length > 0) {
    console.log(bar);
    console.error(
        `❌ [JS-TEST-DEBT/JTD-04] ${orphans.length} suite(s) que vitest NE COLLECTE PAS :`
    );
    for (const o of orphans) console.error(`     ${o}`);
    console.error(
        "\n  Ce fichier ne tourne nulle part. Sa suite est verte parce qu'elle n'existe pas\n" +
            "  pour le runner — pas parce qu'elle passe. Cause la plus fréquente : une\n" +
            "  conversion `.test.js` → `.test.ts` sans élargir le `include` du config, qui\n" +
            "  porte l'extension dans son motif. Corriger le `include`, ou le nom du fichier."
    );
    console.log(bar);
    process.exit(1);
}

if (!fs.existsSync(BASELINE)) {
    // Une baseline absente n'est PAS une liste vide : ce serait déclarer la dette soldée.
    // Même refus que `check-nonnull-assertion-debt.cjs`.
    console.error("ERROR [JS-TEST-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-js-test-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(debt);

const fresh = debt.filter((k) => !baseline.has(k)); // JTD-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // JTD-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [JS-TEST-DEBT] 0 suite non collectée (JTD-04) · ${debt.length} suite(s) JS gelée(s) ` +
            `— baseline à jour (${scanned} suites, ${packages} paquets).`
    );
    console.log(
        `   ℹ ${support.length} fichier(s) de support \`.js\` sous \`__tests__\`/\`__mocks__\` —`
    );
    console.log(
        "     hors compteur (D-23/D-24 comptent les suites), mais dans le coût d'une conversion."
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [JS-TEST-DEBT/JTD-01] ${fresh.length} suite(s) JS NOUVELLE(S) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  Un test neuf s'écrit en TypeScript. La dette D-23/D-24 est gelée, pas ouverte :\n" +
            "  elle a dérivé de +10 fichiers en 5 jours faute de ce cliquet. Convertir le\n" +
            "  fichier, ou motiver le gel sur place avec --update-baseline."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [JS-TEST-DEBT/JTD-02] ${stale.length} entrée(s) de baseline sans fichier :`
    );
    for (const k of stale) console.error(`     - ${k}`);
    console.error(
        "\n  Ces suites ont quitté le JavaScript — bonne nouvelle, mais la baseline doit\n" +
            "  l'enregistrer : `--update-baseline`. ⚠️ Vérifier D'ABORD que la conversion est\n" +
            "  bien COLLECTÉE (JTD-04 est passée) et que le nombre de tests n'a pas baissé :\n" +
            "  une suite renommée hors du `include` disparaît d'ici en ayant l'air d'un progrès."
    );
}

console.log(bar);
process.exit(1);
