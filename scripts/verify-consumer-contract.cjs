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
 * ## Les dix codes
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
 *
 * Codes de sortie : **0** vert · **1** régression · **2** refus de conclure.
 *
 * ## Ce que cette gate ne vérifie PAS, et qui appartient au Sprint 7
 *
 * Le bloc `policy` du manifeste — *« aucune entrée de `public` ni de `events` ne peut être
 * retirée sans dépréciation annoncée »* — est **lu et IGNORÉ** par les dix codes ci-dessus.
 * Ils gardent la **PRÉSENCE** ; rien ne garde le **RETRAIT**, or c'est un retrait qui a produit
 * ce document, deux fois. Une politique déclarée sans vérificateur est ce que ce dépôt appelle
 * une déclaration de plus. Le gardien est **B-211 / Sprint 7** (`CC-10`), et il n'existe pas
 * encore. **Un gardien qui saute une clé doit dire qu'il la saute** — c'est écrit ici plutôt
 * que sous-entendu, et c'est la tâche 1.11.
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
const { readInterfaceMembers } = require("./lib/ts-decl-read.cjs");

const ROOT = registry.ROOT;
const TAG = cm.TAG;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "consumer-contract.json");
const UPDATE = process.argv.includes("--update-baseline");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", c: "\x1b[36m", x: "\x1b[0m" };

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

/**
 * Angles morts de la MESURE, nommés, motivés, et avec leur échéance de fermeture.
 *
 * ⚠️ **Sans cette carte, CC-06 sortirait en exit 2 À CHAQUE RUN, pour toujours** — et une gate
 * durablement au refus se fait désarmer en une semaine, ce qui est pire que pas de gate. Mais
 * l'inverse est pire encore : un angle mort tu se lit comme un vert. La sortie est celle que
 * `verify-host-contract-sync.cjs` a déjà écrite pour `ORACLE_EXEMPT` — *« an unexplained
 * exemption is indistinguishable from a name someone got tired of chasing »* : chaque entrée
 * porte son MOTIF et le sprint qui la ferme.
 *
 * 🛑 **Et une exemption qui a perdu sa cause est une ERREUR, pas un silence.** Si un nom
 * exempté devient mesurable — parce que `fireEvent` a cessé de composer le nom, par exemple —
 * l'entrée ci-dessous est fausse et CC-06 l'exige retirée. C'est l'invariant EM-02 appliqué à
 * l'exemption elle-même, et c'est ce qui distingue cette carte d'une liste de dérogations. Le
 * dépôt a déjà payé le mode inverse : `PARITY-04` existe parce qu'une exemption dont la cause
 * avait disparu était devenue silencieusement inutile.
 */
const SCOPE_EXEMPT = new Map([
    [
        "geoleaf:table:",
        "préfixe COMPOSÉ à l'exécution — `table-state.ts` fait `map.fire(\"geoleaf:\" + " +
            "eventName)`, donc aucun littéral complet n'existe en source et aucune mesure " +
            "statique ne peut conclure. Mesuré le 10/08/2026 : les deux noms concernés sont " +
            "bien ÉMIS (`table-api.ts:141`/`:152`) et ÉCOUTÉS en aval — c'est cette cécité, " +
            "et non une rupture, qui les avait fait classer `broken_since_v3` jusqu'à la " +
            "v1.4.0 du manifeste. FERMÉ PAR : Sprint 4 tâche 4.2 de " +
            "`roadmap_contrat-inverse-api-publique.md` (`fireEvent` prend le nom complet).",
    ],
]);

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
                "façade de plugin sans elle."
        , "CC-03");
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
                "n'ayant rien lu. C'est un instrument cassé, pas une façade vide."
        , "CC-03");
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
            "reconnues sont `core` et `plugin:<répertoire de paquet>`."
    , "CC-00");
    return null;
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
                "comparerait une liste écrite à la main avec elle-même."
        , "CC-09");
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
                "il ne confronte donc plus l'oracle que CETTE gate croit."
        , "CC-09");
    }
    // CC-09 ne « régresse » jamais en 1 : ou bien le verrou est là, ou bien la gate refuse de
    // conclure. Il n'y a pas d'état intermédiaire où l'on croirait à demi une liste manuelle.
    return { assertions: REQUIRED.reduce((a, [, min]) => a + min, 0) };
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const surf = await import(
        "file://" + path.join(ROOT, "scripts", "lib", "namespace-surface.mjs").split(path.sep).join("/")
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
                `(plancher ${FLOOR.keys}) — l'oracle s'est effondré.`
        , "CC-00");
    }
    if (memberTotal < FLOOR.members) {
        cm.refuse(
            `EXPECTED_FACADE_MEMBERS ne rend que ${memberTotal} membre(s) (plancher ` +
                `${FLOOR.members}) — la profondeur 2 est trop étroite pour que CC-01 conclue. ` +
                "Élargissez `DEPTH2_FACADES` (tâches 1.4/1.5) AVANT de compter sur cette gate."
        , "CC-00");
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

        if (UPDATE) {
            fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
            fs.writeFileSync(
                BASELINE,
                JSON.stringify(
                    {
                        _comment:
                            "Contrat inverse S1.8 — les TROIS listes NÉGATIVES du manifeste de " +
                            "consommation. Elles ne peuvent que RÉTRÉCIR (CC-04 entrant, CC-05 " +
                            "sortant). Ajouter une entrée à la main ici est le geste qui désarme " +
                            "la gate : une entrée n'en sort que quand le défaut qu'elle nomme est " +
                            "réparé. Régénérer AVEC --update-baseline, et jamais pour faire " +
                            "passer un rouge.",
                        _generated:
                            "GEOLEAF_CONSUMERS=<dir> node scripts/verify-consumer-contract.cjs --update-baseline",
                        _consumer: m.consumer,
                        _manifest_version: m.version,
                        lists: negatives,
                    },
                    null,
                    4
                ) + "\n"
            );
            console.log(
                `${C.g}✅${C.x} [${TAG}] baseline écrite — ` +
                    `${Object.values(negatives).reduce((a, b) => a + b.length, 0)} entrées négatives.`
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
        const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).lists ?? {};
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
            cm.refuse("0 clé extraite des maps d'événements — la gate est aveugle, pas verte.", "CC-07");
        }

        // La baseline d'EVENT-MAP, lue et non recopiée : c'est elle qui dit si une dette de
        // typage est DÉJÀ suivie par un cliquet (voir le partage de sévérité de CC-07).
        const emBaselinePath = path.join(ROOT, "scripts", ".baselines", "event-map-coverage.json");
        if (!fs.existsSync(emBaselinePath)) {
            cm.refuse(
                "la baseline EVENT-MAP est absente — CC-07 ne peut pas distinguer une dette " +
                    "déjà cliquetée d'une dette que personne ne suit, et rendrait donc l'une " +
                    "des deux en silence."
            , "CC-07");
        }
        const emBaseline = new Set(JSON.parse(fs.readFileSync(emBaselinePath, "utf8")).events);

        for (const e of cm.entriesOf(req.events, "required.events")) {
            checked++;
            const name = e.path;
            if (ev.isDynamic(name)) {
                // ⚠️ Portée MESURÉE, et c'est CC-06 qui la porte. Conclure « absent » ici
                // serait refaire l'erreur exacte que le manifeste a faite jusqu'à sa v1.4.0,
                // où ces deux noms étaient classés `broken` alors qu'ils sont émis ET écoutés.
                const exempt = [...SCOPE_EXEMPT.keys()].find((p) => name.startsWith(p));
                if (exempt) {
                    // ⚠️ L'exemption doit encore avoir sa CAUSE. Si un littéral complet est
                    // apparu en source, la composition dynamique a cessé et l'entrée est
                    // périmée : erreur jusqu'à retrait, jamais silence.
                    if (literals.has(name)) {
                        errors.push({
                            code: "CC-06",
                            msg:
                                `\`${name}\` est exempté de portée pour cause de préfixe ` +
                                `composé (\`${exempt}\`), mais il apparaît désormais en ` +
                                "LITTÉRAL complet dans les sources. L'exemption a perdu sa " +
                                "cause : retirez-la de `SCOPE_EXEMPT` et laissez CC-07 mesurer.",
                        });
                    } else {
                        notes.push(
                            `[CC-06] \`${name}\` HORS DE PORTÉE, exempté : ${SCOPE_EXEMPT.get(exempt)}`
                        );
                    }
                    continue;
                }
                outOfScope.push({
                    code: "CC-06",
                    path: name,
                    why:
                        "préfixe composé dynamiquement (`DYNAMIC_PREFIXES`) — aucun littéral " +
                        "complet en source, la mesure ne peut pas conclure, et AUCUNE " +
                        "exemption motivée ne le couvre",
                });
                continue;
            }
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
                        "ni l'un ni l'autre, et CC-08 ne peut pas s'exécuter."
                , "CC-08");
            }
            if (!entry || typeof entry !== "object" || typeof entry.owner !== "string") {
                cm.refuse(`entrée \`dom_contract\` sans clé \`owner\` : ${JSON.stringify(entry)}`, "CC-08");
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
    }

    // ── CC-09 ────────────────────────────────────────────────────────────────────────
    const tauto = checkAntiTautology();

    // Plancher du TROISIÈME oracle. Il a la même fonction que les deux planchers de CC-00 :
    // distinguer « rien à résoudre par ce chemin » de « ce chemin ne résout plus rien ».
    if (pluginResolved === 0) {
        notes.push(
            "[CC-03] aucune entrée `provider: \"plugin:*\"` dans les manifestes lus — le " +
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
