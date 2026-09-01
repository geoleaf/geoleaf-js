#!/usr/bin/env node
/*!
 * GeoLeaf — CONSUMER-CONTRACT: the INVERSE contract.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The defect this gate exists to catch
 *
 * The repo's other gates hold that **what we declare exists**. This one
 * holds the inverse: **what someone depends on has not vanished**. Nine
 * keys left the `GeoLeaf` namespace because no monorepo reader read them —
 * the reader was **outside**, and no green from here could see it. A
 * removal must turn red.
 *
 * The gesture is not new: `verify-host-contract-sync.cjs` already does this
 * inclusion check, by AST reading and **without booting** — *"this gate
 * inherits a measurement instead of taking one, and stays a sub-second
 * static check"*. The inverse contract is **one more list, not a
 * mechanism**; writing it otherwise would be the fifth competing
 * description of the same surface, which `lib/namespace-surface.mjs`'s
 * header documents as having already cost eleven days of invisible drift.
 *
 * ## Three resolvers, because one alone would be green on what it did not read
 *
 *   • `provider: "core"`        → l'oracle post-boot (`EXPECTED_FACADE_KEYS` en profondeur 1,
 *                                 `EXPECTED_FACADE_MEMBERS` at depth 2)
 *   • `provider: "plugin:<pkg>"` → the object returned by the package's `buildPublicApi()`, read at the AST;
 *                                 the package is resolved by `requireByDirName`, which **throws**
 *   • `dom_contract`             → a selector literal in the core's sources
 *
 * ⚠️ **The third resolver is not a comfort, it is the only route** for `Ws`
 * and `Measure.*`: `namespace-surface.contract.test.js` requires
 * `DEPTH2_FACADES ⊆ EXPECTED_FACADE_KEYS`, yet those two are mounted by
 * plugins and the core's oracle is measured after a `startApp()` without
 * them. They can **never** enter the core's oracle. A gate written on a
 * single oracle would exit **green on a third of the contract without
 * having read it** — the exact failure mode this repo has already paid.
 *
 * ## The thirteen codes
 *
 *   CC-00  non-vacuity floor, the SKIP outcome, and what the gate really read
 *   CC-01  every `required.public` with provider `core` resolves
 *   CC-02  every `private_tolerated` resolves — distinct message, structural limits NAMED
 *   CC-03  every `provider: "plugin:<pkg>"` resolves in `buildPublicApi()`
 *   CC-04  INBOUND ratchet — a negative list does not widen unilaterally
 *   CC-05  OUTBOUND ratchet — a `broken` entry become false is an error until removed
 *   CC-06  MEASURED scope — an out-of-scope path exits 2, never green
 *   CC-07  every `required.events` is typed, emitted as a literal, and on the DOM bus
 *   CC-08  `dom_contract` — `library` has its literal in source, `host` is a host obligation
 *   CC-09  anti-tautology — the oracle read here is still confronted with a real boot
 *   CC-10  DEPRECATION ratchet — an entry only leaves `required.public` / `required.events`
 *          under an announcement, and a `@deprecated` tag does not live undated
 *   CC-11  `installed_by_host` — what the host WRITES does NOT resolve here (CC-01's symmetric)
 *   CC-12  `geoleaf:connector:*` is shared — no name emitted on both sides
 *   CC-13  `requested_events` is READ — a NOTE per entry, never a red
 *
 * Exit codes: **0** green · **1** regression · **2** refusal to conclude.
 *
 * ## What CC-10 does NOT verify of the policy, and it must be known
 *
 * The manifest's `policy` block — *"no `public` or `events` entry can be
 * removed without an announced deprecation"* — was **read and IGNORED** for
 * a long time: the codes guarded PRESENCE, nothing guarded REMOVAL, yet a
 * removal is what produced this document, twice. CC-10 closes that hole.
 * But it does not close its whole width, and **a guardian that skips a key
 * must say it skips it**:
 *
 *   • **The CHANGELOG entry** is not confronted. The announcement form of
 *     `VERSIONING_POLICY.md`'s §Deprecation has THREE members; CC-10 holds
 *     two — the tag in source (through `symbol`) and the dating
 *     (`since` / `removeIn`). The third is mechanisable — searching the
 *     path under the version title in `packages/core/docs/CHANGELOG.md` —
 *     and it is a CONDITIONED refusal, whose reopening condition is the
 *     first announcement whose `since` designates a published version.
 *   • **"surviving at least one published `minor`"** requires knowing the
 *     PUBLISHED versions, which this repo reads nowhere. `removeIn` = next
 *     MAJOR is that duration's verifiable half, and it is the one held.
 *   • **`deprecated_since` in the manifest** is a DOWNSTREAM
 *     acknowledgement. Requiring it would turn the gate red for a gesture
 *     upstream cannot make.
 *
 * Usage: GEOLEAF_CONSUMERS=<directory> node scripts/verify-consumer-contract.cjs
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
 * CC-10's oracle — the deprecations UPSTREAM announces.
 *
 * PUBLIC because it names **symbols** and not a client: downstream declares
 * what it depends on in its `*.consumer.json`, upstream declares what it
 * allows itself to remove here, and the two files are not written by the
 * same hand.
 *
 * ⚠️ Derived by `docsPaths.reference()` and **never hardcoded** — a copied
 * path silently stops matching at the first documentation-root move, and
 * the gate would then refuse to conclude for a motive unrelated to its subject.
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
 * CC-00's floors, deliberately well below the day's values (92 / 258).
 *
 * ⚠️ **`members: 150` was the sprint's most costly dependency, and it was
 * written nowhere.» `EXPECTED_FACADE_MEMBERS` was **83** before the oracle
 * widening: writing this gate before widening the oracle would have
 * produced a gate that **refuses to conclude at its first launch**, which
 * in practice settles into lowering the floor — hence a gate that guards
 * nothing any more. The floor re-measures:
 *
 *     git show <ref>:scripts/lib/namespace-surface.mjs   → the oracle at that date
 *
 * They catch a COLLAPSED instrument, not a legitimately shrinking surface —
 * same partition as `verify-host-contract-sync.cjs`'s `FLOOR`, and same motive.
 */
const FLOOR = { keys: 50, members: 150 };

// ⚠️ `SCOPE_EXEMPT` was REMOVED on 13/08/2026, and the removal is the
// event, not the disappearance.
//
// The map carried a single entry, `geoleaf:table:`, with its motive and the
// deadline closing it: *"CLOSED BY: the `fireEvent` refactor (full name)"*.
// The refactor happened, the 9 names now exist as full literals
// (`table-state.ts`, type `TableEventName`), and its own header required
// this: *"an exemption that lost its cause is an ERROR, not a silence"*.
// CC-06 effectively required it removed — seen red on
// `geoleaf:table:opened` and `:closed` before that removal, which is the
// proof the device worked in both directions.
//
// 🛑 **What is NOT covered after this removal, to know before writing an
// emitter**: `DYNAMIC_PREFIXES` leaving with it (`lib/event-names.cjs`),
// nothing distinguishes "name composed at runtime" from "name absent from
// the sources" any more. A future `dispatchEvent("geoleaf:" + x)` would
// thus make CC-07 conclude "not emitted" — a FALSE red, exactly the error
// the downstream manifest made until its v1.4.0. The repo carries none
// today, and laying machinery for a case that does not exist would be
// speculative. Tracked as a CONDITIONED refusal in the backlog, with its
// reopening condition: the first concatenation that returns. It measures,
// it is not assumed —
//
//   grep -rnE '"geoleaf:"\s*\+|`geoleaf:\$\{' packages/*/src packages/plugins/*/src \
//     packages/libs/*/src | grep -v __tests__
//
// today returns the ONLY line of `table-state.ts`'s TSDoc that tells that past.

// ─── Resolvers ───────────────────────────────────────────────────────────────────────
//
// ⚠️ The oracle is loaded by dynamic `import()` in `main()`:
// `namespace-surface.mjs` is ESM, this gate is CJS, and `require()` of an
// `.mjs` throws. Also the reason `main()` is `async` — not a style choice.

/** Resolution verdicts. `OUT_OF_SCOPE` is NEVER a green: it feeds CC-06. */
const OK = "OK";
const ABSENT = "ABSENT";
const OUT_OF_SCOPE = "OUT_OF_SCOPE";

/**
 * Resolves a path against the core's post-boot oracle.
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
 * Reads the keys of the object returned by a package's `buildPublicApi()`, at the AST.
 *
 * ⚠️ **Four shapes, not one.» A TypeScript object literal carries
 * `PropertyAssignment` (`foo: () => …`), `ShorthandPropertyAssignment`
 * (`foo,` — `measure`'s shape), `MethodDeclaration` (`foo() {}`) and
 * `GetAccessorDeclaration` (`get state() {}` — `websocket`'s shape).
 * Reading only the first would make the gate green on three plugins it had
 * not read, and the repo carries at least one of each.
 */
const pluginApiCache = new Map();
function pluginApiMembers(pkgDirName) {
    if (pluginApiCache.has(pkgDirName)) return pluginApiCache.get(pkgDirName);

    // `requireByDirName` THROWS if the package is unreachable — a hardcoded
    // path would silently stop matching and the gate would exit green
    // having scanned nothing. That is what made the manifest's v1.3.0 exit
    // 2 on `plugin:storage`, which does not exist.
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

/** Resolves a path against a plugin's facade. `provider: "plugin:<dirName>"`. */
function resolvePlugin(p, provider) {
    const pkgDirName = provider.slice("plugin:".length);
    const members = pluginApiMembers(pkgDirName);
    const parts = p.split(".");
    if (parts.length === 1) {
        // The namespace itself: it exists as soon as the package has a non-empty facade.
        return { verdict: OK, why: `\`${pkgDirName}\` expose ${members.length} membres` };
    }
    if (parts.length > 2) {
        return { verdict: OUT_OF_SCOPE, why: "profondeur > 2 sur une façade de plugin" };
    }
    return members.includes(parts[1])
        ? { verdict: OK, why: `membre de buildPublicApi() de \`${pkgDirName}\`` }
        : { verdict: ABSENT, why: `absent de buildPublicApi() de \`${pkgDirName}\`` };
}

/** Resolution switch: core or plugin, depending on the `provider`. */
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

// ─── CC-10: deprecation, and what makes it verifiable ────────────────────────────────

/** An announcement's FOUR fields. All load-bearing: a three-field announcement announces nothing. */
const CHAMPS_ANNONCE = ["since", "removeIn", "replacement", "symbol"];

/**
 * The `@deprecated` PRIOR to the policy, exempted BY NAME.
 *
 * ⚠️ **A named exemption is auditable, an implicit exemption is a hole.»
 * These tags lived in published source before `VERSIONING_POLICY.md`'s
 * §Deprecation existed: demanding a register entry from them would turn the
 * gate red **at its laying**, and a gate red at first launch settles in
 * practice into widening its exemption list, never into repairing the defect.
 *
 * 🛑 **The key is `file#Owner.member`, NOT `file:line`, and it is measured:**
 *   ① Lines drift. The plan that commissioned this code cited
 *      `retry-handler.ts` and `:44`; the file carried `:34` and `:51`,
 *      and the AST returns `:38` and `:52` — three pairs of numbers for two facts.
 *   ② `retry-handler.ts` carries **two** `maxRetries` members, in
 *      `RetryConfig` and in `RetryOptions`. A `file#member` key would
 *      exempt two in one gesture.
 *
 * ⚠️ **The list DERIVES from the scan, it is not copied from a document.»
 * As of 14/08/2026, `annoncesEnSource()` returns **one** tag over 862
 * shipped files: the three `maxRetries` aliases were reclassified — they
 * are KEPT aliases, nothing schedules their removal, and their tag promised
 * a disappearance that will not happen.
 *
 * CLOSED BY: removing these keys, or their entry into `DEPRECATIONS.json`.
 */
const ANNONCES_GRAND_PERAGE = new Map([
    [
        "packages/plugins/table/src/types.ts#TableConfig.pageSize",
        "Clé SANS EFFET (le panneau défile en virtuel), marquée plutôt que retirée pour " +
            "ne pas casser la compilation d'un intégrateur qui l'a écrite. Elle n'a pas sa place " +
            "au registre : une option sans effet n'a aucun `replacement`, donc ce n'est pas une " +
            "dépréciation au sens de la politique mais un défaut à réparer ou un champ à retirer",
    ],
]);

/**
 * Enumerates the SHIPPED sources' `@deprecated` → `file#Owner.member`.
 *
 * Same corpus as CC-07 (`ev.shippedSources()`), deliberately: "shipped
 * source" must mean **one** thing in this gate. Read at the AST and not by
 * grep — a `@deprecated` written in a docblock's prose is not a tag, and
 * these sources are dense in prose that talks about deprecation.
 *
 * ⚠️ The owner stack also descends into **type literals** (`Config?: { … }`),
 * otherwise two facades carrying the same member name would overwrite each
 * other in the Map and one exemption would cover two.
 *
 * @returns {Map<string, {rel: string, lignes: number[]}>} qualified key → where it lives.
 */
function annoncesEnSource() {
    const found = new Map();
    for (const file of ev.shippedSources()) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("@deprecated")) continue; // same pre-filter as collectEventLiterals
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
    // A key designating TWO declarations is a lying key: one's exemption
    // would cover the other, and an announcement's `symbol` citation would
    // be satisfied by a symbol nobody meant to deprecate. Ambiguous =
    // refused, never guessed.
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
 * ⚠️ **An EMPTY `deprecations` object is NOT a refusal**, and the nuance
 * deserves writing because this repo everywhere sets the inverse rule ("no
 * function returns an empty result by default"). It does not apply here:
 * CC-10's comparison is baseline ↔ manifest, never announcements ↔
 * something. An empty register does not make CC-10 hollow — it makes it
 * **maximally strict**: no removal is authorised. That is the day's state,
 * and it is a correct state.
 *
 * @returns {Record<string, object>} the announcements, indexed by consumed-surface path.
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
 * Judges ONE announcement. Returns an array of errors — empty if the announcement holds.
 *
 * The four fields are load-bearing, and each closes a different door:
 *   • `since`       — without it, the announcement has no age and its duration is undecidable
 *   • `removeIn`    — without it, "deprecated" means "removed whenever it suits me"
 *   • `replacement` — one does not deprecate towards nothing
 *   • `symbol`      — without it, the register would be a SECOND place to
 *                     write "this is deprecated", hence one more competing
 *                     description: the failure mode this repo pays dearest
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

    // `removeIn` — a MAJOR strictly above the current one. An announcement
    // dated in the PRESENT is not an announcement: it is a removal warned
    // about after the fact.
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
    // `since` — in the current major line, and never at or after the removal.
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

    // `replacement` — THREE recognised shapes, a fourth REFUSED rather than guessed.
    const r = String(a.replacement);
    let ou = null;
    if (r.startsWith("plugin:")) {
        const i = r.indexOf("/");
        if (i > 0 && resolvePlugin(r.slice(i + 1), r.slice(0, i)).verdict === OK) {
            ou = `façade de \`${r.slice(0, i)}\``;
        }
    } else if (ev.EVENT_LITERAL_RE.test(r)) {
        // An EMITTED but UNTYPED event is not a replacement: downstream
        // would have to cast it by hand. Deprecating towards that moves the
        // debt instead of settling it.
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

    // `symbol` — and here is where the announcement stops being a mere declaration.
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
 * The OUTBOUND direction — an entry left a POSITIVE list. Written once,
 * called TWICE: by the verification body, and by `--update-baseline` (see its block).
 *
 * @returns {{erreurs: object[], notes: string[]}}
 */
function sortiesInjustifiees({ connues, aujourdhui, d, annonces, ctx, liste }) {
    const erreurs = [];
    const notes = [];
    const vivants = new Set(aujourdhui.map((e) => e.path));

    // The THREE ways downstream writes "I no longer depend on it". All
    // three leave a trace IN the file whose sha256 this gate prints;
    // erasing the line leaves none, and that is exactly the difference this
    // code measures.
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
 * The INVERSE direction — a tag NOTHING dates.
 *
 * Same policy seen from the other end, hence **same code**: adding another
 * code would put two ratchets on one object, and two ratchets on an object diverge.
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

    // 🛑 An exemption that lost its cause is an ERROR, not a silence — same
    // device and same severity as the old `SCOPE_EXEMPT`, whose removal
    // CC-06 required the day its cause fell.
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
 * The anti-tautology lock, and why it is TRIPLE.
 *
 * `EXPECTED_FACADE_MEMBERS` is a **hand-written** array. The gesture that
 * makes CC-01 green without repairing anything is: *add the line by hand*.
 * What forbids it is not this gate — it is the golden master, which
 * confronts the list with a real `startApp()`. **The gate is thus only
 * entitled to believe this list as long as that confrontation exists.**
 *
 * Wording taken directly from `verify-deploy-server-contract.cjs`: *"SC-02
 * rereads the disk, it does not compare the generator to itself. Verifying
 * that `serverContractFiles()` contains what `serverContractFiles()`
 * contains would be a tautology."*
 *
 * ⚠️ **The three assertions, and why none suffices:**
 *   • `d.missing` — a member that VANISHES from the runtime while in the list
 *   • `d.extra`   — a member that APPEARS without being in the list
 *   • `membersAgain === members` — stability between two reads 30 ms apart
 *
 * Removing the third alone would make the list **stampable** without the
 * first two moving: an intermittent surface would suffice for anyone to
 * "stabilise" by adding lines. That is why CC-09 reads all three.
 *
 * ⚠️ **And it reads them at the AST, not by grep.» A `grep 'd.missing'` is
 * bypassed by renaming `d` to `diff` — the file would stay correct, the
 * gate would go blind. The read thus bears on the PROPERTY NAME accessed in
 * `expect(…)`'s first argument, whatever the name of the variable carrying it.
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

    /** Property names passed as 1st argument of an `expect(...)`, COUNTED. */
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

    // 🛑 **The MULTIPLICITIES are load-bearing, and a mutation established it.**
    //
    // CC-09's first version required the mere PRESENCE of the three names.
    // Mutation played on 10/08/2026: rename `expect(d.extra, …)` in the
    // loop over `DEPTH2_FACADES` — hence disarm the "a member APPEARS"
    // check at depth 2, the one this gate believes. **CC-09 stayed GREEN**,
    // because the second `expect(d.extra, …)`, depth 1's (the keys),
    // sufficed to satisfy the presence.
    //
    // In other words: the lock covered the keys and believed it covered the
    // members. Exactly the mode this repo calls "a guard never seen red
    // guards nothing" — except here the guard EXISTED, and only mutating it
    // showed it hollow.
    //
    // Hence thresholds, not booleans: **2** for `missing` and `extra` (one
    // per depth), **1** for `membersAgain`. They re-measure by reading the
    // file, and the message says the count found — not merely that
    // something is missing.
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

    // The golden master must ALSO read the same source as us — otherwise it confronts something else.
    if (!/namespace-surface\.mjs/.test(text) || !/DEPTH2_FACADES/.test(text)) {
        cm.refuse(
            "le golden master ne lit plus `lib/namespace-surface.mjs` / `DEPTH2_FACADES` — " +
                "il ne confronte donc plus l'oracle que CETTE gate croit.",
            "CC-09"
        );
    }
    // CC-09 never "regresses" to 1: either the lock is there, or the gate
    // refuses to conclude. There is no intermediate state where a manual
    // list would be half believed.
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
        // Outcome ②: exit 0, named motive, path printed. What keeps this
        // SKIP from swallowing everything is `probe-gate-visibility.cjs`,
        // which plants a FIXTURE manifest and requires seeing this gate turn
        // red on it. It does not prove the real manifest is read — it proves
        // the gate STILL BITES.
        process.exit(0);
    }

    // ── CC-00 — non-vacuity floors ───────────────────────────────────────────────────
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

    // ── The REPO's oracles — built once, outside the loop over the manifests ──
    //
    // They describe our sources, not a consumer: recomputing them per
    // manifest changed no verdict and cost a full AST walk per entry read.
    // The hoist is above all what makes CC-10 possible on the
    // `--update-baseline` side: the writer exits before the verification
    // body, and it must render the SAME judgement as it (§CC-10).
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

    // The EVENT-MAP baseline, read and not copied: it is what says whether
    // a typing debt is ALREADY tracked by a ratchet (see CC-07's severity split).
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

        // ── CC-00 (continued) — an entry present in TWO lists ────────────────────────
        //
        // An observation recorded by the opening check and not settled by
        // it: `GeoJSON.addData` appears in `not_required` AND in
        // `broken_since_v3`. Both statements are true separately, but a
        // reader must say which one it applies — otherwise CC-05 "chooses"
        // silently. **Written precedence: `broken_since_v3` wins**, because
        // it is the RATCHETED list (CC-05), hence the one whose oversight
        // costs; `not_required` is arbitration documentation, which nothing verifies.
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
        // Message DISTINCT from CC-01's, and it is not cosmetic: *"its
        // disappearance is not a bug, it is a sequence break"*. These paths
        // are `_`-prefixed: downstream KNOWS it leans on internals, and the
        // sequence written in the manifest says they will leave when a
        // public equivalent exists. Confusing them with the public contract
        // would treat a planned debt as a regression.
        for (const e of cm.entriesOf(req.private_tolerated, "required.private_tolerated")) {
            checked++;
            const r = resolve(e, surf);
            if (r.verdict === ABSENT) {
                errors.push({
                    code: "CC-02",
                    msg:
                        `\`${e.path}\` ne résout plus — ${r.why}. Sa disparition n'est pas un ` +
                        "bug, c'est une RUPTURE DE SÉQUENCE : cf. le bloc `sequence` " +
                        "du manifeste.",
                });
            } else if (r.verdict === OUT_OF_SCOPE) {
                // ⚠️ **Named, not silenced.» 2 entries out of 6 are
                // structurally invisible, and silencing them would green
                // what the gate did not read. `_app` is excluded from
                // `DEPTH2_FACADES` on purpose (motive written in
                // `namespace-surface.mjs`), and a `_`-prefixed member is
                // filtered by `walkNamespace` by construction. Not a gap to
                // fill: a limit to declare.
                notes.push(
                    `[CC-02] \`${e.path}\` est STRUCTURELLEMENT INVÉRIFIABLE en profondeur 2 — ` +
                        `${r.why}. Cette entrée n'est ni verte ni rouge : elle n'est pas lue.`
                );
            }
        }

        // ── CC-03 — plugin facades ───────────────────────────────────────────────────
        //
        // Already executed by `resolve()` above. What is COUNTED here is
        // what the third oracle really read, and it is printed: without
        // that count, a manifest losing its `plugin:*` entries would let
        // the gate announce a "three oracles" green while the third had
        // opened nothing. An oracle that no longer serves must be seen.
        pluginResolved += cm
            .entriesOf(req.public, "required.public")
            .filter((e) => String(e.provider).startsWith("plugin:")).length;

        // ── CC-04 — cliquet ENTRANT ──────────────────────────────────────────────────
        //
        // ⚠️ `ratchetKey`, and NOT `e.path`, since 26/08/2026. These three lists are written
        // into the baseline, and `public-partition.cjs` classes `scripts/.baselines/` as
        // NON-internal: whatever lands there is published. `requested` is FREE PROSE authored
        // downstream, and copying it verbatim carried a business backend's name into the
        // published corpus — which this repo's golden rule forbids anywhere.
        //
        // The fix cannot be "strip the offending word": that closes the instance, and the next
        // import brings the next word. What closes the CLASS is to stop copying sentences we
        // did not write. A short entry with no whitespace stays verbatim — it is an API path,
        // and a reader must see it.
        //
        // 🛑 BOTH sides of the ratchet go through this one function: the write below, and the
        // CC-04 comparison. Never let them drift apart — the baseline would then read "new
        // entry" on every long entry, on every run.
        const negatives = {
            private_tolerated: cm
                .entriesOf(req.private_tolerated, "private_tolerated")
                .map((e) => cm.ratchetKey(e.path))
                .sort(),
            requested: cm
                .entriesOf(d.requested, "requested")
                .map((e) => cm.ratchetKey(e.path))
                .sort(),
            broken_since_v3: cm
                .entriesOf(d.broken_since_v3, "broken_since_v3")
                .map((e) => cm.ratchetKey(e.path))
                .sort(),
        };

        // ── CC-10 (prerequisite) — the POSITIVE lists ────────────────────────────────
        //
        // ⚠️ **They were tracked by NOTHING, and that is where the hole
        // was.» The original baseline only carried the three negative
        // lists; `required.public` and `required.events` — i.e. THE
        // CONTRACT — had no memory, while they are written by DOWNSTREAM,
        // reread fresh at every run, and never confronted with yesterday.
        //
        // The `provider` enters the baseline but **NOT the ratchet's key**:
        // the ratchet compares paths, and a provider change is not a
        // removal. It enters because the `GATE-PROBE` probe rebuilds a
        // manifest from this list — defaulting `Ws` and `Measure.*` to
        // `core` would turn them red in CC-01, hence turn the probe red for
        // a motive not its own.
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
            // 🛑 **Regeneration is SUBJECT to the ratchet; it does not bypass it.**
            //
            // The `_comment` warns that "adding an entry by hand here is
            // the gesture that disarms the gate" — in PROSE, and it is true
            // of the NEGATIVE lists. On the POSITIVE ones, the disarming
            // gesture is not editing the file: it is REGENERATING it after
            // a removal, which turns a disappearance into a fait accompli,
            // with a documented command and the air of cleanliness.
            //
            // Prose can do nothing against that. This repo measured that "a
            // prose warning stopped neither the first nor the second"
            // number collision, and its written lesson is to prefer a guard
            // that COUNTS to one more paragraph.
            //
            // Consequence, and it is exactly what a deprecation policy is:
            // **the announcement precedes the removal, mechanically.» To
            // record an exit, one must first write the announcement
            // (upstream) or the downgrade (downstream).
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
            const connuesP = (ancienne.positives ?? {})[cm.consumerKey(m.consumer)];
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
                            "Contrat inverse — les TROIS listes NÉGATIVES (`lists`, " +
                            "cliquets CC-04 entrant / CC-05 sortant : elles ne peuvent que " +
                            "RÉTRÉCIR) et les DEUX listes POSITIVES (`positives`, " +
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
                        _consumer: cm.consumerKey(m.consumer),
                        _manifest_version: m.version,
                        _manifest_sha: m.sha,
                        lists: negatives,
                        positives: {
                            // ⚠️ Only DIGEST keys survive the merge (26/08/2026).
                            //
                            // The spread exists to preserve OTHER consumers' positive lists,
                            // and it did its job too well at the migration: the previous
                            // baseline keyed this map by the consumer's NAME, so the spread
                            // carried that name back in as a stale alias of the very entry
                            // being rewritten — the whole point of the change, undone by one
                            // line, and silently.
                            //
                            // The filter is safe by construction rather than by care: every
                            // key now IS `consumer-<hex>`, so a key that fails this
                            // shape can only be a pre-migration residue. It can never drop a
                            // legitimate consumer. Drop the filter and the name comes back on
                            // the next regeneration.
                            ...Object.fromEntries(
                                Object.entries(ancienne.positives ?? {}).filter(([k]) =>
                                    /^consumer-[0-9a-f]{12}$/.test(k)
                                )
                            ),
                            [cm.consumerKey(m.consumer)]: positives,
                        },
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
        // A `broken` entry that RESOLVES again is not silent good news: it
        // is a false entry, and a negative list containing falsehood gets
        // ignored wholesale. It stays an error UNTIL ITS REMOVAL (or
        // reclassification) — same invariant as EM-02 and MH-02, and the
        // wording is theirs on purpose.
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

        // ── CC-07 — the events ───────────────────────────────────────────────────────
        //
        // Three properties, and an event must have them all: TYPED in one
        // of the contract's two maps, EMITTED as a literal in a shipped
        // source, and on the DOM BUS. The third is the one people forget:
        // `Events.on` delegates to `addEventListener`, so a name that only
        // transits the MapLibre bus is a promise the facade cannot keep —
        // the case of `geoleaf:filters:changed`, which the upstream CDC
        // recommended downstream migrate to... a name nothing emits on that bus.
        //
        // ⚠️ The three oracles CC-07 consumes (`literals`, `typedNames`,
        // `emBaseline`) are built BEFORE this loop: they are properties of
        // the REPO, not the manifest, and the `--update-baseline` writer
        // needs them while it exits before reaching here. Recomputing them
        // per manifest brought nothing.

        for (const e of cm.entriesOf(req.events, "required.events")) {
            checked++;
            const name = e.path;
            // ⚠️ The "composed prefix" branch lived HERE, and it is removed
            // with `SCOPE_EXEMPT` and `DYNAMIC_PREFIXES`. It existed for a
            // single producer — the `table` plugin's `fireEvent` — which
            // now takes the full name. Keeping it empty would have produced
            // an always-false test: a branch nothing can take any more is
            // indistinguishable from a branch guarding nothing. The
            // removal's motive, and what it uncovers, are at the
            // `SCOPE_EXEMPT` block above.
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
                // 🛑 **CC-07's three properties do NOT have the same
                // severity, and the split is measured rather than chosen.»
                // "Not emitted" and "wrong bus" are breaks: downstream
                // waits for an event that will not come. "Untyped" is a
                // DEBT — the event arrives, downstream listens through a
                // hand cast.
                //
                // Yet that debt is **already ratcheted**, by EM-02, whose
                // baseline can only shrink. Re-carrying it here as red
                // would put a SECOND ratchet on the same object, and two
                // ratchets on an object diverge — the rule
                // `lib/ts-decl-read.cjs` states for readers and which holds
                // for registers. Worse: `ci:local` would stay permanently
                // red for a debt whose treatment is ⏸ until 3.1.0. A
                // durably red gate gets disarmed.
                //
                // ⚠️ What CC-07 adds that EM-02 cannot say: **WHO depends
                // on it**. The EVENT-MAP baseline is a list of names; this
                // one names the consumer.
                const suivi = emBaseline.has(name);
                if (suivi) {
                    notes.push(
                        `[CC-07] \`${name}\` est ÉMIS mais NON TYPÉ — dette déjà sous cliquet ` +
                            "EM-02 (`scripts/.baselines/event-map-coverage.json`, décroissante), " +
                            "traitement différé à la 3.1.0. Ce que cette ligne ajoute à EM-02 : un consommateur " +
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

        // ── CC-08 — the DOM contract ─────────────────────────────────────────────────
        //
        // Two owners, two DIFFERENT verifications, and confusing them would
        // green what was not read:
        //   • `owner: "library"` → WE set the node: a literal must exist in
        //     the core's sources, at the `literal` citation.
        //   • `owner: "host"`    → the HOST sets it (in its own template,
        //     the demo app in its `index.html`). There is nothing to search
        //     in our sources; what is verifiable is that the `readBy`
        //     citation exists, and it is downstream, hence not measurable
        //     here. The entry is then a declared OBLIGATION, not an assertion.
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
            // The selector carries `#` or `[data-…]`; the literal in source
            // is the id or the attribute, without the `#`. The BARE form is
            // searched, which is what is written.
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

        // ── CC-10 — DEPRECATION ratchet ──────────────────────────────────────────────
        //
        // **What this code catches, and CC-01 cannot see.» CC-01 states:
        // every `required.public` resolves. Its corpus IS the manifest —
        // written by downstream, reread fresh at every run, never
        // confronted with yesterday. Its strength is thus a function of the
        // size of a corpus nobody here controls:
        //
        //   ① I want to remove `X.y`        → CC-01 is RED (the manifest requires it)
        //   ② the entry leaves the manifest → gate GREEN, "66 commitments" instead of 67
        //   ③ I remove the symbol           → gate GREEN. Downstream breaks at vendoring.
        //
        // **Leaving the list IS CC-01's disarming**, and gesture ② is
        // structurally invisible from here: the manifest is not committed
        // in this repo, and the commitment counter goes down LEGITIMATELY
        // in both directions — it cannot serve as an alarm. CC-10 is the
        // missing memory, and it lives on OUR side, in a committed,
        // reviewed file: which is what makes it unassailable from the other repo.
        //
        // ⚠️ **And the attack needs no attacker.» Downstream periodically
        // rewrites its manifest, removes what it believes it no longer
        // consumes, and upstream reads that removal as permission.
        //
        // **The LEGITIMATE gesture exists, and it is named in the error
        // message**: downstream DOWNGRADES to `not_required` / `withdrawn` /
        // `broken_since_v3` instead of erasing the line. `not_required` is
        // an exit it can open alone — wanted, it is ITS contract it
        // abandons. **CC-10 does not remove the exit: it removes the MUTE exit.**
        //
        // Symmetry to remember: **CC-04 forbids a NEGATIVE list growing
        // unilaterally; CC-10 forbids a POSITIVE list shrinking
        // unilaterally.» Each party can only move the manifest in the
        // direction that costs it.
        //
        // 📌 Out of scope, and not an oversight: `installed_by_host` is not
        // under this ratchet. The manifest's `policy` clause only names
        // `public` and `events`.
        {
            const annonces = lireAnnonces();
            const ctx = { surf, literals, typedNames, tags: annoncesEnSource() };
            const connuesP = (baseline.positives ?? {})[cm.consumerKey(m.consumer)];

            if (!connuesP) {
                // Non-vacuity floor, same function as CC-00's, CC-03's and
                // CC-11's: distinguish "nothing to ratchet through this
                // path" from "this path ratchets nothing any more". A new
                // consumer has no yesterday; saying it beats silencing it.
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

                // ARRIVALS are not ratcheted — a positive list growing is
                // common sense (`Core.isAttached` and `Core.reattach`
                // entered from `requested`), and CC-01 already verifies
                // them. An inbound ratchet would turn the gate red at every
                // promotion, hence durably red, hence disarmed — the
                // argument is already written at the CC-07 block. But an
                // arrival not RECORDED is not yet PROTECTED: it would leave
                // again tomorrow without a word.
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

                // The baseline describes a file older than the one just
                // read. Not a regression — the only available signal that a
                // part of the contract is not yet memorised, and it was
                // missing. ⚠️ NOTE and not red: a red on divergence would
                // turn the gate red at every legitimate downstream edit,
                // hence permanently red, hence disarmed.
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

        // ── CC-11 — `installed_by_host`: what the host WRITES must stay free ──────
        //
        // CC-01's exact symmetric, and the code's reason for being. CC-01
        // verifies a path READ by downstream really exists here. This one
        // verifies a path WRITTEN by downstream does NOT exist here —
        // because two writers on one namespace key means the last one wins,
        // silently, one boot order away. The symptom reads at the
        // consumer's, months later, and never as an error.
        //
        // ⚠️ **This key was first refused by CC-00, and the refusal's
        // motive already said what to do**: "a key this reader does not
        // know is a key no CC code verifies". Declaring it in
        // `KNOWN_TOP_LEVEL` without giving it a code would have satisfied
        // that refusal's letter while missing its reason — the gate would
        // have gone green again on a part of the contract it still does not read.
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
        // Non-vacuity floor, same function as CC-00's and CC-03's:
        // distinguish "nothing to verify through this path" from "this path
        // verifies nothing any more". A manifest older than v1.7.0 lacks
        // the key, and CC-11 would then agree perfectly with an empty set.
        if (cm.entriesOf(d.installed_by_host, "installed_by_host").length === 0) {
            notes.push(
                `[CC-11] \`${m.consumer}\` ne déclare aucun \`installed_by_host\` — rien à ` +
                    "confronter à la surface du cœur. Ce n'est pas un vert de sa part."
            );
        }

        // ── CC-13 — `requested_events` is READ, and rendered as a NOTE ──────────────
        //
        // 🛑 THIS KEY WAS ACCEPTED WITHOUT EVER BEING READ, and the irony is
        // written in place: `requested_events` appears in `KNOWN_TOP_LEVEL`
        // (`consumer-manifest.cjs`) — so the schema validates it — but
        // no CC rule looked at its content. The comment justifying that
        // closed list says it wants to avoid "an entry nobody ever
        // verified": being made ACCEPTABLE had excused this block from
        // being VERIFIED.
        //
        // What it cost concretely: `geoleaf:layer:updated` is not emitted,
        // DELIBERATELY ("no speculative event without a listener"), and the
        // refusal had given itself a falsifiable reopening condition — "a
        // subscriber exists […] in a manifest read by
        // verify-consumer-contract". The condition was good; the gate did
        // not read the block where the refutation was to arrive. A refusal
        // whose reopening condition is unobservable is not refutable: it is
        // an opinion.
        //
        // ⚠️ NOTE AND NOT RED, deliberately — same reasoning as CC-10. A
        // REQUEST is not a subscriber: downstream can wish for an event the
        // repo refuses to emit, and that is a legitimate state, not a
        // regression. Turning red here would make the gate a channel
        // through which downstream imposed emissions, which neither party wants.
        const demandes = cm.entriesOf(d.requested_events, "requested_events");
        for (const e of demandes) {
            const nom = e.path;
            const emis = literals.has(nom);
            notes.push(
                `[CC-13] \`${nom}\` est demandé par \`${m.consumer}\` et ` +
                    (emis
                        ? "IL EST ÉMIS ici — la demande est satisfaite, rien à faire."
                        : "n'est PAS émis ici. Une demande n'est pas un abonné : le refus " +
                          "tient tant qu'aucun code aval ne s'y abonne. Mais l'état n'est " +
                          "plus « personne ne l'a demandé ».")
            );
        }

        // ── CC-12 — the `geoleaf:connector:*` namespace is SHARED ────────────────────
        //
        // Six events of the `connector` plugin entered the `geoleaf:`
        // naming domain. The downstream consumer maintains a proprietary
        // plugin emitting six others under that same prefix. Non-collision
        // was verified BY HAND on 13/08/2026 and written into
        // `event-bus.contract.ts` — with, in the same sentence, the
        // admission that "nothing, on either side, prevents a future collision".
        //
        // This code is that something. It costs nothing: downstream already
        // declares its six names in
        // `out_of_scope.emitted_by_suite_connector`, and `literals` is the
        // oracle CC-07 already uses. A note written in a contract does not
        // turn red; this does.
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

    // The THIRD oracle's floor. Same function as CC-00's two floors:
    // distinguish "nothing to resolve through this path" from "this path
    // resolves nothing any more".
    if (pluginResolved === 0) {
        notes.push(
            '[CC-03] aucune entrée `provider: "plugin:*"` dans les manifestes lus — le ' +
                "troisième oracle n'a rien eu à résoudre. Ce n'est pas un vert de sa part."
        );
    }

    // ── CC-06 — the scope, and why it exits 2 and not 1 ──────────────────────────────
    //
    // An out-of-scope path is NOT a regression: the code may be perfectly
    // fine. But it is not green either, because the gate did not read it.
    // Greening it would be exactly the class it exists to catch — "0
    // violations" over a corpus never opened. Exit 2: refusal to conclude,
    // with the paths NAMED.
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

/** Searches a literal in a directory's `.ts` sources. Returns `true` at the first hit. */
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
    // A gate crash is NOT a green, and not a contract regression either.
    cm.refuse(`la gate a levé — ${err && err.stack ? err.stack : err}`, "CC-00");
});
