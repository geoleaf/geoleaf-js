/*!
 * GeoLeaf — noms d'événements DOM : relevé sur AST et exclusions, partagés entre gates.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Pourquoi ce module existe
 *
 * `check-event-map-coverage.cjs` (API publique S3.4) portait ce relevé et ses trois familles
 * d'exclusion. Au contrat inverse S1.7, `verify-consumer-contract.cjs` en a eu besoin des
 * QUATRE — son code CC-07 tient que tout `required.events` du manifeste aval est émis **en
 * littéral** dans les sources livrées **et** sur le bus DOM, ce qui est exactement ce que
 * `collectEventLiterals`, `MAP_BUS`, `DYNAMIC_PREFIXES` et `PERF_MARK_RE` décrivent ensemble.
 *
 * **Un second lecteur déclenche l'extraction** : c'est la règle du dépôt, et elle a un motif
 * mesuré — `ts-decl-read.cjs` la formule ainsi, *« deux copies d'un lecteur dérivent, et la
 * dérive est invisible tant que les deux gates sortent vertes »*. `source-inventory.cjs`,
 * `side-effect-modules.cjs` et `test-load-sites.cjs` sont nés du même geste.
 *
 * ⚠️ **Refactor à comportement NUL.** Rien n'est corrigé ici au passage : les trois familles
 * d'exclusion sont transportées à l'octet, commentaires compris, parce que chacune porte le
 * motif qui la rend relisible et qu'un motif réécrit « au passage » est un motif qu'on ne peut
 * plus confronter à ce qu'il explique. `npm run check:event-map` doit rester vert **et rendre
 * les mêmes nombres** — c'est le critère de succès de la tâche, pas un espoir.
 *
 * ## Pourquoi le relevé lit des LITTÉRAUX et non des sites d'appel
 *
 * L'instrument évident — parcourir l'AST, trouver les `dispatchEvent`, lire l'argument 1 — est
 * précisément celui qui ne marche pas ici, et le code du dépôt dit pourquoi : quatre modules
 * émettent via un helper local qui prend le nom en PARAMÈTRE (`_dispatchCustomEvent`,
 * `_firePluginEvent`, `_dispatch`, `emit`). Une gate qui inspecte les arguments voit quatre
 * appels dynamiques ; le relevé de littéraux voit les 23 littéraux des sites d'appel.
 *
 * Conséquence énoncée plutôt que cachée : ce relevé **ne distingue pas l'émission de
 * l'abonnement**. Un nom seulement écouté compte quand même. C'est délibéré côté EVENT-MAP —
 * un seam non typé est la même dette par quelque bout qu'on le tienne — et c'est une LIMITE
 * dont CC-07 doit tenir compte : il ne peut pas conclure « émis » d'un littéral seul.
 *
 * Usage : const ev = require("./lib/event-names.cjs");
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./packages.cjs");

const ROOT = registry.ROOT;

/** Any `geoleaf:`-prefixed string literal. Anchored: no substring matches. */
const EVENT_LITERAL_RE = /^geoleaf:[A-Za-z0-9:_-]+$/;

// ── Exclusions ───────────────────────────────────────────────────────────────────────
//
// Each entry states WHY the name is not a DOM event, because an exclusion nobody can
// re-derive is indistinguishable from a name someone got tired of typing.

/**
 * `performance.mark()` / `performance.measure()` labels. They share the `geoleaf:`
 * prefix and nothing else: no `dispatchEvent`, no listener, no `detail`.
 *
 * ⚠️ This is where the audit's headline number came from. It reported "22 typed / 89
 * dispatched"; 18 of those 89 are the marks below. Left in, the baseline would be born
 * carrying 18 entries that can never be typed and can never shrink — a debt register
 * whose fifth of entries are permanent is one nobody reads.
 *
 * ⚠️ `geoleaf:boot:aborted` is NOT one of these. It is a real `CustomEvent`
 * (`app/boot-core.ts:242`) that happens to share the `geoleaf:boot:` stem with six
 * marks. The predicate below matches the mark families exactly, never by stem.
 */
const PERF_MARK_RE =
    /^geoleaf:(?:boot:(?:loadConfig|profileResources|registry)|init:(?:basemaps|deferredUI|geojson|mapCreate)):(?:start|end)$|^geoleaf:initApp:(?:start|ready)$|^geoleaf:startup-total$|^geoleaf:theme-data-load$/;

/**
 * Names carried by the **MapLibre** event bus (`map.fire` / `map.on`), not by `document`.
 *
 * `GeoLeafEventMap` types the DOM bus — `Events.on` delegates to `addEventListener`, so a
 * MapLibre-only name typed there would be a promise the facade cannot keep. Whether the
 * two buses should share one map is a real question; it is not this gate's to answer.
 *
 * ⚠️ Ce jeu est load-bearing pour DEUX gates depuis le contrat inverse S1.7, et pour deux
 * verdicts opposés : EVENT-MAP l'utilise pour **ne pas exiger** de typage, CC-07 pour
 * **rougir** — un événement que l'aval déclare écouter via `Events.on` alors qu'il ne
 * transite que par le bus MapLibre est une promesse que la façade ne peut pas tenir.
 */
const MAP_BUS = new Set([
    "geoleaf:geojson:deferred-layers-loaded", // kernel/geojson/loader/profile.ts:337
    "geoleaf:geojson:layers-loaded", // kernel/geojson/loader/profile.ts:364
    "geoleaf:filters:changed", // listened via map.on — plugins/table/src/table-layer.ts:129
]);

/**
 * `geoleaf:table:*` — the ONLY event names in the repo built by concatenation:
 * `table-state.ts:53-59` does `map.fire("geoleaf:" + eventName)` and
 * `document.dispatchEvent(new CustomEvent("geoleaf:" + eventName))`.
 *
 * The 9 names (`opened`, `closed`, `layerChanged`, `sortChanged`, `selectionChanged`,
 * `zoomToSelection`, `exportSelection`, `exportLayer`, `highlightSelection`) never appear
 * as `geoleaf:`-prefixed literals, so this gate is structurally blind to them and says so
 * rather than implying coverage it does not have. Refactoring `fireEvent` to take full
 * literals is on the backlog; until then the blind spot is named here, not silent.
 *
 * ⚠️ **C'est cette cécité, et non une rupture, qui a fait classer `geoleaf:table:opened` et
 * `:closed` en `broken_since_v3` dans le manifeste aval jusqu'à la v1.4.0.** Mesuré le
 * 10/08/2026 : ils sont émis (`plugins/table/src/table-api.ts:141` et `:152`, via `fireEvent`,
 * sur `document` ET sur la carte) et écoutés en aval. CC-07 doit donc traiter un préfixe
 * dynamique comme « hors de portée de la mesure » — **exit 2, jamais vert** —, sans quoi il
 * conclurait « absent » sur un événement bien présent, exactement comme le manifeste l'a fait.
 */
const DYNAMIC_PREFIXES = ["geoleaf:table:"];

/** Vrai si le nom n'est pas un événement DOM typable — les trois familles ci-dessus. */
const isExcluded = (name) =>
    PERF_MARK_RE.test(name) ||
    MAP_BUS.has(name) ||
    DYNAMIC_PREFIXES.some((p) => name.startsWith(p));

/** Vrai si le nom tombe sous un préfixe composé dynamiquement — donc hors de portée du relevé. */
const isDynamic = (name) => DYNAMIC_PREFIXES.some((p) => name.startsWith(p));

// ── Corpus ───────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    "__tests__",
    "__mocks__",
    "docs-dist",
    "examples",
]);
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs"]);

function collectSources(dir, acc) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectSources(path.join(dir, entry.name), acc);
        } else if (EXTS.has(path.extname(entry.name))) {
            const base = entry.name;
            if (base.includes(".test.") || base.includes(".spec.")) continue;
            acc.push(path.join(dir, entry.name));
        }
    }
    return acc;
}

/**
 * Le corpus des sources expédiées de tous les workspaces, plus le scaffold.
 *
 * ⚠️ `_plugin-template` est HORS de `workspaces` (`!packages/_*`) et n'apparaît donc jamais
 * dans `registry.all()`. Il expédie pourtant l'entrée depuis laquelle chaque nouveau plugin
 * est scaffoldé — y compris son écouteur `geoleaf:toolbar:action`. Laissé dehors, le seul
 * fichier dont l'usage d'événements se propage à TOUS les plugins futurs n'est surveillé par
 * personne. C'est le même angle mort que celui qui a coûté trois relevés au dépôt cette
 * semaine (R-N5, tâche npm 3.9, corpus LIC-06).
 */
function shippedSources() {
    const files = [];
    for (const pkg of registry.all()) collectSources(path.join(pkg.absDir, "src"), files);
    collectSources(path.join(ROOT, "packages", "_plugin-template", "src"), files);
    return files;
}

/**
 * Collects `geoleaf:*` names from source, mapped to the files they appear in.
 *
 * Reads string literals off the AST rather than regexing raw text: a `geoleaf:…` written
 * in a comment or a docblock is not a use, and this repo's sources are dense with both.
 *
 * @param {string[]} files
 * @returns {Map<string, Set<string>>} nom → chemins relatifs à la racine du dépôt.
 */
function collectEventLiterals(files) {
    const found = new Map(); // name → Set<relative file>
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("geoleaf:")) continue; // cheap pre-filter
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        const visit = (node) => {
            if (
                (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
                EVENT_LITERAL_RE.test(node.text)
            ) {
                if (!found.has(node.text)) found.set(node.text, new Set());
                found.get(node.text).add(rel);
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(sf, visit);
    }
    return found;
}

module.exports = {
    ROOT,
    EVENT_LITERAL_RE,
    PERF_MARK_RE,
    MAP_BUS,
    DYNAMIC_PREFIXES,
    isExcluded,
    isDynamic,
    collectSources,
    shippedSources,
    collectEventLiterals,
};
