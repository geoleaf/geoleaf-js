/**
 * mocked-symbols.cjs — the symbols a suite DOUBLES while no source carries them.
 *
 * 🛑 **The class, measured by suffering it.** A test mounts a double on a member, calls
 * it, and verifies the double was called: **its oracle is its own fixture**. The suite is
 * green, and it attests an API that no longer exists. The founding case lived **forty
 * days** — `Config.getIconsConfig`, removed from the sources on 2026-07-11, still mocked
 * in two legend suites on 08-20 — while a neighbouring guard proved its absence **by
 * scanning `src/` and skipping `__tests__`**. Two corpora, no link between them. That
 * link is what was missing, and it is all this module does.
 *
 * ## The discriminant, and the two filters that had to be added
 *
 * A symbol is kept when ALL THREE conditions hold:
 *
 * 1. it is **doubled** — it appears as `{ name: vi.fn(…) }`;
 * 2. it is **treated as a MEMBER** — the file uses it somewhere as `.name`;
 * 3. it appears **in no source** of the registry's packages.
 *
 * ⚠️ **Condition 2 was not in the first version, and without it the census is
 * unusable**: 68 symbols, the overwhelming majority being local VARIABLE names
 * (`fooMock`, `mockBar`, `createRuntimeMock`) bound by `vi.hoisted`. They are absent from
 * the sources by construction — that is their job. With condition 2: **8**.
 *
 * ⚠️ **And the "alias" condition had to be added after reading the 8**: the pattern
 * `const h = { proximityInit: vi.fn() }` then `{ initProximityFilter: h.proximityInit }`
 * names a local carrier, never a member. The real member is the RE-BINDING key. A symbol
 * re-bound under a **different** key is thus discarded; re-bound under the **same** key,
 * it is kept — it is then indeed the name the module is supposed to export.
 *
 * ## ⚠️ What this module does NOT prove
 *
 * "The name appears somewhere in the sources" is a **floor**, not an existence proof:
 * `Config.getIconsConfig` would have passed if another object carried a `getIconsConfig`.
 * The floor suffices for the founding case — the member was at **zero** occurrences
 * across 930 sources — and it is chosen for its near-zero false-positive rate. Resolving
 * the member on its REAL carrier would require typing the mocks, which is another job
 * (depth 2 is only frozen on 8 facades).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const IGNORE_DIRS = new Set(["node_modules", "dist", "coverage", ".turbo"]);

/** Walks a directory, setting generated artifacts aside. */
function walk(dir, filter, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!IGNORE_DIRS.has(e.name)) walk(p, filter, out);
        } else if (filter(p)) out.push(p);
    }
    return out;
}

const isTest = (f) => /\.(test|spec)\.(ts|js)$/.test(f);
const isSource = (f) => /\.(ts|js|mjs|cjs)$/.test(f) && !/\.d\.ts$/.test(f) && !isTest(f);

/**
 * The two corpora, derived from the package registry — never from a `packages/**` glob,
 * which would capture `dist/` and `node_modules/`.
 *
 * @returns {{ sources: string[], tests: string[] }} Chemins absolus.
 */
function corpus() {
    const sources = [];
    const tests = [];
    for (const p of registry.all()) {
        walk(path.join(p.dir, "src"), isSource, sources);
        walk(path.join(p.dir, "src"), isTest, tests);
        walk(path.join(p.dir, "__tests__"), isTest, tests);
    }
    return { sources, tests };
}

/** Escapes an identifier for insertion into a regular expression. */
const esc = (s) => s.replace(/[$]/g, "\\$");

/** A file's doubled keys: `{ name: vi.fn(…) }`. */
function mockedKeys(src) {
    const out = new Set();
    const re = /(?:^|[{,\s])([a-zA-Z_$][\w$]*)\s*:\s*vi\.fn\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
    return out;
}

/** Does the file treat `name` as a MEMBER (`.name`) and not as a variable? */
function usedAsMember(src, nom) {
    return new RegExp(`\\.${esc(nom)}\\b`).test(src);
}

/**
 * Is `name` a local ALIAS, re-bound under a DIFFERENT key?
 *
 * `{ initProximityFilter: h.proximityInit }` — the real member is `initProximityFilter`;
 * `proximityInit` is only a carrier. Re-bound under the SAME key, it is not an alias.
 */
function isLocalAlias(src, nom) {
    const re = new RegExp(`([a-zA-Z_$][\\w$]*)\\s*:\\s*[a-zA-Z_$][\\w$]*\\.${esc(nom)}\\b`, "g");
    let m;
    while ((m = re.exec(src)) !== null) if (m[1] !== nom) return true;
    return false;
}

/**
 * Applies the full discriminant to ONE file, against an index of names present in source.
 *
 * A pure function over strings: that is what allows proving it on the historical case
 * (`MDS-03`) rather than on today's repo, where the defect is fixed.
 *
 * @param {string} src Content of the test file.
 * @param {(nom: string) => boolean} presentEnSource Presence-in-sources predicate.
 * @returns {string[]} The kept symbols, sorted.
 */
function deadMockedSymbols(src, presentEnSource) {
    const out = [];
    for (const nom of mockedKeys(src)) {
        if (!usedAsMember(src, nom)) continue;
        if (isLocalAlias(src, nom)) continue;
        if (presentEnSource(nom)) continue;
        out.push(nom);
    }
    return out.sort();
}

/**
 * A file's `Capitalized: { … }` blocks — a literal declaring a namespace's SHAPE.
 *
 * 🛑 **This second stage exists because the first was blind to a case the registry
 * NAMES.** `Baselayers.setBaselayer` is doubled in `api/api.test.js`, absent from every
 * source, and yet **never kept by stage 1**: it is mounted without ever being asserted,
 * so it fails the "treated as a member" condition. An instrument blind to a known
 * instance of its own class is the defect best stated as *the instrument carries the
 * blindness it measures*.
 *
 * The discriminant is structural: the key lives in a literal that is the VALUE of a
 * Capitalized key — i.e. an object declaring a namespace's members, not a local carrier.
 * Census at introduction: **2**, against ~60 if every literal were kept.
 *
 * @param {string} src File content.
 * @returns {Array<{ ns: string, corps: string }>} One block per namespace literal.
 */
function namespaceBlocks(src) {
    const out = [];
    const re = /\b([A-Z][\w$]*)\s*:\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        let depth = 1;
        let i = re.lastIndex;
        while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
        }
        out.push({ ns: m[1], corps: src.slice(re.lastIndex, i - 1) });
    }
    return out;
}

/**
 * Stage 2: the doubled namespace members no source carries.
 *
 * @param {string} src Content of the test file.
 * @param {(nom: string) => boolean} presentEnSource Presence-in-sources predicate.
 * @returns {string[]} `Namespace.member`, sorted.
 */
function deadNamespaceMembers(src, presentEnSource) {
    const out = new Set();
    for (const b of namespaceBlocks(src)) {
        for (const k of mockedKeys(b.corps)) {
            if (!presentEnSource(k)) out.add(`${b.ns}.${k}`);
        }
    }
    return [...out].sort();
}

/**
 * Sweeps the repo.
 *
 * @returns {{ tests: number, sources: number, cles: number, trouves: Array<{ symbole: string, fichier: string }> }}
 */
function scan() {
    const { sources, tests } = corpus();
    const SRC = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const presentEnSource = (nom) => new RegExp(`\\b${esc(nom)}\\b`).test(SRC);

    let cles = 0;
    const trouves = [];
    for (const f of tests) {
        const src = fs.readFileSync(f, "utf8");
        const rel = path.relative(ROOT, f).replace(/\\/g, "/");
        cles += mockedKeys(src).size;
        for (const s of deadMockedSymbols(src, presentEnSource)) {
            trouves.push({ symbole: s, fichier: rel, etage: 1 });
        }
        for (const s of deadNamespaceMembers(src, presentEnSource)) {
            if (trouves.some((t) => t.fichier === rel && s.endsWith(`.${t.symbole}`))) continue;
            trouves.push({ symbole: s, fichier: rel, etage: 2 });
        }
    }
    trouves.sort(
        (a, b) => a.symbole.localeCompare(b.symbole) || a.fichier.localeCompare(b.fichier)
    );
    return { tests: tests.length, sources: sources.length, cles, trouves };
}

/**
 * The founding case, reconstructed INLINE — this is the `MDS-03` witness.
 *
 * ⚠️ It is copied here and not read from `git show`: the real file is fixed since
 * 2026-08-20, so reading it would prove nothing anymore. A detector that no longer points
 * at the defect it was written for goes green on a healthy corpus **and on a sick one**.
 */
const TEMOIN_HISTORIQUE = `
const Log = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }));
const Config = vi.hoisted(() => ({ getIconsConfig: vi.fn(() => ({ showOnMap: true })) }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({ Config }));
globalThis.GeoLeaf = { Taxonomy: { getIcons: () => Config.getIconsConfig?.() ?? null } };
`;

module.exports = {
    corpus,
    mockedKeys,
    usedAsMember,
    isLocalAlias,
    deadMockedSymbols,
    namespaceBlocks,
    deadNamespaceMembers,
    scan,
    TEMOIN_HISTORIQUE,
};
