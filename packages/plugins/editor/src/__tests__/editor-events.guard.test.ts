/**
 * Le typage des événements publics de l'éditeur est-il OPPOSABLE ? — tâche 7.3.
 *
 * 🛑 **Cette garde existe à cause d'un faux vert mesuré, pas d'un principe.** Les neuf
 * `geoleaf:editor:*` ont d'abord été typés en contraignant le `_dispatch` local
 * d'`events.ts`. Une mutation l'a pris en défaut : retirer `pushed` de
 * `GeoLeafEditorSyncFlushedDetail` laissait le typecheck **VERT**. Motif — **trois des neuf
 * émetteurs n'y passaient pas** et construisaient leur `CustomEvent` à la main. Pour ces
 * trois-là, le contrat décrivait une charge que rien n'obligeait à respecter : décoratif.
 *
 * Ce que cette suite garde, et que le typecheck seul ne garde pas :
 *
 *  1. Qu'il n'existe **qu'un** point d'émission. Un `new CustomEvent("geoleaf:editor:…")`
 *     écrit ailleurs rouvrirait le trou exactement comme les trois d'origine — et il
 *     sortirait vert au typecheck, puisque `CustomEvent` accepte n'importe quel `detail`.
 *  2. Que les neuf noms du contrat sont bien ceux que le plugin émet, **dans les deux
 *     sens** : un nom typé que personne n'émet est une promesse creuse ; un nom émis
 *     absent du contrat est une API publique invisible à l'intégrateur — c'est
 *     précisément la classe B-142.
 *
 * Les sujets sont LUS SUR LE DISQUE : un émetteur neuf entre dans le périmètre sans que
 * personne l'inscrive nulle part.
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
/** Le point d'émission unique — le SEUL fichier autorisé à construire l'événement. */
const DISPATCH_MODULE = "editor-events.ts";

/** Tous les `.ts` de production du plugin (hors tests et mocks). */
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

/** Les noms `geoleaf:editor:*` déclarés dans `GeoLeafEventMap`, lus dans le contrat. */
function contractEventNames(): string[] {
    const src = readFileSync(CONTRACT, "utf8");
    const start = src.indexOf("export interface GeoLeafEventMap {");
    const body = src.slice(start, src.indexOf("\n}", start));
    return [...body.matchAll(/"(geoleaf:editor:[a-z-]+)"\s*:/g)].map((m) => m[1]).sort();
}

/** Les noms émis par le plugin, relevés aux sites d'appel du point unique. */
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
        // Sans cette borne, un `SRC` déplacé ferait sortir tout le reste vert en n'ayant
        // scanné aucun fichier.
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
                `l'intégrateur ne peut ni découvrir ni vérifier. C'est la classe B-142.`
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
