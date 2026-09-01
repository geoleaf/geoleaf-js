/**
 * Is the typing of the editor's public events ENFORCEABLE?
 *
 * 🛑 **This guard exists because of a measured false green, not a principle.**
 * The nine `geoleaf:editor:*` were first typed by constraining `events.ts`'s
 * local `_dispatch`. A mutation caught it out: removing `pushed` from
 * `GeoLeafEditorSyncFlushedDetail` left the typecheck **GREEN**. Motive —
 * **three of the nine emitters did not go through it** and built their
 * `CustomEvent` by hand. For those three, the contract described a payload
 * nothing forced to respect: decorative.
 *
 * What this suite guards, and the typecheck alone does not:
 *
 *  1. That there is only **one** emission point. A
 *     `new CustomEvent("geoleaf:editor:…")` written elsewhere would reopen the
 *     hole exactly like the original three — and it would come out green at
 *     the typecheck, since `CustomEvent` accepts any `detail`.
 *  2. That the contract's nine names are indeed the ones the plugin emits, **in
 *     both directions**: a typed name nobody emits is a hollow promise; an
 *     emitted name absent from the contract is a public API invisible to the
 *     integrator — precisely that class.
 *
 * The subjects are READ FROM DISK: a new emitter enters the perimeter without
 * anyone registering it anywhere.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __tests__ → src → editor → plugins → packages → <racine>
const REPO = resolve(__dirname, "../../../../..");
const SRC = resolve(REPO, "packages/plugins/editor/src");
const CONTRACT = resolve(REPO, "packages/core/src/contracts/event-bus.contract.ts");
/** The single emission point — the ONLY file allowed to build the event. */
const DISPATCH_MODULE = "editor-events.ts";

/** All the plugin's production `.ts` files (excluding tests and mocks). */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "__tests__" || entry === "__mocks__") continue;
            out.push(...sourceFiles(full));
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

const FILES = sourceFiles(SRC);

/** The `geoleaf:editor:*` names declared in `GeoLeafEventMap`, read from the contract. */
function contractEventNames(): string[] {
    const src = readFileSync(CONTRACT, "utf8");
    const start = src.indexOf("export interface GeoLeafEventMap {");
    const body = src.slice(start, src.indexOf("\n}", start));
    return [...body.matchAll(/"(geoleaf:editor:[a-z-]+)"\s*:/g)].map((m) => m[1]).sort();
}

/** The names the plugin emits, collected at the single point's call sites. */
function emittedEventNames(): string[] {
    const names = new Set<string>();
    for (const file of FILES) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/dispatchEditorEvent\(\s*"(geoleaf:editor:[a-z-]+)"/g)) {
            names.add(m[1]);
        }
    }
    return [...names].sort();
}

describe("EDITOR-EVENTS — un seul point d'émission", () => {
    it("garde anti-gate-vide : des sources sont bien lues", () => {
        // Without this bound, a moved `SRC` would let everything else come out
        // green having scanned no file.
        expect(FILES.length, "aucune source lue — le périmètre est cassé").toBeGreaterThan(30);
        expect(FILES.some((f) => f.endsWith(DISPATCH_MODULE))).toBe(true);
    });

    it('aucun `new CustomEvent("geoleaf:editor:…")` hors du point unique', () => {
        const offenders = FILES.filter((f) => !f.endsWith(DISPATCH_MODULE)).filter((f) =>
            /new CustomEvent\(\s*"geoleaf:editor:/.test(readFileSync(f, "utf8"))
        );
        expect(
            offenders.map((f) => f.slice(REPO.length + 1)),
            `Émetteur(s) construisant l'événement à la main : leur charge n'est contrainte ` +
                `par RIEN — \`CustomEvent\` accepte n'importe quel \`detail\`, donc le contrat ` +
                `redevient décoratif pour eux. Passer par \`dispatchEditorEvent\`.`
        ).toEqual([]);
    });
});

describe("EDITOR-EVENTS — contrat ≡ émissions, dans les deux sens", () => {
    const declared = contractEventNames();
    const emitted = emittedEventNames();

    it("garde anti-gate-vide : les deux relevés sont non vides", () => {
        expect(declared.length, "aucun nom lu dans GeoLeafEventMap").toBeGreaterThan(5);
        expect(emitted.length, "aucun site d'émission relevé").toBeGreaterThan(5);
    });

    it("tout événement ÉMIS est déclaré au contrat", () => {
        const undeclared = emitted.filter((n) => !declared.includes(n));
        expect(
            undeclared,
            `Événement(s) émis et ABSENT(s) de GeoLeafEventMap — une API publique que ` +
                `l'intégrateur ne peut ni découvrir ni vérifier.`
        ).toEqual([]);
    });

    it("tout événement DÉCLARÉ est réellement émis", () => {
        const unemitted = declared.filter((n) => !emitted.includes(n));
        expect(
            unemitted,
            `Événement(s) déclaré(s) au contrat que le plugin n'émet plus — une promesse ` +
                `creuse, du genre que 7.1b a retiré par 24. Soit l'émetteur revient, soit ` +
                `la clé sort de la map.`
        ).toEqual([]);
    });
});
