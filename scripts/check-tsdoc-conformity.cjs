#!/usr/bin/env node
/**
 * TSDOC-CONFORMITY: le TSDoc doit décrire la signature qu'il surplombe.
 *
 * ## Le défaut que cette gate ferme
 *
 * Le dépôt a un principe : *tout fait vérifiable porte son vérificateur, ou il n'est pas
 * écrit*. Le TSDoc y échappait entièrement. Un `@param` survit au renommage de son
 * paramètre, un `@throws` survit à la suppression de son `throw` — et rien ne le dit.
 *
 * Ce n'est pas théorique. La refonte documentaire V3 a mesuré, sur le seul `CDC_technique.md`,
 * **287 chemins morts sur 452**. Le TSDoc est exposé à la même dérive, avec une circonstance
 * aggravante : depuis l'étape 3 de cette refonte, il est destiné à devenir **la source de la
 * référence d'API publiée sur npm**. Une phrase fausse dans un `.md` interne trompe un
 * développeur du projet ; la même dans un `@example` est livrée aux intégrateurs.
 *
 * ## Ce que cette gate PEUT juger, et ce qu'elle ne peut pas
 *
 * Elle ne lit pas le sens. Elle compare une déclaration à ce qui la documente, et c'est tout.
 *
 *   TSD-01  Tout `@param <nom>` doit nommer un paramètre réel de la signature.
 *           → attrape le renommage et la suppression de paramètre non répercutés.
 *   TSD-02  Un bloc qui documente AU MOINS un paramètre doit les documenter TOUS.
 *           → attrape le paramètre ajouté sans mise à jour du bloc. Volontairement muet
 *             sur les blocs qui ne documentent aucun paramètre : documenter partiellement
 *             est un défaut, ne pas documenter est un choix que MH-01 traite ailleurs.
 *   TSD-03  Un `@throws` exige un `throw` dans le corps de la fonction.
 *           → attrape l'exception documentée qui n'existe plus.
 *   TSD-04  La baseline doit RÉTRÉCIR. Une entrée dont la violation a disparu est une
 *           ERREUR tant qu'elle n'est pas retirée de la baseline.
 *           → sans quoi une baseline est un permis, pas un registre de dette. Même
 *             raisonnement que MH-02 dans `check-module-headers.cjs`.
 *   TSD-05  Un export de premier niveau doit porter un bloc TSDoc.
 *           → attrape l'export publié SANS un mot de documentation, et interdit d'en
 *             créer de nouveaux. Détail et motif au § suivant.
 *   TSD-06  Un `@example` ne peut pas nommer un symbole qui n'existe nulle part.
 *           → attrape la classe fantôme copiable-collable. Détail au § TSD-06.
 *
 * ## TSD-05 — pourquoi une règle ici, et pas un compteur ailleurs
 *
 * La roadmap de la refonte V3 chiffrait ce gisement à « ~173 exports manquants, 89-92 % de
 * couverture, 1 582 blocs existants ». **Aucun instrument de ce dépôt ne produisait ces trois
 * chiffres**, et le « ~173 » a servi quatre fois à dimensionner une sous-tâche avant d'être
 * retiré (mode d'échec n° 5 de `CLAUDE.md` : un chiffre qu'on ne peut pas re-mesurer ne se
 * périme pas, il se fossilise — et il fait autorité d'autant plus qu'il est précis). TSD-05
 * est ce qui remplace ces trois chiffres : la liste **nominative**, réimprimée à chaque run.
 * La mesure réelle, au premier run, a donné **199** — ni 173, ni les ~255 qu'une approximation
 * par regex suggérait.
 *
 * **Deux populations, et elles ne coûtent pas la même chose.** La distinction est écrite ici
 * parce que le « ~173 » les confondait, ce qui rendait la sous-tâche indécoupable :
 *
 *   - **surface publiée** — les fichiers que la carte `exports` d'un `package.json` rend
 *     atteignables, **jokers compris** (`"./capabilities/*"` publie TOUT le sous-arbre : un
 *     intégrateur peut importer chacun de ces fichiers). Un TSDoc manquant y est **livré**,
 *     et son lecteur est extérieur au dépôt — il ne peut pas constater la dérive. C'est
 *     l'argument de B-63, un étage plus bas. **15 exports** y sont nus.
 *   - **le reste de `src/`** — un coût interne, réel mais sans lecteur externe.
 *
 * La sortie sépare les deux et **drague la publiée d'abord**. ⚠️ Le plan initial disait
 * « `utils/` d'abord (52 %, 65 exports) » : cet ordre découlait du chiffre retiré, pas d'une
 * décision. Si `utils/` est sur la surface publiée, il remonte de lui-même.
 *
 * **Pas de pourcentage comme cliquet.** Le motif est celui de
 * `check-namespace-typing-coverage.cjs`, et il est plus fort ici : un pourcentage monte quand
 * on RETIRE une clé, et sur le TSDoc **le dénominateur n'est même pas stable** — supprimer un
 * `export` de baril ferait grimper le taux sans qu'une phrase soit écrite.
 *
 * **Le cliquet est TSD-04, tel quel.** ⚠️ La spécification écrite dans la roadmap annonçait un
 * `TSD-05a` (« un export absent de la baseline doit porter un bloc ») et un `TSD-05b` (« la
 * baseline ne peut que rétrécir »). À l'écriture, les deux se sont révélés **déjà là** :
 * TSD-05a est le mécanisme de baseline lui-même, et TSD-05b **est** TSD-04, qui opère sur
 * l'ensemble des règles sans en connaître aucune. Les dédoubler aurait créé deux autorités
 * pour un seul invariant. Une règle, pas trois — et la roadmap est corrigée dans le même
 * commit, pour que la spécification et le code ne divergent pas dès le premier jour.
 *
 * **Ce que TSD-05 ne juge pas** : la PRÉSENCE d'un bloc, pas sa qualité. Un bloc ne contenant
 * qu'un « TODO » satisfait la règle. C'est la même frontière que partout ici.
 *
 * ## TSD-06 — la « surface réelle » comme oracle, et pourquoi il en faut DEUX
 *
 * L'en-tête de `validate-docs-examples.cjs` dit depuis le S14 que sa deny-list ne voit qu'un
 * fantôme *une fois qu'on lui a écrit la règle*, et que **dériver de la surface réelle vaudrait
 * mieux**. B-75 a montré le coût de ce trou : un `@example` de `core-module.contract.ts`
 * documentait `new POIModule()` — classe dissoute au S9 — sur du code **publié sur npm**.
 *
 * ⚠️ **Le premier essai a été REFUSÉ sur mesure, et il avait raison de l'être.** Prendre le
 * manifeste de surface (`API_SURFACE.txt`) comme oracle unique donnait **3 faux positifs pour
 * 0 vrai** : `StorageHelper` et `LayersDB` sont **réels mais NON exportés**, donc absents d'un
 * manifeste qui ne rend que l'exporté ; `MyDecoder` est un **placeholder**. Une gate qu'il faut
 * faire taire trois fois le premier jour n'est pas une gate.
 *
 * **Ce qui a changé la décision : un SECOND oracle.** Un symbole déclaré quelque part dans les
 * sources — exporté ou non — est réel. Les deux ensemble discriminent les trois cas :
 *
 *   | Dans le manifeste | Déclaré à l'AST | Verdict                                  |
 *   | ----------------- | --------------- | ---------------------------------------- |
 *   | oui               | —               | exporté — rien à dire                    |
 *   | non               | oui             | **privé** — légitime dans un doc interne |
 *   | non               | non             | **FANTÔME** — TSD-06                     |
 *
 * ⚠️ **Et l'AST SEUL ne suffit pas non plus** — mesuré : **1 571 des 4 233** symboles du
 * manifeste ne sont pas trouvés par cette passe (membres de namespace, ré-exports, propriétés
 * d'objets exportés). L'utiliser seul produisait **7 faux fantômes** dont `COG`, `Geocoding` et
 * `FlatGeobuf`. Les deux oracles se compensent, aucun ne remplace l'autre.
 *
 * **Placeholders.** Un exemple a le droit de nommer une classe que le LECTEUR doit écrire
 * (`registerDecoder("my-format", new MyDecoder())`). L'exemption est une **convention de
 * nommage** — préfixe `My` / `Your` / `Custom` / `Sample` / `Example` — et non une liste de
 * symboles : une liste nominative survivrait à son motif, c'est la leçon de B-63.
 *
 * ⚠️ **La règle vit ICI et pas dans `validate-docs-examples.cjs`**, alors que c'est là que la
 * classe a été trouvée. Motif mesuré : cette gate parcourt **déjà** les 847 fichiers en AST
 * (0,5 s) ; l'autre est une passe regex de 0,06 s. Y greffer un second parcours complet aurait
 * multiplié son coût par dix pour refaire un travail déjà fait.
 *
 * ## Périmètre de TSD-06 — deux formes, et c'est MESURÉ suffisant
 *
 * Elle ne lit que `new X()` et `X.method()`. Cette borne n'est pas une prudence de principe :
 * un relevé des cinq autres formes que peut prendre un nom PascalCase dans les 106 `@example`
 * rend **0 fantôme**, le 30/07/2026 :
 *
 *   | Forme                          | Symboles réels | Fantômes |
 *   | ------------------------------ | -------------- | -------- |
 *   | `new X()`          **couvert** | 3              | **0**    |
 *   | `X.method()`       **couvert** | 32             | **0**    |
 *   | `X.PROPRIÉTÉ`                  | 14             | **0**    |
 *   | `: X` / `as X`                 | 6              | **0**    |
 *   | `import { X }`                 | 3              | **0**    |
 *   | `implements` / `extends X`     | 1              | **0**    |
 *   | `f(X)` (argument)              | 1              | **0**    |
 *
 * **Et la forme non couverte la plus à risque est prise par une AUTRE gate** :
 * `import { X }` nommant un export inexistant, c'est `TS2305` — dans les `DEFECT_CODES` de
 * `typecheck-docs-examples.cjs`, avec `TS2307` pour le chemin de module. Élargir ici
 * dupliquerait un contrôle que le compilateur fait mieux.
 *
 * ⚠️ **Élargir aux positions de type (`: X`) serait un RECUL, et c'est mesuré aussi.** Les types
 * utilitaires de TypeScript — `Partial`, `Record`, `Omit`, `Pick`, `Readonly` — ne sont ni dans
 * le manifeste, ni déclarés dans les sources, ni des globals runtime. Ils tomberaient donc dans
 * les trois filtres et **rougiraient au premier `: Partial<X>` écrit**. La borne actuelle n'est
 * pas ce que la règle n'a pas eu le temps de faire : c'est là où elle cesse d'être juste.
 *
 * **Ce qui reste hors de portée pour de bon** : un fantôme cité dans la PROSE d'un TSDoc, hors
 * `@example`. C'est un autre corpus et un autre outil — `audit-report-freshness.cjs` sait déjà
 * traiter les chemins et symboles de prose, il n'est simplement pas branché sur le TSDoc.
 *
 * **Ce qu'elle NE juge PAS, et ne jugera jamais : la véracité de la phrase.** « Met en cache
 * 5 minutes » sur une fonction qui en cache 10 est indiscernable, pour tout outil d'ici, d'une
 * phrase juste. C'est la limite structurelle de tout ce qui est « généré » — TypeDoc garantit
 * la **signature**, jamais la **phrase**. Cette moitié-là reste humaine et vit dans
 * `CLAUDE.md` §Fin de session.
 *
 * ## Ce qui n'est PAS couvert aujourd'hui, et pourquoi c'est dit plutôt que tu
 *
 * - **`@returns` ↔ type de retour** : écarté de cette version. Le dépôt écrit largement
 *   `@returns` sur des fonctions `void` et l'inverse ; en faire une règle produirait un
 *   bruit qui noierait TSD-01, qui est le contrôle à haute valeur. À rouvrir avec une
 *   mesure, pas par principe.
 * - **`@example` qui compile** : c'est le contrôle le plus utile qui manque, et il n'est pas
 *   ici parce qu'il exige les `.d.ts` publiés et le moteur de `typecheck-docs-examples.cjs`.
 *   ⚠️ **137 `@example` vivent dans le code** (109 core, 21 plugins, 7 libs) et **aucun**
 *   n'est vérifié. C'est la suite immédiate de cette gate.
 * - **Chemins cités dans la prose TSDoc** : `audit-report-freshness.cjs` sait déjà le faire,
 *   il n'est simplement pas branché sur le TSDoc.
 * - **Les membres de classe et d'interface** : TSD-05 ne juge que les exports de **premier
 *   niveau**. Une méthode publique non documentée d'une classe exportée passe. Élargir est
 *   possible et multiplierait le gisement ; à faire avec une mesure préalable, comme ici.
 *
 * Usage:
 *   node scripts/check-tsdoc-conformity.cjs                  # gate (exit 1 si violation neuve)
 *   node scripts/check-tsdoc-conformity.cjs --update-baseline
 *   node scripts/check-tsdoc-conformity.cjs --verbose
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
const { extractTsdocExamples } = require("./lib/tsdoc-examples.cjs");

const ROOT = registry.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "tsdoc-conformity.json");
const VERBOSE = process.argv.includes("--verbose");
const UPDATE = process.argv.includes("--update-baseline");

/** Fichiers hors périmètre : les tests documentent leur intention, pas une API. */
const EXCLUDED = /(\/__tests__\/|\/__mocks__\/|\.test\.ts$|\.spec\.ts$|\.d\.ts$)/;

// ---------------------------------------------------------------------------
// Collecte des fichiers — par le registre, jamais par un chemin en dur.
// ---------------------------------------------------------------------------

/** @returns {string[]} chemins absolus des `.ts` de `src/` de tous les paquets. */
function sourceFiles() {
    const out = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (!fs.existsSync(src)) continue;
        walk(src, out);
    }
    return out.filter((f) => !EXCLUDED.test(f.replace(/\\/g, "/")));
}

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".ts")) out.push(full);
    }
}

/**
 * Les fichiers `src/` que la carte `exports` rend atteignables par un intégrateur — la
 * population « surface publiée » de TSD-05.
 *
 * La carte pointe vers `dist/`, qui n'existe pas sur un checkout propre : on la ramène à
 * `src/` par le layout de build (`dist/{types,esm}/X.{d.ts,js}` → `src/X.ts`). ⚠️ Le mapping
 * est **assertif** : s'il ne résout plus rien, la fonction JETTE au lieu de rendre un Set
 * vide. Une surface publiée vide ferait sortir TSD-05 vert en ayant classé tous les exports
 * « internes » — c'est-à-dire verte en n'ayant plus rien priorisé, la classe de défaut que
 * `probe-gate-visibility.cjs` surveille ailleurs. (Vue jeter par mutation du préfixe.)
 *
 * @returns {Set<string>} chemins absolus.
 * @throws {Error} si la carte `exports` ne résout plus aucun fichier source.
 */
function publishedSurface() {
    const set = new Set();
    for (const pkg of registry.all()) {
        const manifest = path.join(pkg.absDir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pj = JSON.parse(fs.readFileSync(manifest, "utf8"));
        for (const cond of Object.values(pj.exports || {})) {
            const target =
                typeof cond === "string" ? cond : cond.types || cond.import || cond.default;
            if (typeof target !== "string") continue;
            const rel = target
                .replace(/^\.\//, "")
                .replace(/^dist\/(?:types|esm)\//, "src/")
                .replace(/\.d\.ts$/, ".ts")
                .replace(/\.js$/, ".ts");
            if (!rel.startsWith("src/")) continue;

            if (rel.includes("*")) {
                // Un sous-chemin joker publie tout son sous-arbre. `"./capabilities/*"` du
                // core rend chaque fichier de `src/capabilities/` importable — n'en compter
                // qu'un serait faux dans l'autre sens.
                const dir = path.join(pkg.absDir, rel.slice(0, rel.indexOf("*")));
                if (fs.existsSync(dir)) {
                    const found = [];
                    walk(dir, found);
                    for (const f of found) set.add(f);
                }
            } else {
                const abs = path.join(pkg.absDir, rel);
                if (fs.existsSync(abs)) set.add(abs);
            }
        }
    }
    if (set.size === 0) {
        throw new Error(
            "[TSDOC/TSD-05] la carte `exports` ne résout plus aucun fichier de `src/` — le " +
                "layout de build a changé, ou le registre de paquets ne rend plus rien. La " +
                "gate refuse de conclure : sans surface publiée, elle classerait TOUT en " +
                "interne et sortirait verte en n'ayant plus rien priorisé."
        );
    }
    return set;
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/**
 * Les noms de paramètres d'une déclaration, en ignorant les patrons de déstructuration :
 * `function f({a, b})` n'a pas de nom à comparer, et le TSDoc le documente alors par
 * `@param options.a`. Les compter produirait un faux positif à chaque fois.
 *
 * @returns {{names: string[], hasBindingPattern: boolean}}
 */
function paramNames(node) {
    const names = [];
    let hasBindingPattern = false;
    for (const p of node.parameters || []) {
        if (ts.isIdentifier(p.name)) names.push(p.name.text);
        else hasBindingPattern = true;
    }
    return { names, hasBindingPattern };
}

/** Vrai si le corps contient un `throw`, y compris dans une closure imbriquée. */
function bodyThrows(node) {
    if (!node.body) return false;
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (ts.isThrowStatement(n)) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(node.body);
    return found;
}

/** Les déclarations que l'on sait apparier à un bloc TSDoc. */
function isDocumentable(n) {
    return (
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isConstructorDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n)
    );
}

// ── TSD-05 ──────────────────────────────────────────────────────────────────
//
// Les natures d'export que TSD-05 juge. `ExportDeclaration` (`export { X } from "…"`) et
// `export *` en sont ABSENTS à dessein : ils ne déclarent rien, ils réexpédient. Exiger un
// bloc sur un baril de réexport ferait recopier la documentation à côté de sa source — le
// doublon exact que la refonte V3 supprime par ailleurs.
const EXPORTED_DECL_KINDS = [
    ts.isFunctionDeclaration,
    ts.isClassDeclaration,
    ts.isInterfaceDeclaration,
    ts.isTypeAliasDeclaration,
    ts.isEnumDeclaration,
    ts.isVariableStatement,
];

/** Vrai si la déclaration porte un bloc TSDoc — sa PRÉSENCE, jamais sa qualité. */
function hasDocBlock(node) {
    return (ts.getJSDocCommentsAndTags(node) || []).some((d) => ts.isJSDoc(d));
}

/** Vrai si le statement porte le modificateur `export`. */
function isExported(node) {
    if (!ts.canHaveModifiers(node)) return false;
    return (ts.getModifiers(node) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Le ou les noms déclarés par un statement exporté. Un `export const a = 1, b = 2;` en
 * déclare deux — les fondre en un seul symbole rendrait la liste nominative incomplète, et
 * une liste nominative incomplète est le défaut qu'elle est censée fermer.
 *
 * @returns {string[]}
 */
function exportedNames(node, sf) {
    if (ts.isVariableStatement(node)) {
        return node.declarationList.declarations
            .map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
            .filter(Boolean);
    }
    if (node.name && typeof node.name.getText === "function") return [node.name.getText(sf)];
    return ["<anonyme>"];
}

// ── TSD-06 ──────────────────────────────────────────────────────────────────

const MANIFEST = docsPaths.reference("API_SURFACE.txt");

/** Convention de placeholder : un nom que le LECTEUR est censé écrire lui-même. */
const PLACEHOLDER_RE = /^(My|Your|Custom|Sample|Example)[A-Z]/;

/** Globals JS/DOM — un exemple a le droit de les nommer. */
const HOST_GLOBALS = new Set([
    ...Object.getOwnPropertyNames(globalThis),
    "CustomEvent",
    "HTMLElement",
    "Element",
    "Event",
    "Blob",
    "File",
    "FormData",
    "Headers",
    "Request",
    "Response",
    "URL",
    "URLSearchParams",
    "AbortController",
    "IntersectionObserver",
    "ResizeObserver",
    "MutationObserver",
    "Worker",
    "IDBDatabase",
    "ImageData",
    "Image",
    "Node",
    "Document",
    "Window",
]);

/**
 * Oracle 1 — les symboles que le manifeste de surface rend, donc EXPORTÉS.
 *
 * Absent = la gate ne peut pas conclure, et elle le dit : sans manifeste, tout symbole privé
 * deviendrait un faux fantôme. Mieux vaut ne pas juger que juger à l'aveugle.
 *
 * @returns {Set<string>|null} `null` si le manifeste est absent.
 */
function readManifestSymbols() {
    if (!fs.existsSync(MANIFEST)) return null;
    const txt = fs.readFileSync(MANIFEST, "utf8");
    const out = new Set();
    for (const m of txt.matchAll(/^\w+ \| [^|]*\.([A-Za-z_$][\w$]*) \|/gm)) out.add(m[1]);
    for (const m of txt.matchAll(/^\w+ \| ([A-Za-z_$][\w$]*) \|/gm)) out.add(m[1]);
    return out;
}

/** Collecte les noms déclarés d'un fichier — oracle 2 (le PRIVÉ, que le manifeste ignore). */
function collectDeclared(sf, into) {
    const visit = (n) => {
        if (
            (ts.isClassDeclaration(n) ||
                ts.isInterfaceDeclaration(n) ||
                ts.isTypeAliasDeclaration(n) ||
                ts.isEnumDeclaration(n) ||
                ts.isFunctionDeclaration(n)) &&
            n.name
        )
            into.add(n.name.text);
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) into.add(n.name.text);
        ts.forEachChild(n, visit);
    };
    visit(sf);
}

/** Les symboles PascalCase qu'un `@example` emploie comme constructeur ou porteur de méthode. */
function exampleSymbols(code) {
    const out = new Set();
    for (const m of code.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) out.add(m[1]);
    for (const m of code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\.\s*[a-z][A-Za-z0-9_]*\s*\(/g))
        out.add(m[1]);
    return out;
}

/** Le libellé de nature affiché dans le détail — stable, il entre dans la clé de baseline. */
function declLabel(node) {
    if (ts.isFunctionDeclaration(node)) return "fonction";
    if (ts.isClassDeclaration(node)) return "classe";
    if (ts.isInterfaceDeclaration(node)) return "interface";
    if (ts.isTypeAliasDeclaration(node)) return "type";
    if (ts.isEnumDeclaration(node)) return "enum";
    if (ts.isVariableStatement(node)) return "const";
    return "export";
}

/**
 * Analyse un fichier et rend ses violations.
 *
 * @param {string} absFile - Chemin absolu du `.ts` à analyser.
 * @param {Set<string>} published - Surface publiée, pour la population de TSD-05.
 * @returns {{rule: string, file: string, line: number, symbol: string, detail: string, published?: boolean}[]}
 */
function analyse(absFile, published, oracles) {
    const text = fs.readFileSync(absFile, "utf8");
    const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.ES2022, true);
    const rel = path.relative(ROOT, absFile).replace(/\\/g, "/");
    const found = [];
    const isPublished = published.has(absFile);

    // TSD-05 — un export de premier niveau sans bloc TSDoc. Passe séparée sur les
    // statements de tête : le `visit` récursif ci-dessous descend dans les corps de
    // fonction, où un `export` ne peut pas vivre.
    //
    // ⚠️ Le regroupement par NOM est load-bearing, pas une optimisation. Une fonction
    // surchargée s'écrit en N signatures + 1 implémentation, toutes `export function f`, et
    // la convention TypeScript — celle que TypeDoc suit pour son rendu — place le bloc sur
    // UNE seule d'entre elles. Juger chaque déclaration séparément accusait `domCreate`
    // (3 déclarations, 1 bloc) de DEUX violations inexistantes, et c'est un doublon de clé
    // de baseline qui l'a révélé. Même raisonnement pour la fusion de déclarations
    // d'interface. La règle est donc : pour un nom exporté, AU MOINS une déclaration porte
    // un bloc.
    const groups = new Map();
    for (const st of sf.statements) {
        if (!EXPORTED_DECL_KINDS.some((k) => k(st))) continue;
        if (!isExported(st)) continue;
        const line = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
        const documented = hasDocBlock(st);
        for (const name of exportedNames(st, sf)) {
            const g = groups.get(name) || { line, label: declLabel(st), documented: false };
            g.documented = g.documented || documented;
            g.line = Math.min(g.line, line);
            groups.set(name, g);
        }
    }
    for (const [name, g] of groups) {
        if (g.documented) continue;
        found.push({
            rule: "TSD-05",
            file: rel,
            line: g.line,
            symbol: name,
            // La population entre dans le détail, donc dans la clé de baseline : si un
            // export interne non documenté devient PUBLIÉ (la carte `exports` change), sa
            // clé change, l'ancienne devient périmée et TSD-04 rougit. C'est voulu — la
            // promotion d'un export nu au rang de surface livrée est exactement
            // l'événement qu'on veut voir.
            detail: `export \`${name}\` (${g.label}) sans bloc TSDoc — ${
                isPublished ? "surface publiée" : "interne"
            }`,
            published: isPublished,
        });
    }

    // TSD-06 — un `@example` nommant un symbole absent des DEUX oracles.
    // `oracles` vaut `null` quand le manifeste est introuvable : la règle se tait alors
    // plutôt que de transformer tout symbole privé en faux fantôme.
    if (oracles) {
        for (const ex of extractTsdocExamples(text)) {
            for (const name of exampleSymbols(ex.code)) {
                if (HOST_GLOBALS.has(name)) continue;
                if (PLACEHOLDER_RE.test(name)) continue;
                if (oracles.exported.has(name) || oracles.declared.has(name)) continue;
                found.push({
                    rule: "TSD-06",
                    file: rel,
                    line: ex.startLine,
                    symbol: name,
                    detail: `@example nomme \`${name}\`, absent de la surface exportée ET des déclarations des sources — symbole fantôme`,
                });
            }
        }
    }

    const visit = (node) => {
        if (isDocumentable(node)) {
            const tags = ts.getJSDocTags(node) || [];
            if (tags.length) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                const symbol =
                    (node.name && node.name.getText && node.name.getText(sf)) ||
                    (ts.isConstructorDeclaration(node) ? "constructor" : "<anonyme>");
                const { names, hasBindingPattern } = paramNames(node);

                const paramTags = tags.filter((t) => t.tagName.text === "param");
                // Un `@param options.a` documente une propriété, pas un paramètre : on ne
                // retient que le segment racine, et on ignore les formes pointées quand la
                // signature porte un patron de déstructuration.
                const documented = paramTags
                    .map((t) => (t.name && t.name.getText ? t.name.getText(sf) : null))
                    .filter(Boolean);
                const rootDocumented = [...new Set(documented.map((d) => d.split(".")[0]))];

                // TSD-01 — un `@param` qui ne nomme aucun paramètre réel.
                if (!hasBindingPattern) {
                    for (const d of rootDocumented) {
                        if (!names.includes(d)) {
                            found.push({
                                rule: "TSD-01",
                                file: rel,
                                line,
                                symbol,
                                detail: `@param \`${d}\` ne correspond à aucun paramètre (réels : ${names.join(", ") || "aucun"})`,
                            });
                        }
                    }
                    // TSD-02 — documentation partielle des paramètres.
                    if (rootDocumented.length > 0) {
                        const missing = names.filter((n) => !rootDocumented.includes(n));
                        if (missing.length) {
                            found.push({
                                rule: "TSD-02",
                                file: rel,
                                line,
                                symbol,
                                detail: `paramètre(s) non documenté(s) alors que d'autres le sont : ${missing.join(", ")}`,
                            });
                        }
                    }
                }

                // TSD-03 — `@throws` sans `throw`.
                const throwsTags = tags.filter((t) =>
                    ["throws", "throw", "exception"].includes(t.tagName.text)
                );
                if (throwsTags.length && !bodyThrows(node)) {
                    found.push({
                        rule: "TSD-03",
                        file: rel,
                        line,
                        symbol,
                        detail: "@throws documenté mais aucun `throw` dans le corps",
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

// ---------------------------------------------------------------------------
// Baseline — la clé ignore le NUMÉRO DE LIGNE, à dessein.
//
// Une clé qui porte la ligne se périme au premier ajout d'import au-dessus, et la gate
// rougit alors sur une violation qu'elle avait déjà tolérée. La clé est donc
// `règle|fichier|symbole|détail` : elle survit au déplacement et ne survit pas à la
// correction, ce qui est exactement ce qu'on veut d'un registre de dette.
// ---------------------------------------------------------------------------

const keyOf = (v) => `${v.rule}|${v.file}|${v.symbol}|${v.detail}`;

function readBaseline() {
    if (!fs.existsSync(BASELINE)) return { entries: [] };
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

// ---------------------------------------------------------------------------

function main() {
    const files = sourceFiles();
    const published = publishedSurface();
    // Oracle 2 (déclarations) : un seul parcours, réutilisé — la passe AST a lieu de toute
    // façon ci-dessous. Oracle 1 (manifeste) : une lecture de fichier.
    const exportedSyms = readManifestSymbols();
    let oracles = null;
    if (exportedSyms) {
        const declared = new Set();
        for (const f of files) {
            collectDeclared(
                ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true),
                declared
            );
        }
        oracles = { exported: exportedSyms, declared };
    }
    // `files.flatMap(analyse)` passerait l'INDEX en 2e argument — la lambda est explicite.
    const violations = files.flatMap((f) => analyse(f, published, oracles));
    const seen = new Set(violations.map(keyOf));

    if (UPDATE) {
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                {
                    _comment:
                        "TSDOC-CONFORMITY — dette gelée. Ne peut que RÉTRÉCIR (TSD-04). " +
                        "Régénérer avec --update-baseline UNIQUEMENT après avoir corrigé, jamais pour faire taire.",
                    _generated: "scripts/check-tsdoc-conformity.cjs --update-baseline",
                    count: violations.length,
                    entries: [...seen].sort(),
                },
                null,
                4
            ) + "\n"
        );
        console.log(`✅ [TSDOC] baseline écrite — ${violations.length} entrée(s).`);
        return 0;
    }

    const baseline = new Set(readBaseline().entries || []);
    const fresh = violations.filter((v) => !baseline.has(keyOf(v)));
    const stale = [...baseline].filter((k) => !seen.has(k));

    const width = 72;
    console.log("─".repeat(width));

    if (fresh.length) {
        console.log(`❌  [TSDOC] ${fresh.length} violation(s) NEUVE(S) :\n`);
        // Surface publiée en tête : un TSDoc manquant y est livré à un lecteur qui ne peut
        // pas constater la dérive. L'ordre de la sortie EST la priorité de drainage.
        const ordered = [...fresh].sort((a, b) => (b.published ? 1 : 0) - (a.published ? 1 : 0));
        for (const v of ordered) {
            const tag = v.published ? " ⟨surface publiée⟩" : "";
            console.log(`  ${v.rule}  ${v.file}:${v.line}  ${v.symbol}${tag}`);
            console.log(`        ${v.detail}\n`);
        }
    }

    if (stale.length) {
        console.log(
            `❌  [TSDOC-04] ${stale.length} entrée(s) de baseline sans violation — la dette a été\n` +
                `    corrigée, la baseline doit suivre. Retirer ces lignes (ou --update-baseline) :\n`
        );
        for (const k of stale.slice(0, 20)) console.log(`  ${k}`);
        if (stale.length > 20) console.log(`  … et ${stale.length - 20} de plus`);
        console.log("");
    }

    if (!fresh.length && !stale.length) {
        const byRule = {};
        for (const v of violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
        const nu = violations.filter((v) => v.rule === "TSD-05");
        const nuPub = nu.filter((v) => v.published).length;

        console.log(
            `✅  [TSDOC] conformité TSDoc — 0 violation neuve.\n` +
                `    ${files.length} fichier(s) analysé(s) · ${violations.length} entrée(s) en baseline (décroissantes).`
        );
        // Anti-gate-vide : on imprime le corpus RÉELLEMENT lu, pas seulement le verdict.
        // C'est ce décompte qui remplace les « 89-92 % » et « ~173 » retirés de la roadmap —
        // et il est réimprimé à chaque run, donc il ne peut pas se fossiliser.
        console.log(
            `    TSD-05 — ${published.size} fichier(s) sur la surface publiée · ` +
                `${nu.length} export(s) sans bloc TSDoc, dont ${nuPub} publié(s).`
        );
        if (nuPub > 0) {
            console.log(
                `    ⚠️  Drainer les ${nuPub} publié(s) d'abord — leur lecteur est extérieur au dépôt.`
            );
        }
        if (VERBOSE) {
            console.log(`    Détail baseline : ${JSON.stringify(byRule)}`);
            for (const v of nu.filter((x) => x.published)) {
                console.log(`      ⟨publié⟩ ${v.file}:${v.line}  ${v.symbol}`);
            }
        }
    }

    console.log("─".repeat(width));
    return fresh.length || stale.length ? 1 : 0;
}

process.exit(main());
