/**
 * @geoleaf-plugins/isochrone — does every dictionary say what the code asks for?
 *
 * `GeoLeaf.I18n.getLabel` answers with the KEY when it does not know it: a label missing from
 * one language shows the raw key there, and nothing turns red at runtime. The keys are
 * therefore found by reading the source — every `"isochrone.*"` literal — and each one must be
 * declared, non-empty and with the same placeholders, in all six languages. A key no source
 * reads is refused too: a dead entry is a label nobody will notice going wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// ⚠️ Prefixed `L_`: the Italian dictionary would otherwise import as `it`, the test function.
import L_de from "../lang/lang-de.js";
import L_en from "../lang/lang-en.js";
import L_es from "../lang/lang-es.js";
import L_fr from "../lang/lang-fr.js";
import L_it from "../lang/lang-it.js";
import L_pt from "../lang/lang-pt.js";

const ALL: Record<string, Record<string, string>> = {
    fr: L_fr,
    en: L_en,
    es: L_es,
    pt: L_pt,
    it: L_it,
    de: L_de,
};

/** The package's `src/`, reached from this file — never by a path written from the root. */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `"isochrone.<key>"` inside a string literal. */
const KEY_RE = /["'`](isochrone\.[a-zA-Z0-9_.]+)["'`]/g;

/** A `{name}` placeholder. */
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** Strips comments, so prose that cites a key is not read as code. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The package's sources, without the tests and the dictionaries themselves. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "lang") continue;
            out.push(...sourceFiles(p));
        } else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
            out.push(p);
        }
    }
    return out;
}

const files = sourceFiles(SRC);
const used = new Set<string>();
for (const file of files) {
    for (const m of stripComments(fs.readFileSync(file, "utf8")).matchAll(KEY_RE)) {
        if (m[1]) used.add(m[1]);
    }
}

/** The placeholders of a label, sorted. */
function placeholders(text: string): string[] {
    return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] ?? "").sort();
}

describe("the scanned corpus", () => {
    // A guard that reads nothing comes out green guarding nothing.
    it("reads the window, the list and the entry", () => {
        const names = files.map((f) => path.relative(SRC, f).replaceAll(path.sep, "/"));
        expect(names).toEqual(
            expect.arrayContaining(["entry.ts", "ui/floating-window.ts", "ui/layer-list.ts"])
        );
        expect(used.size).toBeGreaterThan(30);
    });
});

describe.each(Object.keys(ALL))("the %s dictionary", (lang) => {
    const dict = ALL[lang] ?? {};

    it("declares every key the code reads", () => {
        expect([...used].filter((k) => !(k in dict))).toEqual([]);
    });

    it("declares no key the code does not read", () => {
        expect(Object.keys(dict).filter((k) => !used.has(k))).toEqual([]);
    });

    it("has no empty label", () => {
        expect(Object.entries(dict).filter(([, v]) => v.trim() === "")).toEqual([]);
    });

    it("keeps the French placeholders, no more, no fewer", () => {
        const french: Record<string, string> = L_fr;
        const drift = Object.keys(french).filter(
            (k) => placeholders(dict[k] ?? "").join() !== placeholders(french[k] ?? "").join()
        );
        expect(drift).toEqual([]);
    });
});
