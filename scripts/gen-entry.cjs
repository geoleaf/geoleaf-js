#!/usr/bin/env node
/**
 * @fileoverview GEN-ENTRY — composes a GeoLeaf entry from a capability list,
 * DERIVING everything that can be from the disk rather than copying it.
 *
 * ## What this script exists to prevent
 *
 * Writing an entry by hand means copying four things that already live elsewhere: the
 * installer const's name, the load order, the import path, and the list of
 * re-exportable facades. All four derive — so all four can diverge, and **have**:
 * `kernel-exports.ts` announced "9 capabilities" next to the name of
 * `examples/minimal`, which embarks 6.
 *
 * ## The five derivations, and their single source
 *
 *   1. **The installer const** — `export const <X>` of `capabilities/<id>/install.ts`.
 *   2. **The order** — that of `FULL.capabilities` in `presets/manifest.full.ts`. ⚠️
 *      It is LOAD-BEARING, and that file is the register of reasons: do not copy them
 *      here. The hand-written entries carried a "permalink last" comment explaining
 *      one of them; deriving it makes the comment structurally true instead of
 *      leaving it to vigilance.
 *      🛑 This bullet enumerated "**three** unrelated reasons (Kahn tie-breaking, the
 *      `sharedLifecycle` sequence, **dependency edges**)" until 2026-08-08, and the
 *      three terms carried two defects: the `sharedLifecycle` sequence was
 *      **refuted** (`__tests__/presets/shared-lifecycle-order.test.ts`), and the
 *      "dependency edges" were **never** among the manifest's reasons — they were
 *      invented in `contracts/core-module.contract.ts` and copied here. Two copies of
 *      a list, two drifts: the enumeration is removed, not corrected.
 *   3. **The re-exportable facades** — the INTERSECTION of two derived sets: the
 *      symbols `bundle-esm-entry.ts` re-exports, and those the capability's
 *      `registerGlobals()` mounts (excluding `_privates`). That is what reproduces
 *      the curated subset — `Legend`, `Permalink`, `Share`, `Notifications`, `PWA` —
 *      without a hand table.
 *   4. **The npm subpaths** — `packages/core/package.json`'s `exports` map, INVERTED
 *      on `./dist/esm/<rel>.js`. An npm path hard-written here would be the 5th copy.
 *   5. **The dependencies** — `dependencies` of
 *      `capabilities/<id>/<id>-capability.ts`.
 *
 * ## Two modes, and why both
 *
 *   `--mode=relative` — `../../src/…` imports. What `size:example` compiles, proving
 *                       tree-shaking **on the source graph**.
 *   `--mode=npm`      — `@geoleaf/core/…` imports. What `check-consumer-bundle`
 *                       compiles, proving the **published package** resolves and
 *                       shakes. Two defects invisible from the repo were only seen
 *                       through it.
 *
 * ## Bounded region, not overwritten file
 *
 * The script only rewrites between `@geoleaf:gen:start` and `@geoleaf:gen:end`. Each
 * example's header stays **hand-written**: it carries the reasoning (why those
 * capabilities, what the exclusion proves, which defects the example caught), and a
 * generator cannot write it. Generating the whole file would have destroyed it.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/gen-entry.cjs --caps=legend,filter --mode=relative      # → stdout
 * node scripts/gen-entry.cjs --file=packages/core/examples/minimal/entry.ts        # regenerates
 * node scripts/gen-entry.cjs --file=… --check                          # 0 if current, 1 otherwise
 * node scripts/gen-entry.cjs --caps=offline --check-deps               # fails naming pwa
 * ```
 *
 * @see scripts/check-example-bundle.cjs — ⚠️ this `@see` said "`capabilitiesImportedBy`,
 *      reused here" until 2026-08-08, and it was false: this script only `require()`s
 *      `node:fs` and `node:path`. The repo thus carries **three** independent
 *      extractors of the same array — this one, `capabilitiesImportedBy`
 *      (bundle-check), and the import of `manifest-full-completeness.guard.test.ts`.
 *      GEN-04 holds the first against the third; the second remains uncrossed (a
 *      known follow-up).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "packages", "core");
const SRC = path.join(CORE, "src");
const CAPS_DIR = path.join(SRC, "capabilities");
const MANIFEST_FULL = path.join(SRC, "presets", "manifest.full.ts");
const SHIPPED_ENTRY = path.join(SRC, "bundle-esm-entry.ts");
const CORE_PKG = path.join(CORE, "package.json");

const START = "// @geoleaf:gen:start";
const END = "// @geoleaf:gen:end";

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m" };

// ─── Derivations ──────────────────────────────────────────────────────────────

/** `src/capabilities/` directories carrying an `install.ts`. */
function capabilityDirs() {
    return fs
        .readdirSync(CAPS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(CAPS_DIR, d.name, "install.ts")))
        .map((d) => d.name)
        .sort();
}

/** The installer const exported by `capabilities/<id>/install.ts`. */
function installerName(id) {
    const src = fs.readFileSync(path.join(CAPS_DIR, id, "install.ts"), "utf8");
    const m = src.match(/export const (\w+)\s*:\s*CapabilityInstaller/);
    if (!m) throw new Error(`[GEN-ENTRY] ${id}/install.ts n'exporte aucun CapabilityInstaller.`);
    return m[1];
}

/** Anchor of `manifest.full.ts`'s array. One authority — the error cites it if it moves. */
const MANIFEST_ANCHOR = "capabilities: [";

/**
 * The order of `FULL.capabilities`, as a list of const names.
 *
 * Read from the literal rather than imported: this script is CJS and the manifest is
 * TypeScript with `.js` imports. Importing it would require tsx/jiti and would execute
 * the 21 `install.ts` — including `offline/install.ts`, which drags `geoleaf.sync.ts`
 * and its self-mount on the global. A build script touching no runtime code would
 * execute half of it.
 *
 * ## Comments are removed BEFORE computing the bound — and "before" is the whole point
 *
 * 🛑 **Until 2026-08-08 they were removed AFTER**, and the bound was taken on the RAW
 * text by an `indexOf("],")`. Yet the array carries a comment citing
 * `(deps ["geojson"], like legend and filter)`: its `],` was the first met, the bound
 * fell there, and the array was cut to **16 entries out of 21**. The script then
 * refused to compose `theme-selector`, `vector-tiles`, `profile-switcher`,
 * `language-switcher` and `theme-palette`, asserting they are "absent from
 * FULL.capabilities" — a FALSE assertion, produced by the extractor itself. The
 * header already promised the right move: it described the intent, not what the code
 * did.
 *
 * ⚠️ The line regex excludes `://` (the `[^:]` in front), otherwise an `https://…` in
 * a comment would eat the rest of its line. It thus deliberately differs from
 * `mountedSymbols()`'s and `declaredDeps()`'s, left wide because they operate on
 * URL-free regions — accepted divergence, recorded as a follow-up. ⚠️ And the merely
 * line-ANCHORED form (`/^\s*\/\/…$/gm`) is NOT enough: measured on 08-08, it lets
 * an END-of-line comment through, where a cited installer name would be counted twice
 * (22 instead of 21).
 *
 * The bound is then taken by BRACKET DEPTH, never by `indexOf`: a nested array or an
 * inline object can no longer move it. Guarded by **GEN-04**, which compares this
 * list to the IMPORTED `FULL.capabilities` — the repo's two extractors, face to face.
 */
function manifestOrder() {
    const src = fs.readFileSync(MANIFEST_FULL, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

    const from = code.indexOf(MANIFEST_ANCHOR);
    if (from < 0) {
        throw new Error(
            `[GEN-ENTRY] ancre \`${MANIFEST_ANCHOR}\` introuvable dans ` +
                `${path.relative(ROOT, MANIFEST_FULL)}. Le manifeste a été réécrit — corriger ` +
                `l'ancre, plutôt que de laisser l'extracteur rendre une liste tronquée.`
        );
    }

    let depth = 0;
    let end = -1;
    for (let i = from + MANIFEST_ANCHOR.length - 1; i < code.length; i++) {
        const c = code[i];
        if (c === "[") depth++;
        else if (c === "]" && --depth === 0) {
            end = i;
            break;
        }
    }
    if (end < 0) {
        throw new Error(`[GEN-ENTRY] le tableau \`${MANIFEST_ANCHOR}\` n'est jamais refermé.`);
    }

    const out = [...code.slice(from, end).matchAll(/\b([A-Z][A-Z0-9_]*_INSTALLER)\b/g)].map(
        (m) => m[1]
    );
    // Anti-empty-gate — same class as MFC-03 and GEN-03: an extractor returning `[]`
    // turns every guard built on it GREEN, which is worse than one returning 16.
    if (!out.length) {
        throw new Error(
            `[GEN-ENTRY] \`${MANIFEST_ANCHOR}\` lu VIDE — l'extracteur ne voit plus rien. ` +
                `Une liste vide n'est jamais un état légitime de ce manifeste.`
        );
    }
    return out;
}

/** Symbols re-exported by the shipped entry → source path relative to `src/`. */
function shippedFacades() {
    const src = fs.readFileSync(SHIPPED_ENTRY, "utf8");
    const out = new Map();
    for (const m of src.matchAll(/^export \{ (\w+) \} from "\.\/([^"]+)";/gm)) {
        out.set(m[1], m[2]);
    }
    return out;
}

/** Public symbols mounted by a capability's `registerGlobals()` (excluding `_privates`). */
function mountedSymbols(id) {
    const src = fs.readFileSync(path.join(CAPS_DIR, id, "install.ts"), "utf8");
    const from = src.indexOf("registerGlobals(");
    if (from < 0) return [];
    const body = src.slice(from, src.indexOf("\n    },", from));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    return [...code.matchAll(/\bgl\.([A-Za-z]\w*)\s*=/g)].map((m) => m[1]);
}

/** `dependencies` declared by `capabilities/<id>/<id>-capability.ts`. */
function declaredDeps(id) {
    const file = path.join(CAPS_DIR, id, `${id}-capability.ts`);
    if (!fs.existsSync(file)) return [];
    const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const m = src.match(/^\s*dependencies:\s*\[([^\]]*)\]/m);
    if (!m) return [];
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * INVERSE map of `package.json#exports`: `dist/esm/<rel>.js` → npm subpath.
 *
 * Globbed entries (`./capabilities/*`) are converted to prefixes. Without this
 * inversion, npm mode would hard-write its paths — the copy this script exists to
 * remove.
 */
function npmSubpathResolver() {
    const exp = JSON.parse(fs.readFileSync(CORE_PKG, "utf8")).exports;
    const exact = new Map();
    const globs = [];
    for (const [key, val] of Object.entries(exp)) {
        const target = typeof val === "string" ? val : val?.import;
        if (typeof target !== "string" || !target.startsWith("./dist/esm/")) continue;
        const rel = target.slice("./dist/esm/".length);
        if (key.includes("*")) globs.push({ key, rel });
        else if (!exact.has(rel)) exact.set(rel, key);
    }
    return (srcRel) => {
        const js = srcRel.replace(/\.ts$/, ".js");
        if (exact.has(js)) return `@geoleaf/core${exact.get(js).slice(1)}`;
        for (const g of globs) {
            const [pre, post] = g.rel.split("*");
            if (js.startsWith(pre) && js.endsWith(post)) {
                const star = js.slice(pre.length, js.length - post.length);
                return `@geoleaf/core${g.key.replace("*", star).slice(1)}`;
            }
        }
        return null;
    };
}

// ─── Generation ───────────────────────────────────────────────────────────────

/**
 * Builds an entry's generated region.
 *
 * @param {{caps: string[], mode: "relative"|"npm", id: string}} spec
 * @returns {string} the body, without the markers
 */
function buildRegion({ caps, mode, id }) {
    const npm = npmSubpathResolver();
    const rel = (p) =>
        mode === "npm" ? (npm(p) ?? _fail(p)) : `../../src/${p.replace(/\.ts$/, ".js")}`;
    const _fail = (p) => {
        throw new Error(
            `[GEN-ENTRY] aucun sous-chemin npm n'expose \`src/${p}\` — la carte \`exports\` de ` +
                `packages/core/package.json doit le déclarer avant qu'une entrée en mode npm ` +
                `puisse l'importer. (Cas connu : \`pwa\`, dont la façade n'a pas de sous-chemin.)`
        );
    };

    const kernelSideEffects =
        mode === "npm"
            ? ['import "@geoleaf/core/globals";', 'import "@geoleaf/core/helpers";']
            : [
                  'import "../../src/globals/globals.js";',
                  'import "../../src/app/app-namespace.js";',
              ];
    const contractPath =
        mode === "npm"
            ? "@geoleaf/core/contracts/preset.contract.js"
            : "../../src/contracts/preset.contract.js";
    const bootPath = mode === "npm" ? "@geoleaf/core/boot" : "../../src/app/boot-install.js";
    const kernelPath = mode === "npm" ? "@geoleaf/core/kernel" : "../../src/kernel-exports.js";

    // The shipped manifest's order, restricted to the requested capabilities.
    const order = manifestOrder();
    const byInstaller = new Map(caps.map((c) => [installerName(c), c]));
    const ordered = order.filter((n) => byInstaller.has(n)).map((n) => byInstaller.get(n));
    const unknown = caps.filter((c) => !ordered.includes(c));
    if (unknown.length) {
        throw new Error(
            `[GEN-ENTRY] capacité(s) absente(s) de FULL.capabilities : ${unknown.join(", ")}. ` +
                `Une entrée ne peut pas embarquer ce que le manifeste livré n'installe pas.`
        );
    }

    // The dependency graph is checked HERE, on the EMISSION path, and not only in
    // `main()`.
    //
    // 🛑 `main()`'s header asserted "the check ALWAYS runs, not only under
    // `--check-deps`" until 2026-08-08, while it only lived in the CLI. The Vitest
    // guard, for its part, calls `buildRegion` — so the repo's only real edge
    // (`offline → pwa`) was traversed by NO automatic execution. Emitting an entry
    // with an incomplete graph means producing the defect instead of flagging it: the
    // check belongs to the emission point, and `main()` only keeps its green verdict.
    const missingDeps = checkDeps(caps);
    if (missingDeps.length) {
        throw new Error(
            `[GEN-ENTRY] dépendance(s) de capacité non embarquée(s) : ${missingDeps.join(", ")}. ` +
                `\`ICapabilityDeclaration.dependencies\` n'est lu nulle part au runtime — c'est ` +
                `ici, au build, qu'il devient utile. Ajouter la capacité manquante à --caps.`
        );
    }

    const shipped = shippedFacades();
    const facadeLines = [];
    for (const cap of ordered) {
        for (const sym of mountedSymbols(cap)) {
            if (!shipped.has(sym)) continue; // non-re-exportable facade — mounted on GeoLeaf.* only
            facadeLines.push(`export { ${sym} } from "${rel(shipped.get(sym))}";`);
        }
    }

    const L = [];
    L.push("// ── 1. Kernel side-effects — the two the shipped entry imports too ───────────");
    L.push(...kernelSideEffects);
    L.push("");
    L.push("// ── 2. The manifest — the capabilities THIS bundle embarks ───────────────────");
    L.push(`import type { PresetManifest } from "${contractPath}";`);
    for (const cap of ordered) {
        L.push(`import { ${installerName(cap)} } from "${rel(`capabilities/${cap}/install.ts`)}";`);
    }
    L.push("");
    L.push(`const MANIFEST: PresetManifest = {`);
    L.push(`    id: ${JSON.stringify(id)},`);
    L.push(`    capabilities: [`);
    for (const cap of ordered) L.push(`        ${installerName(cap)},`);
    L.push(`    ],`);
    L.push(`};`);
    L.push("");
    L.push("// ── 3. Install the boot, bound to this manifest ──────────────────────────────");
    L.push(`import { installBoot } from "${bootPath}";`);
    L.push("");
    L.push("installBoot(MANIFEST);");
    L.push("");
    L.push("// ── 4. Surface ESM publique ──────────────────────────────────────────────────");
    L.push(`export * from "${kernelPath}";`);
    if (facadeLines.length) {
        L.push("");
        L.push(...facadeLines);
    }
    L.push("");
    L.push('export default typeof window !== "undefined"');
    L.push('    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]');
    L.push("    : {};");
    return L.join("\n");
}

/** `--check-deps`: every declared dependency of an embarked capability must be too. */
function checkDeps(caps) {
    const missing = [];
    for (const cap of caps) {
        for (const dep of declaredDeps(cap)) {
            if (!caps.includes(dep)) missing.push(`${cap} → ${dep}`);
        }
    }
    return missing;
}

/** Reads an entry file's `@geoleaf:gen:start caps=… mode=… id=…` directive. */
function readSpec(file) {
    const src = fs.readFileSync(file, "utf8");
    const line = src.split("\n").find((l) => l.trimStart().startsWith(START));
    if (!line) throw new Error(`[GEN-ENTRY] ${file} ne porte pas de marqueur ${START}.`);
    const get = (k) => (line.match(new RegExp(`${k}=([\\w,-]+)`)) ?? [])[1];
    const caps = (get("caps") ?? "").split(",").filter(Boolean);
    if (!caps.length) throw new Error(`[GEN-ENTRY] ${file} : marqueur sans \`caps=\`.`);
    return { caps, mode: get("mode") ?? "relative", id: get("id") ?? "custom", src, line };
}

/** Replaces a file's bounded region, without touching what surrounds it. */
function spliceRegion(src, startLine, region) {
    const i = src.indexOf(startLine);
    const j = src.indexOf(END, i);
    if (j < 0) throw new Error(`[GEN-ENTRY] marqueur ${END} manquant.`);
    return src.slice(0, i) + startLine + "\n\n" + region + "\n\n" + src.slice(j);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
    const arg = (k) =>
        (argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=").slice(1).join("=");
    const has = (k) => argv.includes(`--${k}`);

    const file = arg("file");
    const spec = file
        ? readSpec(path.resolve(ROOT, file))
        : {
              caps: arg("caps").split(",").filter(Boolean),
              mode: arg("mode") || "relative",
              id: arg("id") || "custom",
          };

    if (!spec.caps.length) {
        console.error("[GEN-ENTRY] rien à faire : passer --caps=<a,b,c> ou --file=<entry.ts>.");
        return 2;
    }

    const known = capabilityDirs();
    const strays = spec.caps.filter((c) => !known.includes(c));
    if (strays.length) {
        console.error(
            `${C.red}❌ [GEN-ENTRY] capacité(s) inconnue(s) : ${strays.join(", ")}${C.reset}`
        );
        console.error(`${C.dim}   connues : ${known.join(", ")}${C.reset}`);
        return 1;
    }

    // The substantive check lives in `buildRegion` (see the note in place) — the
    // EMISSION point, hence the only place making it inevitable, Vitest guard
    // included. What remains here is the CLI side: a coloured message, and
    // `--check-deps`'s green verdict, which emits nothing and would thus never have
    // reached `buildRegion`.
    const missing = checkDeps(spec.caps);
    if (missing.length) {
        console.error(
            `${C.red}❌ [GEN-ENTRY] dépendance(s) de capacité non embarquée(s) : ${missing.join(", ")}${C.reset}`
        );
        console.error(
            `${C.dim}   \`ICapabilityDeclaration.dependencies\` n'est lu nulle part au runtime —\n` +
                `   c'est ici, au build, qu'il devient utile. Ajouter la capacité manquante à --caps.${C.reset}`
        );
        return 1;
    }
    if (has("check-deps")) {
        console.log(
            `${C.green}✅ [GEN-ENTRY] graphe de dépendances complet pour ${spec.caps.join(", ")}${C.reset}`
        );
        return 0;
    }

    const region = buildRegion(spec);

    if (!file) {
        console.log(region);
        return 0;
    }

    const abs = path.resolve(ROOT, file);
    const next = spliceRegion(spec.src, spec.line, region);
    if (has("check")) {
        if (next === spec.src) {
            console.log(`${C.green}✅ [GEN-ENTRY] ${file} est à jour${C.reset}`);
            return 0;
        }
        console.error(
            `${C.red}❌ [GEN-ENTRY] ${file} a DÉRIVÉ de ce que le générateur produit.${C.reset}`
        );
        console.error(`${C.dim}   Régénérer : node scripts/gen-entry.cjs --file=${file}${C.reset}`);
        return 1;
    }
    fs.writeFileSync(abs, next);
    console.log(
        `${C.green}✅ [GEN-ENTRY] ${file} régénéré (${spec.caps.length} capacités, mode ${spec.mode})${C.reset}`
    );
    return 0;
}

module.exports = { buildRegion, checkDeps, readSpec, spliceRegion, declaredDeps, capabilityDirs };

if (require.main === module) process.exit(main(process.argv.slice(2)));
