/**
 * @file third-party-notices.guard.test.ts
 * @description Guard test — `THIRD_PARTY_LICENSES.txt` carries the license comments of the
 * bundled sources, not only the `LICENSE` file of each bundled package.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **A package's `LICENSE` names its own authors; the code it vendors keeps its notices in its
 * sources only.** Measured on 27/09/2026, before a publication: the print plugin's file carried
 * jsPDF's `LICENSE` (James Hall, yWorks) while its bundle carried jsPDF's JPEG encoder, which is
 * Adobe's under BSD-3-Clause — a license that asks for its notice in every binary
 * redistribution — and omggif. cog carried pdf.js code (Apache-2.0) through geotiff and
 * Zstandard (BSD) through zstddec. Minification stripped every one of those notices, and the
 * generated file said it listed "what the built bundle actually carries".
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * `embeddedNotices` keeps a comment that asks to be kept (`/*!`, `@license`, `@preserve`),
 * states a copyright (`Copyright`, `(C) 1995`, `©`), says it is licensed or says where the code
 * was adapted from, once — a block
 * verbatim, or a run of `//` lines with each line's indentation removed; it drops an ordinary
 * comment; and a `/*` in mid-line never starts a match — unanchored, it swallowed code up to the
 * next comment's end.
 *
 * 🛑 It also reads the SOURCE MAP a bundled file ships, when that file is itself a build: jsPDF
 * and Terra Draw are published minified, their own build already stripped the notices of the
 * code THEY vendor (Google's WebP decoder, Adobe's font metrics; rbush, quickselect,
 * which-polygon), and those survive only in the `sourcesContent` of their maps. Measured on
 * 27/09/2026 by the second adversarial pass: 17 notices missing from print, 4 from editor,
 * and pako's Zlib notice — a run of `//` lines — from print and cog.
 *
 * Proven red first: `embeddedNotices` did not exist; the anchoring case reddens when the
 * pattern loses its `^`; the `//` run, `(C)` and upstream-map cases were red before they were
 * read.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);
const { embeddedNotices } = requireCjs("../../../../scripts/gen-third-party-licenses.cjs") as {
    embeddedNotices: (files: Iterable<string>) => string[];
};

const dir = mkdtempSync(join(tmpdir(), "geoleaf-notices-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function source(name: string, text: string): string {
    const file = join(dir, name);
    writeFileSync(file, text);
    return file;
}

describe("embeddedNotices — the license comments minification strips", () => {
    it("keeps `/*!`, `@license`, `@preserve` and copyright comments, verbatim", () => {
        const file = source(
            "a.js",
            [
                "/*! pkg 1.0 | MIT */",
                "/**",
                " * @license",
                " * Copyright (c) 2008, Adobe Systems Incorporated",
                " */",
                "function f() {",
                "    /* Copyright 2011 notmasteryet — Apache-2.0 */",
                "    /** @preserve kept */",
                "}",
            ].join("\n")
        );
        expect(embeddedNotices([file])).toEqual([
            "/*! pkg 1.0 | MIT */",
            "/**\n * @license\n * Copyright (c) 2008, Adobe Systems Incorporated\n */",
            "/* Copyright 2011 notmasteryet — Apache-2.0 */",
            "/** @preserve kept */",
        ]);
    });

    it("drops an ordinary comment", () => {
        const file = source("b.js", "/* parse the header */\n/** Returns the width. */\n");
        expect(embeddedNotices([file])).toEqual([]);
    });

    it("🛑 a `/*` in mid-line — in a string — never starts a match", () => {
        const file = source(
            "c.js",
            ['const accept = "image/*"; run(accept);', "/* Copyright 2020 X */", ""].join("\n")
        );
        expect(embeddedNotices([file])).toEqual(["/* Copyright 2020 X */"]);
    });

    it("🛑 keeps a run of `//` lines that states a copyright, `(C) <year>` included", () => {
        const file = source(
            "f.js",
            [
                "/*! pkg | MIT AND Zlib */",
                "// (C) 1995-2013 Jean-loup Gailly and Mark Adler",
                "//",
                "// This notice may not be removed or altered.",
                "",
                "// compute the window",
                "run();",
            ].join("\n")
        );
        expect(embeddedNotices([file])).toEqual([
            "/*! pkg | MIT AND Zlib */",
            "// (C) 1995-2013 Jean-loup Gailly and Mark Adler\n//\n// This notice may not be removed or altered.",
        ]);
    });

    it("🛑 reads the notices a pre-built file's own source map keeps", () => {
        const map = {
            version: 3,
            sources: ["../src/rbush.ts", "../src/plain.ts"],
            sourcesContent: [
                "// Based on rbush\n// Copyright (c) 2016 Vladimir Agafonkin\nexport class R {}\n",
                "/** Returns the width. */\nexport const w = 1;\n",
            ],
        };
        writeFileSync(join(dir, "g.min.js.map"), JSON.stringify(map));
        const file = source("g.min.js", "class R{}\n//# sourceMappingURL=g.min.js.map\n");
        expect(embeddedNotices([file])).toEqual([
            "// Based on rbush\n// Copyright (c) 2016 Vladimir Agafonkin",
        ]);
    });

    it("reads an inline source map too", () => {
        const map = { version: 3, sources: ["a.ts"], sourcesContent: ["/*! inline © X */\n"] };
        const url = `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`;
        const file = source("h.js", `x();\n//# sourceMappingURL=${url}\n`);
        expect(embeddedNotices([file])).toEqual(["/*! inline © X */"]);
    });

    it("🛑 keeps an attribution that says it is licensed, without a copyright line", () => {
        // Terra Draw adapts twelve Turf modules, each saying so in a `//` line and nothing more.
        const file = source(
            "i.js",
            "// Adapted from the @turf/bearing module which is MIT Licensed\nexport const b = 1;\n"
        );
        expect(embeddedNotices([file])).toEqual([
            "// Adapted from the @turf/bearing module which is MIT Licensed",
        ]);
    });

    it("🛑 keeps an attribution that only says where the code was adapted from", () => {
        // The twelfth Turf module does not say it is licensed; a snippet geotiff took from
        // Stack Overflow (CC BY-SA, whose attribution is itself a condition) neither.
        const file = source(
            "n.js",
            "// Adapted from @turf/rhumb-distance module\nexport const d = 1;\n"
        );
        expect(embeddedNotices([file])).toEqual(["// Adapted from @turf/rhumb-distance module"]);
    });

    it("an index map (`sections`) throws — it is not read", () => {
        writeFileSync(join(dir, "o.min.js.map"), JSON.stringify({ version: 3, sections: [] }));
        const file = source("o.min.js", "x();\n//# sourceMappingURL=o.min.js.map\n");
        expect(() => embeddedNotices([file])).toThrow(/index map/);
    });

    it("falls back on the `.map` beside a file whose named map is missing", () => {
        const map = { version: 3, sources: ["a.ts"], sourcesContent: ["/*! beside two */\n"] };
        writeFileSync(join(dir, "p.min.js.map"), JSON.stringify(map));
        const file = source("p.min.js", "x();\n//# sourceMappingURL=gone.js.map\n");
        expect(embeddedNotices([file])).toEqual(["/*! beside two */"]);
    });

    it("🛑 follows a `sourceMappingURL` only in a `//#` comment that opens a line", () => {
        const map = {
            version: 3,
            sources: ["a.ts"],
            sourcesContent: ["/*! must not be read */\n"],
        };
        writeFileSync(join(dir, "q.map"), JSON.stringify(map));
        // In a string, `//#` included. The space ends the token: unanchored, the match would
        // read `q.map` and follow it.
        const file = source("q.js", 'const s = "//# sourceMappingURL=q.map ";\n');
        expect(embeddedNotices([file])).toEqual([]);
    });

    it("keeps a `©` notice that says nothing else", () => {
        const file = source("j.js", "/* © 2020 Example Contributors */\nrun();\n");
        expect(embeddedNotices([file])).toEqual(["/* © 2020 Example Contributors */"]);
    });

    it("falls back on the `.map` beside a file that names none", () => {
        const map = { version: 3, sources: ["a.ts"], sourcesContent: ["/*! beside */\n"] };
        writeFileSync(join(dir, "k.min.js.map"), JSON.stringify(map));
        const file = source("k.min.js", "x();\n");
        expect(embeddedNotices([file])).toEqual(["/*! beside */"]);
    });

    it("🛑 reads from disk a source whose map carries no content", () => {
        writeFileSync(join(dir, "orig.ts"), "// Copyright (c) 2019 Original Author\nexport {};\n");
        const map = { version: 3, sources: ["orig.ts"], sourcesContent: [null] };
        writeFileSync(join(dir, "l.min.js.map"), JSON.stringify(map));
        const file = source("l.min.js", "x();\n//# sourceMappingURL=l.min.js.map\n");
        expect(embeddedNotices([file])).toEqual(["// Copyright (c) 2019 Original Author"]);
    });

    it("throws on a map it cannot read — a notice is never lost without a word", () => {
        writeFileSync(join(dir, "m.min.js.map"), "{ not json");
        const file = source("m.min.js", "x();\n//# sourceMappingURL=m.min.js.map\n");
        expect(() => embeddedNotices([file])).toThrow();
    });

    it("keeps a notice once across files, whitespace and leading `*` aside", () => {
        const one = source("d.js", "/*! @license dup */\n");
        const two = source("e.js", "  /*!  @license   dup */\n");
        expect(embeddedNotices([two, one])).toEqual(["/*! @license dup */"]);
    });
});
