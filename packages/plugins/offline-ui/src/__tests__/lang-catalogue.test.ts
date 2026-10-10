/**
 * The catalogue and the code agree: every `storage.*` key the plugin READS is declared, and the
 * six languages carry the same keys.
 *
 * 🛑 WHY A STATIC GUARD. `GeoLeaf.I18n.getLabel` answers THE KEY for a label it does not know —
 * that is its contract. Nothing turns red at runtime: a missing label is a key on screen, seen
 * by whoever opens that panel in that language, and by no test. The cache window and the export
 * panel used to write their labels as literals, outside the catalogue; moving them into it is
 * what makes a typo in a key possible, and this is what catches it.
 *
 * ⚠️ Parity is also held at COMPILE time (`StorageLangDict = typeof langStorageFr`, the five
 * others annotated with it). It is asserted here too because a value can be an empty string
 * and still satisfy the type.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ⚠️ Prefixed `L_`: the Italian locale would import under the name `it`, vitest's own.
import L_fr from "../lang/lang-fr.js";
import L_en from "../lang/lang-en.js";
import L_es from "../lang/lang-es.js";
import L_de from "../lang/lang-de.js";
import L_it from "../lang/lang-it.js";
import L_pt from "../lang/lang-pt.js";

const ALL: Record<string, Record<string, string>> = {
    fr: L_fr,
    en: L_en,
    es: L_es,
    de: L_de,
    it: L_it,
    pt: L_pt,
};

/** The plugin's own sources, found from this file — never a path spelled out. */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `"storage.<some.thing>"` as a COMPLETE string literal: a key assembled by template is not one. */
const KEY_RE = /["'`](storage\.[a-zA-Z0-9_.-]+)["'`]/g;

/** Strips comments before the sweep: a key cited in prose is not a key read. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Source files, without the tests, the mocks and the catalogues themselves. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (/^(__tests__|__mocks__|lang)$/.test(e.name)) continue;
            out.push(...sourceFiles(p));
        } else if (/\.ts$/.test(e.name) && !/\.test\./.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

const files = sourceFiles(SRC);
const used = new Set<string>();
for (const f of files) {
    for (const m of stripComments(fs.readFileSync(f, "utf8")).matchAll(KEY_RE)) {
        // A literal ending with a dot is the stem of a key assembled at run time.
        if (!m[1]!.endsWith(".")) used.add(m[1]!);
    }
}

describe("le corpus scanné", () => {
    // A guard that reads nothing comes out green guarding nothing.
    it("lit des fichiers, et y trouve des clés", () => {
        expect(files.length).toBeGreaterThan(20);
        expect(used.size).toBeGreaterThan(80);
    });

    it("voit les clés de la fenêtre de cache et du panneau d'export", () => {
        for (const key of [
            "storage.status.title",
            "storage.export.json",
            "storage.download.stop",
        ]) {
            expect(used.has(key), `${key} n'est plus lue par le code`).toBe(true);
        }
    });
});

describe("toute clé `storage.*` lue par le code est DÉCLARÉE", () => {
    it("dans le catalogue français, la référence des cinq autres", () => {
        const missing = [...used].filter((k) => !(k in L_fr)).sort();
        expect(missing, `clés lues mais non déclarées : ${missing.join(", ")}`).toEqual([]);
    });
});

describe("les six langues sont à parité", () => {
    const reference = Object.keys(L_fr).sort();

    for (const [code, dict] of Object.entries(ALL)) {
        it(`\`${code}\` porte exactement les clés de \`fr\``, () => {
            expect(Object.keys(dict).sort()).toEqual(reference);
        });

        it(`\`${code}\` n'a aucune valeur vide`, () => {
            const empty = Object.entries(dict)
                .filter(([, v]) => typeof v !== "string" || v.trim() === "")
                .map(([k]) => k);
            expect(empty).toEqual([]);
        });
    }
});
