#!/usr/bin/env node
/**
 * Gate: does the PUBLISHED package keep the promise? (S6)
 *
 * `scripts/check-example-bundle.cjs` proves that the *source graph* tree-shakes. It cannot prove
 * that the *published package* does — it builds from `../../src/`, paths that exist only inside
 * this repository. In S6 the two turned out to have diverged, twice over:
 *
 *   - the recipe in COOKBOOK.md pointed at `@geoleaf/core/src/…` — a directory `files` never
 *     publishes and `exports` never exposes. It could not have worked for anybody, ever;
 *   - `dist/esm/` — what `exports["."]` resolves to — was built with a `moduleSideEffects`
 *     heuristic that dropped the three modules mutating the `Config` singleton, so
 *     `import { Config } from "@geoleaf/core"` shipped a `Config` with no `.get()`.
 *
 * So this gate builds `examples/consumer/entry.ts`, which imports through the real npm subpaths,
 * and asserts four things about the result:
 *
 *   1. **PROVENANCE** — every source in the witness's sourcemaps sits under `dist/esm/`.
 *      This is the cheapest and most important check in the file. If `@rollup/plugin-typescript`
 *      ever wins the resolution race against node-resolve (it has its own `resolveId`, and it
 *      would if anyone added `paths` to the tsconfig), the witness silently bundles `src/` —
 *      the `exports` map is never consulted, `sideEffects` is never read, and every check below
 *      passes while proving *nothing*. A green gate over a broken package is worse than no gate.
 *   2. **SIDE EFFECTS** — the bare-import closure (derived, see `lib/side-effect-modules.cjs`)
 *      survives. This is what a third-party bundler does to us when `sideEffects` is wrong.
 *   3. **EXCLUSION** — not one file of a capability the entry does not list appears in the closure.
 *   4. **SANITY** — the capabilities it *does* list ARE there, else we are measuring nothing.
 *
 * ## Why sourcemaps, and not the registry or the file listing
 *
 * Same reason as S5: a capability can be absent from `GeoLeaf._registry` (its runtime gate is off)
 * and still sit in the file, downloaded on every page load. And a module can exist in `dist/esm/`
 * and still be dropped by the consumer's bundler. The only honest oracle is what actually landed
 * in the artifact — its sourcemaps.
 *
 * Usage:
 *   node scripts/check-consumer-bundle.cjs         # gate (exit 1 on breach)
 *   node scripts/check-consumer-bundle.cjs --list  # + every offending file
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { measureEagerBootAt, listEagerSources } = require("./check-bundle-size.cjs");
const { capabilitiesImportedBy, capabilityFiles } = require("./check-example-bundle.cjs");
const {
    bareImportsOf,
    bareImportClosureFrom,
    resolveSubpathToSrc,
    moduleIdentity,
} = require("./lib/side-effect-modules.cjs");

const ROOT = path.resolve(__dirname, "..");
// T5.5 — par le registre, qui jette si le core est introuvable.
const CORE = require("./lib/packages.cjs").requireByDirName("core").absDir;

const SHIPPED_ENTRY = path.join(CORE, "dist", "geoleaf.esm.js");
const SHIPPED_DIST = path.join(CORE, "dist");

const WITNESS_ENTRY = path.join(CORE, "examples", "dist", "consumer", "geoleaf.consumer.esm.js");
const WITNESS_DIST = path.join(CORE, "examples", "dist", "consumer");

const MANIFEST_SRC = path.join(CORE, "src", "presets", "manifest.full.ts");
const WITNESS_SRC = path.join(CORE, "examples", "consumer", "entry.ts");

/** Same floor as the source-graph gate: an anti-collapse guard, not a ratchet on bytes. */
const MIN_SAVING_PCT = 12;

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

const fmt = (kb) => (kb == null ? "—" : `${kb.toFixed(1)} KB`);

function checkConsumerBundle(opts = {}) {
    const DEFAULT_LOG = {
        ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
        err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
        info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
        dim: (m) => console.log(`${C.dim}   ${m}${C.reset}`),
    };
    const log = { ...DEFAULT_LOG };
    for (const k of Object.keys(DEFAULT_LOG)) {
        if (typeof opts.log?.[k] === "function") log[k] = opts.log[k].bind(opts.log);
    }
    const showList = process.argv.includes("--list");

    const shipped = measureEagerBootAt(SHIPPED_ENTRY, SHIPPED_DIST);
    const witness = measureEagerBootAt(WITNESS_ENTRY, WITNESS_DIST);
    if (shipped == null || witness == null) {
        log.err(
            `Build manquant (${shipped == null ? "dist/geoleaf.esm.js" : "examples/dist/consumer/"}) — lancer \`npm run build\` d'abord. Un gate qui se désarme quand l'artefact manque ne garde rien : ÉCHEC.`
        );
        return false;
    }

    const sources = listEagerSources(WITNESS_ENTRY, WITNESS_DIST);
    if (!sources || sources.length === 0) {
        log.err(
            "Aucune source récupérée des sourcemaps du témoin — la preuve est INVÉRIFIABLE. Vérifier `sourcemap: true` sur rollup.consumer.mjs."
        );
        return false;
    }

    let allOk = true;

    // ── 1. PROVENANCE — the check that protects every other check ──
    // Legitimate sources: the witness entry itself (it lives in examples/, by definition), third
    // party code, and everything else MUST have come through the `exports` map into dist/esm/.
    const fromSrc = sources.filter(
        (s) =>
            !s.includes("dist/esm/") &&
            !s.includes("node_modules/") &&
            !s.includes("examples/consumer/")
    );
    if (fromSrc.length === 0) {
        log.ok(
            `Provenance : les ${sources.length} sources du témoin viennent bien de \`dist/esm/\` — c'est le PAQUET qui est mesuré, pas le dépôt.`
        );
    } else {
        allOk = false;
        log.err(
            `Provenance : ${fromSrc.length} source(s) du témoin ne viennent PAS de \`dist/esm/\` :`
        );
        for (const s of fromSrc.slice(0, showList ? fromSrc.length : 6)) log.dim(s);
        if (!showList && fromSrc.length > 6)
            log.dim(`… (+${fromSrc.length - 6}, relancer avec --list)`);
        log.err(
            "La résolution a contourné le champ `exports` — presque sûrement le `resolveId` de @rollup/plugin-typescript qui a coiffé node-resolve (il le fera dès qu'un `paths` apparaît dans le tsconfig). `sideEffects` n'est alors jamais lu et TOUS les checks ci-dessous sont vides de sens."
        );
    }

    // ── 2. SIDE EFFECTS — what a third-party bundler does to us ──
    //
    // Derived from the WITNESS's own roots, not the package's: this entry bare-imports
    // `@geoleaf/core/globals` and `@geoleaf/core/helpers`, and nothing else. It never imports
    // `bundle-esm-entry`, so `app/init.js` and `runtime-metrics.js` — reachable only from there —
    // are legitimately absent, and demanding them would be a red gate over healthy code. Roots are
    // resolved THROUGH the `exports` map, so this also asserts that the map exposes what the
    // documented recipe imports.
    //
    // Then filtered to what a sourcemap can even show. `globals/globals.ts` is a pure orchestrator:
    // its six bare imports ARE its side effect, it emits no code of its own, so it appears in no
    // map — not the witness's, not the shipped bundle's. The proof that it ran is that its six
    // children landed. "Observable" = present in the SHIPPED bundle's maps, which carry the full
    // closure; anything absent from those cannot be asserted anywhere.
    const witnessRoots = bareImportsOf(WITNESS_SRC)
        .map(resolveSubpathToSrc)
        .filter((r) => r !== null);

    if (witnessRoots.length === 0) {
        log.err(
            "Aucune racine à effet de bord résolue depuis l'entrée du témoin — soit elle n'importe plus `@geoleaf/core/globals` et `/helpers`, soit `exports` ne les expose plus. Dans les deux cas la preuve serait vide : ÉCHEC."
        );
        return false;
    }

    const shippedSources = listEagerSources(SHIPPED_ENTRY, SHIPPED_DIST) || [];
    const observable = new Set(shippedSources.map(moduleIdentity).filter((x) => x !== null));
    const witnessSeen = new Set(sources.map(moduleIdentity).filter((x) => x !== null));

    const witnessRequired = bareImportClosureFrom(witnessRoots)
        .map((srcRel) => srcRel.replace(/\.ts$/, ""))
        .filter((id) => observable.has(id));

    const dropped = witnessRequired.filter((id) => !witnessSeen.has(id));
    if (dropped.length === 0) {
        log.ok(
            `Effets de bord : les ${witnessRequired.length} modules importés NUS (clôture depuis ${witnessRoots.join(", ")}) survivent au tree-shaking du consommateur.`
        );
    } else {
        allOk = false;
        log.err(
            `Effets de bord : ${dropped.length} module(s) importés NUS ont été ÉLAGUÉS du bundle du consommateur :`
        );
        for (const d of dropped) log.dim(`dist/esm/${d}.js`);
        log.err(
            "Ces modules n'existent QUE pour leur effet (ils mutent `Config`, `window.GeoLeaf`, le registre…) — aucun export ne les retient. Deux causes, à vérifier dans cet ordre : (a) le fichier est absent de `dist/esm/` (notre propre build l'a élagué → un `treeshake.moduleSideEffects` réintroduit dans rollup.config.mjs) ; (b) il y est mais `package.json#sideEffects` ne le couvre pas (→ `npm run check:side-effects`)."
        );
    }

    // ── 3 & 4. EXCLUSION / SANITY ──
    const universe = capabilitiesImportedBy(MANIFEST_SRC);
    const embarked = capabilitiesImportedBy(WITNESS_SRC);
    const excluded = universe.filter((id) => !embarked.includes(id));

    if (universe.length === 0 || embarked.length === 0) {
        log.err(
            `Listes de capacités vides (manifeste: ${universe.length}, témoin: ${embarked.length}) — le parsing a échoué, la preuve serait vide de sens : ÉCHEC.`
        );
        return false;
    }

    const leaked = excluded
        .map((id) => ({ id, hits: capabilityFiles(sources, id) }))
        .filter((x) => x.hits.length > 0);
    if (leaked.length === 0) {
        log.ok(
            `Exclusion : aucune des ${excluded.length} capacités exclues n'est dans le bundle du consommateur.`
        );
        log.dim(`exclues : ${excluded.join(", ")}`);
    } else {
        allOk = false;
        log.err(
            `Exclusion : ${leaked.length} capacité(s) exclue(s) sont TOUJOURS dans le bundle :`
        );
        for (const { id, hits } of leaked) {
            log.err(`  ${id} — ${hits.length} fichier(s) :`);
            for (const h of hits.slice(0, showList ? hits.length : 4)) log.dim(`    ${h}`);
        }
    }

    const missing = embarked.filter((id) => capabilityFiles(sources, id).length === 0);
    if (missing.length > 0) {
        allOk = false;
        log.err(
            `Sanity : ${missing.length} capacité(s) EMBARQUÉE(S) absentes de la clôture (${missing.join(", ")}) — la mesure ne regarde pas le bon artefact. Un « tout est exclu » obtenu ainsi ne prouve RIEN.`
        );
    } else {
        log.ok(`Sanity : les ${embarked.length} capacités embarquées sont bien présentes.`);
    }

    // ── Payload (informational floor, same shape as the source-graph gate) ──
    const savedPct = shipped.gz > 0 ? ((shipped.gz - witness.gz) / shipped.gz) * 100 : 0;
    log.info("Charge eager au boot (entrée + clôture des imports STATIQUES) :");
    log.dim(
        `bundle livré (${universe.length} capacités) : ${fmt(shipped.gz)} gz — ${shipped.chunks} chunks`
    );
    log.dim(
        `témoin npm   (${String(embarked.length).padStart(2)} capacités) : ${fmt(witness.gz)} gz — ${witness.chunks} chunks`
    );
    log.dim(
        `économie                    : ${fmt(shipped.gz - witness.gz)} gz (${savedPct.toFixed(1)} %)`
    );

    if (savedPct < MIN_SAVING_PCT) {
        allOk = false;
        log.err(
            `Différentiel : ${savedPct.toFixed(1)} % seulement (plancher ${MIN_SAVING_PCT} %). L'exclusion peut être formellement correcte sans rien alléger.`
        );
    }

    console.log("");
    if (allOk)
        log.ok("Le paquet publié tient sa promesse — mesuré sur ce qu'un intégrateur télécharge.");
    else log.err("Le paquet publié NE tient PAS sa promesse (voir ci-dessus).");
    console.log("");
    return allOk;
}

if (require.main === module) {
    console.log(
        `\n${C.cyan}── 📦 Preuve sur le paquet PUBLIÉ (témoin consommateur) ──${C.reset}\n`
    );
    process.exitCode = checkConsumerBundle() ? 0 : 1;
}

module.exports = { checkConsumerBundle, MIN_SAVING_PCT };
