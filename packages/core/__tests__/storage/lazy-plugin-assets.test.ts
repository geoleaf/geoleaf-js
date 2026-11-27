/**
 * @tests scripts/lib/lazy-plugin-assets — the plugins loaded on demand, derived from the deploy
 *
 * Driven against a fixture deploy directory: the entries come from `init.js` (query string
 * kept), their chunks from the files themselves, static and dynamic imports alike — the drawing
 * engine of a plugin is an `import()`, and it is what a user needs offline.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { deriveLazyPluginAssets, extractLazyPluginEntries } =
    require("../../../../scripts/lib/lazy-plugin-assets.cjs") as {
        deriveLazyPluginAssets(args: { outDir: string; bootAssets: string[] }): string[];
        extractLazyPluginEntries(code: string): string[];
    };

let dir = "";

/** A deploy directory with the given files. */
function deploy(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), "lazy-assets-"));
    mkdirSync(join(dir, "dist"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
}

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
});

describe("deriveLazyPluginAssets", () => {
    it("follows each entry's static AND dynamic imports, query string kept on the entry", () => {
        const out = deploy({
            "init.js": `gl.plugins.registerLazy("editor", () => import("./dist/geoleaf-editor.plugin.js?v=abc"));`,
            "dist/geoleaf-editor.plugin.js": `import{a}from"./geoleaf-editor.entry-X.js";`,
            "dist/geoleaf-editor.entry-X.js": `const m=()=>import("./geoleaf-editor.draw-Y.js");`,
            "dist/geoleaf-editor.draw-Y.js": `export const d=1;`,
        });
        expect(deriveLazyPluginAssets({ outDir: out, bootAssets: [] })).toEqual([
            "dist/geoleaf-editor.plugin.js?v=abc",
            "dist/geoleaf-editor.entry-X.js",
            "dist/geoleaf-editor.draw-Y.js",
        ]);
    });

    it("leaves out what the boot pre-cache already holds", () => {
        const out = deploy({
            "init.js": `import("./dist/geoleaf-a.plugin.js?v=1"); import("./dist/geoleaf-b.plugin.js?v=2");`,
            "dist/geoleaf-a.plugin.js": "",
            "dist/geoleaf-b.plugin.js": "",
        });
        expect(
            deriveLazyPluginAssets({ outDir: out, bootAssets: ["dist/geoleaf-a.plugin.js?v=1"] })
        ).toEqual(["dist/geoleaf-b.plugin.js?v=2"]);
    });

    it("refuses a derived URL with no file — one 404 would make the worker misreport", () => {
        const out = deploy({
            "init.js": `import("./dist/geoleaf-a.plugin.js?v=1");`,
            "dist/geoleaf-a.plugin.js": `import"./geoleaf-a.gone.js";`,
        });
        expect(() => deriveLazyPluginAssets({ outDir: out, bootAssets: [] })).toThrow(
            /geoleaf-a\.gone\.js/
        );
    });

    it("does not read an import that only a comment of init.js names", () => {
        expect(
            extractLazyPluginEntries(
                `// import("./dist/geoleaf-x.plugin.js")\n/* import("./dist/geoleaf-y.plugin.js") */`
            )
        ).toEqual([]);
    });
});
