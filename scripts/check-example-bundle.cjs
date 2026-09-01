#!/usr/bin/env node
/**
 * Tree-shaking gate for @geoleaf/core (presets chantier, S4 → hard gate in S5).
 *
 * GeoLeaf ships ONE bundle, with every in-core capability. The promise it makes to a
 * consumer who wants less is: *write your own entry composing only the capability
 * installers you need, and the rest tree-shakes away.* This script is what turns that
 * promise into a measured fact — and, since S5, into a wall.
 *
 * It builds on `examples/minimal/entry.ts` — the documented recipe itself, so the recipe
 * is exercised rather than merely written — and asserts:
 *
 *   1. **EXCLUSION** — not one source file of an excluded capability appears in the
 *      example's eager static closure. This is the load-bearing check.
 *   2. **DIFFERENTIAL** — the example weighs meaningfully less than the shipped bundle.
 *      A pass on (1) with no weight drop would mean the capabilities were never big
 *      enough to matter, or that the measurement is looking at the wrong artifact.
 *
 * ## Why the registry is NOT the oracle
 *
 * The obvious-looking check — "is capability X absent from `GeoLeaf._registry`?" — proves
 * nothing about the bundle. A capability can be absent from the registry (its runtime gate
 * is off) while its code sits in the file, downloaded on every page load. That gap is exactly
 * the phantom saving this chantier had to close: the old `lazy/*` shells kept excluded
 * capabilities in the shipped payload while `npm run size` — which follows static imports
 * only — happily reported them gone. So the oracle here is the **sourcemaps of the artifacts
 * actually in the eager closure**. Minified chunks say nothing about what went into them;
 * their maps say everything.
 *
 * ## Why the lists are derived, never typed
 *
 * The capability lists used to be two hardcoded arrays. That is a gate that rots: the first
 * person to add a capability makes it silently under-check, and nothing fails. So both lists
 * are parsed out of the code that actually decides them:
 *
 *   - the **universe** of shipped capabilities ← `src/presets/manifest.full.ts` ;
 *   - the **embarked** ones                    ← `examples/minimal/entry.ts` ;
 *   - the **excluded** ones                    ← the difference.
 *
 * Note the universe comes from the MANIFEST, not from listing `src/capabilities/`: a directory
 * is not the authority on what ships. The historical proof was `capabilities/layers/` — kernel
 * code living under a misleading path, which a directory listing would have classified
 * "excluded", found in the closure, and reddened for no reason. A later move sent it to
 * `kernel/geojson/layers-public-api.ts` and the directory now holds exactly the 18
 * declared capabilities, so that particular trap is gone; the rule stands because the next
 * misplaced file would spring it again, silently.
 *
 * Usage:
 *   node scripts/check-example-bundle.cjs         # gate (exit 1 on breach)
 *   node scripts/check-example-bundle.cjs --list  # + full list of capability files found
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { measureEagerBootAt, listEagerSources } = require("./check-bundle-size.cjs");

const ROOT = path.resolve(__dirname, "..");
// Through the registry, which throws if the core cannot be found.
const CORE = require("./lib/packages.cjs").requireByDirName("core").absDir;

// ── The shipped bundle (every capability) ──
const SHIPPED_ENTRY = path.join(CORE, "dist", "geoleaf.esm.js");
const SHIPPED_DIST = path.join(CORE, "dist");

// ── The extracted stylesheets (S6 — the CSS now tree-shakes with its capability) ──
const SHIPPED_CSS = path.join(CORE, "dist", "geoleaf-main.min.css");

// ── The file that decides what is shipped ──
const MANIFEST_SRC = path.join(CORE, "src", "presets", "manifest.full.ts");
const CAPABILITIES_DIR = path.join(CORE, "src", "capabilities");

/**
 * The composed entries this gate proves, one row each.
 *
 * 🛑 **It used to be a single HARD-CODED entry**, and that is what made the proof
 * false as soon as a second entry existed: the gate always measured `minimal`, came
 * out green with correct numbers, and had measured nothing of the work. A gate that
 * cannot see its subject is worse than an absent one — it reassures.
 *
 * `minSavingPct` is the entry's OWN floor, set on its first measurement and
 * commented in place. `null` ⟹ the global floor {@link MIN_SAVING_PCT}. ⚠️ A
 * per-entry floor is NOT a ratchet: it detects the collapse of THIS entry's
 * differential (a kernel edge repatriating the excluded capabilities), it does not
 * arbitrate between entries.
 */
const ENTRIES = [
    {
        id: "minimal",
        srcEntry: path.join(CORE, "examples", "minimal", "entry.ts"),
        distDir: path.join(CORE, "examples", "dist", "minimal"),
        bundleFile: path.join(CORE, "examples", "dist", "minimal", "geoleaf.minimal.esm.js"),
        cssFile: path.join(CORE, "examples", "dist", "minimal", "geoleaf.minimal.css"),
        minSavingPct: null,
    },
    {
        id: "slim",
        srcEntry: path.join(CORE, "examples", "slim", "entry.ts"),
        distDir: path.join(CORE, "examples", "dist", "slim"),
        bundleFile: path.join(CORE, "examples", "dist", "slim", "geoleaf.slim.esm.js"),
        cssFile: path.join(CORE, "examples", "dist", "slim", "geoleaf.slim.css"),
        // Floor set on this entry's FIRST measurement, with margin. It embarks 10
        // capabilities against 6 for `minimal`, so its differential is mechanically
        // weaker: applying the global floor to it would have reddened a correct
        // entry. ⚠️ Not a ratchet — do not raise it to follow the day's measurement.
        minSavingPct: 8,
    },
];

/**
 * Minimum credible saving, in percent of the shipped gzipped boot payload.
 *
 * Calibrated on the measured value, with margin — it is a floor that catches a *collapse*
 * of the differential (a kernel edge dragging the excluded capabilities back in), not a
 * ratchet on byte counts. Do not raise it to chase the current number: a legitimate
 * refactor that moves code from a capability into the kernel would then fail the build for
 * the wrong reason. Raise it only when the example deliberately excludes more.
 */
const MIN_SAVING_PCT = 12;

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

/** Capability ids imported as `capabilities/<id>/install.js` by a source file. */
function capabilitiesImportedBy(file) {
    const src = fs.readFileSync(file, "utf8");
    const ids = new Set();
    const re = /capabilities\/([\w-]+)\/install\.js/g;
    let m;
    while ((m = re.exec(src)) !== null) ids.add(m[1]);
    return [...ids];
}

/** Capability directories that own an `install.ts` — used only to warn about strays. */
function capabilityDirsOnDisk() {
    if (!fs.existsSync(CAPABILITIES_DIR)) return [];
    return fs
        .readdirSync(CAPABILITIES_DIR, { withFileTypes: true })
        .filter(
            (d) =>
                d.isDirectory() && fs.existsSync(path.join(CAPABILITIES_DIR, d.name, "install.ts"))
        )
        .map((d) => d.name);
}

/** Source files under `capabilities/<id>/` present in a closure's sourcemaps. */
function capabilityFiles(sources, id) {
    return sources.filter((s) => s.includes(`capabilities/${id}/`));
}

/**
 * The stylesheets that went into an extracted CSS artifact (S6).
 *
 * Symmetric with {@link listEagerSources} for JS, and it works for the same reason: the minified
 * CSS says nothing about what went into it, its sourcemap says everything. Since S6 the CSS is a
 * node of the JS module graph (each `install.ts` does `import "./css/<id>.css"`), so a capability
 * that is not installed contributes no stylesheet — and this is what proves it.
 *
 * @returns {string[]|null} the `sources` of `<cssFile>.map`, or null if there is no map.
 */
function listCssSources(cssFile) {
    const mapFile = `${cssFile}.map`;
    if (!fs.existsSync(mapFile)) return null;
    try {
        const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
        return (map.sources || []).map((s) => s.replace(/\\/g, "/"));
    } catch (_e) {
        return null;
    }
}

/** Capability ids whose CSS lives under `src/capabilities/<id>/css/` — derived, never typed. */
function capabilitiesWithCss() {
    if (!fs.existsSync(CAPABILITIES_DIR)) return [];
    return fs
        .readdirSync(CAPABILITIES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) => {
            const cssDir = path.join(CAPABILITIES_DIR, d.name, "css");
            return fs.existsSync(cssDir) && fs.readdirSync(cssDir).some((f) => f.endsWith(".css"));
        })
        .map((d) => d.name);
}

/** The basenames of a capability's stylesheets — what to look for in a CSS sourcemap. */
function cssFilesOf(id) {
    const cssDir = path.join(CAPABILITIES_DIR, id, "css");
    if (!fs.existsSync(cssDir)) return [];
    return fs.readdirSync(cssDir).filter((f) => f.endsWith(".css"));
}

const fmt = (kb) => (kb == null ? "—" : `${kb.toFixed(1)} KB`);

/**
 * Runs the tree-shaking proof for ONE composed entry.
 *
 * ⚠️ This block used to be a stale COPY of `checkExampleBundle`'s TSDoc — it documented an
 * `opts` parameter this function has never had, which is TS8024 and, more importantly, made
 * the private helper advertise the public function's contract. The two are not the same:
 * `checkExampleBundle` fans out over `ENTRIES` and owns the `opts.log` merge; this one is
 * handed an already-merged logger and judges a single entry.
 *
 * @param {(typeof ENTRIES)[number]} entry The composed entry to judge — its type is DERIVED
 *   from `ENTRIES` rather than restated, so adding a field there cannot leave this stale.
 * @param {{ok: (m: string) => void, err: (m: string) => void, info: (m: string) => void,
 *   warn: (m: string) => void, dim: (m: string) => void}} log The already-merged logger.
 *   Every method is required here: the partial-merge tolerance belongs to the caller.
 * @param {boolean} showList Print every offending file instead of the first four.
 * @returns {boolean} `true` when this entry holds its promise. Bails out early on `false` for
 *   the four conditions that make the proof meaningless rather than merely failed.
 */
function _checkOneEntry(entry, log, showList) {
    // ── The lists, derived from the code that decides them ──
    const universe = capabilitiesImportedBy(MANIFEST_SRC);
    const embarked = capabilitiesImportedBy(entry.srcEntry);
    const excluded = universe.filter((id) => !embarked.includes(id));

    if (universe.length === 0 || embarked.length === 0) {
        log.err(
            `Listes de capacités vides (manifeste: ${universe.length}, exemple: ${embarked.length}) — le parsing des imports \`capabilities/<id>/install.js\` a échoué. La preuve serait vide de sens : ÉCHEC.`
        );
        return false;
    }

    const stray = embarked.filter((id) => !universe.includes(id));
    if (stray.length > 0) {
        log.err(
            `L'exemple embarque ${stray.length} capacité(s) absente(s) du manifeste livré (${stray.join(", ")}) — le manifeste FULL doit être l'union de tout ce qui existe.`
        );
        return false;
    }

    const unshipped = capabilityDirsOnDisk().filter((id) => !universe.includes(id));
    if (unshipped.length > 0) {
        log.warn(
            `${unshipped.length} capacité(s) ont un install.ts mais ne sont PAS dans manifest.full.ts (${unshipped.join(", ")}) — écrites mais jamais livrées.`
        );
    }

    // ── Payloads ──
    const shipped = measureEagerBootAt(SHIPPED_ENTRY, SHIPPED_DIST);
    const example = measureEagerBootAt(entry.bundleFile, entry.distDir);

    if (shipped == null || example == null) {
        const missing = shipped == null ? "dist/geoleaf.esm.js" : "examples/dist/minimal/";
        log.err(
            `Build manquant (${missing}) — lancer \`npm run build\` d'abord. Un gate qui se désarme quand l'artefact manque ne garde rien : ÉCHEC.`
        );
        return false;
    }

    log.info("Charge eager au boot (entrée + clôture des imports STATIQUES) :");
    log.dim(
        `bundle livré  (${String(universe.length).padStart(2)} capacités) : ${fmt(shipped.gz)} gz / ${fmt(shipped.raw)} raw — ${shipped.chunks} chunks`
    );
    log.dim(
        `exemple       (${String(embarked.length).padStart(2)} capacités) : ${fmt(example.gz)} gz / ${fmt(example.raw)} raw — ${example.chunks} chunks`
    );

    const savedGz = shipped.gz - example.gz;
    const savedPct = shipped.gz > 0 ? (savedGz / shipped.gz) * 100 : 0;
    log.dim(`économie                     : ${fmt(savedGz)} gz (${savedPct.toFixed(1)} %)`);
    console.log("");

    // ── 1. EXCLUSION — the load-bearing check ──
    const sources = listEagerSources(entry.bundleFile, entry.distDir);
    if (!sources || sources.length === 0) {
        log.err(
            "Aucune source récupérée depuis les sourcemaps de l'exemple — la preuve est INVÉRIFIABLE. Vérifier que `sourcemap: true` est bien actif sur exampleMinimalConfig."
        );
        return false;
    }

    let allOk = true;
    const leaked = excluded
        .map((id) => ({ id, hits: capabilityFiles(sources, id) }))
        .filter((x) => x.hits.length > 0);

    if (leaked.length === 0) {
        log.ok(
            `Exclusion : aucune des ${excluded.length} capacités exclues n'apparaît dans la clôture statique.`
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
            if (!showList && hits.length > 4)
                log.dim(`    … (+${hits.length - 4}, relancer avec --list)`);
        }
        log.err(
            "Une arête statique ré-ancre ces capacités. Chercher un import depuis le KERNEL vers `capabilities/*` (c'est ce que faisait `shared.module` → pwa/offline, puis `globals.geojson` → vector-tiles), ou un ré-export de façade laissé dans `kernel-exports.ts`."
        );
    }

    // ── Sanity: the embarked ones MUST be there, else the measurement is looking at nothing ──
    const missing = embarked.filter((id) => capabilityFiles(sources, id).length === 0);
    if (missing.length > 0) {
        allOk = false;
        log.err(
            `Sanity : ${missing.length} capacité(s) EMBARQUÉE(S) sont absentes de la clôture (${missing.join(", ")}) — la mesure ne regarde pas le bon artefact, ou l'entrée d'exemple est cassée. Un « tout est exclu » obtenu ainsi ne prouve RIEN.`
        );
    } else {
        log.ok(
            `Sanity : les ${embarked.length} capacités embarquées sont bien présentes (la mesure regarde le bon artefact).`
        );
    }

    // ── 3. CSS — the same promise, for the stylesheet (S6) ──
    //
    // Until S6 the CSS was produced by a PostCSS pipeline running entirely parallel to the module
    // graph, so a bundle that excluded a capability still shipped 100 % of its CSS — and nothing
    // measured it. Now each `install.ts` imports its own stylesheet, so the CSS is a node of the
    // JS graph and tree-shakes with the code. The oracle is the CSS sourcemap: it names every
    // stylesheet that contributed, and a capability that was never installed cannot be in it.
    const shippedCss = listCssSources(SHIPPED_CSS);
    const exampleCss = listCssSources(entry.cssFile);

    if (shippedCss === null || exampleCss === null) {
        allOk = false;
        log.err(
            "Sourcemap CSS absente — la preuve CSS est INVÉRIFIABLE. Vérifier `sourceMap: true` sur les `postcss({extract})` de rollup.config.mjs. Un gate qui se désarme quand la mesure manque ne garde rien."
        );
    } else {
        const withCss = capabilitiesWithCss();
        const excludedWithCss = excluded.filter((id) => withCss.includes(id));
        const inCss = (sources, id) =>
            cssFilesOf(id).filter((f) => sources.some((s) => s.endsWith(`/${f}`) || s === f));

        const cssLeaked = excludedWithCss
            .map((id) => ({ id, hits: inCss(exampleCss, id) }))
            .filter((x) => x.hits.length > 0);

        if (cssLeaked.length === 0) {
            log.ok(
                `CSS : aucune des ${excludedWithCss.length} capacités exclues qui ont du CSS (${excludedWithCss.join(", ")}) n'y contribue une feuille.`
            );
            log.dim(`feuilles : livré ${shippedCss.length} → exemple ${exampleCss.length}`);
        } else {
            allOk = false;
            log.err(
                `CSS : ${cssLeaked.length} capacité(s) exclue(s) contribuent ENCORE leur feuille :`
            );
            for (const { id, hits } of cssLeaked) log.err(`  ${id} — ${hits.join(", ")}`);
            log.err(
                "Le CSS d'une capacité ne doit entrer dans le graphe QUE par son `install.ts` (`import \"./css/<x>.css\"`). Chercher un `@import` depuis une feuille du kernel (src/css/geoleaf-main.css n'importe que du kernel), ou un import CSS depuis un module kernel."
            );
        }

        // Sanity, same shape as for the JS: the embarked ones MUST be there.
        const embarkedWithCss = embarked.filter((id) => withCss.includes(id));
        const cssMissing = embarkedWithCss.filter((id) => inCss(exampleCss, id).length === 0);
        if (cssMissing.length > 0) {
            allOk = false;
            log.err(
                `CSS sanity : ${cssMissing.length} capacité(s) EMBARQUÉE(S) ne contribuent aucune feuille (${cssMissing.join(", ")}) — soit leur \`install.ts\` n'importe pas son CSS, soit la mesure regarde le mauvais artefact.`
            );
        }
    }

    // ── 2. DIFFERENTIAL ──
    const floor = entry.minSavingPct ?? MIN_SAVING_PCT;
    if (savedPct >= floor) {
        log.ok(
            `[${entry.id}] Différentiel : l'entrée pèse ${savedPct.toFixed(1)} % de moins que le bundle livré (plancher ${floor} %).`
        );
    } else {
        allOk = false;
        log.err(
            `[${entry.id}] Différentiel : ${savedPct.toFixed(1)} % d'économie seulement (plancher ${floor} %). L'exclusion peut être formellement correcte tout en n'allégeant rien — vérifier que le kernel n'a pas absorbé le code des capacités retirées.`
        );
    }

    console.log("");
    if (allOk) {
        log.ok(`[${entry.id}] Le core est réellement dégraçable — mesuré, pas supposé.`);
    } else {
        log.err(
            `[${entry.id}] La promesse de tree-shaking n'est PAS tenue en l'état (voir ci-dessus).`
        );
    }
    console.log("");
    return allOk;
}

/**
 * Plays the proof on EACH composed entry of the repo.
 *
 * ⚠️ All entries are played even after a failure: stopping at the first would
 * deprive the reader of the others' verdict, and it is precisely when one entry
 * breaks that one wants to know whether the others hold.
 *
 * @param {object} [opts] Options.
 * @param {object} [opts.log] Partial logger — merged METHOD BY METHOD, never as a
 *   block: `build-deploy.cjs` does not implement `dim`, and an absent method must
 *   not crash the gate.
 * @returns {boolean} `true` if every entry keeps its promise.
 */
function checkExampleBundle(opts = {}) {
    const DEFAULT_LOG = {
        ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
        err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
        info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
        warn: (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
        dim: (m) => console.log(`${C.dim}   ${m}${C.reset}`),
    };
    const log = { ...DEFAULT_LOG };
    for (const k of Object.keys(DEFAULT_LOG)) {
        if (typeof opts.log?.[k] === "function") log[k] = opts.log[k].bind(opts.log);
    }
    const showList = process.argv.includes("--list");

    if (ENTRIES.length === 0) {
        log.err("Aucune entrée composée déclarée — la preuve serait vide de sens : ÉCHEC.");
        return false;
    }

    let allOk = true;
    for (const entry of ENTRIES) {
        if (!_checkOneEntry(entry, log, showList)) allOk = false;
    }
    return allOk;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🌳 Preuve de tree-shaking (entrée d'exemple) ──${C.reset}\n`);
    process.exitCode = checkExampleBundle() ? 0 : 1;
}

module.exports = {
    checkExampleBundle,
    capabilitiesImportedBy,
    // Exported so the GEN-05 guard confronts THIS extractor with the IMPORTED
    // manifest. Without the path, the guard would have to rewrite it — and
    // confronting two extractors where one copied the other's subject proves
    // nothing.
    MANIFEST_SRC,
    capabilityFiles,
    listCssSources,
    capabilitiesWithCss,
    cssFilesOf,
    MIN_SAVING_PCT,
    ENTRIES,
};
