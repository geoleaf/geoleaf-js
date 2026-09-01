#!/usr/bin/env node
/*!
 * probe-typedoc-surface.mjs
 *
 * Probe of the surface TypeDoc would render if widened — the instrument of the
 * documentation overhaul's sizing step.
 *
 * ## Why it is VERSIONED although it guards nothing
 *
 * It is not a gate and has nothing to gate: it does not judge, it **measures**. It is
 * here because the plan now carries its numbers — 2,829 pages for the 14 packages, 75
 * of the 92 facade keys rendered, 132 members under `Helpers` and 0 under `CONSTANTS` —
 * and a number without a command that reprints it is precisely what this overhaul
 * hunts. The repo's principle: "every verifiable fact carries its verifier, or it is
 * not written" — a number that cannot be re-measured does not expire: it fossilizes. An
 * earlier pass removed three numbers for that exact reason ("89-92 %", "~173 exports",
 * "1,582 TSDoc") — it cannot write four new ones of the same regime.
 *
 * DELIBERATELY outside `ci:local`: converting the 14 packages takes a few seconds and
 * protects nothing. The durable property, when it exists, will be the committed
 * surface manifest and its freshness gate — not this probe.
 *
 * ## What it measures, and which question each answers
 *
 *   - VOLUME (modules, reflections, pages) → "can the rendering be committed?" The
 *     answer is no, and it is quantified here: see also determinism below.
 *   - TypeDoc's 4 `validation` families → the falsifiable criteria replacing "is the
 *     output usable?", which is not a criterion.
 *   - C6, the `EXPECTED_FACADE_KEYS` coverage → the only number saying whether the
 *     RUNTIME surface (the one `API_REFERENCE.md` documents, and the ESM entry does
 *     not render) is derivable. The criterion that decides the whole step.
 *   - The member count PER KEY → ⚠️ without it, a global "75/92" would have had two
 *     documents deleted whose facade renders NO members (`CONSTANTS`, `Log`). The
 *     average hid the defect; the breakdown is what showed it.
 *   - The manifest's determinism → the property the HTML rendering fails: TypeDoc
 *     engraves `git rev-parse HEAD` into it (29 files out of 54 of the current
 *     output), so a fixed point is impossible there.
 *
 * ## What it never writes
 *
 * Nothing in the repo. The rendering is not produced at all (we stop after
 * `convert()`), and the manifests go under `PROBE_OUT`, outside the default tree.
 *
 * Usage : node scripts/probe-typedoc-surface.mjs
 *         PROBE_OUT=/tmp/ma-sonde node scripts/probe-typedoc-surface.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// The registry, never a hard-coded `packages/core`: a hard-coded path does not break
// on a move, it silently stops matching and the probe would come out "green" having
// converted nothing. `requireByDirName` throws if the package cannot be found.
const registry = require_(path.join(ROOT, "scripts/lib/packages.cjs"));
const CORE = registry.requireByDirName("core");

// TypeDoc is only installed in the core — resolved from the registry, same reason.
const TYPEDOC = path.join(CORE.absDir, "node_modules/typedoc/dist/index.js");
if (!fs.existsSync(TYPEDOC)) {
    console.error(
        `✗ TypeDoc introuvable sous ${path.relative(ROOT, TYPEDOC)} — lancer \`npm install\`.`
    );
    process.exit(2);
}
const { Application, TSConfigReader, TypeDocReader, ReflectionKind } = await import(TYPEDOC);

const OUT = process.env.PROBE_OUT || path.join(os.tmpdir(), "geoleaf-probe-typedoc");
fs.mkdirSync(OUT, { recursive: true });

/** Files a TypeDoc warning into a family — we count, we do not read. */
function classify(message) {
    const s = String(message);
    if (/not included in the documentation/.test(s)) return "NOT_EXPORTED";
    if (/does not have any documentation/.test(s)) return "NOT_DOCUMENTED";
    if (/Failed to resolve link|Failed to find/.test(s)) return "INVALID_LINK";
    const tag = s.match(/unknown block tag (@[\w-]+)/);
    if (tag) return `UNKNOWN_TAG ${tag[1]}`;
    return "AUTRE: " + s.slice(0, 70);
}

const COMMON = {
    skipErrorChecking: true,
    logLevel: "Warn",
    readme: "none",
    excludeExternals: true, // without it, `Window` drags in ~220 lib.dom members
    excludePrivate: true,
    excludeInternal: true,
    exclude: ["**/__tests__/**", "**/__mocks__/**", "**/*.test.ts", "**/*.spec.ts"],
    validation: {
        notExported: true,
        invalidLink: true,
        rewrittenLink: true,
        notDocumented: true,
        unusedMergeModuleWith: true,
    },
};

async function probe(label, options) {
    const buckets = {};
    const app = await Application.bootstrapWithPlugins(options, [
        new TypeDocReader(),
        new TSConfigReader(),
    ]);
    app.logger.warn = (m) => {
        const k = classify(m);
        buckets[k] = (buckets[k] || 0) + 1;
    };

    const project = await app.convert();
    if (!project) {
        console.error(`✗ ${label} — convert() n'a rien rendu.`);
        process.exitCode = 2;
        return null;
    }
    app.validate(project);

    // The `kind` router is the default HTML rendering's: buildPages gives the EXACT
    // number of files TypeDoc would write, without writing a single one.
    const Router = app.renderer.routers.get("kind");
    const pages = new Router(app).buildPages(project).length;

    // The manifest: one line per reflection, sorted. The shape retained for the
    // freshness gate — no SHA, no date, no absolute path, hence a pure function of the
    // source. Asserted below, not assumed.
    const lines = [];
    project.traverse(function walk(r) {
        lines.push(`${ReflectionKind[r.kind]} | ${r.getFullName()}`);
        r.traverse(walk);
        return true;
    });
    lines.sort();

    const modules = (project.children || []).map((c) => c.name);
    const dups = [...new Set(modules.filter((x, i) => modules.indexOf(x) !== i))];

    console.log(`\n── ${label} ${"─".repeat(Math.max(0, 56 - label.length))}`);
    console.log(
        `   modules    : ${modules.length}${dups.length ? `   ⚠️ DUPLIQUÉS : ${dups.join(", ")}` : ""}`
    );
    console.log(`   réflexions : ${lines.length}`);
    console.log(`   pages HTML : ${pages}`);
    for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(v).padStart(6)}  ${k}`);
    }

    const file = path.join(OUT, `${label}.manifest.txt`);
    fs.writeFileSync(file, lines.join("\n") + "\n");
    return { label, pages, lines, modules, file };
}

console.log("═".repeat(72));
console.log("SONDE TypeDoc — surface élargie · AUCUNE écriture dans le dépôt");
console.log(`sorties : ${OUT}`);
console.log("═".repeat(72));

const coreTs = path.join(CORE.absDir, "tsconfig.json");

// A. The current state — `resolve` on the ESM entry. The comparison point, and the
//    measurement of the cause: this strategy is what renders 0 facade keys.
const actuel = await probe("A-actuel-resolve", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src/bundle-esm-entry.ts")],
    entryPointStrategy: "resolve",
    tsconfig: coreTs,
});

// B. Widened — `expand` on src/. ⚠️ `global.d.ts` enters ON ITS OWN: TypeDoc's filter
//    accepts `.ts`, hence `.d.ts`. The plan asked to add it as an entryPoint; the
//    counter-trial C shows what that produces.
const elargi = await probe("B-elargi-expand-src", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src")],
    entryPointStrategy: "expand",
    tsconfig: coreTs,
});

// C. Counter-trial of the trap. Must produce a DUPLICATED module named `global` — the
//    assertion that justifies the fix brought to the execution order.
const piege = await probe("C-piege-global-en-entryPoint", {
    ...COMMON,
    entryPoints: [path.join(CORE.absDir, "src"), path.join(CORE.absDir, "src/global.d.ts")],
    entryPointStrategy: "expand",
    tsconfig: coreTs,
});

// D. The 13 plugins in `packages` mode, WITHOUT any plugin typedoc.json — which
//    matters, since `lib/generated-artifacts.cjs` THROWS for any package typedoc.json
//    lacking `out`.
const pluginDirs = registry
    .all()
    .filter((p) => p.dir.replace(/\\/g, "/").includes("packages/plugins/"))
    .map((p) => p.absDir);
const plugins = await probe("D-plugins-packages", {
    ...COMMON,
    entryPoints: pluginDirs,
    entryPointStrategy: "packages",
    packageOptions: { ...COMMON, entryPoints: ["src"], entryPointStrategy: "expand" },
    name: "GeoLeaf Plugins",
});

// ── C6 — is the runtime surface derivable? ──────────────────────────────────────────────
const { EXPECTED_FACADE_KEYS } = await import(path.join(ROOT, "scripts/lib/namespace-surface.mjs"));

console.log("\n" + "═".repeat(72));
console.log("C6 — couverture des EXPECTED_FACADE_KEYS dans la surface rendue");
console.log("═".repeat(72));

const seenIn = (r) => {
    const blob = r.lines.join("\n");
    return EXPECTED_FACADE_KEYS.filter((k) =>
        new RegExp(`GeoLeafGlobal\\.${k}(\\b|$)`, "m").test(blob)
    );
};
for (const r of [actuel, elargi].filter(Boolean)) {
    const seen = seenIn(r);
    console.log(
        `   ${r.label.padEnd(24)} ${seen.length}/${EXPECTED_FACADE_KEYS.length} clés rendues`
    );
}

// ⚠️ The breakdown PER KEY, and not the total alone. And it must distinguish TWO cases
// that "0 members under the facade" conflates — this probe's first version conflated
// them, and the wrong number left for the plan before being caught up:
//
//   (i)  the key is declared through a NAMED TYPE (`Layers?: LayerDataApi`): TypeDoc
//        renders the members at the DECLARATION SITE, not under the facade. The
//        document is derivable — the reader follows a clickable reference. Not a
//        defect.
//   (ii) the key has members NOWHERE (`CONSTANTS = Object.freeze({…})`,
//        `Cluster = buildPublicApi()`): the inferred type is opaque to TypeDoc. There,
//        a document describing that facade has NO replacement, and deleting it would
//        lose its content.
//
// Only (ii) blocks. Conflating the two over-counts the blockage by a factor of ~3.
if (elargi) {
    const blob = elargi.lines.join("\n");
    const decl = fs.readFileSync(path.join(CORE.absDir, "src/global.d.ts"), "utf8");

    /** The type name through which a facade key is declared, if there is one. */
    function declaredTypeName(key) {
        const m = decl.match(new RegExp(`^\\s+${key}\\??\\s*:\\s*([^;]+);`, "m"));
        if (!m) return null;
        const t = m[1].trim();
        // `typeof import("…").X` / `import("…").X` → X; `Foo` → Foo. An inline `{ … }`
        // has no name, and that is precisely the case that renders its members under
        // the facade.
        const viaImport = t.match(/import\([^)]*\)\.([A-Za-z_]\w*)/);
        if (viaImport) return viaImport[1];
        const bare = t.match(/^([A-Za-z_]\w*)$/);
        return bare ? bare[1] : null;
    }

    const routees = [];
    const opaques = [];
    for (const k of seenIn(elargi)) {
        const direct = (blob.match(new RegExp(`GeoLeafGlobal\\.${k}\\.`, "g")) || []).length;
        if (direct > 0) continue;
        const t = declaredTypeName(k);
        const ailleurs = t ? (blob.match(new RegExp(`\\b${t}\\.[A-Za-z_]`, "g")) || []).length : 0;
        (ailleurs > 0 ? routees : opaques).push(
            `${k}${t ? `→${t}` : ""}${ailleurs ? ` (${ailleurs})` : ""}`
        );
    }

    console.log(
        `\n   ℹ ${routees.length} façade(s) rendue(s) AILLEURS qu'in situ — dérivables, le lecteur`
    );
    console.log(`     suit un type nommé : ${routees.join(", ") || "(aucune)"}`);
    console.log(
        `\n   ⚠️ ${opaques.length} façade(s) dont les membres ne sont rendus NULLE PART — un`
    );
    console.log(
        `      document qui les décrit ne peut PAS être supprimé : ${opaques.join(", ") || "(aucune)"}`
    );

    const abs = EXPECTED_FACADE_KEYS.filter((k) => !seenIn(elargi).includes(k));
    console.log(
        `\n   ℹ ${abs.length} clé(s) absente(s), dont ${abs.filter((k) => k.startsWith("_")).length} ` +
            `préfixée(s) \`_\` (dette service-locator, hors namespace par décision)`
    );
    console.log(
        `   ℹ Table/Geocoding/Popup dans EXPECTED_FACADE_KEYS ? ` +
            ["Table", "Geocoding", "Popup"]
                .map((k) => `${k}=${EXPECTED_FACADE_KEYS.includes(k)}`)
                .join(" ")
    );
}

// ── Determinism — the property the RENDERING fails and the manifest holds ───────────────
console.log("\n" + "═".repeat(72));
console.log("DÉTERMINISME du manifeste (le rendu HTML, lui, grave le SHA de HEAD)");
console.log("═".repeat(72));
let impur = 0;
for (const r of [actuel, elargi, piege, plugins].filter(Boolean)) {
    const t = fs.readFileSync(r.file, "utf8");
    const sha = (t.match(/\b[a-f0-9]{40}\b/g) || []).length;
    const abs = (t.match(/\/(home|Users)\/[^\s|]+/g) || []).length;
    const dates = (t.match(/\b20\d\d-\d\d-\d\d\b/g) || []).length;
    if (sha || abs || dates) impur++;
    console.log(`   ${r.label.padEnd(30)} SHA=${sha}  chemins_abs=${abs}  dates=${dates}`);
}
console.log(
    impur === 0
        ? "   ✓ aucun manifeste ne contient de SHA, de date ni de chemin absolu."
        : `   ✗ ${impur} manifeste(s) impur(s) — le régime de gate du §Fraîcheur ne tient plus.`
);

if (elargi && plugins) {
    console.log("\n" + "═".repeat(72));
    console.log(
        `TOTAL 14 paquets : ${elargi.pages + plugins.pages} pages HTML · ` +
            `manifeste ${elargi.lines.length + plugins.lines.length} lignes`
    );
    console.log("═".repeat(72));
}
