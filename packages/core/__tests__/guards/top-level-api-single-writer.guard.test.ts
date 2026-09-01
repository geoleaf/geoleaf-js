/**
 * Guard TLA — the 11 top-level methods have ONE writer, and they are DETACHABLE.
 *
 * ## The defect this guard closes (the "B11 duplicate")
 *
 * `globalThis.GeoLeaf` is not built in one go: several modules hook their
 * pieces onto it at import. The eleven `GeoLeafTopLevelApi` methods were
 * hooked by **two** modules at once — `globals/globals.api.ts` via
 * `defineApiMethods()`, and `kernel/api/geoleaf-api.ts` via an
 * `Object.assign`. The last evaluated won, and the two forms were **not
 * equivalent**. The price was already paid twice, in production:
 *
 *   - `get BaseLayers()` set in the `Object.assign` literal overwrote with
 *     `undefined` the alias `globals.api.ts` had just set — `Object.assign`
 *     INVOKES the source's getter;
 *   - `getMetrics() { return this.getHealth(); }` worked attached and threw detached.
 *
 * ⚠️ **No gate could see them: they compare NAMES, and the name did exist.**
 * Hence the two assertions below, bearing neither on names nor on types.
 *
 * ## TLA-01 — single writer, at the AST, on disk
 *
 * 🛑 **Not at grep, and the motive is measured.** A `grep 'X.getMetrics ='`
 * over all of `src/` yields exactly ONE result per name — `globals.api.ts`'s
 * — because the second writer is an **object literal**
 * (`getMetrics: readHealthStatus,`). The naive instrument is blind to the
 * duplicate's very shape: it would have certified "one writer" while there were two.
 *
 * 🛑 **Not at instrumented import either.** A `Proxy` on the namespace would
 * measure what the TEST's import chain loads, not what the repo contains —
 * and under Vitest `geoleaf-api.ts` is almost never in that chain. The guard
 * would be green whatever the file's state.
 *
 * So: `ts.createSourceFile` over all `src/**\/*.ts`, three recognised write
 * forms (member assignment, `Object.assign` literal,
 * `Object.defineProperty`), and the identifiers designating the namespace
 * **derived per file**, never hand-written.
 *
 * ## TLA-02 — detachability, phrased as EQUIVALENCE
 *
 * ⚠️ The literal phrasing "none must throw" is **infeasible**: `init()`
 * legitimately throws when no controller is mounted, and forging a fake
 * controller would make the guard bear on the mounting rather than the
 * shape. The retained assertion is stronger and needs no controller:
 * **detaching changes NOTHING**.
 *
 * The comparison bears on the VERDICT (threw / returned), and on the
 * constructor + message when it throws. It does not compare returned values:
 * `getHealth()` carries live counters, and a deep equality would be unstable
 * there for a reason unrelated to the defect. Exactly the discriminant of
 * the original bug — attached returned, detached threw.
 *
 * ## Proof by mutation — and the first one is FREE
 *
 *   G1  **no mutation, production code intact (08/08/2026, before the fix)**
 *       → 🔴 **TLA-01 on all 11 names**, naming both files. The measurement
 *       that DEMONSTRATES the duplicate: the guard and the preflight survey
 *       are the same object, and it flips green when the fix removes the
 *       `Object.assign`. Writing this guard AFTER the reconciliation would
 *       have made it be born green, and a mutation would have had to be
 *       forged for what the repo demonstrated on its own.
 *   G2  `globals.api.ts`: `getMetrics` rewritten as
 *       `function () { return this.getHealth(); }` → 🔴 TLA-02 on
 *       `getMetrics`. The mutation targets the SURVIVOR, not the condemned
 *       module: mutating the one being deleted would prove nothing about the after.
 *   G6  restoring the `Object.assign` after the fix → 🔴 TLA-01 again. Proves
 *       the guard holds in the RETURN direction, not just that it followed the change.
 *
 * @see packages/core/src/contracts/top-level-api.contract.ts — the list of 11, never copied
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const ts = require_("typescript");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");
const SRC = path.join(REPO, "packages/core/src");
const CONTRACT = path.join(SRC, "contracts/top-level-api.contract.ts");

const { readInterfaceMembers } = require_(path.join(REPO, "scripts/lib/ts-decl-read.cjs"));

/** The 11 names — READ from the contract, never copied here. */
const NAMES: string[] = [
    ...readInterfaceMembers(CONTRACT, "GeoLeafTopLevelApi", { tag: "TLA" }).keys(),
];

/** All of `src/`'s `.ts`, recursively. */
function sources(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sources(p, out);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
    }
    return out;
}

/**
 * The expressions that, IN THIS FILE, designate the `GeoLeaf` namespace.
 *
 * Derived, never listed: an identifier is one if its initialiser calls
 * `ensureGeoLeaf()` / `getGeoLeaf()`, or carries a `….GeoLeaf` chain; a
 * parameter is one if its type names `GeoLeaf`. Any expression whose text
 * ends in `.GeoLeaf` counts too. If this detector stops matching, TLA-03
 * says so — it does not come out green silently.
 */
function namespaceAliases(sf: unknown): Set<string> {
    const aliases = new Set<string>();
    const visit = (node: any): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const init = node.initializer.getText(sf);
            if (/\bensureGeoLeaf\s*\(|\bgetGeoLeaf\s*\(|\.GeoLeaf\b/.test(init)) {
                aliases.add(node.name.text);
            }
        }
        if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
            if (/GeoLeaf/.test(node.type.getText(sf))) aliases.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return aliases;
}

/** `true` if `expr` designates the namespace in this file. */
function isNamespace(expr: unknown, sf: unknown, aliases: Set<string>): boolean {
    const t = (expr as any)?.getText?.(sf) ?? "";
    return aliases.has(t) || /\.GeoLeaf$/.test(t) || t === "GeoLeaf";
}

/** method name → files (repo-relative) that write it onto the namespace. */
function collectWriters(): Map<string, Set<string>> {
    const writers = new Map<string, Set<string>>(NAMES.map((n) => [n, new Set<string>()]));
    const files = sources(SRC);

    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
        const aliases = namespaceAliases(sf);
        const rel = path.relative(REPO, file);
        const note = (name: string) => {
            if (writers.has(name)) writers.get(name)!.add(rel);
        };

        const visit = (node: any): void => {
            // Form 1 — member assignment: `_gl.init = …`
            if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(node.left) &&
                isNamespace(node.left.expression, sf, aliases)
            ) {
                note(node.left.name.text);
            }

            // Form 2 — `Object.assign` literal: `Object.assign(existing, { init: … })`.
            // The ONE the grep does not see, and the duplicate's shape.
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === "assign" &&
                node.expression.expression.getText(sf) === "Object" &&
                node.arguments.length >= 2 &&
                isNamespace(node.arguments[0], sf, aliases)
            ) {
                for (const arg of node.arguments.slice(1)) {
                    const lit = ts.isSatisfiesExpression?.(arg) ? arg.expression : arg;
                    if (!ts.isObjectLiteralExpression(lit)) continue;
                    for (const p of lit.properties) {
                        if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
                            note(p.name.text);
                        }
                    }
                }
            }

            // Forme 3 — `Object.defineProperty(<ns>, "init", …)`
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === "defineProperty" &&
                node.expression.expression.getText(sf) === "Object" &&
                node.arguments.length >= 2 &&
                isNamespace(node.arguments[0], sf, aliases) &&
                ts.isStringLiteral(node.arguments[1])
            ) {
                note((node.arguments[1] as any).text);
            }

            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return writers;
}

const WRITERS = collectWriters();
const CORPUS = sources(SRC).length;

describe("TLA — les 11 méthodes de haut niveau : un seul écrivain, et détachables (7.7)", () => {
    it("TLA-03 — anti-garde-vide : corpus, contrat et détecteur sont tous vivants", () => {
        // ① the scanned corpus is real
        expect(
            CORPUS,
            "moins de 400 fichiers scannés — le walk ne voit plus `src/`"
        ).toBeGreaterThan(400);
        // ② the contract does yield its eleven members, else TLA-01 would bear on the empty set
        expect(NAMES.length, `GeoLeafTopLevelApi rend ${NAMES.length} membres`).toBe(11);
        // ③ the DETECTOR still matches: `globals.api.ts` must be seen as each
        // one's writer. Without this assertion, a broken detector would yield
        // "1 writer" (or 0) everywhere and TLA-01 would come out green
        // guarding nothing any more — the class's exact failure mode.
        for (const name of NAMES) {
            expect(
                [...WRITERS.get(name)!],
                `TLA-03 : \`${name}\` n'est vu écrit par AUCUN fichier — le détecteur de namespace ` +
                    `ne matche plus. Ce n'est pas un succès, c'est une cécité.`
            ).toContain("packages/core/src/globals/globals.api.ts");
        }
    });

    it("TLA-01 — chacune des 11 est écrite par EXACTEMENT un module", () => {
        const multi = NAMES.map((n) => ({ n, files: [...WRITERS.get(n)!] })).filter(
            (x) => x.files.length !== 1
        );
        expect(
            multi.map((x) => `${x.n} ← ${x.files.join(" + ") || "(aucun)"}`),
            `Des méthodes de \`GeoLeafTopLevelApi\` ont plusieurs écrivains. Le dernier module ` +
                `évalué gagne, et rien ne garantit que les deux formes soient équivalentes — c'est ` +
                `le doublon B11, et il a déjà coûté deux défauts de production ` +
                `(\`get BaseLayers\` écrasé par undefined, \`getMetrics\` non détachable).`
        ).toEqual([]);
    });
});

// ── TLA-02 — detachability, at runtime ────────────────────────────────────────────────────────
//
// Loaded AFTER the scan so the import does not influence TLA-01.
// `globals/globals.js` is the chain every entry of the repo imports — the
// surface really shipped.
await import("../../src/globals/globals.js");

/** Plausible arguments per method — their value matters little, their ARITY does. */
const ARGS: Record<string, unknown[]> = {
    init: [{}],
    setTheme: ["light"],
    loadConfig: ["/profile.json"],
    createMap: ["map"],
    getMap: ["map"],
    getAllMaps: [],
    getModule: ["legend"],
    hasModule: ["legend"],
    getNamespace: ["Legend"],
    getHealth: [],
    getMetrics: [],
};

/**
 * A call's VERDICT, reduced to what discriminates the original defect.
 *
 * Not the returned value: `getHealth()` carries live counters, and a deep
 * equality would be unstable there for a reason foreign to the subject. What
 * matters is "threw or returned", and if it throws, what exactly —
 * precisely where the non-detachable form diverged.
 */
function verdict(fn: (...a: unknown[]) => unknown, args: unknown[]): string {
    try {
        const v = fn(...args);
        // A rejected promise is not a synchronous throw: we neutralise it so
        // the run does not fail on an uncaught rejection, and only compare synchrony.
        if (v && typeof (v as Promise<unknown>).catch === "function") {
            (v as Promise<unknown>).catch(() => {});
            return "returned:thenable";
        }
        return `returned:${v === null ? "null" : typeof v}`;
    } catch (e) {
        return `threw:${(e as Error)?.constructor?.name}:${(e as Error)?.message}`;
    }
}

describe("TLA-02 — détacher une méthode du namespace ne change RIEN", () => {
    const GeoLeaf = globalThis.GeoLeaf as unknown as Record<string, (...a: unknown[]) => unknown>;

    it("TLA-03bis — le namespace porte bien les 11 après import de la chaîne globals", () => {
        // Without it, the loop below would skip everything and come out green on zero subjects.
        for (const name of NAMES) {
            expect(typeof GeoLeaf?.[name], `GeoLeaf.${name} absent après import`).toBe("function");
        }
    });

    it.each(NAMES)("TLA-02 — %s : attaché et détaché rendent le même verdict", (name) => {
        const args = ARGS[name] ?? [];
        const attached = verdict((...a) => GeoLeaf[name](...a), args);
        const detached = verdict(
            (({ [name]: f }) => f as (...a: unknown[]) => unknown)(GeoLeaf),
            args
        );
        expect(
            detached,
            `\`const { ${name} } = GeoLeaf\` puis appel ne se comporte pas comme ` +
                `\`GeoLeaf.${name}()\`. C'est le défaut D8 : une méthode qui dépend de \`this\` ` +
                `marche attachée et casse détachée, et aucune gate de NOMS ne peut le voir.`
        ).toBe(attached);
    });
});
