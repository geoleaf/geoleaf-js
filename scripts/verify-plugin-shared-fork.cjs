#!/usr/bin/env node
/**
 * Locks in the cross-plugin consolidation settled by PLUGINS S1.
 *
 * S1 repatriated ~12 forked copies of shared chrome utilities into
 * `@geoleaf/host-runtime` (adoption 3 → 9 packages). The real danger it exposed was
 * NOT in its statement: the `coreConfigGet` export of host-runtime had silently
 * DRIFTED from its nine live copies — it was missing the `value === undefined` guard,
 * dead since creation, so nothing ever confronted it with the copies. A fork nobody
 * re-reads diverges in silence. This gate forbids a fork from reappearing.
 *
 * The sibling gates it completes:
 *   - `verify-plugin-core-boundary.cjs` forbids IMPORTING core sources into a plugin.
 *   - `verify-seam-drift.cjs` watches the DELIBERATE core↔plugin copies for drift.
 *   - this gate forbids RE-DEFINING a symbol that lives canonically in
 *     `@geoleaf/host-runtime` instead of importing it.
 *
 * ## Import vs definition — why this is not core-boundary reheated
 *
 * `verify-plugin-core-boundary` matches import SPECIFIERS. A fork is not an import: it
 * is a package DEFINING its own `export function coreConfigGet(...)` / `const
 * adoptStylesheet = ...`. So the detection is keyed on the DECLARATION keyword
 * (`function` / `const|let|var`) immediately before a canonical name. That discriminator
 * is exactly what separates a fork from the four things that must NOT trip:
 *   - `import { coreConfigGet } from "@geoleaf/host-runtime"` — the desired state,
 *   - `export { adoptStylesheet } from "@geoleaf/host-runtime"` — a re-export,
 *   - `getUINotifications()?.success(...)` — a usage,
 *   - `showTooltipDelayed` — a homonym (the `\b` after the name blocks it).
 *
 * PSF-01: no canonical symbol DEFINED outside `@geoleaf/host-runtime`, per the baseline.
 * PSF-02: the baseline must SHRINK — a symbol no longer forked is reported for removal,
 *         so a paid-off debt cannot quietly authorise a future regression.
 *
 * Scope: `src/**\/*.ts` of every workspace package EXCEPT the canonical home and the
 * core, excluding `__tests__/` and `.d.ts`. Comment lines are exempt.
 *
 * Usage: node scripts/verify-plugin-shared-fork.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** The symbols' canonical home — never a fork, and the source of the symbol list. */
const CANONICAL_HOME = "@geoleaf/host-runtime";

/**
 * The core owns `getGeoLeaf` / `ensureGeoLeaf` / `coreConfigGet` itself, and host.ts
 * documents that host-runtime MIRRORS the core (it cannot import it — bundle contract).
 * The core is therefore a PEER source, not a fork consumer; it also carries coincidental
 * homonyms (`showTooltip` / `hideTooltip` in `capabilities/feature-info`, different
 * signature). Excluding it by NAME — not by a `packages/plugins/` path prefix — keeps
 * the gate blindness-safe: a package relocated by a future sprint is still enumerated by
 * the workspace registry and stays scanned, instead of dropping out of a hard-coded path.
 */
const PEER_SOURCE = "@geoleaf/core";

/**
 * Local re-definitions of a canonical symbol still tolerated, per package DIRECTORY name.
 *
 * A DEBT with an owner, not a permanent exemption — PSF-02 forces it to shrink.
 *
 * ✅ EMPTY since STRUCT S2 (F7), and that is the whole point: the register held exactly
 * one entry, `addpoi: ["getGeoLeaf"]`, and it was paid off. `plugin-addpoi` now imports
 * host-runtime's `getGeoLeaf` and keeps only the local NARROW, renamed `coreHost` —
 * the pattern plugin-editor, plugin-measure and plugin-print already followed. PSF-02
 * would have reported the entry as unused, which is why its removal shipped in the very
 * commit that removed the definition.
 *
 * `Object.entries({})` does not loop, so PSF-02 stays green on an empty register.
 * Adding to this list requires a deliberate decision.
 */
const BASELINE = {};

/**
 * A non-empty subset of the derived symbols that MUST always be present. If `index.ts`
 * is reshaped (e.g. switched to `export *`) the parse could silently yield a list that
 * drops these — a gate scanning for nothing is green and blind, the exact failure the
 * probe exists to catch. Missing anchors THROW rather than pass.
 *
 * The first four were named by the roadmap (S11.1: css-adopt / touch-drag / notify-seam /
 * coreConfigGet). STRUCT S2 (F9) adds one anchor per family canonised by that sprint, so
 * the guard grows with the surface it guards instead of staying pinned to the 2026-era
 * subset: a future `export *` must now drop SEVEN known names before it can go unnoticed.
 */
const ANCHORS = [
    "coreConfigGet",
    "adoptStylesheet",
    "wireTouchDrag",
    "getUINotifications",
    "Log", // F1 — log-seam
    "tLabel", // F2 — i18n-seam
    "getNestedValue", // F3 — core-utils-seam
    "getNativeMap", // F4 — map-seam
    "createEl", // F4 — dom-seam
    "downloadBlob", // F5 — download
];

// The registry derives package paths from the workspace globs and THROWS on an unknown
// or moved package — never silently scans nothing. Same reasoning as the sibling gate.
const registry = require("./lib/packages.cjs");

/**
 * The canonical symbol list is DERIVED from the value exports of host-runtime's
 * `index.ts`, not hard-coded — a new shared utility auto-enrols. Deriving `getGeoLeaf` /
 * `ensureGeoLeaf` / `coreConfigGet` is only safe BECAUSE the core (which also owns them)
 * is out of scope; see {@link PEER_SOURCE}. `type X` re-exports are dropped: a type
 * cannot be re-copied as a runtime fork.
 *
 * @returns {string[]} value export names, e.g. ["getGeoLeaf", "adoptStylesheet", …]
 */
function deriveSymbols() {
    const home = registry.byName(CANONICAL_HOME);
    if (!home) {
        throw new Error(
            `verify-plugin-shared-fork: "${CANONICAL_HOME}" is not a workspace package — ` +
                `the symbol list cannot be derived. Fix the name rather than hard-coding it.`
        );
    }
    const indexPath = path.join(home.absDir, "src", "index.ts");
    const src = fs.readFileSync(indexPath, "utf8");

    const symbols = new Set();
    for (const block of src.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["']/g)) {
        for (const raw of block[1].split(",")) {
            const name = raw.trim();
            if (!name || name.startsWith("type ")) continue;
            // Keep the EXPORTED name (the public identifier a fork would re-declare): the
            // right side of `x as y`, or the whole token when there is no alias.
            symbols.add(
                name
                    .split(/\s+as\s+/)
                    .pop()
                    .trim()
            );
        }
    }

    const list = [...symbols];
    if (list.length === 0) {
        throw new Error(
            `verify-plugin-shared-fork: derived 0 symbols from ${path.relative(ROOT, indexPath)} — ` +
                `the export shape changed or the parse broke. This gate must never scan for nothing.`
        );
    }
    const missing = ANCHORS.filter((a) => !list.includes(a));
    if (missing.length) {
        throw new Error(
            `verify-plugin-shared-fork: canonical anchors missing from the derived set: ` +
                `${missing.join(", ")}. The list is ${list.join(", ")}.`
        );
    }
    return list;
}

/** Walks `dir`, collecting `.ts` files outside `__tests__/` (and never `.d.ts`). */
function collectSources(dir, results) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "node_modules") continue;
            collectSources(full, results);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            results.push(full);
        }
    }
    return results;
}

/** `true` when the line is a comment — docs may name any symbol they like. */
function isComment(line) {
    const t = line.trim();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

const symbols = deriveSymbols();
const NAMES = symbols.join("|");

/**
 * A canonical symbol DEFINED at statement start, in either shape:
 *   - `export function coreConfigGet<T>(…)`  (exported or not, async or not, generator)
 *   - `export const adoptStylesheet = …` / `let` / `var`  (arrow or object re-impl)
 * `\b` after the name rejects homonyms (`showTooltipDelayed`). A leading `import` /
 * `export { … } from` line has no `function` / `const` before the name, so it cannot match.
 */
const DEF_RE = new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\*?\\s+(${NAMES})\\b` +
        `|^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${NAMES})\\b\\s*[:=]`
);

// Enumerate every workspace package except the canonical home and the core peer.
const targets = registry.all().filter((p) => p.name !== CANONICAL_HOME && p.name !== PEER_SOURCE);
if (targets.length === 0) {
    throw new Error(
        "verify-plugin-shared-fork: 0 target packages — the registry emptied. This is the " +
            "silent-blindness class S9.4/S10.2 exist to prevent, not a clean run."
    );
}

let failed = false;
/** @type {Record<string, Set<string>>} dirName → canonical symbols seen defined there. */
const seen = {};

// ── PSF-01 — no canonical symbol defined outside the home, beyond the baseline. ──
for (const pkg of targets) {
    const srcDir = path.join(pkg.absDir, "src");
    const allowed = BASELINE[pkg.dirName] || [];
    seen[pkg.dirName] = new Set();
    const violations = [];

    for (const file of collectSources(srcDir, [])) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            if (isComment(line)) return;
            const m = line.match(DEF_RE);
            if (!m) return;
            const sym = m[1] || m[2];
            seen[pkg.dirName].add(sym);
            if (!allowed.includes(sym)) {
                violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${sym}`);
            }
        });
    }

    if (violations.length) {
        failed = true;
        console.error(
            `\n❌ [PSF-01] ${pkg.dirName} — re-définition(s) d'utilitaire shared hors baseline :`
        );
        for (const v of violations) console.error(`   ${v}`);
        console.error(
            `   → Importez le symbole depuis ${CANONICAL_HOME} au lieu de le redéfinir.\n` +
                `     Une copie locale re-fork ce que le S1 a consolidé, et dérive en silence\n` +
                `     dès que l'original change — c'est exactement ce qui est arrivé à coreConfigGet.`
        );
    }
}

if (!failed)
    console.log(`✅ [PSF-01] Aucune re-définition d'utilitaire ${CANONICAL_HOME} hors baseline.`);

// ── PSF-02 — the baseline must shrink. An entry no longer forked is reported. ──
let stale = false;
for (const [dirName, allowed] of Object.entries(BASELINE)) {
    registry.requireByDirName(dirName); // throws (loud) if the package moved or was renamed
    const seenHere = seen[dirName] || new Set();
    const unused = allowed.filter((sym) => !seenHere.has(sym));
    if (unused.length) {
        stale = true;
        console.error(`\n❌ [PSF-02] ${dirName} — entrée(s) de baseline devenue(s) inutiles :`);
        for (const u of unused) console.error(`   ${u}`);
        console.error(
            `   → Retirez-les de BASELINE dans scripts/verify-plugin-shared-fork.cjs.\n` +
                `     La baseline est une dette, pas une permission permanente.`
        );
    }
}

if (stale) failed = true;
else console.log("✅ [PSF-02] Baseline à jour — aucune entrée obsolète.");

process.exit(failed ? 1 : 0);
