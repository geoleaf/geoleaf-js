#!/usr/bin/env node
/**
 * GeoLeaf plugin scaffold generator (Plugin Contract v1, S14).
 *
 * Copies packages/_plugin-template/ into packages/plugins/<name>/, substitutes
 * placeholders, strips flag-gated blocks/files, then runs structural
 * PC-01…PC-12 self-checks on the result, plus INV-CONFIG on the profile branch.
 *
 * ⚠️ This header said `packages/plugin-<name>/` until 31/07/2026 — the pre-ARCHI-S10 layout,
 * contradicting the code 160 lines below, which carries its own comment explaining the move.
 * The same stale path lived in `_plugin-template/README.template.md`. Three copies of one
 * fact, two of them wrong, and nothing could see it: an emitted path is not a link.
 *
 * Every plugin is MIT, published to npmjs with public access — the template
 * carries the licence itself, and there is no variant to choose.
 *
 * Usage:
 *   node scripts/create-plugin.cjs <name> [--ui] [--i18n] [--map]
 *
 * Zero runtime dependencies.
 *
 * @version 1.0.0
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT, "packages", "_plugin-template");

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
};
const log = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    warn: (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
};

// ── argv parsing ───────────────────────────────────────────────────────────
function parseArgs(argv) {
    const positional = [];
    const flags = { ui: false, i18n: false, map: false };
    for (const arg of argv) {
        if (arg === "--ui") flags.ui = true;
        else if (arg === "--i18n") flags.i18n = true;
        else if (arg === "--map") flags.map = true;
        else if (arg.startsWith("--")) {
            log.err(`Unknown flag: ${arg}`);
            process.exit(1);
        } else positional.push(arg);
    }
    return { name: positional[0], flags };
}

function pascalCase(kebab) {
    return kebab
        .split("-")
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
}

// ── flag-gated block stripping ─────────────────────────────────────────────
// Removes /* <flag> */ … /* </flag> */ (and content) when the flag is OFF;
// removes just the delimiters when ON.
function applyGatedBlocks(text, flags) {
    const TAGS = ["ui", "i18n", "map"];
    for (const tag of TAGS) {
        const on = flags[tag];
        const open = `/* <${tag}> */`;
        const close = `/* </${tag}> */`;
        const re = new RegExp(
            `[ \\t]*${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}[ \\t]*\\n?`,
            "g"
        );
        if (on) {
            text = text.split(open).join("").split(close).join("");
        } else {
            text = text.replace(re, "");
        }
    }
    return text;
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── placeholder substitution ───────────────────────────────────────────────
function substitute(text, ctx) {
    return text
        .split("__PLUGIN_PKG__")
        .join(ctx.pkg)
        .split("__PLUGIN_NAMESPACE__")
        .join(ctx.namespace)
        .split("__PLUGIN_NAME__")
        .join(ctx.name);
}

// ── which template files to skip per flag ──────────────────────────────────
function shouldSkip(relPath, flags) {
    const p = relPath.replace(/\\/g, "/");
    if (p === "README.template.md") return true; // template-only doc
    // ⚠️ `src/config.ts` was in this list until 08/08/2026, and it did not belong there.
    // Stylesheets and their ambient declaration ARE UI-only; a config reader is not — every
    // plugin has a `modules.<id>` branch, `enabled` first among them. A plugin scaffolded
    // without `--ui` was therefore born with NO way to read its own configuration, and the
    // omission was silent: nothing imports `config.ts` in the template, so its absence broke
    // no build. The UI-only part of that file (`showButton`) is gated by `/* <ui> */` blocks
    // instead, which is what the block mechanism is for.
    if (!flags.ui && (p.startsWith("src/css/") || p === "src/css.d.ts")) return true;
    if (!flags.i18n && p.startsWith("src/lang/")) return true;
    return false;
}

// ── recursive copy with transform ──────────────────────────────────────────
function copyDir(srcDir, destDir, ctx, flags) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const rel = path.relative(TEMPLATE_DIR, srcPath);
        if (shouldSkip(rel, flags)) continue;
        // `README.plugin.md` is the template OF THE GENERATED PLUGIN's readme, and it lands
        // as `README.md`. It is a distinct file from `README.template.md`, which documents
        // the scaffold itself and is skipped above.
        //
        // ⚠️ It was missing entirely until 26/08/2026, and nothing said so: a scaffolded
        // plugin was born WITHOUT a readme, `create-plugin.cjs` exited 0, and the two gates
        // that would have caught it (`NPMDOC-02`, `PRC-01`) were not in the scaffold's
        // verification channel. Its npm page would have read "no README".
        const destName =
            entry.name === "README.plugin.md"
                ? "README.md"
                : entry.name.split("__PLUGIN_NAME__").join(ctx.name);
        const destPath = path.join(destDir, destName);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, ctx, flags);
        } else {
            let content = fs.readFileSync(srcPath, "utf8");
            content = applyGatedBlocks(content, flags);
            content = substitute(content, ctx);
            fs.writeFileSync(destPath, content);
        }
    }
}

// ── structural self-validation (PC-01…PC-12 subset + INV-CONFIG) ───────────
function selfValidate(destDir, ctx) {
    const problems = [];
    const entry = path.join(destDir, "src", "entry.ts");
    if (!fs.existsSync(entry)) problems.push("PC-01 missing src/entry.ts");
    else {
        const e = fs.readFileSync(entry, "utf8");
        if (!/plugins\s*\??\.\s*register\s*(?:\?\.)?\s*\(/.test(e))
            problems.push("PC-02 entry.ts does not call plugins.register()");
        if (!e.includes("__GEOLEAF_VERSION__")) problems.push("PC-11 missing version token");
        if (/\brequire\s*\(/.test(e) || /\bmodule\.exports\b/.test(e))
            problems.push("PC-04 CommonJS syntax in entry.ts");
        // INV-CONFIG — every `profileKey` must sit in the plugin's OWN `modules.<id>` branch,
        // the one `config.ts` reads. The invariant is frozen (PLUGIN_ARCHITECTURE_SPEC §5) but
        // it is the only line of the §9 checklist with no executable `PC-` check next to it,
        // and that is exactly how the template drifted: it declared its button under
        // `ui.show<Namespace>` until 08/08/2026 — a key that did not even share the casing of
        // the config one — so a scaffolded plugin's button could not be switched on from the
        // config its own file documented. Nothing rejected it, here or in CI.
        //
        // ⚠️ This check lives at SCAFFOLD time only, on purpose. Four shipped plugins
        // (geocoding, measure, print, editor) are still on `ui.show*`; promoting it to a
        // repo-wide PC check in verify-plugin-contract.cjs must come WITH their migration,
        // or the gate is born red. Both are tracked together in the permanent registry.
        const configBranch = `modules.${ctx.name}.`;
        for (const m of e.matchAll(/profileKey\s*:\s*["'`]([^"'`]+)["'`]/g)) {
            if (!m[1].startsWith(configBranch))
                problems.push(
                    `INV-CONFIG profileKey "${m[1]}" lies outside the plugin's own profile ` +
                        `branch — expected a key under "${configBranch}" ` +
                        `(e.g. "${configBranch}showButton"). See PLUGIN_ARCHITECTURE_SPEC §5.`
                );
        }
    }
    const pkgPath = path.join(destDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.type !== "module") problems.push('PC-05 package.json type must be "module"');
    if (pkg.name !== ctx.pkg) problems.push(`PC-05 package name ${pkg.name} != ${ctx.pkg}`);
    if (!/^\d+\.\d+\.\d+/.test(pkg.version)) problems.push("PC-05 package version not SemVer");
    if (!pkg.license) problems.push("PC-05 package license missing");
    const tests = path.join(destDir, "src", "__tests__");
    if (!fs.existsSync(tests)) problems.push("PC-09 missing src/__tests__/");
    return problems;
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
    const { name, flags } = parseArgs(process.argv.slice(2));

    if (!name) {
        log.err("Usage: node scripts/create-plugin.cjs <name> [--ui] [--i18n] [--map]");
        process.exit(1);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        log.err(`Invalid plugin name "${name}" — use kebab-case (e.g. heatmap, my-layer).`);
        process.exit(1);
    }
    // Emit under packages/plugins/, else the scaffold recreates the old tree at
    // the first generated plugin.
    //
    // ⚠️ WITHOUT the `plugin-` prefix. The 13 directories were renamed
    // (`plugin-storage` → `storage`), and this scaffold stayed on the old form:
    // the next generated plugin would have landed in
    // `packages/plugins/plugin-<name>`, alone of its kind. The workspace glob
    // would still have caught it — so no gate would have reddened — but
    // `registry.requireByDirName("<name>")` would have thrown, and that is the
    // function the other scripts now go through.
    //
    // The path stays literal here, and it is the only place where that is right:
    // the package does not exist yet, there is nothing to resolve. What the
    // registry validates is the AFTER — hence the output check below.
    const destRel = path.posix.join("packages", "plugins", name);
    const destDir = path.join(ROOT, "packages", "plugins", name);
    if (fs.existsSync(destDir)) {
        log.err(`${destRel} already exists — aborting.`);
        process.exit(1);
    }
    if (!fs.existsSync(TEMPLATE_DIR)) {
        log.err(`Template not found at ${path.relative(ROOT, TEMPLATE_DIR)}.`);
        process.exit(1);
    }

    const ctx = {
        name,
        namespace: pascalCase(name),
        pkg: `@geoleaf-plugins/${name}`,
    };

    log.info(`Scaffolding plugin "${name}" (ui=${flags.ui}, i18n=${flags.i18n}, map=${flags.map})`);
    copyDir(TEMPLATE_DIR, destDir, ctx, flags);
    log.ok(`Created ${destRel}/`);

    const problems = selfValidate(destDir, ctx);
    if (problems.length) {
        log.err("Generated plugin failed structural self-checks:");
        for (const p of problems) log.err(`  - ${p}`);
        // Remove ONLY what this run created. The guard is the `existsSync(destDir)` abort a
        // few lines up: past it, `destDir` provably did not exist, so this run is the one that
        // made it — the same reasoning `probe-gate-visibility.cjs` had to learn the hard way
        // (its cleanup once deleted 13 real plugins by removing a path it had not created).
        //
        // Leaving the debris was the behaviour until 08/08/2026, and it was not inert:
        // `packages/plugins/*` is a workspace glob, so the next `npm install` would enrol a
        // package that had just failed its own contract checks, and nothing in the output
        // said to delete it.
        fs.rmSync(destDir, { recursive: true, force: true });
        log.info(`Removed ${destRel}/ — the scaffold is not left half-made.`);
        process.exit(1);
    }
    log.ok("Structural PC-01…PC-12 + INV-CONFIG self-checks passed.");

    console.log("");
    log.info("Next steps:");
    // Steps 3 and 4 used to ask for a manual entry in the PLUGINS list
    // of verify-plugin-contract.cjs and in PLUGIN_BUNDLES of check-bundle-size.cjs.
    // Both are now DERIVED from package.json#workspaces via scripts/lib/packages.cjs,
    // so `npm install` alone enrolls the plugin in every gate. Leaving the old advice
    // would have had users hand-editing lists that no longer exist.
    log.info(`  1. npm install  (links the new workspace — this alone enrolls it in every gate)`);
    log.info(`  2. Implement src/public-api.ts and src/entry.ts`);
    log.info(`  3. node scripts/verify-plugin-contract.cjs --plugin=${name} --fail`);
    log.info(`  4. Set a size budget for "${name}" in BUDGETS (scripts/check-bundle-size.cjs) —`);
    log.info(`     the plugin list is derived, but its threshold is measured data.`);
}

main();
