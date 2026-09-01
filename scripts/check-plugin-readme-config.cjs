#!/usr/bin/env node
/**
 * PRC — a plugin's README documents every configuration key the plugin declares.
 *
 * ## The hole this closes
 *
 * A package README is what an integrator reads: it ships in the npm tarball and it is the
 * only door for someone who never opens this repo. Several gates already read that corpus —
 * `validate-docs-examples` and `typecheck-docs-examples` consume `productDocsFiles()` — but
 * every one of them checks the VALIDITY of what is written (does this API exist? does this
 * example compile?). None checks its COMPLETENESS. A configuration key could be added,
 * shipped, read at runtime and never documented, with every gate green.
 *
 * The corpus was never the missing piece. The missing piece was a consumer.
 *
 * ## The oracle, and why it is the config interface
 *
 * Plugins do not carry a `configSchema` — that concept belongs to core capabilities, and
 * `doc-capability-config.guard.test.js` already holds those. What a plugin carries is a
 * TypeScript interface describing its profile configuration, either declared in
 * `src/config.ts` or imported there from `./types`. That interface IS the contract: it is
 * what `getPluginConfig()` returns and what the profile is validated against.
 *
 * ⚠️ A plugin with NO `src/config.ts` has no profile configuration at all — its options are
 * per-call API arguments (`CogLayerOptions`, `FgbLoadOptions`), documented under their own
 * headings. Those are named below with that reason, and their count is printed: this gate
 * says what it does not judge, rather than staying silent about it.
 *
 * ## Codes
 *
 *   PRC-01  every member of a plugin's config interface is cited in its README.
 *   PRC-02  ANTI-EMPTY — the covered-plugin count may not fall below the floor. A plugin
 *           that loses its `src/config.ts` (or its interface) would leave this gate's corpus
 *           in silence, and the gate would stay green having stopped reading it.
 *   PRC-03  the uncovered plugins are NAMED, with their reason.
 *
 * ## Born green, on purpose
 *
 * Measured before this file existed: 11 plugins, 133 members, ONE undocumented key
 * (`table.exportFormats`, live at `panel.ts`). It was documented first, then this gate was
 * written. A gate born red on a corpus it cannot fix gets disarmed within the week — this
 * repo has measured that more than once. A gate born green on a clean corpus is a ratchet.
 *
 * Usage: node scripts/check-plugin-readme-config.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ts = require("typescript");
const registry = require("./lib/packages.cjs");
const { readInterfaceMembers } = require("./lib/ts-decl-read.cjs");

const TAG = "PRC";
const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", x: "\x1b[0m" };

/**
 * Floor for PRC-02. Derived once by measurement, and it may only be RAISED.
 *
 * Lowering it is the gesture that would hide the very disappearance the code exists to catch,
 * so it is written here with that warning rather than computed from the corpus it guards.
 */
const COVERED_FLOOR = 11;

/**
 * Resolves the interface that describes a plugin's profile configuration.
 *
 * Two shapes exist in this repo and both are legitimate: the interface is declared inside
 * `src/config.ts`, or it is imported there from a relative module (`./types.js`). When several
 * `*Config` names are in scope, the WIDEST wins — the narrow ones are its sub-objects
 * (`TableLayerConfig` under `TableConfig`), and picking one of those would make the gate check
 * a fraction of the contract while looking complete.
 *
 * @param {string} absDir Absolute directory of the plugin package.
 * @returns {{ name: string, file: string, count: number }|null} The oracle, or `null` when the
 *   plugin declares no profile configuration at all.
 */
function resolveOracle(absDir) {
    const cfg = path.join(absDir, "src", "config.ts");
    if (!fs.existsSync(cfg)) return null;

    const sf = ts.createSourceFile(cfg, fs.readFileSync(cfg, "utf8"), ts.ScriptTarget.Latest, true);
    const candidates = [];

    ts.forEachChild(sf, (node) => {
        if (ts.isInterfaceDeclaration(node) && /Config$/.test(node.name.getText())) {
            candidates.push({ name: node.name.getText(), file: cfg, count: node.members.length });
            return;
        }
        if (!ts.isImportDeclaration(node)) return;
        const bindings = node.importClause && node.importClause.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) return;
        const from = node.moduleSpecifier.getText().replace(/["']/g, "");
        // Only RELATIVE imports: a `*Config` coming from `@geoleaf/host-runtime` is the host's
        // contract, not this plugin's, and holding a README to it would be a false invariant.
        if (!from.startsWith(".")) return;
        const target = path.join(absDir, "src", from.replace(/\.js$/, ".ts"));
        if (!fs.existsSync(target)) return;
        for (const el of bindings.elements) {
            const name = el.name.getText();
            if (!/Config$/.test(name)) continue;
            try {
                candidates.push({
                    name,
                    file: target,
                    count: readInterfaceMembers(target, name, { tag: TAG }).size,
                });
            } catch {
                // Not an interface (a type alias, a re-export): not an oracle. Silence here is
                // safe because PRC-02 catches a plugin that ends up with NO oracle at all.
            }
        }
    });

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.count - a.count)[0];
}

const errors = [];
const covered = [];
const uncovered = [];
let totalMembers = 0;

for (const pkg of registry.all()) {
    if (!pkg.name.startsWith("@geoleaf-plugins/")) continue;
    const short = pkg.name.replace("@geoleaf-plugins/", "");
    const readme = path.join(pkg.absDir, "README.md");

    if (!fs.existsSync(readme)) {
        errors.push(
            `[PRC-01] ${pkg.name} has no README.md — the integrator's only door is missing, ` +
                `and no amount of configuration documentation elsewhere replaces it.`
        );
        continue;
    }

    const oracle = resolveOracle(pkg.absDir);
    if (!oracle) {
        uncovered.push(`${short} (no src/config.ts — options are per-call API arguments)`);
        continue;
    }

    // `readInterfaceMembers` returns `Set<string>` OR `Map<string,string>` depending on
    // `withTypes`; without it, a Set. The cast tells `tsconfig.tooling.json` which branch
    // this call takes — without it the spread types as `string | [string, string]` and the
    // TOOLING-TS ratchet climbs by one.
    const members = /** @type {string[]} */ ([
        ...readInterfaceMembers(oracle.file, oracle.name, { tag: TAG }),
    ]);
    const doc = fs.readFileSync(readme, "utf8");
    const missing = members.filter(
        (m) => !new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(doc)
    );

    totalMembers += members.length;
    covered.push({ short, oracle: oracle.name, n: members.length, missing });

    if (missing.length > 0) {
        errors.push(
            `[PRC-01] ${pkg.name} — ${missing.length} configuration key(s) declared in ` +
                `\`${oracle.name}\` (${path.relative(registry.ROOT || process.cwd(), oracle.file)}) ` +
                `and absent from its README: ${missing.join(", ")}.\n` +
                `        A key read at runtime and undocumented is a setting an integrator ` +
                `cannot find. Document it, or remove it from the interface if it is dead.`
        );
    }
}

console.log(
    `${C.d}── ${TAG} — les README de plugin documentent la config qu'ils déclarent ──${C.x}`
);
console.log(
    `  ${covered.length} plugin(s) couvert(s) · ${totalMembers} membre(s) confrontés · ` +
        `${uncovered.length} hors oracle`
);
for (const u of uncovered) console.log(`${C.d}   [PRC-03] ${u}${C.x}`);

// PRC-02 — anti-empty. A gate that stops reading must SAY so, never go green on a shrunken
// corpus. This is the assertion that separates "green because it holds" from "green because
// I read almost nothing".
if (covered.length < COVERED_FLOOR) {
    errors.push(
        `[PRC-02] ${covered.length} plugin(s) couvert(s) pour un plancher de ${COVERED_FLOOR} — ` +
            `un plugin a QUITTÉ le corpus de cette gate. Il a perdu son \`src/config.ts\` ou ` +
            `l'interface que celui-ci déclarait, et sans cette assertion la gate serait restée ` +
            `verte en ayant cessé de le lire. Rétablir l'oracle, ou abaisser le plancher AVEC ` +
            `le motif écrit à côté de la constante.`
    );
}

if (errors.length > 0) {
    console.error(`\n${C.r}✘ ${TAG}${C.x} : ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    process.exit(1);
}

console.log(
    `${C.g}✓ ${TAG}${C.x} — ${totalMembers} membre(s) de configuration, tous documentés ` +
        `(${covered.length} plugin(s), plancher ${COVERED_FLOOR}).`
);
