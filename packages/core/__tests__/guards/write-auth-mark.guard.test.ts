/**
 * Guard WAM — the core's write drain and the connector name the SAME member of a request's
 * `init` for what a layer declared as `write.auth`.
 *
 * ## Why one name is written twice
 *
 * A layer says how its writes are authenticated; the one who attaches the credential is the
 * connector plugin, which intercepts `fetch`. The core cannot tell it directly — it imports no
 * plugin, and the plugin never imports the core — so the drain puts the declaration ON the
 * request, as a member of its `init`, and the interceptor reads it there. The name of that
 * member therefore lives in both files. The day they differ, a layer declared
 * `write.auth: "none"` gets the session's token again, and nothing says so: the request still
 * succeeds.
 *
 *   WAM-01  both declarations are found. The rule guarding the guard: an extractor that
 *           misses one would compare nothing and stay green.
 *   WAM-02  they are the same name.
 *
 * ## Proof by mutation — to replay before believing this guard
 *
 * Changing the literal of `WRITE_AUTH_MARK` in the connector's `fetch-interceptor.ts` must
 * turn WAM-02 red; renaming the constant must turn WAM-01 red.
 *
 * @see packages/core/src/capabilities/offline/write/push-engine.ts — `WRITE_AUTH_MARK`
 * @see packages/plugins/connector/src/fetch-interceptor.ts — `WRITE_AUTH_MARK`
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

// `packages.cjs` is the packages' single registry, and it THROWS when a package is not found —
// which is why no `packages/<name>` path is written here by hand.
const packages = createRequire(import.meta.url)(path.join(REPO, "scripts/lib/packages.cjs"));

const DRAIN = path.join(
    packages.requireByDirName("core").absDir,
    "src/capabilities/offline/write/push-engine.ts"
);
const INTERCEPTOR = path.join(
    packages.requireByDirName("connector").absDir,
    "src/fetch-interceptor.ts"
);

/** The string literal of `const WRITE_AUTH_MARK = "…"` in a source file, or `null`. */
function markOf(file: string): string | null {
    const source = fs.readFileSync(file, "utf8");
    return /^const WRITE_AUTH_MARK = "([^"]+)";/m.exec(source)?.[1] ?? null;
}

describe("garde — la marque d'authentification d'une écriture porte un seul nom", () => {
    const drain = markOf(DRAIN);
    const interceptor = markOf(INTERCEPTOR);

    it("WAM-01 : les deux déclarations sont trouvées", () => {
        expect(drain, "WRITE_AUTH_MARK introuvable dans le drain du core").not.toBeNull();
        expect(interceptor, "WRITE_AUTH_MARK introuvable dans l'intercepteur").not.toBeNull();
    });

    it("WAM-02 : le drain et l'intercepteur écrivent le même nom", () => {
        expect(interceptor).toBe(drain);
    });

    it("WAM-02 : le drain POSE la marque sous ce nom, et pas sous un littéral voisin", () => {
        // `authMark()` builds the fragment with a computed key: the constant is what
        // names the member, so the two cannot drift inside the file.
        const source = fs.readFileSync(DRAIN, "utf8");
        expect(source).toMatch(/\{ \[WRITE_AUTH_MARK\]: target\.auth \}/);
    });
});
