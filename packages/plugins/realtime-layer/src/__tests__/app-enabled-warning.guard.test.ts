/**
 * Guard — a `realtime.enabled` that is not a boolean is SAID in the delivered application.
 *
 * The plugin warns about it (`bootFromProfile`, RT-03), but the application only loads the plugin
 * when the profile asks for it with `enabled === true`: a string `"true"` kept the plugin out, and
 * the warning never left. The application's profile scan (`_scanProfileNeeds` in the app's
 * `init.js`) must therefore say it itself, with the plugin's words.
 *
 * The function is read from the application's source and run in a sandbox: `init.js` is a plain
 * script with no exports, and copying the function here would test the copy.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../../..");
// The application is not a package of `packages/`: its one deployable source sits at this path,
// which the core's lazy-plugin guard reads the same way.
const INIT_JS = path.join(REPO, "apps", "geoleaf-app", "init.js");

type Needs = { realtime: boolean; websocket: boolean };

/** A top-level function's source, read from `init.js`. */
function functionSource(src: string, name: string): string {
    const start = src.indexOf(`function ${name}(`);
    expect(start, `${name} is no longer in init.js`).toBeGreaterThan(-1);
    const end = src.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end + 2);
}

/**
 * `_scanProfileNeeds` from the app's source, with `console.warn` spied. Every top-level function of
 * `init.js` it calls is loaded beside it: a helper left out fails the run by name, it does not hide.
 */
function loadScan(): { scan: (node: unknown) => Needs; warn: ReturnType<typeof vi.fn> } {
    const src = readFileSync(INIT_JS, "utf8");
    const defined = [...src.matchAll(/^function (_\w+)\(/gm)].map((m) => m[1] as string);
    const body = functionSource(src, "_scanProfileNeeds");
    const helpers = defined.filter((n) => n !== "_scanProfileNeeds" && body.includes(`${n}(`));
    const code = [...helpers.map((n) => functionSource(src, n)), body].join("\n");
    const warn = vi.fn();
    const sandbox: Record<string, unknown> = { console: { warn } };
    vm.runInNewContext(`${code}\nthis.scan = _scanProfileNeeds;`, sandbox);
    return { scan: sandbox["scan"] as (node: unknown) => Needs, warn };
}

const profile = (enabled: unknown) => ({
    layers: [{ id: "buses", data: { realtime: { enabled, source: "polling" } } }],
});

describe("the app's profile scan and `realtime.enabled`", () => {
    it("warns, with the plugin's words, when `enabled` is not a boolean — and loads nothing", () => {
        const { scan, warn } = loadScan();
        const needs = scan(profile("true"));
        expect(needs.realtime).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]?.[0]);
        expect(message).toContain("data.realtime.enabled must be a boolean");
        expect(message).toContain('"buses"');
        expect(message).toContain('"true"');
    });

    it("stays silent on a boolean, and loads the plugin on `true`", () => {
        const { scan, warn } = loadScan();
        expect(scan(profile(true)).realtime).toBe(true);
        expect(scan(profile(false)).realtime).toBe(false);
        expect(
            scan({ layers: [{ id: "x", data: { realtime: { source: "sse" } } }] }).realtime
        ).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });
});
