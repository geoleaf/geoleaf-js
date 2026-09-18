/**
 * Guard RTS — the connector's renewal and the core's write drain call the SAME statuses
 * passing.
 *
 * ## Why one list is written twice
 *
 * `@geoleaf-plugins/connector` classifies how a renewal failed: a passing failure keeps the
 * session, a refusal ends it. The core's write drain classifies how a send failed with the same
 * words — `TRANSIENT_SERVER_STATUSES`, which it waits out instead of setting the capture aside.
 * One vocabulary, and it cannot be shared: the plugin never imports the core, and the core does
 * not import `@geoleaf/host-runtime` (`capabilities/offline/config-seam.ts` says why). The list
 * therefore lives in both files, and this guard fails the day they differ — a status the drain
 * waits out while the connector ends the session on it, or the reverse.
 *
 *   RTS-01  both declarations are found. The rule guarding the guard: an extractor that
 *           misses one would compare nothing and stay green.
 *   RTS-02  they list the same statuses, order aside.
 *
 * ## Proof by mutation — to replay before believing this guard
 *
 * Removing `429` from `TRANSIENT_RENEWAL_STATUSES` (`auth-client.ts`) must turn RTS-02 red;
 * renaming the constant must turn RTS-01 red.
 *
 * @see packages/plugins/connector/src/auth-client.ts — `TRANSIENT_RENEWAL_STATUSES`
 * @see packages/core/src/capabilities/offline/write/push-engine.ts — `TRANSIENT_SERVER_STATUSES`
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
const RENEWAL = path.join(packages.requireByDirName("connector").absDir, "src/auth-client.ts");

/**
 * The statuses of `const <name> … = new Set([…])` in a source file, sorted — or `null` when the
 * declaration is not there.
 */
function statusesOf(file: string, name: string): number[] | null {
    const source = fs.readFileSync(file, "utf8");
    const match = new RegExp(`const ${name}\\b[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(source);
    const list = match?.[1];
    if (list === undefined) return null;
    // ⚠️ Empty items are skipped BEFORE conversion: Prettier writes a long list with a trailing
    // comma, and `Number("")` is 0 — this extractor first read that comma as a status.
    return list
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
        .map(Number)
        .sort((a, b) => a - b);
}

describe("RTS — the renewal and the drain share their passing statuses", () => {
    const drain = statusesOf(DRAIN, "TRANSIENT_SERVER_STATUSES");
    const renewal = statusesOf(RENEWAL, "TRANSIENT_RENEWAL_STATUSES");

    it("RTS-01 — both declarations are found", () => {
        expect(
            drain,
            `TRANSIENT_SERVER_STATUSES not found in ${path.relative(REPO, DRAIN)}`
        ).not.toBeNull();
        expect(
            renewal,
            `TRANSIENT_RENEWAL_STATUSES not found in ${path.relative(REPO, RENEWAL)}`
        ).not.toBeNull();
        expect(drain?.length ?? 0).toBeGreaterThan(0);
    });

    it("RTS-02 — they list the same statuses", () => {
        expect(renewal).toEqual(drain);
    });
});
