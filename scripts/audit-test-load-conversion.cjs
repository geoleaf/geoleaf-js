#!/usr/bin/env node
/**
 * audit-test-load-conversion.cjs — triage et preuves de sensibilité (roadmap COUVERTURE).
 *
 * ## Ce qu'il sert, et pourquoi il n'est pas une gate
 *
 * `verify-test-load-mode.cjs` gèle la dette : il interdit un site `require()` de PLUS.
 * Celui-ci a accompagné son remboursement — il dit **quoi convertir** (`--triage`), et il
 * prouve que la conversion n'a éteint ni la sensibilité d'un mock (`--prove-mocks`) ni un
 * rechargement (`--prove-reload`).
 *
 * Il n'est volontairement PAS câblé dans `ci:local` : la propriété durable est la baseline
 * décroissante du S1 ; ces preuves sont **ponctuelles**, à rejouer à la demande.
 *
 * ## Le piège que ces contrôles existent pour éviter
 *
 * Un test converti reste **vert** même si son mock ne mord plus rien, ou si un rechargement
 * a cessé de recharger. La verdeur ne prouve rien. Les harnais `--prove-mocks` et
 * `--prove-reload` figent un relevé de sensibilité la première fois, puis refusent tout lot
 * où un fichier l'a PERDUE : l'invariant est l'ÉGALITÉ avant/après, prouvée par mutation
 * (neutraliser le mock ou casser le rechargement doit faire rougir), pas « ça doit rougir ».
 *
 * ## Un paquet à la fois
 *
 * Les sous-commandes portent sur **le paquet désigné par `--pkg`** (défaut : `@geoleaf/core`).
 * Jusqu'au S5 le paquet était codé en dur ; le `SCOPE` pouvait s'élargir sans que les relevés
 * suivent.
 *
 * Usage :
 *   node scripts/audit-test-load-conversion.cjs --triage                          # quoi convertir
 *   node scripts/audit-test-load-conversion.cjs --prove-mocks  <nom> [fichiers…]  # sensibilité des mocks
 *   node scripts/audit-test-load-conversion.cjs --prove-reload <nom> [fichiers…]  # sensibilité du rechargement
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ts = require("typescript");
const registry = require("./lib/packages.cjs");
const sites = require("./lib/test-load-sites.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * Où vivent les relevés — `GEOLEAF_LOAD_AUDIT_DIR`, défaut `_archive_local/load-conversion/`.
 *
 * ⚠️ Le chemin était `tmp_load-conversion/`, EN DUR, à la racine. Deux défauts, pas un :
 *
 *   • la checklist d'hygiène UNIVERSELLE interdit un `tmp_*` permanent à la racine. Le
 *     dépôt était donc en violation de sa propre règle de fin de sprint — et c'est
 *     exactement COMMENT 126,8 Mo y ont stagné jusqu'au T4.6 : gitignoré par `tmp_*`,
 *     donc invisible en revue, et personne pour rapprocher le dossier de la règle ;
 *   • 99,94 % de ces 126,8 Mo n'avaient plus de producteur. Les 8 répertoires `run-*`
 *     (117,6 Mio) et les 9 relevés `<pkg>--<nom>.json` étaient écrits par `--snapshot`,
 *     supprimé au commit 3285f48e (COUVERTURE S6, unification sur istanbul). Un résidu
 *     de sous-commande morte, pas une politique de rétention.
 *
 * `_archive_local/` est la place sanctionnée des artefacts purement locaux : déjà
 * gitignorée, déjà hors périmètre d'ESLint et des checks 1/1b de `verify-repo-hygiene`.
 *
 * ⚠️ La destination est VÉRIFIÉE ignorée par git, pas espérée. C'est plus fort que le
 * filet de nom `tmp_*` qu'on perd : celui-ci mordait au commit, pour un préfixe ;
 * celle-ci mord à l'ÉCRITURE, pour n'importe quel chemin.
 */
function resolveSnapDir() {
    const raw = process.env.GEOLEAF_LOAD_AUDIT_DIR;
    const abs = raw
        ? path.resolve(ROOT, raw)
        : path.join(ROOT, "_archive_local", "load-conversion");
    const shown = path.relative(ROOT, abs) || abs;

    // `git check-ignore -q` : 0 = ignoré, 1 = non ignoré. Un chemin déjà SUIVI rend 1 —
    // ce qui est le comportement voulu ici, pas un bug : y écrire des relevés les ferait
    // entrer dans l'index.
    if (spawnSync("git", ["check-ignore", "-q", abs], { cwd: ROOT }).status !== 0) {
        console.error(
            `✘ audit-test-load-conversion : « ${shown} » n'est pas ignoré par git.\n` +
                `  Les relevés sont des artefacts locaux — le lot du 22/07 pesait 117,6 Mio.\n` +
                `  Y écrire sous un chemin suivi les ferait entrer dans l'index au premier\n` +
                `  « git add -A » : l'accident est déjà enregistré deux fois au CHANGELOG.\n` +
                `  Ajoutez une règle à .gitignore, ou pointez GEOLEAF_LOAD_AUDIT_DIR ailleurs.`
        );
        process.exit(1);
    }
    return abs;
}

/**
 * Annonce la destination et ce qu'elle pèse déjà.
 *
 * C'est le remède du T4, et il est banal : `tmp_load-conversion/` a atteint 126,8 Mo
 * parce que RIEN ne le nommait jamais. Un dossier gitignoré qu'aucun outil ne mentionne
 * ne se fait remarquer qu'au `du -sh` — c'est-à-dire jamais. Deux lignes de sortie
 * suffisent à fermer ça.
 */
function announceSnapDir(dir) {
    let files = 0;
    let bytes = 0;
    const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else {
                files++;
                bytes += fs.statSync(full).size;
            }
        }
    };
    walk(dir);
    const size =
        bytes > 1024 * 1024
            ? `${(bytes / 1024 / 1024).toFixed(1)} Mio`
            : `${Math.round(bytes / 1024)} Kio`;
    const shown = path.relative(ROOT, dir) || dir;
    console.log(
        `ℹ relevés : ${shown}  (${files} fichier(s), ${size}) — GEOLEAF_LOAD_AUDIT_DIR pour déplacer`
    );
}

const SNAP_DIR = resolveSnapDir();
announceSnapDir(SNAP_DIR);

/**
 * Paquets dont ce script instruit la conversion — les trois que la mesure du 22/07 désigne.
 * Les 14 autres sont déjà à zéro `require()` de source.
 */
const SCOPE = ["@geoleaf/core", "@geoleaf-plugins/editor", "@geoleaf-plugins/offline-ui"];

/** Paquet mesuré par défaut, quand `--pkg` n'est pas donné. */
const DEFAULT_PKG = "@geoleaf/core";

/**
 * Le paquet visé par une sous-commande (`--pkg`, défaut `@geoleaf/core`).
 *
 * ⚠️ Le nom est vérifié contre le registre : un `--pkg` hors périmètre échoue plutôt que de
 * laisser un contrôle porter sur autre chose que ce qu'il annonce.
 *
 * @param {string} name Nom de manifeste.
 * @returns {object} Entrée de registre.
 */
function requirePkg(name) {
    if (!SCOPE.includes(name)) {
        console.error(
            `✘ audit-test-load-conversion: « ${name} » est hors périmètre.\n` +
                `  Périmètre : ${SCOPE.join(", ")}`
        );
        process.exit(1);
    }
    const pkg = registry.byName(name);
    if (!pkg) {
        console.error(`✘ audit-test-load-conversion: paquet « ${name} » absent du registre.`);
        process.exit(1);
    }
    return pkg;
}

/**
 * Appels de journalisation tolérés au chargement d'un module.
 *
 * Exemption **écrite plutôt que silencieuse** : `Log.debug("[StorageDB] Module loaded")` est
 * un appel, donc du code exécuté à l'import — mais il ne lit rien que le test installe et
 * n'a aucun effet qu'un test puisse observer. Le compter comme « effet de chargement »
 * classerait la moitié de `capabilities/offline/` en C et interdirait des remontées qui
 * sont sûres. Toute autre forme d'appel reste, elle, un effet.
 */
const INERT_CALLEES = new Set(["Log", "console"]);

/** Objets d'environnement : y toucher au chargement rend le hoisting dangereux. */
const ENV_GLOBALS = new Set(["self", "window", "globalThis", "document", "navigator"]);

/** @param {string} abs @returns {string} Chemin repo-relatif, séparateurs POSIX. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

// ── Inventaire des sites ─────────────────────────────────────────────────────
//
// `walkTests`, la résolution des specifiers (relatifs ET nus) et le classement en familles
// vivent dans `lib/test-load-sites.cjs`, partagés avec le gate `verify-test-load-mode.cjs`.
// Ils y ont été extraits au S5 : ce script et le gate en portaient chacun une copie, et
// elles avaient déjà divergé une fois — au S2, le classifieur qui range un fichier en
// « mécanique » a dû être corrigé DANS LES DEUX (2.5, `vi.isolateModules`).

// ── Analyse d'inertie au chargement (AST) ────────────────────────────────────

/**
 * Une expression est-elle inerte, c'est-à-dire évaluable sans rien exécuter d'observable ?
 *
 * ⚠️ **On ne descend jamais dans un corps de fonction.** `const DB = { get() { … } }` est
 * inerte quoi que fassent ses méthodes : elles ne tournent pas à l'import. Descendre y
 * classerait en « actif » presque tout module non trivial, et le triage perdrait son sens.
 *
 * @param {ts.Node} node Expression à juger.
 * @returns {boolean}
 */
function isInertExpression(node) {
    if (!node) return true;

    // Un corps de fonction ne s'exécute pas à l'import : la valeur elle-même est inerte.
    if (
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isClassExpression(node) ||
        ts.isMethodDeclaration(node)
    ) {
        return true;
    }

    if (ts.isCallExpression(node)) return isInertCall(node);

    // ⚠️ **Une AFFECTATION est un effet** — et cette garde manquait ici alors qu'elle existe,
    // à 350 lignes de distance, dans le `inert()` de {@link precedingEffects}. Deux analyses
    // voisines du même script qui divergent sur le même jugement : exactement le défaut que
    // l'ADR relève déjà deux fois (`new Map()` au S3, le classifieur de familles au S2), et
    // qui a valu l'extraction de `lib/test-load-sites.cjs`.
    //
    // Ce qu'elle laissait passer, mesuré au S4 : `built-in/api/geoleaf-api.ts` ouvre par
    // `_g.GeoLeaf = _g.GeoLeaf || {};` — l'installation du namespace public, au chargement.
    // {@link loadTimeEffects} la déclarait INERTE, donc la façade `geoleaf.api.ts` sortait
    // « rechargement décoratif » sur l'axe R2 : le contraire de la vérité, du côté qui fait
    // hisser un chargement porteur.
    if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
            return false;
        }
    }
    if (ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)) return false;

    // `new Map()`, `new Set()`, `new WeakMap()` — constructions sans effet de bord externe.
    if (ts.isNewExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (!/^(Map|Set|WeakMap|WeakSet|Date|Error|RegExp|Array|Object)$/.test(name)) return false;
        return (node.arguments || []).every(isInertExpression);
    }

    // Lire un global d'environnement au chargement compte comme un effet : le module
    // dépend alors de ce que le test a installé AVANT de le charger.
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        let root = node;
        while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
            root = root.expression;
        }
        if (ts.isIdentifier(root) && ENV_GLOBALS.has(root.text)) return false;
    }

    let inert = true;
    node.forEachChild((child) => {
        if (!inert) return;
        if (
            ts.isFunctionExpression(child) ||
            ts.isArrowFunction(child) ||
            ts.isMethodDeclaration(child) ||
            ts.isClassExpression(child)
        ) {
            return;
        }
        if (!isInertExpression(child)) inert = false;
    });
    return inert;
}

/**
 * Un appel est-il tolérable au chargement ? Seule la journalisation l'est — voir
 * {@link INERT_CALLEES} pour la justification, qui est écrite et non supposée.
 *
 * @param {ts.CallExpression} node
 * @returns {boolean}
 */
function isInertCall(node) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        return INERT_CALLEES.has(callee.expression.text);
    }
    return false;
}

/**
 * Un STATEMENT de premier niveau est-il inerte ?
 *
 * ⚠️ Existe parce que l'exemption {@link INERT_CALLEES} **ne survivait pas à une garde**.
 * `Log.info("… Module loaded")` était toléré ; `if (Log) Log.info("… Module loaded")` ne
 * l'était pas — non par décision, mais parce qu'un `IfStatement` tombait dans le `flag()`
 * final de {@link loadTimeEffects}, qui ne reconnaissait que les expressions et les
 * déclarations. Or c'est la forme la PLUS répandue du dépôt : les quatre modules de
 * `ui/cache-button/` la portent, et la roadmap en avait tiré « Log.info conditionnel » comme
 * un vrai cas porteur — un faux positif hérité de l'outil, pas une propriété du code.
 *
 * @param {ts.Statement} st
 * @returns {boolean}
 */
function isInertStatement(st) {
    if (ts.isBlock(st)) return st.statements.every(isInertStatement);
    if (ts.isEmptyStatement(st)) return true;
    if (ts.isExpressionStatement(st)) {
        // Directive de fichier (`"use strict";`) — inerte.
        return ts.isStringLiteral(st.expression) || isInertExpression(st.expression);
    }
    if (ts.isIfStatement(st)) {
        return (
            isInertExpression(st.expression) &&
            isInertStatement(st.thenStatement) &&
            (!st.elseStatement || isInertStatement(st.elseStatement))
        );
    }
    return false;
}

/**
 * Ce qu'un module exécute à l'import — la question qui décide si on peut le hoister.
 *
 * Si un module n'exécute rien au chargement, le **moment** de son chargement ne peut pas
 * compter : remonter son `require()` déféré en `import` de tête est sûr **par dérivation**,
 * pas par jugement de lecture. C'est toute la raison d'être de cette fonction.
 *
 * @param {string} file Chemin absolu d'un module `.ts`.
 * @returns {{line: number, text: string}[]} Effets relevés, vide si le module est inerte.
 */
function loadTimeEffects(file) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const effects = [];

    const flag = (node) => {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        effects.push({ line, text: node.getText(sf).split("\n")[0].slice(0, 90) });
    };

    for (const st of sf.statements) {
        if (
            ts.isImportDeclaration(st) ||
            ts.isImportEqualsDeclaration(st) ||
            ts.isExportDeclaration(st) ||
            ts.isInterfaceDeclaration(st) ||
            ts.isTypeAliasDeclaration(st) ||
            ts.isEnumDeclaration(st) ||
            ts.isFunctionDeclaration(st) ||
            ts.isClassDeclaration(st)
        ) {
            continue;
        }

        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (!isInertExpression(d.initializer)) {
                    flag(d);
                    break;
                }
            }
            continue;
        }

        if (!isInertStatement(st)) flag(st);
    }

    return effects;
}

/**
 * L'état de niveau module d'un module cible — l'axe R2 du sprint 4.
 *
 * ⚠️ **Ce n'est PAS {@link loadTimeEffects}, et les confondre inverse le verdict.** L'inertie
 * du S2 répond à « peut-on hoister ? » ; R2 répond à « le rechargement porte-t-il quelque
 * chose ? ». Les deux divergent sur la forme la plus courante du dépôt :
 *
 *     let _cache = null;   // INERTE au chargement — et pourtant c'est TOUTE la raison
 *                          // de recharger : c'est là que vit l'état qu'un test veut neuf.
 *
 * Un module sans aucun état de niveau module rend son rechargement **décoratif** : le
 * `vi.resetModules()` qui le précède ne change rien d'observable. C'est un constat à écrire
 * — le harnais `--prove-reload` le confirmera en le trouvant insensible des deux côtés — et
 * non un défaut à corriger dans ce sprint.
 *
 * ⚠️ Réserve du S3, reprise telle quelle : **ne jamais juger sur une cible MOCKÉE.** Une
 * factory remplace le module ; l'état du vrai module n'existe pas. L'appelant l'exclut.
 *
 * @param {string} file Chemin absolu d'un module `.ts`.
 * @returns {{line: number, text: string}[]} Porteurs d'état, vide si le module est sans état.
 */
function ownModuleState(file) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const held = [];

    const note = (node) =>
        held.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: node.getText(sf).split("\n")[0].slice(0, 90),
        });

    /** Un initialiseur crée-t-il un conteneur dont le contenu peut changer ? */
    const isMutableContainer = (init) => {
        if (!init) return false;
        if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) return true;
        if (ts.isNewExpression(init)) {
            const name = ts.isIdentifier(init.expression) ? init.expression.text : "";
            return /^(Map|Set|WeakMap|WeakSet)$/.test(name);
        }
        return false;
    };

    for (const st of sf.statements) {
        // Un effet de chargement est de l'état par construction : `LayerManagerModule = {…}`,
        // `globalEventManager = new EventListenerManager("global")`, `Object.assign(LS, …)`.
        // Les trois modules que le S3 a laissés en classe C sont exactement de cette forme.
        if (!ts.isVariableStatement(st)) {
            if (
                !isInertStatement(st) &&
                !ts.isImportDeclaration(st) &&
                !ts.isExportDeclaration(st)
            ) {
                if (
                    !ts.isInterfaceDeclaration(st) &&
                    !ts.isTypeAliasDeclaration(st) &&
                    !ts.isEnumDeclaration(st) &&
                    !ts.isFunctionDeclaration(st) &&
                    !ts.isClassDeclaration(st)
                ) {
                    note(st);
                }
            }
            continue;
        }

        // `let` / `var` de module : rebindables, donc de l'état — quelle que soit la valeur
        // initiale. C'est le cas que l'analyse d'inertie du S2 déclare (justement) inerte.
        const isLet = !(st.declarationList.flags & ts.NodeFlags.Const);
        for (const d of st.declarationList.declarations) {
            if (isLet || isMutableContainer(d.initializer)) {
                note(d);
                break;
            }
        }
    }

    return held;
}

/**
 * Profondeur de suivi du graphe pour {@link moduleState}.
 *
 * ⚠️ **Ce n'est pas un réglage de confort, c'est l'arbitrage de l'axe** — et il n'y a pas de
 * profondeur « juste » : R2 se dégrade continûment avec elle. Mesuré sur les 21 fichiers qui
 * rechargent, en nombre de fichiers déclarés PORTEURS :
 *
 *     depth 0 → 11 · depth 1 → **20** · depth 2 → 21 · depth 3 → 21 sur 21
 *
 * Dès 2 hops l'axe ne discrimine plus rien : tout module atteint un porteur d'état si on le
 * suit assez loin. C'est le défaut que le S3 a corrigé trois fois sur son axe 3 (« 71
 * fichiers sur 84 »), et il est ici structurel, pas accidentel.
 *
 * **1 est retenu parce que c'est la plus petite profondeur qui corrige un défaut DÉRIVABLE** —
 * les façades `geoleaf.*.ts`, dont le `import` de côté fait le travail un hop plus loin (voir
 * {@link moduleState}). Au-delà, on n'achète plus de justesse, on érode le pouvoir séparateur.
 *
 * ⚠️ Conséquence à retenir : **R2 est une ATTENTE, pas un critère.** Le critère est
 * `--prove-reload`, qui mesure au lieu de dériver. Un désaccord entre les deux se tranche en
 * faveur du harnais, et se lit comme une correction à apporter à R2.
 */
const STATE_DEPTH = 1;

/**
 * L'état de niveau module d'une cible, **en suivant ses imports statiques**.
 *
 * ⚠️ Sans ce suivi, l'axe se trompait sur exactement la forme la plus fréquente du périmètre.
 * `geoleaf.api.ts` ne contient qu'un `"use strict"`, un import et un ré-export — R2 le
 * déclarait « sans état, rechargement décoratif ». C'est faux : son commentaire écrit que
 * l'import est **de côté** et que le vrai travail, `Object.assign(GeoLeaf, {…})`, tourne dans
 * `built-in/api/geoleaf-api.js`, un hop plus loin. Le module de la façade est bien inerte ;
 * **le chargement de la façade, lui, ne l'est pas**, et c'est ce que le test recharge.
 *
 * C'est la 3ᵉ des quatre limites déjà écrites à l'ADR — « elle ne suit pas le graphe
 * transitif ». Elle était tolérable tant que l'analyse servait à décider un hoisting ; elle
 * ne l'est plus quand elle sert à dire « recharger ceci ne sert à rien ».
 *
 * @param {string} file Chemin absolu d'un module `.ts`.
 * @param {object} pkg Entrée de registre du paquet.
 * @returns {{line: number, text: string, via: string|null}[]} Vide si rien n'a d'état.
 */
function moduleState(file, pkg) {
    const seen = new Set();

    const visit = (abs, depth, via) => {
        if (seen.has(abs) || !fs.existsSync(abs)) return [];
        seen.add(abs);

        const own = ownModuleState(abs);
        if (own.length) return own.map((h) => ({ ...h, via }));
        if (depth >= STATE_DEPTH) return [];

        const src = fs.readFileSync(abs, "utf8");
        const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        for (const st of sf.statements) {
            const isImp = ts.isImportDeclaration(st);
            const isExp = ts.isExportDeclaration(st) && st.moduleSpecifier;
            if (!isImp && !isExp) continue;
            const spec = st.moduleSpecifier;
            if (!spec || !ts.isStringLiteral(spec)) continue;
            const hit = sites.resolveSource(abs, spec.text, pkg);
            if (!hit) continue;
            const found = visit(hit.abs, depth + 1, rel(hit.abs));
            if (found.length) return found;
        }
        return [];
    };

    return visit(file, 0, null);
}

// ── Analyse du fichier de TEST (les deux axes du sprint 3) ───────────────────

/**
 * Les cibles de `vi.mock()` / `vi.doMock()` d'un fichier de test, résolues.
 *
 * ⚠️ **Cet axe remplace l'arbitrage que la roadmap annonce.** Elle pose le tri du S3 comme
 * « `require()` **porteur** (contourne le hoisting de `vi.mock`) vs `require()`
 * **d'habitude** » — or dans ce dépôt `require()` ne contourne rien : le `setup.js` du core
 * intercepte `Module._load` et **sert** les factories aux `require()`. Prouvé au 3.0 : sur
 * `config/config-loaders.test.js`, neutraliser les `vi.mock()` fait rougir 6 tests sur 6
 * **avant** conversion. Le mock était déjà en vigueur.
 *
 * La question utile n'est donc pas une intention mais une résolution de specifier : **la
 * cible de ce `require()` est-elle mockée dans le même fichier ?**
 *
 * @param {string} tf Chemin absolu du fichier de test.
 * @param {string} src Source du fichier de test.
 * @param {object} pkg Entrée de registre du paquet.
 * @returns {Set<string>} Chemins repo-relatifs des modules mockés.
 */
function mockTargets(tf, src, pkg) {
    const out = new Set();
    for (const m of src.matchAll(/vi\.(?:mock|doMock)\(\s*(['"])([^'"]+)\1/g)) {
        const hit = sites.resolveSource(tf, m[2], pkg);
        if (hit) out.add(rel(hit.abs));
    }
    return out;
}

/**
 * Les variables de module qu'une factory `vi.mock()` capture — donc la TDZ.
 *
 * ⚠️ **C'est le motif dominant du S3, et il n'est ni dans la roadmap ni dans son plan.**
 * `vi.mock()` est hissé au-dessus du corps du fichier : une factory qui referme sur un
 * `const` de module s'exécute donc **avant que ce `const` existe**. Le `require()` différé
 * masquait le défaut en appelant la factory tard. Mesuré au 3.0 en convertissant le
 * `require()` de tête de `config/config-loaders.test.js` en `import` :
 *
 *     ReferenceError: Cannot access 'mockLog' before initialization
 *
 * Le geste est `vi.hoisted()`, qui fait initialiser les fixtures avant toute factory. Une
 * déclaration dont l'initialiseur EST un `vi.hoisted(...)` est donc sûre : elle ne compte pas.
 *
 * @param {string} file Chemin absolu du fichier de test.
 * @param {string} src Source du fichier de test.
 * @returns {string[]} Noms capturés — vide si l'import statique est sûr.
 */
function hoistCaptures(file, src) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    const isHoistedCall = (init) =>
        !!init &&
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === "hoisted";

    /** Noms déclarés au niveau module, `vi.hoisted()` exclu. */
    const moduleScope = new Set();
    const addNames = (name) => {
        if (ts.isIdentifier(name)) {
            moduleScope.add(name.text);
            return;
        }
        if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
            for (const el of name.elements) if (ts.isBindingElement(el)) addNames(el.name);
        }
    };
    for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
            if (isHoistedCall(d.initializer)) continue;
            addNames(d.name);
        }
    }
    if (!moduleScope.size) return [];

    const captured = new Set();
    // Ne comptent que les LECTURES : le `Log` de `{ Log: mockLog }` est une clé, et le `b`
    // de `a.b` un nom de propriété. Les compter fabriquerait des captures qui n'existent pas.
    //
    // ⚠️ Et seules les lectures IMMÉDIATES : on ne descend pas dans une fonction imbriquée.
    // `() => ({ Log: mockLog })` lit `mockLog` quand la factory est appelée, donc pendant la
    // phase hissée — TDZ. `() => ({ get state() { return _sharedState } })` ne le lit qu'au
    // premier accès à `.state`, longtemps après : aucune TDZ. Même principe que
    // {@link isInertExpression}, qui ne descend pas non plus dans un corps de fonction.
    const isFunctionLike = (n) =>
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isGetAccessorDeclaration(n) ||
        ts.isSetAccessorDeclaration(n);

    const readIdents = (node) => {
        if (isFunctionLike(node)) return;
        if (ts.isPropertyAssignment(node)) return readIdents(node.initializer);
        if (ts.isPropertyAccessExpression(node)) return readIdents(node.expression);
        if (ts.isIdentifier(node)) {
            if (moduleScope.has(node.text)) captured.add(node.text);
            return;
        }
        node.forEachChild(readIdents);
    };
    const scan = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "mock" &&
            node.arguments.length > 1
        ) {
            const factory = node.arguments[1];
            // La factory elle-même est une fonction : on entre dans SON corps, puis on
            // s'arrête à toute fonction plus profonde.
            if (isFunctionLike(factory)) {
                if (factory.body) readIdents(factory.body);
            } else {
                readIdents(factory);
            }
        }
        node.forEachChild(scan);
    };
    scan(sf);

    return [...captured].sort();
}

/**
 * Ce qui s'exécute au niveau module AVANT le premier `require()` du fichier de test.
 *
 * ⚠️ **« Tous les `require()` au top level » ne veut PAS dire « l'ordre ne compte pas ».**
 * L'ADR du S2 l'écrit noir sur blanc — c'est la deuxième de ses quatre limites du triage —
 * et le lot 1 du S3 en contient trois cas d'un coup : `api/geoleaf-api.test.js` installe
 * `globalThis.GeoLeaf._APIController` avant de charger, `ui/ui-api.test.js` pose
 * `_g.GeoLeaf._UITheme`, et `ui/desktop-panel-branches.test.js` redéfinit `window.matchMedia`.
 * Les trois modules lisent cet environnement **au chargement** : un `import` statique, qui se
 * hisse au-dessus, chargerait avant que l'environnement existe.
 *
 * La question est donc dérivable, comme l'inertie du module cible au S2 — mais elle porte sur
 * le fichier de TEST, et ses formes inertes ne sont pas les mêmes (`vi.fn()` crée une fixture,
 * `vi.spyOn()` installe un espion). D'où une analyse distincte plutôt qu'un paramètre de plus
 * sur {@link isInertExpression}, qui juge un module de production.
 *
 * @param {string} file Chemin absolu du fichier de test.
 * @param {string} src Source du fichier de test.
 * @returns {{line: number, text: string}[]} Effets relevés, vide si le hoisting est sûr.
 */
function precedingEffects(file, src) {
    if (!/require\(\s*['"]\.\.?\//.test(src)) return [];

    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    // ⚠️ La borne est l'instruction QUI PORTE le premier `require`, pas l'index du mot. Bornée
    // à l'index, l'analyse incluait `const { X } = require(…)` elle-même et signalait son
    // propre `require` comme un effet — 72 fichiers sur 84, un axe qui ne discrimine plus.
    const LOAD = /require\(\s*['"]\.\.?\//;
    const loadIdx = sf.statements.findIndex((st) => LOAD.test(st.getText(sf)));
    // Aucun `require` au niveau module : le chargement est déjà différé, la question ne se
    // pose pas — c'est le cas des classes B et C.
    if (loadIdx === -1) return [];

    /** Appels `vi.*` sans effet observable : ils créent une fixture ou sont hissés. */
    const VI_INERT = new Set(["fn", "hoisted", "mock", "doMock", "unmock"]);

    /**
     * Enregistrements de suite : `beforeAll(fn)` inscrit un rappel, il ne l'exécute pas.
     * Le corps tourne après l'évaluation du module, donc jamais avant le `require` de tête.
     */
    const REGISTRARS = new Set([
        "describe",
        "it",
        "test",
        "beforeAll",
        "beforeEach",
        "afterAll",
        "afterEach",
    ]);

    /**
     * Un appel est-il une simple fabrication de fixture ?
     *
     * ⚠️ Deux formes, et oublier la seconde sur-signale massivement : `vi.fn()` d'une part,
     * et la CHAÎNE `vi.fn().mockReturnValue(null)` d'autre part, qui est la manière normale
     * d'armer un double. La première version comptait 71 fichiers sur 84 — presque tout le
     * périmètre, donc un axe qui ne discrimine plus rien.
     */
    const isFixtureCall = (node) => {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && REGISTRARS.has(callee.text)) return true;
        if (!ts.isPropertyAccessExpression(callee)) return false;
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "vi") {
            return VI_INERT.has(callee.name.text);
        }
        // `.mockReturnValue(…)`, `.mockImplementation(…)`, … chaînés sur une fixture.
        return (
            callee.name.text.startsWith("mock") &&
            ts.isCallExpression(callee.expression) &&
            isFixtureCall(callee.expression)
        );
    };

    const inert = (node) => {
        if (!node) return true;
        if (
            ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) ||
            ts.isClassExpression(node)
        ) {
            return true;
        }
        // ⚠️ Une AFFECTATION est l'effet même que cet axe traque — `_g.GeoLeaf._UITheme = {…}`
        // installe l'environnement que le module lira au chargement. La première version
        // descendait dedans sans la reconnaître et la rendait « inerte » : un faux négatif
        // sur exactement le cas à attraper.
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            return false;
        }
        if (ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)) return false;
        if (ts.isCallExpression(node)) {
            return isFixtureCall(node) && node.arguments.every((a) => inert(a));
        }
        // ⚠️ Même allowlist que {@link isInertExpression}, et pour la même raison : `new Map()`
        // ne touche rien d'extérieur. La première version refusait TOUT `new`, si bien que
        // `const state = { layers: new Map() }` — une fixture pure — sortait « effet » sur
        // sept fichiers. Deux analyses voisines du même script qui divergent sur le même
        // jugement, c'est exactement le défaut que ce dépôt collectionne.
        if (ts.isNewExpression(node)) {
            const name = ts.isIdentifier(node.expression) ? node.expression.text : "";
            if (!/^(Map|Set|WeakMap|WeakSet|Date|Error|RegExp|Array|Object)$/.test(name)) {
                return false;
            }
            return (node.arguments ?? []).every((a) => inert(a));
        }
        let ok = true;
        node.forEachChild((child) => {
            if (!ok) return;
            if (
                ts.isFunctionExpression(child) ||
                ts.isArrowFunction(child) ||
                ts.isClassExpression(child)
            ) {
                return;
            }
            if (!inert(child)) ok = false;
        });
        return ok;
    };

    const effects = [];
    for (const st of sf.statements.slice(0, loadIdx)) {
        if (
            ts.isImportDeclaration(st) ||
            ts.isFunctionDeclaration(st) ||
            ts.isClassDeclaration(st) ||
            ts.isInterfaceDeclaration(st) ||
            ts.isTypeAliasDeclaration(st)
        ) {
            continue;
        }
        let effectful = false;
        if (ts.isVariableStatement(st)) {
            effectful = st.declarationList.declarations.some((d) => !inert(d.initializer));
        } else if (ts.isExpressionStatement(st)) {
            if (ts.isStringLiteral(st.expression)) continue;
            effectful = !inert(st.expression);
        } else {
            effectful = true;
        }
        if (!effectful) continue;
        effects.push({
            line: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1,
            text: st.getText(sf).split("\n")[0].slice(0, 76),
        });
    }
    return effects;
}

/**
 * Quels `require()` d'un fichier sont des sites de RECHARGEMENT — l'axe R1 du sprint 4.
 *
 * ## Pourquoi cet axe passe avant tous les autres
 *
 * La famille (`classify`) est un attribut de **fichier** : il suffit d'un `vi.resetModules()`
 * quelque part pour que le fichier entier soit rangé « reload ». Le **geste**, lui, se décide
 * au **site**. Mesuré sur le périmètre du S4 : 44 sites rechargent, **15 ne rechargent pas**
 * — ce sont des `require()` ordinaires qui cohabitent avec un rechargement situé ailleurs
 * dans le fichier, et 3 fichiers sur 25 n'ont que de ceux-là.
 *
 * Sans cet axe, le classement A/B/C du S2 décide seul — et il décide **mal, du côté qui coûte
 * cher**. Il juge l'inertie de la cible et range la plupart des 44 en classe B, « remontée en
 * `import` statique SÛRE ». C'est exact sur l'inertie et faux sur l'intention : hisser
 * détruirait le rechargement, et **le test resterait vert en testant la première instance**.
 * C'est le mode d'échec que tout ce sprint existe pour éviter, et la 1ʳᵉ des quatre limites
 * déjà écrites à l'ADR — « elle juge le module CIBLE, pas l'intention du hook ».
 *
 * ## Ce qui est dérivé
 *
 * Un site recharge si son `require()` est lexicalement dans un `vi.isolateModules(…)`, si un
 * `vi.resetModules()` le précède dans l'un de ses blocs englobants, ou s'il vit dans un
 * **helper de niveau module** — troisième cas, ajouté après l'avoir vu manquer.
 *
 * ⚠️ La remontée se fait sur TOUS les blocs englobants, pas seulement le plus proche : le
 * `vi.resetModules()` de `geojson-core.test.js` ouvre le `beforeEach` et les `require()`
 * qu'il couvre sont dans une boucle imbriquée deux niveaux plus bas.
 *
 * ⚠️ **Le cas indirect, et pourquoi il compte comme rechargement.** `utils/runtime-metrics`
 * porte `function loadModule() { … require(…) }` au niveau module, appelée depuis les tests
 * APRÈS le `vi.resetModules()` du `beforeEach`. Lexicalement, aucun reset ne précède ce
 * `require` — l'analyse le rendait « collatéral », donc hoistable, ce qui aurait détruit le
 * rechargement en laissant la suite verte. Les appels d'un helper sont ailleurs : on ne peut
 * PAS prouver qu'aucun reset ne les précède, et la règle du S2 tranche dans ce sens —
 * « `await import()` coûte un mot pour préserver l'ordre à la lettre ».
 *
 * @param {string} file Chemin absolu du fichier de test.
 * @param {string} src Source du fichier de test.
 * @returns {Map<number, "iso"|"reset"|"indirect">} Ligne du `require()` → ce qui le recharge.
 */
function reloadSites(file, src) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    const requires = [];
    const isolators = [];
    const resets = [];

    const collect = (node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isIdentifier(callee) && callee.text === "require") {
                requires.push(node);
            } else if (
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === "vi"
            ) {
                // ⚠️ `vi.isolateModules` **n'existe pas dans Vitest** (4.1.8 : `grep` rend
                // zéro). Les 5 fichiers qui l'appellent ne tournent que parce que
                // `packages/core/__tests__/setup.js:565` le DÉFINIT — et son « use Jest's
                // native isolateModules when available » est du code mort, `setup.js:9`
                // posant `globalThis.jest = vi`. Ce que le shim fait tient en deux lignes :
                // `clearCJSCache(); fn();`. La cible annoncée par la roadmap et par l'ADR,
                // `vi.isolateModulesAsync()`, n'existe pas davantage : le seul geste ESM est
                // `vi.resetModules()` puis `await import()`.
                if (/^isolateModules(Async)?$/.test(callee.name.text)) isolators.push(node);
                if (callee.name.text === "resetModules") resets.push(node);
            }
        }
        ts.forEachChild(node, collect);
    };
    collect(sf);

    const covers = (outer, inner) =>
        inner.getStart(sf) >= outer.getStart(sf) && inner.getEnd() <= outer.getEnd();

    /** Enregistrements de suite : leur callback s'exécute DANS le déroulé, pas ailleurs. */
    const REGISTRARS = new Set([
        "describe",
        "it",
        "test",
        "beforeAll",
        "beforeEach",
        "afterAll",
        "afterEach",
    ]);
    const isFn = (n) =>
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n);

    /**
     * Le `require()` vit-il dans un helper de niveau module, plutôt que dans le déroulé
     * d'un hook ? On juge la fonction la plus EXTERNE : un `forEach` imbriqué dans un
     * `beforeEach` reste du déroulé, et le prendre pour un helper sur-signalerait.
     */
    const inModuleHelper = (req) => {
        let outermost = null;
        for (let c = req.parent; c; c = c.parent) if (isFn(c)) outermost = c;
        if (!outermost) return false;
        const par = outermost.parent;
        const isCallback =
            par &&
            ts.isCallExpression(par) &&
            ((ts.isIdentifier(par.expression) && REGISTRARS.has(par.expression.text)) ||
                (ts.isPropertyAccessExpression(par.expression) &&
                    ts.isIdentifier(par.expression.expression) &&
                    par.expression.expression.text === "vi"));
        return !isCallback;
    };

    const out = new Map();
    for (const req of requires) {
        const line = sf.getLineAndCharacterOfPosition(req.getStart(sf)).line + 1;
        if (isolators.some((iso) => covers(iso, req))) {
            out.set(line, "iso");
            continue;
        }
        let verdict = null;
        for (let scope = req.parent; scope && !verdict; scope = scope.parent) {
            if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
            if (resets.some((r) => covers(scope, r) && r.getEnd() < req.getStart(sf))) {
                verdict = "reset";
            }
        }
        if (!verdict && inModuleHelper(req)) verdict = "indirect";
        if (verdict) out.set(line, verdict);
    }
    return out;
}

// ── Triage ───────────────────────────────────────────────────────────────────

/**
 * Classe les fichiers de test « mécaniques » du périmètre par geste de conversion.
 *
 * ⚠️ « Mécanique » au sens de `verify-test-load-mode.cjs` est une définition NÉGATIVE — ni
 * `vi.mock()` ni `resetModules()`. Elle ne dit rien de la FORME du site, et la roadmap en
 * a tiré à tort que la conversion serait « un remplacement de specifier ». Mesuré : ça ne
 * l'est que pour la classe A.
 *
 * @returns {{files: object[], witnesses: string[], loads: Map<string, {req: Set, imp: Set}>}}
 */
function triage() {
    const packages = SCOPE.map(requirePkg);

    /** module source → { req: Set<testFile>, imp: Set<testFile> } — tous paquets confondus. */
    const loads = new Map();
    const touch = (mod) => {
        if (!loads.has(mod)) loads.set(mod, { req: new Set(), imp: new Set() });
        return loads.get(mod);
    };

    // Le graphe de chargement se calcule sur TOUT le dépôt : un module du core peut être
    // importé par un test d'un autre paquet, et c'est ce qui décide s'il est un témoin
    // propre. Le triage, lui, ne porte que sur le périmètre.
    const inScope = new Set(packages.map((p) => p.name));
    const files = [];

    for (const p of registry.all()) {
        /** Sites `require()` du paquet, specifiers relatifs ET nus (lib partagée). */
        const byFile = new Map();
        for (const s of sites.collectSites(p)) {
            if (!byFile.has(s.file)) byFile.set(s.file, []);
            byFile.get(s.file).push(s);
        }

        for (const tf of sites.walkTests(p.absDir)) {
            const relTf = rel(tf);
            const src = fs.readFileSync(tf, "utf8");
            const scrubbed = sites.scrubMocks(src);

            const mySites = (byFile.get(relTf) ?? []).filter((s) => s.mod);
            for (const s of mySites) touch(path.join(ROOT, s.mod)).req.add(tf);

            // Le versant `import` du graphe : relatifs ET nus, mêmes règles de résolution.
            const impSpecs = [
                ...scrubbed.matchAll(/(?:^|\s)import\s[^;]*?from\s*(['"])([^'"]+)\1/g),
                ...scrubbed.matchAll(/(?:await\s+)?import\(\s*(['"])([^'"]+)\1\s*\)/g),
                ...scrubbed.matchAll(/importActual\(\s*(['"])([^'"]+)\1\s*\)/g),
            ].map((m) => m[2]);
            for (const spec of impSpecs) {
                const hit = sites.resolveSource(tf, spec, p);
                if (hit) touch(hit.abs).imp.add(tf);
            }

            if (!mySites.length) continue;
            if (!inScope.has(p.name)) continue;
            // La définition des familles vit dans `lib/test-load-sites.cjs`, pas ici : au S2
            // il a fallu la corriger dans DEUX scripts à la fois (2.5).
            //
            // ⚠️ Le filtre `if (family === "reload") continue;` a sauté au S4, comme celui de
            // la famille « mock » avait sauté au S3. Tant qu'il tenait, ces 25 fichiers
            // n'étaient dans AUCUN inventaire de l'outil : ni triage, ni `--prove-mocks`
            // (0 des 16 qui portent pourtant `vi.mock()` ne figure au relevé du S3), et
            // c'est de là que vient l'affirmation — fausse — que le shim `Module._load`
            // n'aurait plus de consommateur après le S3. Il en a 14, tous ici.
            const family = sites.classify(src);

            // Les axes du S3. Sur la famille « mechanical » ils sont vides par construction —
            // pas de `vi.mock()`, donc ni cible mockée ni capture.
            const hasMocks = family === "mock" || /vi\.(?:do)?mock\(/.test(src);
            const mocked = hasMocks ? mockTargets(tf, src, p) : new Set();

            // L'axe R1 du S4 — et il DOIT passer avant le classement A/B/C, qui range un
            // site de rechargement en « remontée sûre » : exact sur l'inertie, faux sur
            // l'intention, et vert une fois cassé.
            const reloading = family === "reload" ? reloadSites(tf, src) : new Map();
            const reloadOf = (s) => reloading.get(s.line) ?? null;
            const reload = mySites.filter((s) => reloadOf(s));

            const deferred = mySites.filter((s) => s.deferred);
            const active = [];
            for (const s of deferred) {
                // ⚠️ Une cible MOCKÉE dans ce fichier n'est jamais évaluée : la factory
                // remplace le module, et ce que le vrai module ferait au chargement n'a plus
                // lieu. La juger « active » range le fichier en C — donc « garder le déféré »
                // — pour un effet qui ne se produira pas. Mesuré au lot 5 : 4 fichiers sur 7
                // n'étaient C que par des cibles mockées (`config/profile.ts`,
                // `geojson/core.ts`, `basemap-selector.ts`).
                if (mocked.has(s.mod)) continue;
                const eff = loadTimeEffects(path.join(ROOT, s.mod));
                if (eff.length) active.push({ mod: s.mod, effect: eff[0] });
            }

            // ⚠️ Ces deux axes étaient gardés par `family === "mock"`, ce qui les rendait
            // aveugles aux 16 fichiers du S4 qui portent AUSSI `vi.mock()` — or ils y sont
            // exactement aussi nécessaires : la TDZ ne dépend pas de la présence d'un
            // `resetModules` ailleurs dans le fichier.
            const captures = hasMocks ? hoistCaptures(tf, src) : [];
            const preceding = hasMocks ? precedingEffects(tf, src) : [];

            // L'axe R2 — sur les seules cibles RECHARGÉES, et jamais sur une cible mockée
            // (même réserve qu'au-dessus : le vrai module n'est pas évalué).
            const stateful = [];
            const stateless = [];
            for (const s of reload) {
                if (mocked.has(s.mod)) continue;
                const held = moduleState(path.join(ROOT, s.mod), p);
                if (held.length) stateful.push({ mod: s.mod, held: held[0] });
                else if (!stateless.includes(s.mod)) stateless.push(s.mod);
            }

            files.push({
                pkg: p.name,
                family,
                file: relTf,
                sites: mySites.length,
                bare: mySites.filter((s) => s.kind === "bare").length,
                modules: [...new Set(mySites.map((s) => s.mod))],
                klass: deferred.length === 0 ? "A" : active.length ? "C" : "B",
                active,
                // Sites dont la cible est mockée dans CE fichier : le déféré peut y être
                // porteur si un mock est configuré entre le hissage et le chargement.
                m1: mySites.filter((s) => mocked.has(s.mod)).length,
                captures,
                preceding,
                // Axes du S4. `reload` compte les sites qui RECHARGENT ; les autres sites du
                // fichier sont des `require()` ordinaires, à convertir au geste S2/S3.
                reload: reload.length,
                reloadIso: mySites.filter((s) => reloadOf(s) === "iso").length,
                stateful,
                stateless,
            });
        }
    }

    // Modules qu'AUCUN test ne charge par `import` : istanbul ne leur voit qu'un résidu
    // (`LH:1` à `4`, la ligne d'import), donc leur conversion fait franchement monter A1.
    // Un lot qui n'en contient aucun peut sortir « rien de plus qu'avant » tout en étant
    // juste — d'où ce compte, qui sert à COMPOSER les lots et non à les juger.
    for (const f of files) {
        f.reqOnly = f.modules.filter((m) => {
            const L = loads.get(path.join(ROOT, m));
            return L && !L.imp.size;
        }).length;
    }

    // Témoins propres : après conversion ils n'auront qu'UN seul chemin de chargement, donc
    // leur relevé est non ambigu. C'est sur eux que A1 a le plus de valeur probante.
    const mechFiles = new Set(files.map((f) => f.file));
    const witnesses = [];
    for (const f of files) {
        for (const mod of f.modules) {
            const abs = path.join(ROOT, mod);
            const L = loads.get(abs);
            if (!L || L.imp.size) continue;
            if ([...L.req].some((t) => !mechFiles.has(rel(t)))) continue;
            if (!witnesses.includes(mod)) witnesses.push(mod);
        }
    }

    return { files, witnesses: witnesses.sort(), loads };
}

/** @param {ReturnType<typeof triage>} t */
function printTriage(t) {
    const nSites = (a) => a.reduce((n, f) => n + f.sites, 0);
    const nBare = (a) => a.reduce((n, f) => n + f.bare, 0);
    const line = (label, a, geste) => {
        console.log(`  ${label} : ${a.length} fichiers / ${nSites(a)} sites`);
        console.log(`      → ${geste}`);
    };

    const mech = t.files.filter((f) => f.family === "mechanical");
    const mock = t.files.filter((f) => f.family === "mock");

    console.log("ℹ audit-test-load-conversion — triage\n");
    console.log("  ══ Mécaniques — sprints 2 et 5 ══\n");

    for (const name of SCOPE) {
        const own = mech.filter((f) => f.pkg === name);
        const bare = nBare(own);
        console.log(
            `  ${name.padEnd(26)} ${String(own.length).padStart(3)} fichiers / ` +
                `${String(nSites(own)).padStart(3)} sites` +
                (bare ? `   (dont ${bare} par specifier NU)` : "")
        );
    }

    const by = (k) => mech.filter((f) => f.klass === k);
    const A = by("A"),
        B = by("B"),
        C = by("C");

    console.log("");
    line("A — require() tous au top level ", A, "import statique, remplacement de specifier");
    line(
        "B — différé, module cible INERTE",
        B,
        "remontée en import statique SÛRE (dérivée, pas supposée)"
    );
    line("C — différé, module cible ACTIF ", C, "garder le déféré : await import() dans le hook");
    console.log(
        `\n  TOTAL : ${mech.length} fichiers / ${nSites(mech)} sites` +
            `  ·  ${t.witnesses.length} modules témoins propres (un seul chemin après conversion)`
    );

    if (C.length) {
        console.log("\n  ── Classe C, à instruire un par un ──");
        for (const f of C) {
            console.log(`  • ${f.file}`);
            for (const a of f.active) {
                console.log(`      ${a.mod}:${a.effect.line}  ${a.effect.text}`);
            }
        }
    }

    // ⚠️ `printReloadTriage` est appelé ICI, pas en fin de fonction : le `return` du S3
    // ci-dessous sort dès que la famille « mock » est vide — ce qui est le cas depuis que le
    // S3 est soldé. Placée après lui, la section du S4 ne se serait jamais affichée, et
    // l'outil aurait annoncé un périmètre vide en ayant simplement cessé de regarder.
    printReloadTriage(t);

    if (!mock.length) return;

    // ── Sprint 3. Deux axes en plus de la position, et ce sont eux qui décident du geste.
    // La roadmap annonçait un arbitrage (« porteur vs habitude ») ; les deux sont dérivés du
    // source, comme l'analyse d'inertie du S2.
    const tdz = mock.filter((f) => f.captures.length);
    const clean = mock.filter((f) => !f.captures.length);
    const m1Sites = mock.reduce((n, f) => n + f.m1, 0);

    console.log("\n\n  ══ vi.mock() — sprint 3 ══\n");
    console.log(`  ${mock.length} fichiers / ${nSites(mock)} sites\n`);

    console.log("  Axe 1 — une factory vi.mock() capture-t-elle une variable de module ?");
    console.log(
        `    OUI  : ${String(tdz.length).padStart(3)} fichiers / ${nSites(tdz)} sites` +
            "   → vi.hoisted() AVANT tout import statique, sinon TDZ"
    );
    console.log(
        `    non  : ${String(clean.length).padStart(3)} fichiers / ${nSites(clean)} sites` +
            "   → import statique direct"
    );

    console.log("\n  Axe 2 — la cible du require() est-elle mockée dans le MÊME fichier ?");
    console.log(
        `    M1   : ${String(m1Sites).padStart(3)} sites` +
            "               → vérifier qu'aucun mock n'est configuré avant le chargement"
    );
    console.log(
        `    M0   : ${String(nSites(mock) - m1Sites).padStart(3)} sites` +
            "               → le triage A/B/C ci-dessus s'applique tel quel"
    );

    const mby = (k) => mock.filter((f) => f.klass === k);
    console.log("\n  Position / inertie, mêmes classes qu'au S2 :");
    console.log(
        `    A ${mby("A").length} fichiers / ${nSites(mby("A"))} sites` +
            `  ·  B ${mby("B").length} / ${nSites(mby("B"))}` +
            `  ·  C ${mby("C").length} / ${nSites(mby("C"))}`
    );

    const pre = mock.filter((f) => f.preceding.length);
    console.log("\n  Axe 3 — quelque chose s'exécute-t-il AVANT le premier require() ?");
    console.log(
        `    OUI  : ${String(pre.length).padStart(3)} fichiers / ${nSites(pre)} sites` +
            "   → garder le déféré : await import(), un import se hisserait au-dessus"
    );

    if (tdz.length) {
        console.log("\n  ── Capture de module, à faire passer par vi.hoisted() ──");
        for (const f of tdz) {
            console.log(`  • ${f.file}  ← ${f.captures.join(", ")}`);
        }
    }

    if (pre.length) {
        console.log("\n  ── Environnement posé avant le chargement, à NE PAS hisser ──");
        for (const f of pre) {
            console.log(`  • ${f.file}`);
            for (const e of f.preceding.slice(0, 3)) console.log(`      :${e.line}  ${e.text}`);
        }
    }
}

/**
 * La famille « reload » — sprint 4.
 *
 * @param {ReturnType<typeof triage>} t
 */
function printReloadTriage(t) {
    const reload = t.files.filter((f) => f.family === "reload");
    if (!reload.length) return;

    const nSites = (a) => a.reduce((n, f) => n + f.sites, 0);
    const nReload = reload.reduce((n, f) => n + f.reload, 0);
    const nIso = reload.reduce((n, f) => n + f.reloadIso, 0);

    console.log("\n\n  ══ resetModules() / isolateModules() — sprint 4 ══\n");
    console.log(`  ${reload.length} fichiers / ${nSites(reload)} sites\n`);

    console.log("  Axe R1 — ce require() RECHARGE-t-il, ou cohabite-t-il avec un rechargement ?");
    console.log(
        `    reload      : ${String(nReload).padStart(3)} sites` +
            `  (dont ${nIso} en isolateModules)   → vi.resetModules() + await import() EN PLACE`
    );
    console.log(
        `    collatéral  : ${String(nSites(reload) - nReload).padStart(3)} sites` +
            "                            → geste ordinaire S2/S3 : import statique"
    );
    console.log(
        "    ⚠️ Le classement A/B/C ci-dessus rangerait la plupart des sites « reload » en\n" +
            "       classe B — remontée SÛRE. Exact sur l'inertie, faux sur l'intention : hisser\n" +
            "       détruit le rechargement, et le test reste VERT sur la première instance."
    );

    const pureCollateral = reload.filter((f) => f.reload === 0);
    if (pureCollateral.length) {
        console.log(
            `\n    ${pureCollateral.length} fichier(s) 100 % collatéraux — leur resetModules() ne couvre aucun require() :`
        );
        for (const f of pureCollateral) console.log(`      • ${f.file}`);
    }

    const stateful = reload.filter((f) => f.stateful.length);
    const decorative = reload.filter((f) => !f.stateful.length && f.stateless.length);

    console.log("\n  Axe R2 — le module rechargé porte-t-il un état de niveau module ?");
    console.log(
        `    OUI  : ${String(stateful.length).padStart(3)} fichiers` +
            "   → le rechargement est porteur, --prove-reload doit les voir SENSIBLES"
    );
    console.log(
        `    non  : ${String(decorative.length).padStart(3)} fichiers` +
            "   → rechargement décoratif : insensible AVANT comme APRÈS, donc CONFORME"
    );
    console.log(
        "    ⚠️ R2 n'est pas l'inertie du S2 : `let _cache = null` est inerte au chargement\n" +
            "       et c'est pourtant TOUTE la raison de recharger.\n" +
            "    ⚠️ Et R2 discrimine PEU — il suffit d'un hop de plus pour qu'il déclare tout\n" +
            "       porteur (20/21 ici, 21/21 à depth 2). C'est une ATTENTE posée avant mesure,\n" +
            "       PAS un critère : le critère est --prove-reload, et son invariant l'ÉGALITÉ."
    );

    if (decorative.length) {
        console.log("\n  ── Rechargement sans état à recharger, à confirmer par --prove-reload ──");
        for (const f of decorative) {
            console.log(`  • ${f.file}  ← ${f.stateless.join(", ")}`);
        }
    }
}

// ── Preuve que les mocks sont en vigueur ─────────────────────────────────────

/** Suffixe des fichiers-sondes. Transitoires : écrits, lancés, supprimés. */
const PROBE_SUFFIX = ".__probe.test.js";

/**
 * Supprime les sondes qu'une exécution interrompue aurait laissées.
 *
 * Appelé AVANT chaque campagne : une sonde oubliée serait un fichier de test de plus dans
 * le dépôt, que le gate du S1 compterait et que `git status` ferait passer pour du travail.
 *
 * @param {object} pkg Entrée de registre.
 * @returns {number} Sondes supprimées.
 */
function sweepProbes(pkg) {
    let n = 0;
    for (const f of sites.walkTests(pkg.absDir)) {
        if (f.endsWith(PROBE_SUFFIX)) {
            fs.rmSync(f, { force: true });
            n += 1;
        }
    }
    return n;
}

/**
 * Neutralise les `vi.mock()` d'un fichier SANS toucher à rien d'autre.
 *
 * Renommer l'appel suffit et c'est le geste le plus sûr : le transform de Vitest ne cherche
 * que `vi.mock(`, donc l'appel renommé n'est plus hissé, et le stub le rend inerte. Les
 * factories restent en place — ce sont des fonctions fléchées, elles ne s'exécutent pas.
 * Tout le reste du fichier, fixtures et assertions comprises, est **inchangé**.
 *
 * ⚠️ `vi.mocked(` ne matche pas : la regex exige la parenthèse juste après `mock`.
 *
 * @param {string} src Source du fichier de test.
 * @returns {{code: string, mocks: number}}
 */
function neutraliseMocks(src) {
    // Même correction qu'à {@link neutraliseReload} : un `vi.mock(` cité en commentaire
    // fabriquait une sonde vide.
    const mocks = (sites.stripComments(src).match(/vi\.mock\(/g) ?? []).length;
    return {
        code: `vi.__disabled_mock = () => {};\n${src.replace(/vi\.mock\(/g, "vi.__disabled_mock(")}`,
        mocks,
    };
}

/**
 * Lance des fichiers de test et rend leur verdict, fichier par fichier.
 *
 * Une seule invocation de Vitest pour tout le lot : le coût est dominé par le démarrage, et
 * un fichier qui explose n'empêche pas les autres de rendre leur résultat.
 *
 * @param {string[]} files Chemins absolus.
 * @param {object} pkg Entrée de registre.
 * @returns {Map<string, boolean>} fichier → a échoué (donc sensible).
 */
function runAndCollect(files, pkg) {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const outFile = path.join(SNAP_DIR, `probe-run-${pkg.dirName}.json`);
    fs.rmSync(outFile, { force: true });

    spawnSync(
        "npx",
        [
            "vitest",
            "run",
            "--config",
            path.join(pkg.absDir, "vitest.config.ts"),
            "--reporter=json",
            `--outputFile=${outFile}`,
            ...files,
        ],
        {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env, CI: "true" },
            maxBuffer: 64 * 1024 * 1024,
        }
    );

    const verdict = new Map();
    if (!fs.existsSync(outFile)) return verdict;
    const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
    for (const r of report.testResults ?? []) {
        verdict.set(path.resolve(ROOT, r.name), r.status === "failed");
    }
    fs.rmSync(outFile, { force: true });
    return verdict;
}

/**
 * Neutralise les `vi.resetModules()` / `vi.isolateModules()` d'un fichier — le contrôle du
 * sprint 4, et le pendant exact de {@link neutraliseMocks}.
 *
 * ⚠️ **Le stub d'`isolateModules` exécute quand même `fn()`.** On retire l'isolation, PAS le
 * chargement : sinon le fichier ne chargerait plus rien et rougirait pour une raison qui n'a
 * aucun rapport avec le rechargement. C'est ce qui rend la sonde **symétrique** avant et
 * après conversion — avant, le `require()` rend l'instance du cache CJS ; après,
 * `await import()` rend celle du registre ESM. Des deux côtés : instance périmée → rouge.
 *
 * ⚠️ `vi.isolateModulesAsync` est traité à part et **avant** : la regex d'`isolateModules`
 * exige la parenthèse, donc elle ne le capterait pas, et il sortirait de la neutralisation
 * intact — une sonde qui laisse vivre ce qu'elle prétend couper.
 *
 * ⚠️ Ni l'un ni l'autre n'existe dans Vitest 4.1.8 : c'est `packages/core/__tests__/setup.js`
 * qui les définit. La forme est gardée pour que la sonde reste juste **après** le démantèlement
 * de ce shim (B.11), où il ne restera que `resetModules`.
 *
 * @param {string} src Source du fichier de test.
 * @returns {{code: string, count: number}}
 */
function neutraliseReload(src) {
    // ⚠️ Compté sur le source SANS commentaires. Un `vi.isolateModules()` cité dans un
    // commentaire produisait une sonde qui ne neutralisait rien, donc un fichier
    // « insensible » au relevé — puis un ROUGE « dispositif disparu » le jour où le
    // commentaire partait. Mesuré sur `app/helpers.test.js`, converti sans défaut.
    const bare = sites.stripComments(src);
    const count =
        (bare.match(/vi\.resetModules\(/g) ?? []).length +
        (bare.match(/vi\.isolateModules(?:Async)?\(/g) ?? []).length;
    const code =
        "vi.__disabled_reset = () => {};\n" +
        "vi.__disabled_iso = (fn) => fn();\n" +
        "vi.__disabled_isoAsync = async (fn) => { await fn(); };\n" +
        src
            .replace(/vi\.resetModules\(/g, "vi.__disabled_reset(")
            .replace(/vi\.isolateModulesAsync\(/g, "vi.__disabled_isoAsync(")
            .replace(/vi\.isolateModules\(/g, "vi.__disabled_iso(");
    return { code, count };
}

/**
 * La sensibilité de chaque fichier à un dispositif qui lui est propre — le contrôle commun
 * aux sprints 3 (`vi.mock()`) et 4 (`vi.resetModules()`).
 *
 * ## Ce qu'il attrape, et qu'aucune suite verte ne distingue
 *
 * Convertir un `require()` en `import` change l'implémentation qui sert les mocks (le shim
 * `Module._load` de `packages/core/__tests__/setup.js` cède au mocker natif) **et** celle qui
 * recharge un module (le patch CJS de `vi.resetModules` cède au registre ESM). Si l'un des
 * deux cessait d'agir au passage, le test **resterait vert en testant autre chose** — le vrai
 * module au lieu du mock, ou la première instance au lieu d'une neuve.
 *
 * ## L'invariant, et pourquoi il n'est pas « doit rougir »
 *
 * Le relevé se prend AVANT conversion puis se rejoue APRÈS, et ce qui est exigé est
 * **l'égalité**. Un fichier insensible des deux côtés est conforme : son dispositif était
 * décoratif avant, il l'est encore, la conversion n'a rien changé. Ce qui est refusé est le
 * passage de sensible à insensible. « Doit rougir » condamnerait le premier cas, qui est un
 * constat à écrire — 25 fichiers au S3 — et non un défaut à corriger dans ce sprint.
 *
 * ⚠️ **Ne sort JAMAIS par `process.exit()`.** Un `process.exit()` dans le `try` court-circuite
 * le `finally` : la fonction laissait alors ses sondes sur le disque au moment précis où elle
 * signale un défaut — un contrôle qui salit le dépôt quand il rougit finit par être contourné.
 * Trouvé en le prouvant par mutation, pas en le relisant. Le code de sortie est rendu à
 * l'appelant, qui sort après le nettoyage.
 *
 * ⚠️ **Une seule implémentation pour les deux sprints.** Le S3 et le S4 en auraient porté une
 * copie chacun, et l'ADR relève déjà trois fois ce que deux analyses jumelles finissent par
 * faire : diverger sur le jugement qu'elles étaient censées partager.
 *
 * @param {object} spec Ce qui distingue les deux contrôles.
 * @param {string} spec.cmd Nom de la sous-commande, pour les messages.
 * @param {string} spec.slug Préfixe du relevé sur disque.
 * @param {string} spec.what Ce qui est neutralisé, au pluriel.
 * @param {(src: string) => {code: string, count: number}} spec.neutralise
 * @param {string} spec.lost Ce qu'une régression signifie, en une phrase.
 * @param {string} name Nom du relevé.
 * @param {string[]} files Chemins absolus des fichiers à sonder.
 * @param {object} pkg Entrée de registre.
 * @returns {boolean} `false` si un fichier a PERDU sa sensibilité.
 */
function proveSensitivity(spec, name, files, pkg) {
    const relevePath = path.join(SNAP_DIR, `${spec.slug}-${name}.json`);
    const swept = sweepProbes(pkg);
    if (swept) console.log(`ℹ ${swept} sonde(s) d'une exécution interrompue supprimée(s).`);

    /** Ce que CE lot prétend couvrir — la borne du contrôle « dispositif disparu ». */
    const targeted = new Set(files.map((f) => rel(f)));

    const probes = new Map();
    try {
        for (const f of files) {
            const { code, count } = spec.neutralise(fs.readFileSync(f, "utf8"));
            if (!count) continue;
            // La sonde vit à CÔTÉ de l'original : les specifiers relatifs et les alias Vite
            // s'y résolvent à l'identique. Un fichier déplacé ailleurs testerait autre chose.
            const probe = f.replace(/\.test\.(js|ts)$/, PROBE_SUFFIX);
            fs.writeFileSync(probe, code);
            probes.set(probe, { origin: rel(f), count });
        }

        // ⚠️ **Le dispositif DISPARU — trouvé par mutation, et il rendait le contrôle
        // inoffensif sur exactement le défaut qu'il existe pour attraper.** Un fichier sans
        // aucun `count` est ignoré par la boucle ci-dessus, donc absent de `now`, donc jamais
        // comparé au relevé : la campagne sortait **verte** sur un lot où un fichier avait
        // perdu TOUS ses `resetModules()`, et avançait le relevé par-dessus. Mesuré sur
        // `ui/ui-main.test.js` privé de son rechargement : « sensibilité préservée », exit 0.
        //
        // Un fichier explicitement ciblé, connu du relevé comme portant le dispositif, et qui
        // n'en porte plus, est une RÉGRESSION — pas une absence. La distinction avec un
        // fichier simplement hors du lot tient à `targeted` : sans elle, chaque lot
        // accuserait les 20 fichiers qu'il ne sonde pas.
        const priorReleve = fs.existsSync(relevePath)
            ? JSON.parse(fs.readFileSync(relevePath, "utf8"))
            : null;
        const probed = new Set([...probes.values()].map((m) => m.origin));
        const vanished = priorReleve
            ? [...targeted].filter((f) => priorReleve[f]?.count > 0 && !probed.has(f))
            : [];

        if (vanished.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${vanished.length} fichier(s) ne déclarent PLUS de ` +
                    `${spec.what}, alors que le relevé « ${name} » les y connaît :\n` +
                    vanished.map((f) => `      ${f}`).join("\n") +
                    "\n\n  Le dispositif n'a pas changé de sensibilité, il a DISPARU — et c'est\n" +
                    "  la forme la plus directe du défaut : plus rien ne recharge, et la suite\n" +
                    "  reste verte sur la première instance."
            );
            return false;
        }

        if (!probes.size) {
            console.error(`✘ ${spec.cmd}: aucun fichier ne déclare de ${spec.what}.`);
            return false;
        }

        // ⚠️ **Un verdict ne vaut que sur un fichier vert SANS mutation** — et l'oubli de
        // cette évidence a pollué le relevé en cours de sprint. `globals/globals-core` a été
        // sondé alors qu'il échouait déjà pour une autre raison (un mock incomplet que le
        // mocker natif refuse) : sa sonde a échoué elle aussi, donc « sensible », et le
        // relevé a été AVANCÉ avec cette valeur. Le lot suivant, une fois le mock réparé, a
        // vu « sensibilité PERDUE » sur un fichier parfaitement converti.
        //
        // Une passe pristine sépare les deux causes. Elle coûte une invocation de Vitest —
        // quelques secondes — contre un relevé faux qu'aucun contrôle ne rattrape ensuite.
        const brokenBefore = runAndCollect(
            [...probes.values()].map((m) => path.join(ROOT, m.origin)),
            pkg
        );
        const inconclusive = [...probes.entries()].filter(([, m]) =>
            brokenBefore.get(path.join(ROOT, m.origin))
        );
        if (inconclusive.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${inconclusive.length} fichier(s) sont ROUGES sans aucune ` +
                    "mutation. Leur sensibilité n'est pas mesurable, et l'inscrire au relevé\n" +
                    "  y figerait une valeur fausse :\n" +
                    inconclusive.map(([, m]) => `      ${m.origin}`).join("\n") +
                    "\n\n  Réparer le lot d'abord, puis rejouer ce contrôle."
            );
            return false;
        }

        console.log(`ℹ ${spec.cmd}: ${probes.size} fichier(s), ${spec.what} neutralisés…`);
        const failed = runAndCollect([...probes.keys()], pkg);

        const now = {};
        for (const [probe, meta] of probes) {
            // Un fichier absent du relevé n'a produit aucun test : sans son dispositif, il n'a
            // même pas pu être collecté. C'est le signal de sensibilité le plus fort.
            now[meta.origin] = { count: meta.count, sensitive: failed.get(probe) ?? true };
        }

        const sensitive = Object.values(now).filter((v) => v.sensitive).length;
        console.log(
            `  sensibles : ${sensitive} / ${Object.keys(now).length}` +
                `  ·  insensibles : ${Object.keys(now).length - sensitive}`
        );

        if (!priorReleve) {
            fs.mkdirSync(SNAP_DIR, { recursive: true });
            fs.writeFileSync(relevePath, JSON.stringify(now, null, 4) + "\n");
            console.log(`\n✔ relevé « ${name} » figé — à rejouer APRÈS conversion.`);
            for (const [f, v] of Object.entries(now)) {
                if (!v.sensitive) {
                    console.log(
                        `  ℹ insensible à ses ${v.count} ${spec.what} AVANT conversion : ${f}`
                    );
                }
            }
            return true;
        }

        const before = priorReleve;
        const regressions = [];
        const gained = [];
        for (const [f, v] of Object.entries(now)) {
            const b = before[f];
            if (!b) continue;
            if (b.sensitive && !v.sensitive) regressions.push(f);
            if (!b.sensitive && v.sensitive) gained.push(f);
        }

        console.log(`\n── Bulletin ${spec.cmd}, contre le relevé « ${name} » ──\n`);
        console.log(`  sensibilité PERDUE : ${regressions.length}  ·  gagnée : ${gained.length}`);
        for (const f of gained) {
            console.log(`  ℹ ${f} — insensible avant, sensible après`);
        }

        if (regressions.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${regressions.length} fichier(s) ont PERDU leur sensibilité.\n` +
                    `  ${spec.lost}\n` +
                    "  C'est exactement l'échec qu'une suite verte ne distingue pas :\n" +
                    regressions.map((f) => `      ${f}`).join("\n") +
                    "\n\n  Règle de l'ADR : la conversion change le MODE de chargement, jamais ce\n" +
                    "  qui est testé. Laisser le site en require(), écrire la raison sur place,\n" +
                    "  et router en backlog comme B.10."
            );
            return false;
        }

        // ⚠️ FUSION, pas remplacement. Le relevé couvre tout le sprint et les lots n'en
        // sondent qu'une tranche : l'écraser avec `now` effacerait l'état « avant » des
        // fichiers non encore convertis, et les lots suivants n'auraient plus rien à quoi se
        // comparer — un contrôle qui se désarme tout seul au fil de son propre usage.
        fs.writeFileSync(relevePath, JSON.stringify({ ...before, ...now }, null, 4) + "\n");
        console.log(`\n✔ sensibilité préservée — le relevé « ${name} » est avancé.`);
        return true;
    } finally {
        for (const probe of probes.keys()) fs.rmSync(probe, { force: true });
    }
}

/**
 * Le contrôle du sprint 3 — patron prouvé à la main au 3.0 sur `config/config-loaders.test.js` :
 * 6 tests sur 6 rougissent mocks neutralisés, avant conversion **comme** après.
 *
 * @param {string} name @param {string[]} files @param {object} pkg @returns {boolean}
 */
const proveMocks = (name, files, pkg) =>
    proveSensitivity(
        {
            cmd: "prove-mocks",
            slug: "mocks",
            what: "mock(s)",
            neutralise: (src) => {
                const { code, mocks } = neutraliseMocks(src);
                return { code, count: mocks };
            },
            lost: "Un mock a cessé de s'appliquer : le test reste vert en testant le VRAI module.",
        },
        name,
        files,
        pkg
    );

/**
 * Le contrôle du sprint 4 — et **le piège n'a pas la forme que la roadmap lui donne**.
 *
 * ## Ce que trois mutations ont mesuré, avant toute conversion
 *
 * La roadmap pose : « un test qui ne recharge plus PASSE ENCORE, la verdeur ne distingue pas
 * ce cas ». C'est vrai pour une moitié du périmètre seulement, et la coupure est exactement
 * celle que le relevé donne — 11 fichiers sensibles, 14 insensibles :
 *
 * ```
 * fichier SENSIBLE   → rechargement détruit → la SUITE rougit d'elle-même
 *     ui/ui-main : resetModules retiré        →  3 tests sur 5 tombent
 *     api/api    : chargement hissé en import → 11 tests sur 25 tombent
 * fichier INSENSIBLE → rechargement détruit → la suite reste VERTE
 *     legend/legend-extended : ses 6 resetModules retirés → 37 sur 37 PASSENT
 * ```
 *
 * **C'est là que vit le piège, et nulle part ailleurs** : sur les 11 sensibles, la suite est
 * son propre garde-fou ; sur les 14 insensibles, rien ne dit qu'on a cassé quelque chose.
 *
 * ## Conséquence : l'invariant d'égalité ne suffisait pas
 *
 * Hérité du S3, il ne protège justement pas ces 14 fichiers — « insensible avant, insensible
 * après » est conforme par construction. Ce qui les couvre est le contrôle du **dispositif
 * DISPARU** (voir {@link proveSensitivity}), absent du harnais du S3 et ajouté ici après
 * l'avoir vu manquer : sans lui, la mutation sur `legend-extended` sortait verte des DEUX
 * côtés, suite comme contrôle.
 *
 * Les trois mécanismes se répartissent le travail, et aucun n'est redondant :
 *
 * ```
 * resetModules SUPPRIMÉ                → contrôle « disparu »   (le seul filet des 14)
 * rechargement CASSÉ mais présent      → la suite, si sensible ; inoffensif sinon
 * sensibilité PERDUE sans suppression  → invariant d'égalité du S3
 * ```
 *
 * @param {string} name @param {string[]} files @param {object} pkg @returns {boolean}
 */
const proveReload = (name, files, pkg) =>
    proveSensitivity(
        {
            cmd: "prove-reload",
            slug: "reload",
            what: "rechargement(s)",
            neutralise: neutraliseReload,
            lost: "Le rechargement n'a plus lieu : le test passe sur la PREMIÈRE instance du module.",
        },
        name,
        files,
        pkg
    );

// ── Exécution ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? null : (argv[i + 1] ?? "");
};

if (argv.includes("--triage")) {
    const t = triage();
    // `--json` sert à COMPOSER les lots : un lot doit contenir au moins un module `reqOnly`,
    // sinon A1 peut sortir à vide sur une conversion pourtant juste. Composer ça à l'œil sur
    // 84 fichiers, c'est se tromper.
    if (argv.includes("--json")) console.log(JSON.stringify(t.files, null, 2));
    else printTriage(t);
    process.exit(0);
}

const targetPkg = () => requirePkg(flag("--pkg") || DEFAULT_PKG);

/**
 * Les deux contrôles de sensibilité partagent leur ligne de commande : un nom de relevé, et
 * une liste de fichiers facultative qui, laissée vide, retombe sur le périmètre du sprint.
 *
 * @param {string} cmdFlag Drapeau de la sous-commande.
 * @param {string} family Famille de `lib/test-load-sites.cjs` prise par défaut.
 * @param {(name: string, files: string[], pkg: object) => boolean} run
 */
function dispatchProve(cmdFlag, family, run) {
    const name = flag(cmdFlag);
    if (name === null) return;
    if (!name) {
        console.error(`✘ ${cmdFlag} exige un nom : ${cmdFlag} lot1 [fichiers…]`);
        process.exit(1);
    }
    const pkg = targetPkg();
    // Les fichiers sont les arguments libres — tout ce qui n'est ni un drapeau ni sa valeur.
    const reserved = new Set([cmdFlag, name, "--pkg", flag("--pkg") ?? ""]);
    const given = argv.filter((a) => !reserved.has(a)).map((f) => path.resolve(ROOT, f));
    // Sans liste, tout le périmètre du sprint pour ce paquet : le triage sait déjà qui c'est.
    const targets = given.length
        ? given
        : triage()
              .files.filter((f) => f.pkg === pkg.name && f.family === family)
              .map((f) => path.join(ROOT, f.file));
    // Le code de sortie est décidé APRÈS le nettoyage des sondes — voir proveSensitivity().
    process.exit(run(name, targets, pkg) ? 0 : 1);
}

dispatchProve("--prove-mocks", "mock", proveMocks);
dispatchProve("--prove-reload", "reload", proveReload);

console.error(
    "Usage :\n" +
        "  node scripts/audit-test-load-conversion.cjs --triage\n" +
        "  node scripts/audit-test-load-conversion.cjs --prove-mocks  <nom> [fichiers…]\n" +
        "  node scripts/audit-test-load-conversion.cjs --prove-reload <nom> [fichiers…]\n" +
        "\n  Les deux --prove-* figent un relevé la 1ʳᵉ fois, puis COMPARENT : ils refusent un\n" +
        "  lot où un fichier a PERDU sa sensibilité. L'invariant est l'ÉGALITÉ, pas le rouge —\n" +
        "  un fichier insensible des deux côtés est conforme. Sans liste de fichiers, ils\n" +
        "  prennent tout le périmètre de leur sprint (mock → S3, reload → S4).\n" +
        `\n  --pkg défaut : ${DEFAULT_PKG}\n` +
        `  périmètre    : ${SCOPE.join(", ")}`
);
process.exit(1);
