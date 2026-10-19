/**
 * @file publish-plugins-continues.guard.test.ts
 * @description Guard test — one plugin that fails to publish no longer stops the plugins after it.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **A single refused plugin used to cut the wave short.** On 18/10/2026 the registry refused
 * `@geoleaf-plugins/isochrone` (E404: its trusted-publisher link had gone stale), and
 * `publish-plugins.cjs` exited on the spot: `measure`, next in alphabetical order, was never
 * attempted and had to be published by a second run. The order among plugins is indifferent —
 * no plugin depends on another, as the script's own docblock measures — so nothing justified
 * stopping.
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * The script attempts EVERY plugin, then exits 1 and names each failure. It runs the REAL script
 * with a fake `npm` first in `PATH`, in `--dry-run`: the fake records which workspaces were
 * attempted and refuses one of them.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const SCRIPT = join(ROOT, "scripts", "publish-plugins.cjs");

/**
 * `npm view` knows every package, none at the version this repo declares; `npm publish`
 * logs its workspace, and refuses the one named by `FAKE_NPM_REFUSE`.
 */
const FAKE_NPM = `#!/bin/sh
case "$1" in
    view) printf '%s' '["0.0.1"]'; exit 0 ;;
    publish)
        ws=""
        for a in "$@"; do case "$a" in --workspace=*) ws="\${a#--workspace=}" ;; esac; done
        printf '%s\\n' "$ws" >> "$FAKE_NPM_LOG"
        [ "$ws" = "$FAKE_NPM_REFUSE" ] && { echo "npm error code E404" >&2; exit 1; }
        exit 0 ;;
    *) echo "fake npm: no $1" >&2; exit 97 ;;
esac
`;

let fakeDir = "";

describe("publish-plugins — un greffon refusé n'arrête plus la vague", () => {
    beforeAll(() => {
        fakeDir = mkdtempSync(join(tmpdir(), "geoleaf-fake-npm-publish-"));
        const bin = join(fakeDir, "npm");
        writeFileSync(bin, FAKE_NPM, { encoding: "utf8" });
        chmodSync(bin, 0o755);
    });

    afterAll(() => {
        rmSync(fakeDir, { recursive: true, force: true });
    });

    it("🛑 tente le greffon qui suit le refusé, puis sort en 1 en le nommant", () => {
        const log = join(fakeDir, "attempted.log");
        writeFileSync(log, "", { encoding: "utf8" });
        const res = spawnSync(process.execPath, [SCRIPT, "--dry-run"], {
            cwd: ROOT,
            env: {
                ...process.env,
                PATH: `${fakeDir}:${process.env.PATH ?? ""}`,
                FAKE_NPM_LOG: log,
                FAKE_NPM_REFUSE: "@geoleaf-plugins/isochrone",
            },
            encoding: "utf8",
        });
        const attempted = readFileSync(log, { encoding: "utf8" }).split("\n").filter(Boolean);
        const out = `${res.stdout}${res.stderr}`;

        expect(attempted).toContain("@geoleaf-plugins/isochrone");
        expect(attempted).toContain("@geoleaf-plugins/measure");
        expect(attempted).toContain("@geoleaf-plugins/websocket");
        expect(res.status).toBe(1);
        expect(out).toMatch(/1 échec\(s\)[^\n]*@geoleaf-plugins\/isochrone/);
    });
});
