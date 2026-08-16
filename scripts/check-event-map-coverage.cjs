#!/usr/bin/env node
/**
 * EVENT-MAP: every GeoLeaf DOM event name that appears in shipped source must be typed
 * in `contracts/event-bus.contract.ts` (API publique S3.4).
 *
 * ## The gap this closes
 *
 * Un nom relevé et non typé est inatteignable par la façade `Events` : le consommateur qui
 * le veut doit replier sur un `document.addEventListener` nu avec un `CustomEvent<{…}>`
 * écrit à la main — c'est exactement ainsi que le dépôt s'est retrouvé avec QUATRE
 * déclarations divergentes de la charge de `geoleaf:toolbar:action` avant que S3 ne les
 * unifie. Rien n'empêche le suivant d'arriver. C'est à cela que sert cette gate.
 *
 * ⚠️ **Ce paragraphe portait trois chiffres en dur — « 22 typés », « 79 relevés », « les 57
 * restants » — et les trois étaient faux.** Ils dataient du câblage (API publique S3.4) et
 * n'ont jamais été re-mesurés, alors que la gate IMPRIME les siens à chaque run, deux lignes
 * plus bas. Un exemple périmé dans le commentaire d'une gate d'événements est précisément le
 * défaut que cette gate existe pour attraper (voir l'avertissement en fin de fichier, qui
 * raconte la même chose à propos de `geoleaf:popup:action`) — et il a survécu pour la même
 * raison : aucune règle ne lit les commentaires. **Les chiffres ne sont donc plus écrits
 * ici** ; ils se lisent dans la sortie du run, ou par `npm run check:event-map`.
 *
 *   EM-01  An event name found in source, absent from the maps AND absent from the
 *          baseline → ERROR. A NEW event cannot arrive untyped.
 *   EM-02  A baseline entry that is now typed, or that no longer appears anywhere in
 *          source → ERROR until removed. The baseline may only SHRINK.
 *          Same invariant as MH-02 (`check-module-headers.cjs`) and PCB-02
 *          (`verify-plugin-core-boundary.cjs`); the wording is theirs on purpose.
 *
 * ## Why it scans string LITERALS and not `dispatchEvent` call sites
 *
 * The obvious instrument — walk the AST, find `dispatchEvent`/`dispatchGeoLeafEvent`
 * calls, read argument 1 — is the one that does not work here, and the repo's own code
 * says why. Four modules emit through a local helper that takes the name as a
 * parameter:
 *
 *   `kernel/themes/theme-applier/core.ts:162`   `_dispatchCustomEvent(name, detail)`
 *   `kernel/api/plugin-registry.ts:44`          `_firePluginEvent(name, detail)`
 *   `plugins/editor/src/events.ts:364`          `_dispatch(eventName, detail)`
 *   `plugins/websocket/…/event-bus-bridge.ts:61` `emit(name, detail)`  ← 12 `ws:*` names
 *
 * An argument-inspecting gate sees four `dispatchEvent(name, …)` calls and reports four
 * unknown dynamic names; a literal sweep sees the 23 literals at the call sites. The
 * literal sweep is the instrument that matches how this codebase actually emits.
 *
 * Consequence, stated rather than hidden: this gate does **not** distinguish emission
 * from subscription. A name that is only ever listened for still counts. That is
 * deliberate — an untyped seam is the same debt whichever end you hold it by, and the
 * sweep found 5 such pending seams (`geoleaf:filters:changed`,
 * `geoleaf:cache:cancelled`, …) that are worth carrying in the register.
 *
 * Usage: node scripts/check-event-map-coverage.cjs
 *        node scripts/check-event-map-coverage.cjs --update-baseline
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
// Contrat inverse S1.7 — le relevé de littéraux et les TROIS familles d'exclusion sont sortis
// d'ici vers `lib/` le jour où `verify-consumer-contract.cjs` (CC-07) en a eu besoin. Deux
// copies d'un relevé dérivent, et la dérive reste invisible tant que les deux gates sortent
// vertes. Les motifs de chaque exclusion sont partis AVEC les exclusions : ils n'ont de sens
// qu'à côté de ce qu'ils expliquent.
const { isExcluded, shippedSources, collectEventLiterals } = require("./lib/event-names.cjs");

const ROOT = registry.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "event-map-coverage.json");
const UPDATE = process.argv.includes("--update-baseline");

// Resolved through the registry, never as a hard-coded `packages/core` path: a literal
// would stop matching the day the package moves and the gate would report "0 untyped
// event" from a file it never opened. `requireByDirName` throws instead.
// (cf. `probe-gate-visibility.cjs`, which hunts precisely this class.)
const CONTRACT = path.join(
    registry.requireByDirName("core").absDir,
    "src",
    "contracts",
    "event-bus.contract.ts"
);

/** The two maps that make an event name "typed". Both are public API since S3. */
const MAP_NAMES = ["GeoLeafEventMap", "GeoLeafRawEventMap"];

// ⚠️ `EVENT_LITERAL_RE`, `PERF_MARK_RE`, `MAP_BUS` et `DYNAMIC_PREFIXES` vivent désormais dans
// `lib/event-names.cjs` — avec leurs motifs, qui n'ont de sens qu'à côté de ce qu'ils
// expliquent. Cette gate n'importe que `isExcluded`, leur COMPOSITION : importer les trois
// constantes « pour la lisibilité » les laisserait inutilisées ici, et un import inutilisé est
// une dépendance que rien ne prouve. Pour lire une exclusion, on ouvre la lib.

// ── 1. Source of truth: the map keys, parsed from the contract ───────────────────────

/**
 * Reads the event names declared by the two maps.
 *
 * Parsed from the AST rather than copied into this file: a hand-kept second list is the
 * defect this whole sprint is about. A typo in a map key then shows up as a NEW untyped
 * event (EM-01), which is the correct place to notice it.
 */
function readTypedEventNames() {
    if (!fs.existsSync(CONTRACT)) {
        console.error(`ERROR [EVENT-MAP]: contract not found — ${path.relative(ROOT, CONTRACT)}`);
        process.exit(2);
    }
    const sf = ts.createSourceFile(
        CONTRACT,
        fs.readFileSync(CONTRACT, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const names = new Set();
    const seenMaps = [];
    for (const stmt of sf.statements) {
        if (!ts.isInterfaceDeclaration(stmt)) continue;
        if (!MAP_NAMES.includes(stmt.name.text)) continue;
        seenMaps.push(stmt.name.text);
        for (const member of stmt.members) {
            if (!ts.isPropertySignature(member) || !member.name) continue;
            if (ts.isStringLiteral(member.name)) names.add(member.name.text);
        }
    }
    const missing = MAP_NAMES.filter((m) => !seenMaps.includes(m));
    if (missing.length > 0) {
        console.error(`ERROR [EVENT-MAP]: interface(s) introuvable(s) dans le contrat: ${missing}`);
        console.error("La gate refuse de conclure — elle mesurerait contre une map vide.");
        process.exit(2);
    }
    return names;
}

// ── 2. Corpus: every shipped source of every workspace ───────────────────────────────
//
// `collectSources`, `shippedSources` et `collectEventLiterals` vivent dans
// `lib/event-names.cjs` depuis le contrat inverse S1.7 — y compris la raison pour laquelle le
// corpus ajoute `_plugin-template`, hors `workspaces` et donc invisible à `registry.all()`.

// ── 3. Run ───────────────────────────────────────────────────────────────────────────

const typed = readTypedEventNames();

const sourceFiles = shippedSources();

// ── Non-vacuity ──────────────────────────────────────────────────────────────────────
// Three floors, because each of them has already been the failure mode of some gate in
// this repo: an empty corpus, an empty oracle, and an empty measurement all report
// "nothing wrong" in exactly the same words as a clean run.
if (sourceFiles.length === 0) {
    console.error("ERROR [EVENT-MAP]: corpus vide — la gate refuse de conclure.");
    process.exit(2);
}
if (typed.size === 0) {
    console.error("ERROR [EVENT-MAP]: 0 clé extraite des maps — la gate est aveugle, pas verte.");
    process.exit(2);
}

const found = collectEventLiterals(sourceFiles);
if (found.size === 0) {
    console.error(
        `ERROR [EVENT-MAP]: 0 littéral \`geoleaf:*\` sur ${sourceFiles.length} fichiers. ` +
            "Impossible dans ce dépôt — l'instrument est cassé, pas le code."
    );
    process.exit(2);
}

const inScope = [...found.keys()].filter((n) => !isExcluded(n)).sort();
const untyped = inScope.filter((n) => !typed.has(n));

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "API publique S3.4 — GeoLeaf DOM event names present in source and absent " +
                    "from GeoLeafEventMap / GeoLeafRawEventMap. This list may only SHRINK " +
                    "(EM-02): type an event in contracts/event-bus.contract.ts, then remove " +
                    "its line. Never add to it by hand — a new event must be born typed (EM-01).",
                _generated: "node scripts/check-event-map-coverage.cjs --update-baseline",
                count: untyped.length,
                events: untyped,
            },
            null,
            // 4, not 2 — Prettier owns `scripts/**/*.json` at tabWidth 4 and would otherwise
            // reformat the whole file on commit, turning a one-line shrink into an
            // unreviewable diff. Same reasoning as `check-module-headers.cjs`.
            4
        ) + "\n"
    );
    console.log(`✅ [EVENT-MAP] baseline written — ${untyped.length} untyped event name(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error("ERROR [EVENT-MAP]: baseline missing.");
    console.error("Run: node scripts/check-event-map-coverage.cjs --update-baseline");
    process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).events);

// EM-01 — untyped AND not in the baseline.
const newlyUntyped = untyped.filter((n) => !baseline.has(n));

// EM-02 — baseline entries that are no longer true.
const staleEntries = [...baseline].filter((n) => typed.has(n) || !found.has(n)).sort();

let failed = false;

if (newlyUntyped.length > 0) {
    failed = true;
    console.error(
        `ERROR [EVENT-MAP/EM-01]: ${newlyUntyped.length} nouvel(s) événement(s) non typé(s) :`
    );
    for (const n of newlyUntyped) {
        console.error(`  ${n}  —  ${[...found.get(n)].sort().join(", ")}`);
    }
    console.error("");
    console.error(
        "Ajoutez la clé dans `packages/core/src/contracts/event-bus.contract.ts` : " +
            "`GeoLeafEventMap` si le detail est JSON-sérialisable, `GeoLeafRawEventMap` s'il " +
            "porte une référence DOM vivante (le bus assaini la détruirait)."
    );
}

if (staleEntries.length > 0) {
    failed = true;
    console.error(
        `ERROR [EVENT-MAP/EM-02]: ${staleEntries.length} entrée(s) de baseline ne sont plus vraies :`
    );
    for (const n of staleEntries) {
        console.error(`  ${n} — ${typed.has(n) ? "désormais typé" : "absent des sources"}`);
    }
    console.error("");
    console.error(
        "The baseline is a debt register, not a permission slip: it may only shrink. " +
            "Run: node scripts/check-event-map-coverage.cjs --update-baseline"
    );
}

if (failed) process.exit(1);

// Le ratio porte sur les noms RELEVÉS DANS LES SOURCES, pas sur les clés déclarées :
// `typed.size` compte aussi les clés sans émetteur (`geoleaf:poi:click`… — typées, jamais
// émises), et les mêler donnerait un pourcentage qui monte quand on ajoute une clé morte.
// Ce qu'on veut savoir est : « parmi ce que le code utilise réellement, quelle part est
// typée ? »
//
// ⚠️ Ce commentaire citait AUSSI `geoleaf:popup:action` comme « typée, jamais émise », et
// c'était faux depuis onze jours au 09/08/2026 : B-69 l'a rendue émettrice le 29/07, dans
// `capabilities/feature-info/render/widget-dispatch.ts`. Un exemple périmé dans le commentaire
// d'une gate d'événements est précisément le défaut que cette gate existe pour attraper —
// et il a survécu parce qu'aucune règle ne lit les commentaires. Relever un exemple **dans**
// le code, jamais de mémoire.
//
// ⚠️ La correction du 09/08 citait `widget-dispatch.ts:365` et
// `dispatchGeoLeafEvent("geoleaf:popup:action", …)`. Les DEUX sont périmées depuis le
// 14/08/2026 : la clé est passée dans `GeoLeafRawEventMap` et s'émet en `CustomEvent` nu, la
// ligne ayant bougé au passage. Une citation de ligne posée POUR corriger une citation périmée
// s'est périmée à son tour en cinq jours — d'où le nom de fichier seul ci-dessus.
// ── EM-03 — un événement NAMESPACÉ hors du domaine ───────────────────────────────────
//
// 🛑 Les règles ci-dessus sont ancrées sur `^geoleaf:` : elles ne peuvent pas voir un
// événement qui ne porte pas le préfixe. EM-03 ferme cet angle mort — le motif complet, et
// le périmètre que cette règle N'A PAS, sont dans `lib/event-gates.cjs`.
const { collectNamespacedEventLiterals, DOMAIN_PREFIX } = require("./lib/event-gates.cjs");
const { violations: nsViolations, callSites } = collectNamespacedEventLiterals(sourceFiles);

// Anti-gate-vide : EM-03 inspecte des SITES D'APPEL, pas des littéraux nus. Si le balayage
// n'en trouve aucun, c'est l'instrument qui est cassé — ce dépôt en porte des centaines.
if (callSites === 0) {
    console.error(
        `ERROR [EVENT-MAP/EM-03]: 0 site d'appel d'événement sur ${sourceFiles.length} fichiers. ` +
            "Impossible dans ce dépôt — la gate refuse de conclure."
    );
    process.exit(2);
}

if (nsViolations.length > 0) {
    console.error(
        `\nERROR [EVENT-MAP/EM-03]: ${nsViolations.length} littéral(aux) d'événement namespacé(s) ` +
            `hors du domaine \`${DOMAIN_PREFIX}\` :\n`
    );
    for (const v of nsViolations) {
        const rel = path.relative(ROOT, v.file);
        console.error(`   "${v.name}"  ${rel}:${v.line}  (via ${v.gate}())`);
    }
    console.error(
        `\n  Un littéral d'événement qui contient un \`:\` DOIT commencer par \`${DOMAIN_PREFIX}\`.\n` +
            "  Les événements ÉTRANGERS (natifs DOM, MapLibre, Terra Draw…) n'en contiennent\n" +
            "  aucun — c'est ce qui sépare les deux sans liste à entretenir.\n" +
            "  Renommez, puis typez la clé dans `contracts/event-bus.contract.ts` (EM-01 la\n" +
            "  réclamera dès qu'elle entre dans le domaine — c'est voulu).\n" +
            "  Cas d'une bibliothèque tierce réellement namespacée : `FOREIGN_NAMESPACED`\n" +
            "  dans `scripts/lib/event-gates.cjs`, avec son motif écrit sur place.\n"
    );
    process.exit(1);
}

const typedInSource = inScope.filter((n) => typed.has(n)).length;
const pct = ((typedInSource / inScope.length) * 100).toFixed(1);
console.log(
    `✅ [EVENT-MAP] ${typedInSource}/${inScope.length} noms d'événements relevés dans les sources ` +
        `sont typés (${pct} %) ; ${sourceFiles.length} fichiers scannés, ${typed.size} clés ` +
        `déclarées, ${baseline.size} en baseline, aucun nouveau, aucun périmé.`
);
// Le périmètre d'EM-03 s'imprime, il ne se recopie pas : c'est le seul moyen de voir qu'elle
// a réellement scanné quelque chose le jour où un refactor lui retire ses sites d'appel.
console.log(
    `   [EM-03] ${callSites} site(s) d'appel d'événement à littéral inspecté(s) ; ` +
        `aucun nom namespacé hors \`${DOMAIN_PREFIX}\`.`
);
process.exit(0);
