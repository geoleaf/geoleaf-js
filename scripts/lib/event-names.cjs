/*!
 * GeoLeaf — DOM event names: AST-based census and exclusions, shared between gates.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Why this module exists
 *
 * `check-event-map-coverage.cjs` used to carry this census and its exclusion families.
 * Then `verify-consumer-contract.cjs` needed them too — its CC-07 code holds that every
 * `required.events` of the downstream manifest is emitted **as a literal** in the shipped
 * sources **and** on the DOM bus, which is exactly what `collectEventLiterals`, `MAP_BUS`
 * and `PERF_MARK_RE` describe together.
 *
 * ⚠️ **They were THREE families until 2026-08-13, and four exports.** The third —
 * `DYNAMIC_PREFIXES` / `isDynamic` — is removed since: its only producer, the `table`
 * plugin's `fireEvent`, now takes the full name. The complete rationale is in the file
 * body, where the family used to live.
 *
 * **A second reader triggers the extraction**: that is this repo's rule, and it has a
 * measured rationale — `ts-decl-read.cjs` phrases it as *"two copies of a reader drift,
 * and the drift is invisible as long as both gates come out green"*.
 * `source-inventory.cjs`, `side-effect-modules.cjs` and `test-load-sites.cjs` were born of
 * the same move.
 *
 * ⚠️ **Zero-behaviour refactor.** Nothing is fixed here in passing: the three exclusion
 * families are transported byte-for-byte, comments included, because each carries the
 * rationale that keeps it re-readable, and a rationale rewritten "in passing" is one you
 * can no longer confront with what it explains. `npm run check:event-map` must stay green
 * **and return the same numbers** — that is the task's success criterion, not a hope.
 *
 * ## Why the census reads LITERALS and not call sites
 *
 * The obvious instrument — walk the AST, find the `dispatchEvent`s, read argument 1 — is
 * precisely the one that does not work here, and the repo's code says why: four modules
 * emit through a local helper that takes the name as a PARAMETER (`_dispatchCustomEvent`,
 * `_firePluginEvent`, `_dispatch`, `emit`). A gate inspecting arguments sees four dynamic
 * calls; the literal census sees the call sites' 23 literals.
 *
 * A consequence stated rather than hidden: this census **does not distinguish emission
 * from subscription**. A name that is only listened to still counts. That is deliberate on
 * the EVENT-MAP side — an untyped seam is the same debt whichever end you hold it by — and
 * it is a LIMIT CC-07 must account for: it cannot conclude "emitted" from a literal alone.
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
 * (`app/boot-core.ts`) that happens to share the `geoleaf:boot:` stem with six
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
 * ⚠️ This set is load-bearing for TWO gates, and for two opposite verdicts: EVENT-MAP
 * uses it to **not demand** typing, CC-07 to **go red** — an event the downstream declares
 * listening to via `Events.on` while it only travels the MapLibre bus is a promise the
 * facade cannot keep.
 */
const MAP_BUS = new Set([
    "geoleaf:geojson:deferred-layers-loaded", // kernel/geojson/loader/profile.ts
    "geoleaf:geojson:layers-loaded", // kernel/geojson/loader/profile.ts
    "geoleaf:filters:changed", // listened via map.on — plugins/table/src/table-layer.ts
]);

// ── The third family is GONE, and that is the fact to know ───────────────────────────
//
// `DYNAMIC_PREFIXES = ["geoleaf:table:"]` and its companion `isDynamic` lived here. They
// named a STRUCTURAL blindness: `fireEvent` (`table` plugin) composed its names at runtime
// — `map.fire("geoleaf:" + eventName)` — so no complete literal existed in source, so this
// census could see nothing of its 9 names and said so rather than suggesting a coverage it
// did not have.
//
// ✅ **Removed on 2026-08-13**: `fireEvent` now takes the FULL name, constrained by the
// `TableEventName` type (`plugins/table/src/table-state.ts`), and the 9 names are typed in
// `GeoLeafEventMap`. The blindness is not worked around, it has no object left — which is
// what the old comment announced as the exit (*"Refactoring `fireEvent` to take full
// literals is on the backlog"*).
//
// ⚠️ **Two readers moved together, and that was the trap.** `isExcluded` (below) serves
// EVENT-MAP; `isDynamic` served CC-06 in `verify-consumer-contract.cjs`, with a
// `SCOPE_EXEMPT` map whose entry named a deadline. The removal ORDER mattered: once
// `isDynamic` is gone, the CC-06 branch goes dead and a stale exemption would become
// invisible forever. So it was SEEN red, then removed, before this one.
//
// 🛑 What this removal leaves uncovered is written where someone will read it at the right
// moment: the `SCOPE_EXEMPT` block of `verify-consumer-contract.cjs`, with its re-measure
// command.

/**
 * True if the name is not a typable DOM event — the TWO families above.
 *
 * ⚠️ They were three until 2026-08-13. Do not remove this function believing you remove
 * the vanished family: it still carries the **18 `performance` marks** and the **3
 * MapLibre-bus names**, which nothing else excludes. Deleting it would demand typing for
 * 21 names that are not DOM events.
 */
const isExcluded = (name) => PERF_MARK_RE.test(name) || MAP_BUS.has(name);

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
 * The shipped-sources corpus of every workspace, plus the scaffold.
 *
 * ⚠️ `_plugin-template` is OUTSIDE `workspaces` (`!packages/_*`) and thus never appears in
 * `registry.all()`. Yet it ships the entry every new plugin is scaffolded from — including
 * its `geoleaf:toolbar:action` listener. Left outside, the one file whose event usage
 * propagates to ALL future plugins is watched by nobody. It is the same blind spot that
 * cost the repo three separate censuses in one week — the license-banner corpus that
 * LIC-06 now guards among them.
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
 * @returns {Map<string, Set<string>>} name → repo-root-relative paths.
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
    isExcluded,
    collectSources,
    shippedSources,
    collectEventLiterals,
};
