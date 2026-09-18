/**
 * @file published-parity-normalize.guard.test.ts
 * @description Guard test — the chunk-hash normalization behind PUB-05 strips exactly
 * Rollup's content hashes, leaves every other byte judged, and refuses to conclude on a
 * collision.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * The published-parity gate judges a package that ships no `src/` through its `dist/`.
 * Rollup names chunks `<name>-<hash>.js`, and the hash differs between two machines
 * building the same sources, so a raw comparison is noise. A normalization that matches
 * too little reddens on that noise; one that matches too much goes green by blurring a
 * real divergence — the worse of the two, since nothing says so. These cases pin the rule
 * to the chunk names this repository actually emits, and to what it must NOT erase.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface NpmRegistry {
    normalizeChunkHashes(text: string): string;
    hashEntries(
        entries: { rel: string; abs: string }[]
    ): Map<string, string> & { originals: Map<string, string> };
}

const lib: NpmRegistry = requireCjs("../../../../scripts/lib/npm-registry.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-pub-normalize-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Writes a throwaway file and returns its absolute path. */
function fixture(name: string, content: string): string {
    const abs = path.join(tmp, name);
    fs.writeFileSync(abs, content, "utf8");
    return abs;
}

describe("PUB-05 — normalisation des noms de chunks", () => {
    it("retire un hash qui contient lui-même un tiret (motif du core)", () => {
        expect(lib.normalizeChunkHashes("dist/chunks/geoleaf-chunk-core-utils-BT-vtPKw.js")).toBe(
            "dist/chunks/geoleaf-chunk-core-utils.js"
        );
    });

    it("retire le hash d'un chunk dont le nom porte un point (motif des plugins)", () => {
        expect(lib.normalizeChunkHashes("dist/geoleaf-editor.modes-Csy1EyXY.js")).toBe(
            "dist/geoleaf-editor.modes.js"
        );
    });

    it("réécrit une référence de chunk dans un contenu, et rien d'autre", () => {
        const src = 'import{a}from"./chunks/geoleaf-bundle-esm-entry-Csy1EyXY.js";const v="1.0.0";';
        expect(lib.normalizeChunkHashes(src)).toBe(
            'import{a}from"./chunks/geoleaf-bundle-esm-entry.js";const v="1.0.0";'
        );
    });

    it("laisse une déclaration intacte, et traite une map comme son chunk", () => {
        expect(lib.normalizeChunkHashes("dist/types/contracts/event-bus.contract.d.ts")).toBe(
            "dist/types/contracts/event-bus.contract.d.ts"
        );
        expect(lib.normalizeChunkHashes("dist/geoleaf-print.jspdf-AbCd1234.js.map")).toBe(
            "dist/geoleaf-print.jspdf.js.map"
        );
    });

    // 🛑 The case that made the first version of the rule refuse to conclude on the real core:
    // an unhashed granular entry whose last segment happens to be an eight-letter word.
    it("ne prend pas un mot de huit lettres pour un hash hors des chunks geoleaf-*", () => {
        expect(
            lib.normalizeChunkHashes("dist/esm/adapters/maplibre/maplibre-cluster-builders.js")
        ).toBe("dist/esm/adapters/maplibre/maplibre-cluster-builders.js");
    });

    // ⚠️ The imprecision the rule accepts, pinned rather than hidden: a `geoleaf-` name ending
    // in an eight-letter word IS rewritten (one published file, measured). Harmless only
    // because the rewrite is the same on both sides — the `hashEntries` cases below prove that
    // a real change still shows, and that two files are never merged in silence.
    it("réécrit aussi un nom geoleaf-* terminé par un mot de huit lettres — symétriquement", () => {
        expect(lib.normalizeChunkHashes("dist/geoleaf-field-renderer.js")).toBe(
            "dist/geoleaf-field.js"
        );
    });

    it("sous dist/, deux builds qui ne diffèrent que par leurs hashes ont la même empreinte", () => {
        const a = lib.hashEntries([
            {
                rel: "dist/geoleaf-entry-AAAAAAAA.js",
                abs: fixture("a.js", 'import"./geoleaf-x-11111111.js";'),
            },
        ]);
        const b = lib.hashEntries([
            {
                rel: "dist/geoleaf-entry-BBBBBBBB.js",
                abs: fixture("b.js", 'import"./geoleaf-x-22222222.js";'),
            },
        ]);
        expect([...a.keys()]).toEqual(["dist/geoleaf-entry.js"]);
        expect(a.get("dist/geoleaf-entry.js")).toBe(b.get("dist/geoleaf-entry.js"));
        expect(a.originals.get("dist/geoleaf-entry.js")).toBe("dist/geoleaf-entry-AAAAAAAA.js");
    });

    it("sous dist/, un changement hors hash reste visible — rien d'autre n'est effacé", () => {
        const a = lib.hashEntries([{ rel: "dist/m.js", abs: fixture("m1.js", 'const v="a";') }]);
        const b = lib.hashEntries([{ rel: "dist/m.js", abs: fixture("m2.js", 'const v="b";') }]);
        expect(a.get("dist/m.js")).not.toBe(b.get("dist/m.js"));
    });

    it("hors de dist/, le fichier est haché tel quel", () => {
        const a = lib.hashEntries([
            { rel: "README.md", abs: fixture("r1.md", "voir x-11111111.js") },
        ]);
        const b = lib.hashEntries([
            { rel: "README.md", abs: fixture("r2.md", "voir x-22222222.js") },
        ]);
        expect(a.get("README.md")).not.toBe(b.get("README.md"));
    });

    it("refuse de conclure quand deux fichiers deviennent indiscernables, avant toute lecture", () => {
        expect(() =>
            lib.hashEntries([
                { rel: "dist/geoleaf-chunk-AAAAAAAA.js", abs: path.join(tmp, "absent-a") },
                { rel: "dist/geoleaf-chunk-BBBBBBBB.js", abs: path.join(tmp, "absent-b") },
            ])
        ).toThrow(/normalisation ambiguë/);
    });
});
