#!/usr/bin/env node
/*!
 * GeoLeaf — CONSUMER-CONTRACT : le contrat INVERSE.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Le défaut que cette gate existe pour attraper
 *
 * Les autres gates du dépôt tiennent que **ce que nous déclarons existe**. Celle-ci tient
 * l'inverse : **ce dont quelqu'un dépend n'a pas disparu**. Neuf clés sont parties du namespace
 * `GeoLeaf` parce qu'aucun lecteur du monorepo ne les lisait — le lecteur était **dehors**, et
 * aucun vert d'ici ne pouvait le voir. Un retrait doit rougir.
 *
 * Le geste n'est pas neuf : `verify-host-contract-sync.cjs` fait déjà cette vérification
 * d'inclusion, par lecture d'AST et **sans booter** — *« this gate inherits a measurement
 * instead of taking one, and stays a sub-second static check »*. Le contrat inverse est **une
 * liste de plus, pas un mécanisme** ; l'écrire autrement serait la cinquième description
 * concurrente de la même surface, ce que l'en-tête de `lib/namespace-surface.mjs` documente
 * comme ayant déjà coûté onze jours de dérive invisible.
 *
 * ## Trois résolveurs, parce qu'un seul serait vert sur ce qu'il n'a pas lu
 *
 *   • `provider: "core"`        → l'oracle post-boot (`EXPECTED_FACADE_KEYS` en profondeur 1,
 *                                 `EXPECTED_FACADE_MEMBERS` en profondeur 2)
 *   • `provider: "plugin:<pkg>"` → l'objet rendu par `buildPublicApi()` du paquet, lu à l'AST ;
 *                                 le paquet est résolu par `requireByDirName`, qui **jette**
 *   • `dom_contract`             → un littéral de sélecteur dans les sources du cœur
 *
 * ⚠️ **Le troisième résolveur n'est pas un confort, c'est la seule voie** pour `Ws` et
 * `Measure.*` : `namespace-surface.contract.test.js` exige `DEPTH2_FACADES ⊆
 * EXPECTED_FACADE_KEYS`, or ces deux-là sont montés par des plugins et l'oracle du cœur est
 * mesuré après un `startApp()` sans eux. Ils ne pourront **jamais** entrer dans l'oracle du
 * cœur. Une gate écrite sur un oracle unique sortirait **verte sur un tiers du contrat sans
 * l'avoir lu** — le mode d'échec exact que ce dépôt a déjà payé.
 *
 * ## Les treize codes
 *
 *   CC-00  plancher de non-vacuité, issue du SKIP, et ce que la gate a réellement lu
 *   CC-01  tout `required.public` de fournisseur `core` résout
 *   CC-02  tout `private_tolerated` résout — message distinct, limites structurelles NOMMÉES
 *   CC-03  tout `provider: "plugin:<pkg>"` résout dans `buildPublicApi()`
 *   CC-04  cliquet ENTRANT — une liste négative ne s'élargit pas unilatéralement
 *   CC-05  cliquet SORTANT — une entrée `broken` devenue fausse est une erreur jusqu'à retrait
 *   CC-06  portée MESURÉE — un chemin hors de portée sort en exit 2, jamais en vert
 *   CC-07  tout `required.events` est typé, émis en littéral, et sur le bus DOM
 *   CC-08  `dom_contract` — `library` a son littéral en source, `host` est une obligation d'hôte
 *   CC-09  anti-tautologie — l'oracle lu ici est encore confronté à un vrai boot
 *   CC-10  cliquet de DÉPRÉCIATION — une entrée ne quitte `required.public` / `required.events`
 *          que sous annonce, et une balise `@deprecated` ne vit pas sans être datée
 *   CC-11  `installed_by_host` — ce que l'hôte ÉCRIT ne résout PAS ici (symétrique de CC-01)
 *   CC-12  `geoleaf:connector:*` est partagé — aucun nom émis des deux côtés
 *
 * Codes de sortie : **0** vert · **1** régression · **2** refus de conclure.
 *
 * ## Ce que CC-10 ne vérifie PAS de la politique, et il faut le savoir
 *
 * Le bloc `policy` du manifeste — *« aucune entrée de `public` ni de `events` ne peut être
 * retirée sans dépréciation annoncée »* — a été **lu et IGNORÉ** de S1 jusqu'au Sprint 7 : les
 * codes gardaient la **PRÉSENCE**, rien ne gardait le **RETRAIT**, or c'est un retrait qui a
 * produit ce document, deux fois. CC-10 ferme ce trou. Mais il n'en ferme pas toute la
 * largeur, et **un gardien qui saute une clé doit dire qu'il la saute** (tâche 1.11) :
 *
 *   • **L'entrée CHANGELOG** n'est pas confrontée. La forme d'annonce du §Deprecation de
 *     `VERSIONING_POLICY.md` a TROIS membres ; CC-10 en tient deux — la balise en source (par
 *     `symbol`) et la datation (`since` / `removeIn`). Le troisième est mécanisable — chercher
 *     le chemin sous le titre de version dans `packages/core/docs/CHANGELOG.md` — et c'est un
 *     refus CONDITIONNÉ, dont la condition de réouverture est la première annonce dont le
 *     `since` désigne une version publiée.
 *   • **« survivre à au moins un `minor` publié »** exige de connaître les versions PUBLIÉES,
 *     que ce dépôt ne lit nulle part. `removeIn` = prochain MAJEUR est la moitié vérifiable de
 *     cette durée, et c'est celle qui est tenue.
 *   • **`deprecated_since` au manifeste** est un accusé de réception de l'AVAL. L'exiger
 *     rendrait la gate rouge pour un geste que l'amont ne peut pas faire.
 *
 * Usage : GEOLEAF_CONSUMERS=<répertoire> node scripts/verify-consumer-contract.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
const cm = require("./lib/consumer-manifest.cjs");
const ev = require("./lib/event-names.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
const { readInterfaceMembers } = require("./lib/ts-decl-read.cjs");

const ROOT = registry.ROOT;
const TAG = cm.TAG;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "consumer-contract.json");
const UPDATE = process.argv.includes("--update-baseline");

/**
 * L'oracle de CC-10 — les dépréciations que l'AMONT annonce.
 *
 * PUBLIC parce qu'il nomme des **symboles** et pas un client : l'aval déclare ce dont il
 * dépend dans son `*.consumer.json`, l'amont déclare ce qu'il s'autorise à retirer ici, et
 * les deux fichiers ne sont pas écrits par la même main.
 *
 * ⚠️ Dérivé par `docsPaths.reference()` et **jamais écrit en dur** — un chemin recopié
 * cesse silencieusement de matcher au premier déménagement de racine documentaire, et la
 * gate refuserait alors de conclure pour un motif qui n'a rien à voir avec son sujet.
 */
const DEPRECATIONS = docsPaths.reference("consumers", "DEPRECATIONS.json");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    d: "\x1b[2m",
    c: "\x1b[36m",
    x: "\x1b[0m",
};

/**
 * Planchers de CC-00, délibérément très en dessous des valeurs du jour (92 / 258).
 *
 * ⚠️ **`members: 150` est la dépendance la plus coûteuse du sprint, et elle n'était écrite
 * nulle part.** `EXPECTED_FACADE_MEMBERS` valait **83** avant la tâche 1.5 : écrire cette gate
 * avant d'élargir l'oracle aurait produit une gate qui **refuse de conclure à son premier
 * lancement**, ce qui se solde en pratique par l'abaissement du plancher — donc par une gate
 * qui ne garde plus rien. Le plancher se re-mesure :
 *
 *     git show <ref>:scripts/lib/namespace-surface.mjs   → l'oracle à cette date
 *
 * Ils attrapent un INSTRUMENT effondré, pas une surface qui rétrécit légitimement — même
 * partition que le `FLOOR` de `verify-host-contract-sync.cjs`, et même motif.
 */
const FLOOR = { keys: 50, members: 150 };

// ⚠️ `SCOPE_EXEMPT` a été RETIRÉ le 13/08/2026 (Sprint 4, tâches 4.2/4.3), et le retrait est
// l'événement, pas la disparition.
//
// La carte portait une seule entrée, `geoleaf:table:`, avec son motif et l'échéance qui la
// fermait : *« FERMÉ PAR : Sprint 4 tâche 4.2 […] (`fireEvent` prend le nom complet) »*.
// Le refactor a eu lieu, les 9 noms existent désormais en littéraux complets
// (`table-state.ts`, type `TableEventName`), et son propre en-tête exigeait ceci :
// *« une exemption qui a perdu sa cause est une ERREUR, pas un silence »*. CC-06 l'a
// effectivement exigée retirée — vu rouge sur `geoleaf:table:opened` et `:closed` avant
// ce retrait, ce qui est la preuve que le dispositif fonctionnait dans les deux sens.
//
// 🛑 **Ce qui n'est PAS couvert après ce retrait, et il faut le savoir avant d'écrire un
// émetteur** : `DYNAMIC_PREFIXES` partant avec elle (`lib/event-names.cjs`), plus rien ne
// distingue « nom composé à l'exécution » de « nom absent des sources ». Un futur
// `dispatchEvent("geoleaf:" + x)` ferait donc conclure CC-07 à « non émis » — un rouge FAUX,
// exactement l'erreur que le manifeste aval a faite jusqu'à sa v1.4.0. Le dépôt n'en porte
// aujourd'hui aucun, et poser une machinerie pour un cas qui n'existe pas serait spéculatif.
// Suivi comme refus CONDITIONNÉ au backlog, avec sa condition de réouverture : la première
// concaténation qui revient. Elle se mesure, elle ne se suppose pas —
//
//   grep -rnE '"geoleaf:"\s*\+|`geoleaf:\$\{' packages/*/src packages/plugins/*/src \
//     packages/libs/*/src | grep -v __tests__
//
// rend aujourd'hui la SEULE ligne du TSDoc de `table-state.ts` qui raconte ce passé.

// ─── Résolveurs ──────────────────────────────────────────────────────────────────────
//
// ⚠️ L'oracle est chargé par `import()` dynamique dans `main()` : `namespace-surface.mjs` est
// ESM, cette gate est CJS, et le `require()` d'un `.mjs` jette. C'est aussi la raison pour
// laquelle `main()` est `async` — pas un choix de style.

/** Verdicts de résolution. `OUT_OF_SCOPE` n'est JAMAIS un vert : il alimente CC-06. */
const OK = "OK";
const ABSENT = "ABSENT";
const OUT_OF_SCOPE = "OUT_OF_SCOPE";

/**
 * Résout un chemin contre l'oracle post-boot du cœur.
 *
 * @returns {{ verdict: string, why: string }}
 */
function resolveCore(p, surf) {
    const parts = p.split(".");
    if (parts.length === 1) {
        return surf.EXPECTED_FACADE_KEYS.includes(p)
            ? { verdict: OK, why: "profondeur 1, dans EXPECTED_FACADE_KEYS" }
            : { verdict: ABSENT, why: "absent d'EXPECTED_FACADE_KEYS (profondeur 1)" };
    }
    const [head, member, ...rest] = parts;
    if (!surf.EXPECTED_FACADE_KEYS.includes(head)) {
        return { verdict: ABSENT, why: `la clé de tête \`${head}\` est absente de l'oracle` };
    }
    if (rest.length > 0) {
        return {
            verdict: OUT_OF_SCOPE,
            why: `profondeur ${parts.length} — l'oracle s'arrête à la profondeur 2`,
        };
    }
    if (!surf.DEPTH2_FACADES.includes(head)) {
        return {
            verdict: OUT_OF_SCOPE,
            why: `\`${head}\` n'est pas dans DEPTH2_FACADES — ses membres ne sont pas mesurés`,
        };
    }
    if (member.charAt(0) === "_") {
        return {
            verdict: OUT_OF_SCOPE,
            why: `\`${member}\` est \`_\`-préfixé — \`walkNamespace\` le filtre par construction`,
        };
    }
    const members = surf.EXPECTED_FACADE_MEMBERS[head] ?? [];
    return members.includes(member)
        ? { verdict: OK, why: `profondeur 2, dans EXPECTED_FACADE_MEMBERS.${head}` }
        : { verdict: ABSENT, why: `absent d'EXPECTED_FACADE_MEMBERS.${head}` };
}

/**
 * Lit les clés de l'objet rendu par `buildPublicApi()` d'un paquet, à l'AST.
 *
 * ⚠️ **Quatre formes, pas une.** Un littéral d'objet TypeScript porte des
 * `PropertyAssignment` (`foo: () => …`), des `ShorthandPropertyAssignment` (`foo,` — c'est
 * la forme de `measure`), des `MethodDeclaration` (`foo() {}`) et des
 * `GetAccessorDeclaration` (`get state() {}` — c'est la forme de `websocket`). Ne lire que la
 * première rendrait la gate verte sur trois plugins qu'elle n'aurait pas lus, et le dépôt en
 * porte au moins un de chaque.
 */
const pluginApiCache = new Map();
function pluginApiMembers(pkgDirName) {
    if (pluginApiCache.has(pkgDirName)) return pluginApiCache.get(pkgDirName);

    // `requireByDirName` JETTE si le paquet est introuvable — un chemin en dur cesserait
    // silencieusement de matcher et la gate sortirait verte en n'ayant rien scanné. C'est ce
    // qui a fait sortir la v1.3.0 du manifeste en exit 2 sur `plugin:storage`, qui n'existe pas.
    const pkg = registry.requireByDirName(pkgDirName);
    const file = path.join(pkg.absDir, "src", "public-api.ts");
    if (!fs.existsSync(file)) {
        cm.refuse(
            `\`${pkgDirName}\` n'a pas de \`src/public-api.ts\` — impossible de résoudre une ` +
                "façade de plugin sans elle.",
            "CC-03"
        );
    }
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    let members = null;
    const visit = (node) => {
        if (
            (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
            node.name &&
            ts.isIdentifier(node.name) &&
            node.name.text === "buildPublicApi"
        ) {
            const found = new Set();
            const walk = (n) => {
                if (ts.isObjectLiteralExpression(n)) {
                    for (const prop of n.properties) {
                        if (!prop.name) continue;
                        if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
                            if (
                                ts.isPropertyAssignment(prop) ||
                                ts.isShorthandPropertyAssignment(prop) ||
                                ts.isMethodDeclaration(prop) ||
                                ts.isGetAccessorDeclaration(prop)
                            ) {
                                found.add(prop.name.text);
                            }
                        }
                    }
                }
                ts.forEachChild(n, walk);
            };
            walk(node);
            members = [...found].sort();
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    if (members === null) {
        cm.refuse(`\`buildPublicApi\` introuvable dans ${path.relative(ROOT, file)}`, "CC-03");
    }
    if (members.length === 0) {
        cm.refuse(
            `\`buildPublicApi\` de \`${pkgDirName}\` rend 0 membre — la gate serait verte en ` +
                "n'ayant rien lu. C'est un instrument cassé, pas une façade vide.",
            "CC-03"
        );
    }
    pluginApiCache.set(pkgDirName, members);
    return members;
}

/** Résout un chemin contre la façade d'un plugin. `provider: "plugin:<dirName>"`. */
function resolvePlugin(p, provider) {
    const pkgDirName = provider.slice("plugin:".length);
    const members = pluginApiMembers(pkgDirName);
    const parts = p.split(".");
    if (parts.length === 1) {
        // Le namespace lui-même : il existe dès lors que le paquet a une façade non vide.
        return { verdict: OK, why: `\`${pkgDirName}\` expose ${members.length} membres` };
    }
    if (parts.length > 2) {
        return { verdict: OUT_OF_SCOPE, why: "profondeur > 2 sur une façade de plugin" };
    }
    return members.includes(parts[1])
        ? { verdict: OK, why: `membre de buildPublicApi() de \`${pkgDirName}\`` }
        : { verdict: ABSENT, why: `absent de buildPublicApi() de \`${pkgDirName}\`` };
}

/** Aiguille de résolution : cœur ou plugin, selon le `provider`. */
function resolve(entry, surf) {
    const provider = entry.provider || "core";
    if (provider === "core") return resolveCore(entry.path, surf);
    if (provider.startsWith("plugin:")) return resolvePlugin(entry.path, provider);
    cm.refuse(
        `\`provider\` inconnu (\`${provider}\`) sur \`${entry.path}\` — les seules formes ` +
            "reconnues sont `core` et `plugin:<répertoire de paquet>`.",
        "CC-00"
    );
    return null;
}

// ─── CC-10 : la dépréciation, et ce qui la rend vérifiable ───────────────────────────

/** Les QUATRE champs d'une annonce. Tous portants : une annonce à trois champs n'annonce pas. */
const CHAMPS_ANNONCE = ["since", "removeIn", "replacement", "symbol"];

/**
 * Les `@deprecated` ANTÉRIEURS à la politique, exemptés NOMMÉMENT.
 *
 * ⚠️ **Une exemption nommée est auditable, une exemption implicite est un trou.** Ces balises
 * vivaient en source publiée avant que le §Deprecation de `VERSIONING_POLICY.md` existe :
 * leur réclamer une entrée de registre ferait rougir la gate **à sa pose**, et une gate rouge
 * au premier lancement se solde en pratique par l'élargissement de sa liste d'exemptions,
 * jamais par la réparation du défaut.
 *
 * 🛑 **La clé est `fichier#Propriétaire.membre`, PAS `fichier:ligne`, et c'est mesuré :**
 *   ① Les lignes dérivent. La roadmap qui a commandé ce code citait `retry-handler.ts:27` et
 *      `:44` ; le fichier portait `:34` et `:51`, et l'AST rend `:38` et `:52` — trois paires
 *      de nombres pour deux faits.
 *   ② `retry-handler.ts` porte **deux** membres `maxRetries`, dans `RetryConfig` et dans
 *      `RetryOptions`. Une clé `fichier#membre` en exempterait deux d'un seul geste.
 *
 * ⚠️ **La liste se DÉRIVE par le scan, elle ne se recopie pas d'un document.** Au 14/08/2026,
 * `annoncesEnSource()` rend **une** balise sur 862 fichiers expédiés : les trois alias
 * `maxRetries` ont été reclassés par la tâche 7.2 — ce sont des alias CONSERVÉS, rien ne
 * programme leur retrait, et leur tag promettait une disparition qui n'aura pas lieu.
 *
 * FERMÉ PAR : le retrait de ces clés, ou leur entrée dans `DEPRECATIONS.json`.
 */
const ANNONCES_GRAND_PERAGE = new Map([
    [
        "packages/plugins/table/src/types.ts#TableConfig.pageSize",
        "B-71 — clé SANS EFFET (le panneau défile en virtuel), marquée plutôt que retirée pour " +
            "ne pas casser la compilation d'un intégrateur qui l'a écrite. Elle n'a pas sa place " +
            "au registre : une option sans effet n'a aucun `replacement`, donc ce n'est pas une " +
            "dépréciation au sens de la politique mais un défaut à réparer ou un champ à retirer",
    ],
]);

/**
 * Énumère les `@deprecated` des sources EXPÉDIÉES → `fichier#Propriétaire.membre`.
 *
 * Même corpus que CC-07 (`ev.shippedSources()`), délibérément : « source expédiée » doit
 * vouloir dire **une** chose dans cette gate. Lu à l'AST et non au grep — un `@deprecated`
 * écrit dans la prose d'un docblock n'est pas une balise, et ces sources sont denses en
 * prose qui parle de dépréciation.
 *
 * ⚠️ La pile de propriétaires descend aussi dans les **littéraux de type** (`Config?: { … }`),
 * sans quoi deux façades portant le même nom de membre s'écraseraient dans la Map et une
 * exemption en couvrirait deux.
 *
 * @returns {Map<string, {rel: string, lignes: number[]}>} clé qualifiée → où elle vit.
 */
function annoncesEnSource() {
    const found = new Map();
    for (const file of ev.shippedSources()) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("@deprecated")) continue; // même pré-filtre que collectEventLiterals
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        const nomDe = (n) =>
            !n ? null : ts.isStringLiteral(n) || ts.isIdentifier(n) ? n.text : null;
        const pile = [];
        const visit = (node) => {
            const tags = ts.getJSDocTags(node) || [];
            if (tags.some((t) => t.tagName.text === "deprecated")) {
                const cle = `${rel}#${[...pile, nomDe(node.name)].filter(Boolean).join(".")}`;
                const l = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                if (!found.has(cle)) found.set(cle, { rel, lignes: [] });
                found.get(cle).lignes.push(l);
            }
            const porteur =
                ts.isInterfaceDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isModuleDeclaration(node)
                    ? nomDe(node.name)
                    : (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
                        node.type &&
                        ts.isTypeLiteralNode(node.type)
                      ? nomDe(node.name)
                      : null;
            if (porteur) pile.push(porteur);
            ts.forEachChild(node, visit);
            if (porteur) pile.pop();
        };
        ts.forEachChild(sf, visit);
    }
    // Une clé qui désigne DEUX déclarations est une clé qui ment : l'exemption de l'une
    // couvrirait l'autre, et la citation `symbol` d'une annonce serait satisfaite par un
    // symbole que personne n'a voulu déprécier. Ambiguë = refusée, jamais devinée.
    for (const [cle, o] of found) {
        if (o.lignes.length > 1) {
            cm.refuse(
                `la citation \`${cle}\` désigne ${o.lignes.length} déclarations portant ` +
                    `\`@deprecated\` (lignes ${o.lignes.join(", ")}). Une clé ambiguë rend une ` +
                    "exemption et une annonce satisfaisables par le mauvais symbole.",
                "CC-10"
            );
        }
    }
    return found;
}

/**
 * Lit `DEPRECATIONS.json`. Absent → REFUS : c'est l'oracle de CC-10.
 *
 * ⚠️ **Un objet `deprecations` VIDE n'est PAS un refus**, et la nuance mérite d'être écrite
 * parce que ce dépôt pose partout la règle inverse (« aucune fonction ne rend un résultat
 * vide par défaut »). Elle ne s'applique pas ici : la comparaison de CC-10 est
 * baseline ↔ manifeste, jamais annonces ↔ quelque chose. Un registre vide ne rend pas CC-10
 * creux — il le rend **maximalement strict** : aucun retrait n'est autorisé. C'est l'état du
 * jour, et c'est un état correct.
 *
 * @returns {Record<string, object>} les annonces, indexées par chemin de surface consommée.
 */
function lireAnnonces() {
    if (!fs.existsSync(DEPRECATIONS)) {
        cm.refuse(
            `\`${docsPaths.rel(DEPRECATIONS)}\` est absent. C'est l'ORACLE de CC-10 : sans lui, ` +
                "la gate ne peut ni autoriser un retrait ni dater une balise, et sortirait " +
                "verte en n'ayant rien lu.",
            "CC-10"
        );
    }
    let data;
    try {
        data = JSON.parse(fs.readFileSync(DEPRECATIONS, "utf8"));
    } catch (err) {
        cm.refuse(`\`${docsPaths.rel(DEPRECATIONS)}\` au JSON invalide — ${err.message}`, "CC-10");
    }
    const map = data && data.deprecations;
    if (!map || typeof map !== "object" || Array.isArray(map)) {
        cm.refuse(
            `\`${docsPaths.rel(DEPRECATIONS)}\` n'a pas d'objet \`deprecations\` à sa racine.`,
            "CC-10"
        );
    }
    return map;
}

/**
 * Juge UNE annonce. Rend un tableau d'erreurs — vide si l'annonce tient.
 *
 * Les quatre champs sont portants, et chacun ferme une porte différente :
 *   • `since`       — sans lui, l'annonce n'a pas d'âge et sa durée est indécidable
 *   • `removeIn`    — sans lui, « déprécié » veut dire « retiré quand ça m'arrange »
 *   • `replacement` — on ne déprécie pas vers rien
 *   • `symbol`      — sans lui, le registre serait un SECOND endroit où écrire « c'est
 *                     déprécié », donc une description concurrente de plus : le mode d'échec
 *                     que ce dépôt paie le plus cher
 */
function jugerAnnonce(chemin, a, ctx) {
    const out = [];
    const pre = `\`${chemin}\` : l'annonce de \`${docsPaths.rel(DEPRECATIONS)}\``;
    const push = (msg) => out.push({ code: "CC-10", msg: `${pre} ${msg}` });
    const semver = (v) => (/^\d+\.\d+\.\d+$/.test(String(v)) ? String(v) : null);

    const manquants = CHAMPS_ANNONCE.filter(
        (k) => !Object.prototype.hasOwnProperty.call(a, k) || a[k] === null || a[k] === ""
    );
    if (manquants.length > 0) {
        push(
            `est INCOMPLÈTE — champ(s) manquant(s) : ${manquants.join(", ")}. Les quatre sont ` +
                "portants ; lire les contrôles suivants sur une annonce trouée reviendrait à " +
                "juger des champs absents."
        );
        return out;
    }

    // `removeIn` — un MAJEUR strictement supérieur au courant. Une annonce datée du PRÉSENT
    // n'est pas une annonce : c'est un retrait dont on prévient après coup.
    const courant = registry.requireByDirName("core").manifest.version;
    const majCourant = Number(String(courant).split(".")[0]);
    const mr = /^(\d+)\.0\.0$/.exec(String(a.removeIn));
    if (!mr || Number(mr[1]) <= majCourant) {
        push(
            `porte \`removeIn: "${a.removeIn}"\` — attendu un MAJEUR de la forme \`x.0.0\` ` +
                `STRICTEMENT supérieur au courant (${courant}). Une annonce datée du présent ` +
                "n'est pas une annonce."
        );
    }
    // `since` — dans la ligne majeure courante, et jamais au niveau ou après le retrait.
    if (!semver(a.since)) {
        push(`porte \`since: "${a.since}"\`, illisible — attendu \`x.y.z\`.`);
    } else if (Number(String(a.since).split(".")[0]) !== majCourant) {
        push(
            `annonce \`since: "${a.since}"\` hors de la ligne majeure courante (${courant}) — ` +
                "l'annonce se fait dans la ligne qui la publie."
        );
    } else if (mr && cm.cmpVersion(a.since, a.removeIn, docsPaths.rel(DEPRECATIONS)) >= 0) {
        push(
            `annonce \`since\` (${a.since}) au niveau ou après \`removeIn\` (${a.removeIn}) — ` +
                "une version qui annonce ET retire n'annonce rien."
        );
    }

    // `replacement` — TROIS formes reconnues, une quatrième REFUSÉE plutôt que devinée.
    const r = String(a.replacement);
    let ou = null;
    if (r.startsWith("plugin:")) {
        const i = r.indexOf("/");
        if (i > 0 && resolvePlugin(r.slice(i + 1), r.slice(0, i)).verdict === OK) {
            ou = `façade de \`${r.slice(0, i)}\``;
        }
    } else if (ev.EVENT_LITERAL_RE.test(r)) {
        // Un événement ÉMIS mais NON TYPÉ n'est pas un remplaçant : l'aval devrait le caster
        // à la main. Déprécier vers ça déplace la dette au lieu de la solder.
        if (ctx.literals.has(r) && ctx.typedNames.has(r)) ou = "événement émis ET typé";
    } else if (resolveCore(r, ctx.surf).verdict === OK) {
        ou = "surface du cœur";
    }
    if (!ou) {
        push(
            `désigne \`replacement: "${r}"\`, qui NE RÉSOUT PAS. **On ne déprécie pas vers ` +
                "rien** : une annonce dont la sortie de secours n'existe pas dit à " +
                "l'intégrateur de migrer vers un vide. Formes reconnues — un chemin du cœur, " +
                "un `geoleaf:*` émis ET typé, ou `plugin:<paquet>/<chemin>`."
        );
    }

    // `symbol` — et c'est ici que l'annonce cesse d'être une déclaration.
    if (!ctx.tags.has(String(a.symbol))) {
        push(
            `cite \`symbol: "${a.symbol}"\`, qui ne désigne AUCUNE déclaration portant ` +
                "`@deprecated` dans les sources expédiées. Deux causes, et il faut savoir " +
                "laquelle : ou la balise n'a jamais été posée — l'annonce n'existe alors que " +
                "dans ce JSON et l'intégrateur ne la voit nulle part — ou le symbole a été " +
                "renommé et la citation a dérivé. Forme : `chemin/relatif.ts#Propriétaire.membre`."
        );
    }
    return out;
}

/**
 * Le SENS SORTANT — une entrée a quitté une liste POSITIVE. Écrit une fois, appelé DEUX
 * fois : par le corps de vérification, et par `--update-baseline` (voir son bloc).
 *
 * @returns {{erreurs: object[], notes: string[]}}
 */
function sortiesInjustifiees({ connues, aujourdhui, d, annonces, ctx, liste }) {
    const erreurs = [];
    const notes = [];
    const vivants = new Set(aujourdhui.map((e) => e.path));

    // Les TROIS façons dont l'aval écrit « je n'en dépends plus ». Toutes trois laissent une
    // trace DANS le fichier dont cette gate imprime le sha256 ; effacer la ligne n'en laisse
    // aucune, et c'est exactement la différence que ce code mesure.
    const declasse = new Map();
    for (const [nom, valeur] of [
        ["not_required", d.not_required],
        ["withdrawn", d.withdrawn],
        ["broken_since_v3", d.broken_since_v3],
    ]) {
        for (const e of cm.entriesOf(valeur, nom)) declasse.set(e.path, nom);
    }

    for (const connu of connues) {
        if (vivants.has(connu.path)) continue;

        const chez = declasse.get(connu.path);
        if (chez) {
            notes.push(
                `[CC-10] \`${connu.path}\` a quitté \`${liste}\` — DÉCLASSÉ par l'aval en ` +
                    `\`${chez}\`. Sortie légitime : c'est SON contrat qu'il abandonne, et il ` +
                    "l'a écrit. Une sortie déclassée est notée, jamais tue."
            );
            continue;
        }

        const a = annonces[connu.path];
        if (!a) {
            erreurs.push({
                code: "CC-10",
                msg:
                    `\`${connu.path}\` a QUITTÉ \`${liste}\` sans laisser d'écrit. **La sortie ` +
                    "de cette liste est le DÉSARMEMENT de CC-01** : ce chemin n'est plus dans " +
                    "le corpus que CC-01 résout, son symbole peut donc disparaître sans " +
                    "qu'aucun vert d'ici ne bouge — et le compteur d'engagements, qui baisse " +
                    "légitimement, ne peut pas servir d'alarme. Deux gestes, et seulement " +
                    `deux : l'AMONT annonce le retrait dans \`${docsPaths.rel(DEPRECATIONS)}\` ` +
                    "(4 champs + un `@deprecated` réel sur son symbole), ou l'AVAL DÉCLASSE " +
                    "l'entrée en `not_required` / `withdrawn` / `broken_since_v3` au lieu " +
                    "d'effacer la ligne.",
            });
            continue;
        }

        const maux = jugerAnnonce(connu.path, a, ctx);
        if (maux.length > 0) {
            erreurs.push(...maux);
            continue;
        }
        notes.push(
            `[CC-10] \`${connu.path}\` a quitté \`${liste}\` — sortie ANNONCÉE par l'amont ` +
                `(since ${a.since}, removeIn ${a.removeIn}, → \`${a.replacement}\`). L'annonce ` +
                "a précédé le retrait : c'est ce qu'une politique de dépréciation est."
        );
    }
    return { erreurs, notes };
}

/**
 * Le SENS INVERSE — une balise que RIEN ne date.
 *
 * Même politique vue de l'autre bout, donc **même code** : poser un CC-13 mettrait deux
 * cliquets sur un même objet, et deux cliquets sur un objet divergent.
 */
function annoncesOrphelines(tags, annonces) {
    const erreurs = [];
    const citees = new Set(Object.values(annonces).map((a) => a && String(a.symbol)));

    for (const [cle, ou] of tags) {
        if (citees.has(cle) || ANNONCES_GRAND_PERAGE.has(cle)) continue;
        erreurs.push({
            code: "CC-10",
            msg:
                `\`${cle}\` (${ou.rel}) porte un \`@deprecated\` que RIEN ne date. ` +
                "L'intégrateur voit une rature dans son éditeur sans savoir quand le symbole " +
                "part ni par quoi le remplacer — strictement moins informatif que pas de " +
                "balise du tout. Une balise est la MOITIÉ d'une annonce ; l'autre est " +
                `l'entrée dans \`${docsPaths.rel(DEPRECATIONS)}\`. Si rien ne programme son ` +
                "retrait, ce n'est pas une dépréciation : décrivez-la comme un alias conservé.",
        });
    }

    // 🛑 Une exemption qui a perdu sa cause est une ERREUR, pas un silence — même dispositif
    // et même sévérité que l'ancien `SCOPE_EXEMPT`, dont le retrait a été exigé par CC-06 le
    // jour où sa cause est tombée.
    for (const [cle, motif] of ANNONCES_GRAND_PERAGE) {
        if (!tags.has(cle)) {
            cm.refuse(
                `l'exemption de grand-pérage \`${cle}\` (${motif}) ne mord plus AUCUNE balise : ` +
                    "le symbole a été retiré, renommé, ou sa balise est partie. Une exemption " +
                    "qui a perdu sa cause desserre la gate en silence — retirez-la de " +
                    "`ANNONCES_GRAND_PERAGE`.",
                "CC-10"
            );
        }
    }
    return { erreurs };
}

// ─── CC-09 : anti-tautologie ─────────────────────────────────────────────────────────

/**
 * Le verrou anti-tautologie, et pourquoi il est TRIPLE.
 *
 * `EXPECTED_FACADE_MEMBERS` est un tableau **écrit à la main**. Le geste qui rend CC-01 vert
 * sans rien réparer est : *ajouter la ligne à la main*. Ce qui l'interdit n'est pas cette
 * gate — c'est le golden master, qui confronte la liste à un vrai `startApp()`. **La gate n'a
 * donc le droit de croire cette liste que tant que cette confrontation existe.**
 *
 * Formulation directement issue de `verify-deploy-server-contract.cjs` : *« SC-02 relit le
 * disque, il ne compare pas le générateur à lui-même. Vérifier que `serverContractFiles()`
 * contient ce que `serverContractFiles()` contient serait une tautologie. »*
 *
 * ⚠️ **Les trois assertions, et pourquoi aucune ne suffit :**
 *   • `d.missing` — un membre qui DISPARAÎT du runtime alors qu'il est dans la liste
 *   • `d.extra`   — un membre qui APPARAÎT sans être dans la liste
 *   • `membersAgain === members` — la stabilité entre deux lectures à 30 ms
 *
 * Retirer la troisième seule rendrait la liste **tamponnable** sans que les deux premières
 * bougent : il suffirait d'une surface intermittente pour que quiconque « stabilise » en
 * ajoutant des lignes. C'est pour ça que CC-09 lit les trois.
 *
 * ⚠️ **Et il les lit à l'AST, pas au grep.** Un `grep 'd.missing'` se contourne en renommant
 * `d` en `diff` — le fichier resterait correct, la gate deviendrait aveugle. La lecture porte
 * donc sur le NOM DE PROPRIÉTÉ accédé dans le premier argument d'`expect(…)`, quel que soit le
 * nom de la variable qui le porte.
 */
function checkAntiTautology() {
    const file = path.join(
        registry.requireByDirName("core").absDir,
        "__tests__",
        "app",
        "boot-golden-master.test.js"
    );
    if (!fs.existsSync(file)) {
        cm.refuse(
            `le golden master est introuvable (${path.relative(ROOT, file)}). Sans lui, ` +
                "`EXPECTED_FACADE_MEMBERS` n'est plus confronté à aucun boot : cette gate " +
                "comparerait une liste écrite à la main avec elle-même.",
            "CC-09"
        );
    }
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    /** Noms de propriété passés en 1er argument d'un `expect(...)`, COMPTÉS. */
    const seen = new Map();
    const bump = (n) => seen.set(n, (seen.get(n) ?? 0) + 1);
    const visit = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "expect" &&
            node.arguments.length > 0
        ) {
            const a = node.arguments[0];
            if (ts.isPropertyAccessExpression(a)) bump(a.name.text);
            else if (ts.isIdentifier(a)) bump(a.text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    // 🛑 **Les MULTIPLICITÉS sont load-bearing, et c'est une mutation qui l'a établi.**
    //
    // La première version de CC-09 exigeait la simple PRÉSENCE des trois noms. Mutation jouée
    // le 10/08/2026 : renommer `expect(d.extra, …)` dans la boucle sur `DEPTH2_FACADES` — donc
    // désarmer le contrôle « un membre APPARAÎT » à la profondeur 2, celle que cette gate
    // croit. **CC-09 est resté VERT**, parce que le second `expect(d.extra, …)`, celui de la
    // profondeur 1 (les clés), suffisait à satisfaire la présence.
    //
    // Autrement dit : le verrou couvrait les clés et croyait couvrir les membres. C'est
    // exactement le mode que ce dépôt appelle « une garde jamais vue rouge ne garde rien » —
    // sauf qu'ici la garde EXISTAIT, et que seul le fait de la muter l'a montrée creuse.
    //
    // D'où des seuils, pas des booléens : **2** pour `missing` et `extra` (un par profondeur),
    // **1** pour `membersAgain`. Ils se re-mesurent en lisant le fichier, et le message dit le
    // compte trouvé — pas seulement qu'il manque quelque chose.
    const REQUIRED = [
        [
            "missing",
            2,
            "un membre qui DISPARAÎT du runtime ne serait plus vu — 2 attendus : la boucle " +
                "sur `DEPTH2_FACADES` (profondeur 2) et le diff des clés (profondeur 1)",
        ],
        [
            "extra",
            2,
            "un membre qui APPARAÎT hors liste ne serait plus vu — 2 attendus, même partage " +
                "de profondeur. C'est CE seuil que la mutation du 10/08 a rendu nécessaire",
        ],
        [
            "membersAgain",
            1,
            "la liste redeviendrait tamponnable : il suffirait d'une surface intermittente " +
                "pour que quiconque « stabilise » en ajoutant des lignes à la main",
        ],
    ];
    const perdus = REQUIRED.filter(([n, min]) => (seen.get(n) ?? 0) < min);
    if (perdus.length > 0) {
        console.error(
            `${C.r}✗${C.x} [${TAG}/CC-09] ${perdus.length} assertion(s) du verrou ` +
                "anti-tautologie ont disparu du golden master :"
        );
        for (const [n, min, conseq] of perdus) {
            console.error(
                `    expect(…${n}…) — ${seen.get(n) ?? 0} trouvée(s), ${min} attendue(s). ` +
                    `Sans elle, ${conseq}.`
            );
        }
        console.error(
            `${C.d}    Sans ces verrous, \`EXPECTED_FACADE_MEMBERS\` n'est plus confronté à un\n` +
                `    vrai boot, et CC-01 vérifierait une liste écrite à la main contre elle-même.${C.x}`
        );
        cm.refuse("le verrou anti-tautologie du golden master est incomplet", "CC-09");
    }

    // Le golden master doit AUSSI lire la même source que nous — sinon il confronte autre chose.
    if (!/namespace-surface\.mjs/.test(text) || !/DEPTH2_FACADES/.test(text)) {
        cm.refuse(
            "le golden master ne lit plus `lib/namespace-surface.mjs` / `DEPTH2_FACADES` — " +
                "il ne confronte donc plus l'oracle que CETTE gate croit.",
            "CC-09"
        );
    }
    // CC-09 ne « régresse » jamais en 1 : ou bien le verrou est là, ou bien la gate refuse de
    // conclure. Il n'y a pas d'état intermédiaire où l'on croirait à demi une liste manuelle.
    return { assertions: REQUIRED.reduce((a, [, min]) => a + min, 0) };
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const surf = await import(
        "file://" +
            path.join(ROOT, "scripts", "lib", "namespace-surface.mjs").split(path.sep).join("/")
    );

    const read = cm.readConsumers();
    console.log(`${C.c}── 🔁 Contrat inverse : ce dont l'aval dépend a-t-il disparu ? ──${C.x}\n`);
    cm.describe(read);

    if (read.status === "skip") {
        // Issue ② : exit 0, motif nommé, chemin imprimé. Ce qui empêche ce SKIP de tout avaler
        // est `probe-gate-visibility.cjs`, qui plante un manifeste de FIXTURE et exige de voir
        // cette gate rougir dessus. Il ne prouve pas que le vrai manifeste est lu — il prouve
        // que la gate MORD ENCORE.
        process.exit(0);
    }

    // ── CC-00 — planchers de non-vacuité ─────────────────────────────────────────────
    const memberTotal = Object.values(surf.EXPECTED_FACADE_MEMBERS).reduce(
        (a, b) => a + b.length,
        0
    );
    if (surf.EXPECTED_FACADE_KEYS.length < FLOOR.keys) {
        cm.refuse(
            `EXPECTED_FACADE_KEYS ne rend que ${surf.EXPECTED_FACADE_KEYS.length} clé(s) ` +
                `(plancher ${FLOOR.keys}) — l'oracle s'est effondré.`,
            "CC-00"
        );
    }
    if (memberTotal < FLOOR.members) {
        cm.refuse(
            `EXPECTED_FACADE_MEMBERS ne rend que ${memberTotal} membre(s) (plancher ` +
                `${FLOOR.members}) — la profondeur 2 est trop étroite pour que CC-01 conclue. ` +
                "Élargissez `DEPTH2_FACADES` (tâches 1.4/1.5) AVANT de compter sur cette gate.",
            "CC-00"
        );
    }
    console.log(
        `${C.d}   oracle : ${surf.EXPECTED_FACADE_KEYS.length} clés · ` +
            `${surf.DEPTH2_FACADES.length} façades en profondeur 2 · ${memberTotal} membres` +
            `${C.x}\n`
    );

    const errors = [];
    const outOfScope = [];
    const notes = [];
    let checked = 0;
    let pluginResolved = 0;

    // ── Les oracles du DÉPÔT — construits une fois, hors de la boucle sur les manifestes ──
    //
    // Ils décrivent nos sources, pas un consommateur : les recalculer par manifeste ne
    // changeait aucun verdict et coûtait un parcours d'AST complet par entrée lue. Le hoist
    // est surtout ce qui rend CC-10 possible côté `--update-baseline` : le writer sort avant
    // le corps de vérification, et il doit rendre le MÊME jugement que lui (§CC-10).
    const literals = ev.collectEventLiterals(ev.shippedSources());
    const contract = path.join(
        registry.requireByDirName("core").absDir,
        "src",
        "contracts",
        "event-bus.contract.ts"
    );
    const typedNames = new Set();
    for (const mapName of ["GeoLeafEventMap", "GeoLeafRawEventMap"]) {
        for (const k of readInterfaceMembers(contract, mapName, { tag: TAG })) {
            typedNames.add(k);
        }
    }
    if (typedNames.size === 0) {
        cm.refuse(
            "0 clé extraite des maps d'événements — la gate est aveugle, pas verte.",
            "CC-07"
        );
    }

    // La baseline d'EVENT-MAP, lue et non recopiée : c'est elle qui dit si une dette de
    // typage est DÉJÀ suivie par un cliquet (voir le partage de sévérité de CC-07).
    const emBaselinePath = path.join(ROOT, "scripts", ".baselines", "event-map-coverage.json");
    if (!fs.existsSync(emBaselinePath)) {
        cm.refuse(
            "la baseline EVENT-MAP est absente — CC-07 ne peut pas distinguer une dette " +
                "déjà cliquetée d'une dette que personne ne suit, et rendrait donc l'une " +
                "des deux en silence.",
            "CC-07"
        );
    }
    const emBaseline = new Set(JSON.parse(fs.readFileSync(emBaselinePath, "utf8")).events);

    for (const m of read.manifests) {
        const d = m.data;
        const req = d.required;

        // ── CC-00 (suite) — une entrée présente dans DEUX listes ─────────────────────
        //
        // Constat consigné par le contrôle du Sprint 0 et non tranché par lui :
        // `GeoJSON.addData` figure dans `not_required` ET dans `broken_since_v3`. Les deux
        // énoncés sont vrais séparément, mais un lecteur doit dire lequel il applique — sans
        // quoi CC-05 « choisit » en silence. **Précédence écrite : `broken_since_v3` gagne**,
        // parce que c'est la liste sous CLIQUET (CC-05), donc celle dont l'oubli coûte ;
        // `not_required` est de la documentation d'arbitrage, que rien ne vérifie.
        const dansDeuxListes = [];
        const notReq = Object.keys(d.not_required ?? {}).filter((k) => !cm.isMeta(k));
        for (const k of notReq) {
            if (Object.prototype.hasOwnProperty.call(d.broken_since_v3 ?? {}, k)) {
                dansDeuxListes.push(k);
            }
        }
        for (const k of dansDeuxListes) {
            notes.push(
                `[CC-00] \`${k}\` est dans \`not_required\` ET \`broken_since_v3\` — ` +
                    "précédence appliquée : `broken_since_v3` (liste sous cliquet CC-05)."
            );
        }

        // ── CC-01 — required.public ──────────────────────────────────────────────────
        for (const e of cm.entriesOf(req.public, "required.public")) {
            checked++;
            const r = resolve(e, surf);
            if (r.verdict === ABSENT) {
                errors.push({
                    code: "CC-01",
                    msg: `\`${e.path}\` (${e.provider}) ne résout pas — ${r.why}`,
                });
            } else if (r.verdict === OUT_OF_SCOPE) {
                outOfScope.push({ code: "CC-01", path: e.path, why: r.why });
            }
        }

        // ── CC-02 — private_tolerated ────────────────────────────────────────────────
        //
        // Message DISTINCT de CC-01, et ce n'est pas cosmétique : *« sa disparition n'est pas
        // un bug, c'est une rupture de séquence — cf. D-14 »*. Ces chemins sont `_`-préfixés :
        // l'aval SAIT qu'il s'appuie sur de l'interne, et la séquence écrite au manifeste dit
        // qu'ils partiront quand un équivalent public existera. Les confondre avec le contrat
        // public ferait traiter une dette planifiée comme une régression.
        for (const e of cm.entriesOf(req.private_tolerated, "required.private_tolerated")) {
            checked++;
            const r = resolve(e, surf);
            if (r.verdict === ABSENT) {
                errors.push({
                    code: "CC-02",
                    msg:
                        `\`${e.path}\` ne résout plus — ${r.why}. Sa disparition n'est pas un ` +
                        "bug, c'est une RUPTURE DE SÉQUENCE : cf. D-14 et le bloc `sequence` " +
                        "du manifeste.",
                });
            } else if (r.verdict === OUT_OF_SCOPE) {
                // ⚠️ **Nommé, pas tu.** 2 entrées sur 6 sont structurellement invisibles, et
                // les taire rendrait vert ce que la gate n'a pas lu. `_app` est exclu de
                // `DEPTH2_FACADES` à dessein (motif écrit dans `namespace-surface.mjs`), et un
                // membre `_`-préfixé est filtré par `walkNamespace` par construction. Ce n'est
                // donc pas un manque à combler : c'est une limite à déclarer.
                notes.push(
                    `[CC-02] \`${e.path}\` est STRUCTURELLEMENT INVÉRIFIABLE en profondeur 2 — ` +
                        `${r.why}. Cette entrée n'est ni verte ni rouge : elle n'est pas lue.`
                );
            }
        }

        // ── CC-03 — façades de plugin ────────────────────────────────────────────────
        //
        // Déjà exécuté par `resolve()` ci-dessus. On COMPTE ici ce que le troisième oracle a
        // réellement lu, et on l'imprime : sans ce décompte, un manifeste qui perdrait ses
        // entrées `plugin:*` laisserait la gate annoncer un vert « trois oracles » alors que
        // le troisième n'aurait rien ouvert. Un oracle qui ne sert plus doit se voir.
        pluginResolved += cm
            .entriesOf(req.public, "required.public")
            .filter((e) => String(e.provider).startsWith("plugin:")).length;

        // ── CC-04 — cliquet ENTRANT ──────────────────────────────────────────────────
        const negatives = {
            private_tolerated: cm
                .entriesOf(req.private_tolerated, "private_tolerated")
                .map((e) => e.path)
                .sort(),
            requested: cm
                .entriesOf(d.requested, "requested")
                .map((e) => e.path)
                .sort(),
            broken_since_v3: cm
                .entriesOf(d.broken_since_v3, "broken_since_v3")
                .map((e) => e.path)
                .sort(),
        };

        // ── CC-10 (préalable) — les listes POSITIVES ─────────────────────────────────
        //
        // ⚠️ **Elles n'étaient suivies par RIEN avant le Sprint 7, et c'est là qu'était le
        // trou.** La baseline S1.8 ne portait que les trois listes négatives ; `required.public`
        // et `required.events` — c'est-à-dire LE CONTRAT — n'avaient aucune mémoire, alors
        // qu'elles sont écrites par l'AVAL, relues à neuf à chaque run, et jamais confrontées
        // à hier.
        //
        // Le `provider` entre dans la baseline mais **PAS dans la clé du cliquet** : le cliquet
        // compare des chemins, et un changement de fournisseur n'est pas un retrait. Il y entre
        // parce que la sonde `GATE-PROBE` reconstruit un manifeste depuis cette liste — défauter
        // `Ws` et `Measure.*` en `core` les ferait rougir en CC-01, donc rougir la sonde pour un
        // motif qui n'est pas le sien.
        const parChemin = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const positives = {
            public: cm
                .entriesOf(req.public, "required.public")
                .map((e) => ({ path: e.path, provider: e.provider || "core" }))
                .sort(parChemin),
            events: cm
                .entriesOf(req.events, "required.events")
                .map((e) => ({ path: e.path, provider: "core" }))
                .sort(parChemin),
        };

        if (UPDATE) {
            // 🛑 **La régénération est SOUMISE au cliquet ; elle ne le contourne pas.**
            //
            // Le `_comment` avertit depuis S1.8 qu'« ajouter une entrée à la main ici est le
            // geste qui désarme la gate » — en PROSE, et c'est vrai des listes NÉGATIVES. Sur
            // les POSITIVES, le geste qui désarme n'est pas d'éditer le fichier : c'est de le
            // RÉGÉNÉRER après un retrait, ce qui transforme une disparition en état de fait,
            // avec une commande documentée et l'air de la propreté.
            //
            // La prose ne peut rien contre ça. Ce dépôt a mesuré qu'« un avertissement en prose
            // n'a arrêté ni la première ni la seconde » collision de numéro, et sa leçon écrite
            // est de préférer une garde qui COMPTE à un paragraphe de plus.
            //
            // Conséquence, et c'est très exactement ce qu'une politique de dépréciation est :
            // **l'annonce précède le retrait, mécaniquement.** Pour enregistrer une sortie, il
            // faut d'abord écrire l'annonce (amont) ou le déclassement (aval).
            if (read.manifests.length > 1) {
                cm.refuse(
                    `${read.manifests.length} manifestes lus, et ce writer n'a JAMAIS su en ` +
                        "enregistrer plus d'un : il sort après le premier, en silence. CC-04 " +
                        "comparerait alors le second consommateur à la baseline du premier. " +
                        "Défaut préexistant, rendu bruyant plutôt que corrigé à la volée.",
                    "CC-04"
                );
            }
            const ancienne = fs.existsSync(BASELINE)
                ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
                : {};
            const connuesP = (ancienne.positives ?? {})[m.consumer];
            if (connuesP) {
                const annonces = lireAnnonces();
                const ctxU = { surf, literals, typedNames, tags: annoncesEnSource() };
                const bloque = [
                    ...sortiesInjustifiees({
                        connues: connuesP.public ?? [],
                        aujourdhui: positives.public,
                        d,
                        annonces,
                        ctx: ctxU,
                        liste: "required.public",
                    }).erreurs,
                    ...sortiesInjustifiees({
                        connues: connuesP.events ?? [],
                        aujourdhui: positives.events,
                        d,
                        annonces,
                        ctx: ctxU,
                        liste: "required.events",
                    }).erreurs,
                ];
                if (bloque.length > 0) {
                    for (const e of bloque) console.error(`    ${C.r}✗${C.x} [${e.code}] ${e.msg}`);
                    cm.refuse(
                        `${bloque.length} sortie(s) de liste POSITIVE ne sont justifiées par ` +
                            "rien : la baseline REFUSE de les enregistrer, et n'a rien écrit. " +
                            "Annoncez le retrait (amont) ou déclassez l'entrée (aval) AVANT de " +
                            "régénérer.",
                        "CC-10"
                    );
                }
            }
            fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
            fs.writeFileSync(
                BASELINE,
                JSON.stringify(
                    {
                        _comment:
                            "Contrat inverse — S1.8 pour les TROIS listes NÉGATIVES (`lists`, " +
                            "cliquets CC-04 entrant / CC-05 sortant : elles ne peuvent que " +
                            "RÉTRÉCIR) et S7.4 pour les DEUX listes POSITIVES (`positives`, " +
                            "cliquet CC-10 : `required.public` et `required.events` ne peuvent " +
                            "pas rétrécir sans annonce). ⚠️ Les deux moitiés se désarment " +
                            "DIFFÉREMMENT. Une négative se désarme en ajoutant une ligne à la " +
                            "main — une entrée n'en sort que quand le défaut qu'elle nomme est " +
                            "réparé. Une positive se désarme en RÉGÉNÉRANT après un retrait, ce " +
                            "qui fait passer une disparition pour un état de fait. C'est pourquoi " +
                            "`--update-baseline` REFUSE (exit 2 / CC-10) d'enregistrer une sortie " +
                            "que rien ne justifie : sur cette moitié-là, l'avertissement n'est " +
                            "plus en prose.",
                        _generated:
                            "GEOLEAF_CONSUMERS=<dir> node scripts/verify-consumer-contract.cjs --update-baseline",
                        _consumer: m.consumer,
                        _manifest_version: m.version,
                        _manifest_sha: m.sha,
                        lists: negatives,
                        positives: { ...(ancienne.positives ?? {}), [m.consumer]: positives },
                    },
                    null,
                    4
                ) + "\n"
            );
            console.log(
                `${C.g}✅${C.x} [${TAG}] baseline écrite — ` +
                    `${Object.values(negatives).reduce((a, b) => a + b.length, 0)} entrées ` +
                    `négatives, ${positives.public.length + positives.events.length} positives ` +
                    `sous cliquet CC-10 pour \`${m.consumer}\`.`
            );
            process.exit(0);
        }

        if (!fs.existsSync(BASELINE)) {
            cm.refuse(
                `baseline absente (${path.relative(ROOT, BASELINE)}). Sans elle, CC-04 et ` +
                    "CC-05 n'ont pas de point de comparaison et sortiraient verts en n'ayant " +
                    "rien cliqueté. Régénérez avec --update-baseline.",
                "CC-04"
            );
        }
        const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
        const base = baseline.lists ?? {};
        for (const [listName, entries] of Object.entries(negatives)) {
            const known = new Set(base[listName] ?? []);
            const neuves = entries.filter((p) => !known.has(p));
            for (const p of neuves) {
                errors.push({
                    code: "CC-04",
                    msg:
                        `\`${p}\` est apparu dans la liste NÉGATIVE \`${listName}\` sans être ` +
                        "en baseline. Ces listes ne peuvent que RÉTRÉCIR : une entrée neuve " +
                        "est une dette qu'on ajoute unilatéralement, pas un constat.",
                });
            }
        }

        // ── CC-05 — cliquet SORTANT ──────────────────────────────────────────────────
        //
        // Une entrée `broken` qui RÉSOUT de nouveau n'est pas une bonne nouvelle silencieuse :
        // c'est une entrée fausse, et une liste négative qui contient du faux se fait ignorer
        // en bloc. Elle reste une erreur JUSQU'À SON RETRAIT (ou son reclassement) — même
        // invariant que EM-02 et MH-02, et la formulation est la leur à dessein.
        for (const e of cm.entriesOf(d.broken_since_v3, "broken_since_v3")) {
            const r = resolveCore(e.path, surf);
            if (r.verdict === OK) {
                errors.push({
                    code: "CC-05",
                    msg:
                        `\`${e.path}\` est déclaré \`broken_since_v3\` mais RÉSOUT (${r.why}). ` +
                        "Reclassez-le (`required.*` s'il est vraiment revenu) ou retirez-le — " +
                        "une entrée de baseline devenue fausse est une erreur jusqu'à retrait.",
                });
            }
        }

        // ── CC-07 — les événements ───────────────────────────────────────────────────
        //
        // Trois propriétés, et un événement doit les avoir toutes : TYPÉ dans l'une des deux
        // maps du contrat, ÉMIS en littéral dans une source expédiée, et sur le BUS DOM. La
        // troisième est celle qu'on oublie : `Events.on` délègue à `addEventListener`, donc un
        // nom qui ne transite que par le bus MapLibre est une promesse que la façade ne peut
        // pas tenir — c'est le cas de `geoleaf:filters:changed`, que le CDC amont recommandait
        // à l'aval de migrer... vers un nom que rien n'émet sur ce bus.
        //
        // ⚠️ Les trois oracles que CC-07 consomme (`literals`, `typedNames`, `emBaseline`) sont
        // construits AVANT cette boucle depuis le Sprint 7 : ce sont des propriétés du DÉPÔT,
        // pas du manifeste, et le writer de `--update-baseline` en a besoin alors qu'il sort
        // avant d'arriver ici. Les recalculer par manifeste n'apportait rien.

        for (const e of cm.entriesOf(req.events, "required.events")) {
            checked++;
            const name = e.path;
            // ⚠️ La branche « préfixe composé » vivait ICI, et elle est retirée avec
            // `SCOPE_EXEMPT` et `DYNAMIC_PREFIXES` (Sprint 4, 4.2/4.3). Elle existait pour un
            // seul producteur — `fireEvent` du plugin `table` — qui prend désormais le nom
            // complet. La garder vide aurait produit un test toujours faux : une branche que
            // rien ne peut plus emprunter est indiscernable d'une branche qui ne garde rien.
            // Le motif du retrait, et ce qu'il découvre, sont au bloc `SCOPE_EXEMPT` ci-dessus.
            if (ev.MAP_BUS.has(name)) {
                errors.push({
                    code: "CC-07",
                    msg:
                        `\`${name}\` est porté par le bus MapLibre (\`map.fire\`/\`map.on\`), ` +
                        "pas par `document`. `Events.on` délègue à `addEventListener` : le " +
                        "typer serait une promesse que la façade ne peut pas tenir.",
                });
                continue;
            }
            if (!literals.has(name)) {
                errors.push({
                    code: "CC-07",
                    msg: `\`${name}\` n'apparaît comme littéral dans AUCUNE source expédiée.`,
                });
                continue;
            }
            if (!typedNames.has(name)) {
                // 🛑 **Les trois propriétés de CC-07 n'ont PAS la même sévérité, et le partage
                // est mesuré plutôt que choisi.** « Non émis » et « mauvais bus » sont des
                // ruptures : l'aval attend un événement qui ne viendra pas. « Non typé » est
                // une DETTE — l'événement arrive, l'aval l'écoute par un cast à la main.
                //
                // Or cette dette est **déjà sous cliquet**, celui d'EM-02, dont la baseline ne
                // peut que rétrécir. La re-porter ici en rouge poserait un SECOND cliquet sur
                // le même objet, et deux cliquets sur un objet divergent — c'est la règle que
                // `lib/ts-decl-read.cjs` formule pour les lecteurs et qui vaut pour les
                // registres. Pire : `ci:local` resterait rouge en permanence pour une dette
                // dont le propriétaire écrit est le Sprint 4, ⏸ jusqu'à la 3.1.0. Une gate
                // durablement rouge se fait désarmer.
                //
                // ⚠️ Ce que CC-07 ajoute et qu'EM-02 ne peut pas dire : **QUI en dépend**.
                // La baseline EVENT-MAP est une liste de noms ; celle-ci nomme le consommateur.
                const suivi = emBaseline.has(name);
                if (suivi) {
                    notes.push(
                        `[CC-07] \`${name}\` est ÉMIS mais NON TYPÉ — dette déjà sous cliquet ` +
                            "EM-02 (`scripts/.baselines/event-map-coverage.json`, décroissante), " +
                            "propriétaire écrit : Sprint 4 de `roadmap_contrat-inverse-api-" +
                            "publique.md`. Ce que cette ligne ajoute à EM-02 : un consommateur " +
                            `AVAL en dépend (${JSON.stringify(e.raw?.listenedBy ?? [])}).`
                    );
                } else {
                    errors.push({
                        code: "CC-07",
                        msg:
                            `\`${name}\` est émis, NON TYPÉ, et absent de la baseline EM — ` +
                            "il n'est donc suivi par aucun cliquet. Ajoutez la clé dans " +
                            "`packages/core/src/contracts/event-bus.contract.ts`.",
                    });
                }
            }
        }

        // ── CC-08 — le contrat DOM ───────────────────────────────────────────────────
        //
        // Deux propriétaires, deux vérifications DIFFÉRENTES, et les confondre serait rendre
        // vert ce qu'on n'a pas lu :
        //   • `owner: "library"` → c'est NOUS qui posons le nœud : un littéral doit exister
        //     dans les sources du cœur, à la citation `literal`.
        //   • `owner: "host"`    → c'est l'HÔTE qui le pose (Odoo dans son XML, l'app de démo
        //     dans son `index.html`). Il n'y a rien à chercher dans nos sources ; ce qui est
        //     vérifiable est que la citation `readBy` existe, et elle est aval, donc non
        //     mesurable ici. L'entrée est alors une OBLIGATION déclarée, pas une assertion.
        const coreSrc = path.join(registry.requireByDirName("core").absDir, "src");
        for (const entry of req.dom_contract ?? []) {
            if (typeof entry === "string") {
                cm.refuse(
                    `\`dom_contract\` porte une chaîne nue (\`${entry}\`) — CC-08 a besoin de ` +
                        "`{selector, owner, readBy}` pour distinguer une obligation de la " +
                        "bibliothèque d'une obligation de l'hôte. Une chaîne ne peut porter " +
                        "ni l'un ni l'autre, et CC-08 ne peut pas s'exécuter.",
                    "CC-08"
                );
            }
            if (!entry || typeof entry !== "object" || typeof entry.owner !== "string") {
                cm.refuse(
                    `entrée \`dom_contract\` sans clé \`owner\` : ${JSON.stringify(entry)}`,
                    "CC-08"
                );
            }
            checked++;
            if (entry.owner === "host") {
                notes.push(
                    `[CC-08] \`${entry.selector}\` — obligation de l'HÔTE : rien à vérifier ` +
                        "dans nos sources, seule la citation `readBy` fait foi, et elle est aval."
                );
                continue;
            }
            if (entry.owner !== "library") {
                errors.push({
                    code: "CC-08",
                    msg: `\`${entry.selector}\` : \`owner\` inconnu (\`${entry.owner}\`).`,
                });
                continue;
            }
            // Le sélecteur porte `#` ou `[data-…]` ; le littéral en source est l'id ou
            // l'attribut, sans le `#`. On cherche la forme NUE, qui est ce qui est écrit.
            const needle = entry.selector.replace(/^#/, "").replace(/^\[|\]$/g, "");
            if (!grepSources(coreSrc, needle)) {
                errors.push({
                    code: "CC-08",
                    msg:
                        `\`${entry.selector}\` est déclaré \`owner: "library"\` mais aucun ` +
                        `littéral \`${needle}\` n'existe dans les sources du cœur. Soit le ` +
                        "nœud a changé de nom (rupture pour l'aval), soit il est désormais " +
                        "posé par l'hôte et l'entrée doit changer de propriétaire.",
                });
            }
        }

        // ── CC-10 — cliquet de DÉPRÉCIATION ──────────────────────────────────────────
        //
        // **Ce que ce code attrape, et que CC-01 ne peut pas voir.** CC-01 énonce : tout
        // `required.public` résout. Son corpus EST le manifeste — écrit par l'aval, relu à
        // neuf à chaque run, jamais confronté à hier. Sa force est donc une fonction de la
        // taille d'un corpus que personne ici ne contrôle :
        //
        //   ① je veux retirer `X.y`        → CC-01 est ROUGE (le manifeste l'exige)
        //   ② l'entrée quitte le manifeste → gate VERTE, « 66 engagements » au lieu de 67
        //   ③ je retire le symbole         → gate VERTE. L'aval casse à la vendorisation.
        //
        // **La sortie de la liste EST le désarmement de CC-01**, et le geste ② est
        // structurellement invisible d'ici : le manifeste n'est pas commité dans ce dépôt, et
        // le compteur d'engagements baisse LÉGITIMEMENT dans les deux sens — il ne peut pas
        // servir d'alarme. CC-10 est la mémoire qui manque, et elle vit de NOTRE côté, dans un
        // fichier commité et sous revue : c'est ce qui la rend inattaquable depuis l'autre dépôt.
        //
        // ⚠️ **Et l'attaque n'a pas besoin d'attaquant.** L'aval réécrit périodiquement son
        // manifeste, retire ce qu'il croit ne plus consommer, et l'amont lit ce retrait comme
        // une permission.
        //
        // **Le geste LÉGITIME existe, et il est nommé dans le message d'erreur** : l'aval
        // DÉCLASSE vers `not_required` / `withdrawn` / `broken_since_v3` au lieu d'effacer la
        // ligne. `not_required` est une porte de sortie qu'il peut s'ouvrir seul — c'est voulu,
        // c'est SON contrat qu'il abandonne. **CC-10 ne supprime pas la sortie : il supprime la
        // sortie MUETTE.**
        //
        // Symétrie à retenir : **CC-04 interdit qu'une liste NÉGATIVE grandisse unilatéralement ;
        // CC-10 interdit qu'une liste POSITIVE rétrécisse unilatéralement.** Chaque partie ne
        // peut déplacer le manifeste que dans la direction qui lui coûte.
        //
        // 📌 Hors périmètre, et ce n'est pas un oubli : `installed_by_host` n'est pas sous ce
        // cliquet. La clause `policy` du manifeste ne nomme que `public` et `events`.
        {
            const annonces = lireAnnonces();
            const ctx = { surf, literals, typedNames, tags: annoncesEnSource() };
            const connuesP = (baseline.positives ?? {})[m.consumer];

            if (!connuesP) {
                // Plancher de non-vacuité, même fonction que ceux de CC-00, CC-03 et CC-11 :
                // distinguer « rien à cliqueter par ce chemin » de « ce chemin ne cliquette
                // plus rien ». Un consommateur neuf n'a pas d'hier ; le dire vaut mieux que
                // le taire.
                notes.push(
                    `[CC-10] \`${m.consumer}\` n'a aucune liste positive en baseline — aucune ` +
                        "sortie n'est détectable pour lui. Ce n'est pas un vert de sa part : " +
                        "`--update-baseline` l'y fait entrer."
                );
            } else {
                for (const [liste, connues, aujourdhui] of [
                    ["required.public", connuesP.public ?? [], positives.public],
                    ["required.events", connuesP.events ?? [], positives.events],
                ]) {
                    const v = sortiesInjustifiees({
                        connues,
                        aujourdhui,
                        d,
                        annonces,
                        ctx,
                        liste,
                    });
                    errors.push(...v.erreurs);
                    notes.push(...v.notes);
                }

                // Les ARRIVÉES ne sont pas cliquetées — une liste positive qui grandit est le
                // bon sens (S6 y a fait entrer `Core.isAttached` et `Core.reattach` depuis
                // `requested`), et CC-01 les vérifie déjà. Poser un cliquet entrant rendrait la
                // gate rouge à chaque promotion, donc durablement rouge, donc désarmée —
                // l'argument est déjà écrit au bloc CC-07. Mais une arrivée non ENREGISTRÉE
                // n'est pas encore PROTÉGÉE : elle repartirait demain sans un mot.
                const connus = new Set(
                    [...(connuesP.public ?? []), ...(connuesP.events ?? [])].map((e) => e.path)
                );
                const neuves = [...positives.public, ...positives.events]
                    .map((e) => e.path)
                    .filter((p) => !connus.has(p));
                if (neuves.length > 0) {
                    notes.push(
                        `[CC-10] ${neuves.length} entrée(s) positive(s) sont PLUS RÉCENTES que ` +
                            `la baseline (${neuves.join(", ")}) — vérifiées par CC-01, mais hors ` +
                            "cliquet : leur retrait passerait inaperçu. `--update-baseline`."
                    );
                }

                // La baseline décrit un fichier plus ancien que celui qu'on vient de lire. Ce
                // n'est pas une régression — c'est le seul signal disponible qu'une part du
                // contrat n'est pas encore mémorisée, et il manquait. ⚠️ NOTE et non rouge :
                // un rouge sur divergence rendrait la gate rouge à chaque édition légitime de
                // l'aval, donc rouge en permanence, donc désarmée.
                if (baseline._manifest_sha && baseline._manifest_sha !== m.sha) {
                    notes.push(
                        `[CC-10] la baseline a été enregistrée sur le manifeste ` +
                            `v${baseline._manifest_version} (sha256:${baseline._manifest_sha}) ; ` +
                            `celui-ci est en v${m.version} (sha256:${m.sha}). Le cliquet compare ` +
                            "à un état antérieur — ce qu'il doit faire, mais il faut le savoir. " +
                            "⚠️ Aucune gate du clone public ne verra cette dérive : là-bas " +
                            "`GEOLEAF_CONSUMERS` n'est pas défini et cette gate SAUTE."
                    );
                }
            }

            errors.push(...annoncesOrphelines(ctx.tags, annonces).erreurs);
        }

        // ── CC-11 — `installed_by_host` : ce que l'hôte ÉCRIT doit rester libre ──────
        //
        // Symétrique exact de CC-01, et c'est la raison d'être du code. CC-01 vérifie qu'un
        // chemin LU par l'aval existe bien ici. Celui-ci vérifie qu'un chemin ÉCRIT par
        // l'aval n'existe PAS ici — parce que deux écrivains sur une même clé du namespace,
        // c'est le dernier qui gagne, en silence, à un ordre de boot près. Le symptôme se
        // lit chez le consommateur, des mois plus tard, et jamais comme une erreur.
        //
        // ⚠️ **Cette clé a d'abord été refusée par CC-00, et le motif du refus disait déjà
        // ce qu'il fallait faire** : « une clé que ce lecteur ne connaît pas est une clé
        // qu'aucun code CC ne vérifie ». La déclarer dans `KNOWN_TOP_LEVEL` sans lui donner
        // de code aurait satisfait la lettre de ce refus en manquant sa raison — la gate
        // serait redevenue verte sur une part du contrat qu'elle ne lit toujours pas.
        for (const e of cm.entriesOf(d.installed_by_host, "installed_by_host")) {
            if (resolveCore(e.path, surf).verdict === OK) {
                errors.push({
                    code: "CC-11",
                    msg:
                        `\`${e.path}\` est déclaré \`installed_by_host\` — l'aval l'ÉCRIT sur ` +
                        "le namespace — mais il résout AUSSI sur la surface du cœur. Deux " +
                        "écrivains pour une clé : le vainqueur dépend de l'ordre de boot, et " +
                        "l'écrasement est muet. Renommer côté cœur, ou en faire un point " +
                        "d'extension déclaré, ou faire renommer l'aval — mais pas laisser.",
                });
            }
        }
        // Plancher de non-vacuité, même fonction que ceux de CC-00 et CC-03 : distinguer
        // « rien à vérifier par ce chemin » de « ce chemin ne vérifie plus rien ». Un
        // manifeste antérieur à la v1.7.0 n'a pas la clé, et CC-11 s'accorderait alors
        // parfaitement avec un ensemble vide.
        if (cm.entriesOf(d.installed_by_host, "installed_by_host").length === 0) {
            notes.push(
                `[CC-11] \`${m.consumer}\` ne déclare aucun \`installed_by_host\` — rien à ` +
                    "confronter à la surface du cœur. Ce n'est pas un vert de sa part."
            );
        }

        // ── CC-12 — le namespace `geoleaf:connector:*` est PARTAGÉ ───────────────────
        //
        // Depuis S4.7, six événements du plugin `connector` sont entrés dans le domaine de
        // nommage `geoleaf:`. Le consommateur aval maintient un plugin propriétaire qui en
        // émet six autres sous ce même préfixe. La non-collision a été vérifiée À LA MAIN
        // le 13/08/2026 et écrite dans `event-bus.contract.ts` — avec, dans la même phrase,
        // l'aveu que « rien, d'aucun côté, n'empêche une collision future ».
        //
        // Ce code est ce quelque chose. Il ne coûte rien : l'aval déclare déjà ses six noms
        // dans `out_of_scope.emitted_by_suite_connector`, et `literals` est l'oracle que
        // CC-07 utilise déjà. Une note écrite dans un contrat ne rougit pas ; ceci rougit.
        const emitsAval = d.out_of_scope?.emitted_by_suite_connector;
        if (!Array.isArray(emitsAval) || emitsAval.length === 0) {
            notes.push(
                `[CC-12] \`${m.consumer}\` ne déclare aucun émetteur propriétaire — le ` +
                    "namespace partagé n'a rien à confronter. Ce n'est pas un vert de sa part."
            );
        }
        if (Array.isArray(emitsAval)) {
            for (const name of emitsAval) {
                const sites = literals.get(name);
                if (sites) {
                    errors.push({
                        code: "CC-12",
                        msg:
                            `\`${name}\` est déclaré émis par le plugin propriétaire de ` +
                            `\`${m.consumer}\`, mais ce dépôt l'émet aussi — ` +
                            `${[...sites].join(", ")}. Deux émetteurs pour un nom sur le bus ` +
                            "DOM : les abonnés de l'un reçoivent les événements de l'autre, " +
                            "avec un `detail` d'une autre forme. Renommer ici.",
                    });
                }
            }
        }
    }

    // ── CC-09 ────────────────────────────────────────────────────────────────────────
    const tauto = checkAntiTautology();

    // Plancher du TROISIÈME oracle. Il a la même fonction que les deux planchers de CC-00 :
    // distinguer « rien à résoudre par ce chemin » de « ce chemin ne résout plus rien ».
    if (pluginResolved === 0) {
        notes.push(
            '[CC-03] aucune entrée `provider: "plugin:*"` dans les manifestes lus — le ' +
                "troisième oracle n'a rien eu à résoudre. Ce n'est pas un vert de sa part."
        );
    }

    // ── CC-06 — la portée, et pourquoi elle sort en 2 et non en 1 ────────────────────
    //
    // Un chemin hors de portée n'est PAS une régression : le code va peut-être très bien. Mais
    // il n'est pas vert non plus, parce que la gate ne l'a pas lu. Le rendre vert serait
    // exactement la classe qu'elle existe pour attraper — « 0 violation » sur un corpus
    // qu'on n'a pas ouvert. Exit 2 : refus de conclure, avec les chemins NOMMÉS.
    if (outOfScope.length > 0) {
        console.error(
            `${C.y}⚠${C.x}  [${TAG}/CC-06] ${outOfScope.length} chemin(s) HORS DE PORTÉE de la ` +
                "mesure — ni verts ni rouges, non lus :"
        );
        for (const o of outOfScope) console.error(`    ${o.path} — ${o.why}`);
    }

    for (const n of notes) console.log(`${C.d}   ${n}${C.x}`);
    if (notes.length > 0) console.log("");

    if (errors.length > 0) {
        const byCode = new Map();
        for (const e of errors) {
            if (!byCode.has(e.code)) byCode.set(e.code, []);
            byCode.get(e.code).push(e.msg);
        }
        for (const [code, msgs] of [...byCode].sort()) {
            console.error(`${C.r}✗${C.x} [${TAG}/${code}] ${msgs.length} :`);
            for (const msg of msgs) console.error(`    ${msg}`);
        }
        process.exit(1);
    }

    if (outOfScope.length > 0) {
        console.error(
            `${C.d}    CC-06 refuse de conclure plutôt que de rendre vert ce qu'il n'a pas lu.${C.x}`
        );
        process.exit(2);
    }

    console.log(
        `${C.g}✓${C.x}  ${checked} engagement(s) du contrat inverse vérifiés sur ` +
            `${read.manifests.length} manifeste(s) — dont ${pluginResolved} par le troisième ` +
            `oracle (façades de plugin) ; ${tauto.assertions} verrous anti-tautologie en ` +
            "place ; aucune régression."
    );
    process.exit(0);
}

/** Cherche un littéral dans les sources `.ts` d'un répertoire. Rend `true` au premier hit. */
function grepSources(dir, needle) {
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
            const p = path.join(cur, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "dist") continue;
                stack.push(p);
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".css")) {
                if (fs.readFileSync(p, "utf8").includes(needle)) return true;
            }
        }
    }
    return false;
}

main().catch((err) => {
    // Un plantage de la gate n'est PAS un vert, et pas non plus une régression du contrat.
    cm.refuse(`la gate a levé — ${err && err.stack ? err.stack : err}`, "CC-00");
});
