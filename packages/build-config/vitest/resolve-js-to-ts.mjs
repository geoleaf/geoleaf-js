/**
 * Shared Vitest/Vite plugin — resolveJsToTs.
 *
 * Resolves relative `.js` imports to their `.ts` counterpart at test time, which
 * the monorepo ESM convention requires: source files import with a `.js`
 * extension (TypeScript ESM interop) while the file on disk is `.ts`.
 *
 * Two complementary hooks:
 *  1. `resolveId` — intercepts Vite's module-graph resolution (static imports in
 *     test files going through Vite's SSR module runner).
 *  2. `transform` — rewrites `.js` imports IN source code before esbuild/Vite
 *     transforms it. Load-bearing for CJS-mode loading (forks pool via
 *     `createRequire`): esbuild turns `import { X } from "./foo.js"` into
 *     `require("./foo.js")`, and without the rewrite the native require cannot
 *     find the file.
 *
 * Typed in JSDoc rather than TypeScript — see ensure-tsx-node-options.mjs for why
 * everything under build-config/ is `.mjs` (ARCHI S9.3).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Vite plugin resolving `.js` relative imports to their `.ts` counterpart.
 * @type {import('vite').Plugin}
 */
export const resolveJsToTs = {
    name: "geoleaf-resolve-js-to-ts",
    enforce: "pre",
    resolveId(id, importer) {
        if (!importer || !id.startsWith(".") || !id.endsWith(".js")) return null;
        let importerPath = importer;
        if (importerPath.startsWith("file://")) {
            importerPath = fileURLToPath(importerPath);
        }
        const tsPath = resolve(dirname(importerPath), id.slice(0, -3) + ".ts");
        if (existsSync(tsPath)) {
            return tsPath;
        }
        return null;
    },
    transform(code, id) {
        // Only rewrite imports in TypeScript source files (not tests, not node_modules)
        if (
            !id.endsWith(".ts") ||
            id.endsWith(".d.ts") ||
            id.includes("node_modules") ||
            id.includes("__tests__") ||
            id.includes("vitest.config")
        ) {
            return null;
        }
        // Rewrite: from './foo.js' → from './foo.ts' when foo.ts exists on disk
        const rewritten = code.replace(
            /(from\s+['"])(\.{1,2}[^'"]*?)(\.js)(['"])/g,
            (_match, prefix, path, _ext, suffix) => {
                const dir = dirname(id);
                const tsPath = resolve(dir, path + ".ts");
                if (existsSync(tsPath)) {
                    return `${prefix}${path}.ts${suffix}`;
                }
                return _match;
            }
        );
        return rewritten !== code ? { code: rewritten } : null;
    },
};
