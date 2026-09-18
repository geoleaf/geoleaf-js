/**
 * @file published-parity-registry-answer.guard.test.ts
 * @description Guard test — in front of a publication, the parity gate refuses to conclude when
 * the registry did not answer, instead of skipping green.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **The gate that guards publication skipped its whole corpus on the machine that publishes,
 * and exited 0.** On 09/09/2026 the publication runner printed "PUB-00 SAUTÉ — aucun paquet n'a
 * pu être confronté au registre (0 téléchargement(s) en échec)". Two pieces composed it:
 *
 *   • `alreadyPublished` read EVERY failure of `npm view` as "this version is not published" — a
 *     refused connection, an authentication error, a registry answering 404 for everything — so a
 *     registry that could not be read looked like seventeen versions awaiting publication;
 *   • PUB-00 skipped with exit 0 wherever it ran, `release:check` included.
 *
 * Reproduced on 18/09/2026 with the runner's npm (12.0.2), against a registry refusing the
 * connection AND against one answering 404 everywhere: the same line, and exit 0, both times.
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * The registry's answer is read from `npm view <name> versions --json` — one shape under npm 10
 * and npm 12, measured on the seventeen public packages — into four states, and only a list of
 * versions or an E404 is an answer. Under `release:check` (`GEOLEAF_RELEASE_CHECK=1`), the gate
 * refuses to conclude when a package could not be confronted, or when the registry knows none of
 * the public packages. Outside it, the skip stays a loud exit 0: an offline workstation proves
 * nothing, and must not be red for it.
 *
 * ⚠️ The end-to-end cases run the REAL gate with a fake `npm` first in `PATH`: offline,
 * deterministic, and faithful to both call shapes — the one before the fix and the one after.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../../../..");
const GATE = join(ROOT, "scripts", "verify-published-parity.cjs");

type RegistryState = "published" | "version-absent" | "package-absent" | "unknown";
interface RegistryAnswer {
    state: RegistryState;
    code?: string;
}
interface NpmRegistry {
    readRegistryAnswer(stdout: string, version: string): RegistryAnswer;
}

const lib: NpmRegistry = requireCjs("../../../../scripts/lib/npm-registry.cjs");

// ── What `npm view <name> versions --json` printed, measured under npm 10.9.8 and 12.0.2 ────
const VERSIONS = '[\n  "2.1.7",\n  "3.0.0",\n  "3.3.0"\n]';
const E404 =
    '{\n  "error": {\n    "code": "E404",\n    "summary": "Not Found - GET https://registry.npmjs.org/@geoleaf%2fdoes-not-exist-xyz - Not found"\n  }\n}';
const REFUSED =
    '{\n  "error": {\n    "code": "ECONNREFUSED",\n    "summary": "FetchError: request to http://127.0.0.1:9/@geoleaf%2fcore failed, reason: connect ECONNREFUSED 127.0.0.1:9"\n  }\n}';

describe("PUB — ce que la réponse du registre veut dire, sous npm 10 ET npm 12", () => {
    it("une version présente dans la liste est publiée", () => {
        expect(lib.readRegistryAnswer(VERSIONS, "3.3.0").state).toBe("published");
    });

    it("une version absente d'une liste LUE est une version en attente de publication", () => {
        expect(lib.readRegistryAnswer(VERSIONS, "3.4.0").state).toBe("version-absent");
    });

    it("un E404 dit que le registre ne connaît pas le PAQUET", () => {
        expect(lib.readRegistryAnswer(E404, "1.0.0").state).toBe("package-absent");
    });

    it.each([
        ["une connexion refusée", REFUSED, "ECONNREFUSED"],
        ["une sortie vide", "", "unreadable"],
        ["une sortie illisible", "npm notice", "unreadable"],
        ["une erreur sans code", '{ "error": {} }', "unreadable"],
        // Both measured majors print an ARRAY, a single version included: any other shape is
        // unknown to this instrument, and refusing is the safe reading (see `packEntry`).
        ["une chaîne seule, forme qu'aucun npm mesuré n'imprime", '"1.0.0"', "unreadable"],
    ])("🛑 %s n'est PAS une réponse — l'état est inconnu, jamais « absent »", (_l, out, code) => {
        expect(lib.readRegistryAnswer(out, "1.0.0")).toEqual({ state: "unknown", code });
    });
});

/**
 * A fake `npm`, faithful to both call shapes of `npm view`, per `FAKE_NPM_MODE`.
 *
 * POSIX `sh` rather than Node: the gate calls it once per public package, and a Node start-up
 * per call made each case cost two seconds.
 */
const FAKE_NPM = `#!/bin/sh
[ "$1" = "view" ] || { echo "fake npm: no $1" >&2; exit 97; }
case "$FAKE_NPM_MODE" in
    refused)
        printf '%s' '{"error":{"code":"ECONNREFUSED","summary":"connect ECONNREFUSED 127.0.0.1:9"}}'
        exit 1 ;;
    not-found)
        printf '%s' '{"error":{"code":"E404","summary":"Not Found - GET https://registry.invalid/"}}'
        exit 1 ;;
    all-bumped)
        # Every package known to the registry, none at the version this repo declares.
        if [ "$3" = "versions" ]; then printf '%s' '["0.0.1"]'; exit 0; fi
        printf '%s' '{"error":{"code":"E404","summary":"No match found for version"}}'
        exit 1 ;;
    *) exit 98 ;;
esac
`;

let fakeDir = "";

interface GateRun {
    status: number | null;
    out: string;
}

/** Runs the real gate with the fake `npm` first in `PATH`. */
function runGate(mode: string, release: boolean): GateRun {
    const { GEOLEAF_RELEASE_CHECK: _inherited, ...base } = process.env;
    const env: NodeJS.ProcessEnv = {
        ...base,
        PATH: `${fakeDir}:${process.env.PATH ?? ""}`,
        FAKE_NPM_MODE: mode,
        ...(release ? { GEOLEAF_RELEASE_CHECK: "1" } : {}),
    };
    const res = spawnSync(process.execPath, [GATE], { cwd: ROOT, env, encoding: "utf8" });
    // The words asserted below carry no colour code: the output is read as printed.
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("PUB-00 — devant une publication, un registre muet n'est pas un vert", () => {
    beforeAll(() => {
        fakeDir = mkdtempSync(join(tmpdir(), "geoleaf-fake-npm-"));
        const bin = join(fakeDir, "npm");
        writeFileSync(bin, FAKE_NPM);
        chmodSync(bin, 0o755);
    });

    afterAll(() => {
        rmSync(fakeDir, { recursive: true, force: true });
    });

    it("🛑 registre injoignable, sous release:check : la gate refuse de conclure", () => {
        const run = runGate("refused", true);
        expect(run.status).toBe(1);
        expect(run.out).toMatch(/PUB-00.*non confronté/);
    }, 60_000);

    it("🛑 registre qui ne connaît AUCUN paquet public, sous release:check : refus", () => {
        const run = runGate("not-found", true);
        expect(run.status).toBe(1);
        expect(run.out).toMatch(/PUB-00.*ne connaît aucun/);
    }, 60_000);

    it("contre-épreuve : hors release:check, le même registre injoignable reste un saut NOMMÉ", () => {
        const run = runGate("refused", false);
        expect(run.status).toBe(0);
        expect(run.out).toMatch(/SAUTÉ/);
        expect(run.out).toMatch(/non confronté/);
    }, 60_000);

    it("contre-épreuve : tous les paquets bumpés d'un coup — le vide est légitime, pas de refus", () => {
        // The remedy PUB-05 prescribes for a toolchain change is to bump every package: that
        // publication must not be blocked by the rule that closes the skip.
        const run = runGate("all-bumped", true);
        expect(run.status).toBe(0);
    }, 60_000);
});
