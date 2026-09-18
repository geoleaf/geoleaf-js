/**
 * @file published-parity-pack-shape.guard.test.ts
 * @description Guard test — the parity gate reads `npm pack --dry-run --json` under npm ≤ 11
 * AND under npm 12, and refuses to conclude on any other shape.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **The gate crashed on the one machine that publishes, after passing everywhere else.**
 * `localFileHashes` read `JSON.parse(out)[0]`. npm 10 prints an ARRAY, `[ { name, files } ]`;
 * npm 12.0.2 prints an OBJECT keyed by package name, `{ "<name>": { name, files } }` — measured
 * 18/09/2026 on `@geoleaf-plugins/cog`, entry keys identical, root shape only. `publish.yml`
 * pins npm 12 for trusted publishing, while a workstation runs whatever it has: `[0]` read
 * `undefined` on the publication runner, and `release:check` died on a `TypeError` in front of
 * the irreversible act. `ci:local` and `release:check --strict` were green locally, under npm 10.
 *
 * ⚠️ **And it had never compared anything there before.** On 09/09/2026, under the same npm
 * 12.0.2, the runner's PUB printed "PUB-00 SAUTÉ — aucun paquet n'a pu être confronté": the
 * gate that guards publication had skipped its whole corpus on the machine that publishes. The
 * first run that reached the comparison is the one that crashed.
 *
 * What it locks
 * ------------------------------------------------------------------------------------
 * Both measured shapes yield the entry. Every other shape THROWS a `PackShapeError` — it must
 * not return `null`, because the caller turns `null` into a PUB-00 note ("nothing compared"),
 * which does not redden: an unreadable output would then let the gate conclude green before a
 * publication, having compared nothing. Proven red first: `packEntry` did not exist, and the
 * gate itself was run under npm 12 before and after the fix.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface PackFile {
    path: string;
    size: number;
    mode: number;
}
interface PackEntryShape {
    name: string;
    files: PackFile[];
}
interface NpmRegistry {
    packEntry(parsed: unknown): PackEntryShape;
}

const lib: NpmRegistry = requireCjs("../../../../scripts/lib/npm-registry.cjs");

/** The entry both npm majors print for one package — only the ROOT around it differs. */
const ENTRY: PackEntryShape = {
    name: "@geoleaf-plugins/cog",
    files: [
        { path: "LICENSE", size: 1072, mode: 420 },
        { path: "dist/index.js", size: 2048, mode: 420 },
    ],
};

/** The thrown value's `name`, or `undefined` when nothing was thrown. */
function thrownName(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (err) {
        return (err as Error).name;
    }
    return undefined;
}

describe("PUB — la sortie de `npm pack --dry-run --json`, sous npm ≤ 11 ET sous npm 12", () => {
    it("lit la forme TABLEAU de npm ≤ 11", () => {
        expect(lib.packEntry([ENTRY]).files).toEqual(ENTRY.files);
    });

    it("lit la forme OBJET de npm 12 — celle du runner de publication", () => {
        expect(lib.packEntry({ [ENTRY.name]: ENTRY }).files).toEqual(ENTRY.files);
    });

    it.each([
        ["un tableau vide", []],
        ["un objet vide", {}],
        ["null", null],
        ["une chaîne", "npm notice"],
        ["une entrée sans `files` (tableau)", [{ name: ENTRY.name }]],
        ["une entrée sans `files` (objet)", { [ENTRY.name]: { name: ENTRY.name } }],
        ["deux paquets dans un tableau", [ENTRY, ENTRY]],
        ["deux paquets dans un objet", { a: ENTRY, b: ENTRY }],
    ])("refuse de conclure sur %s — elle jette, elle ne rend pas `null`", (_label, parsed) => {
        expect(thrownName(() => lib.packEntry(parsed))).toBe("PackShapeError");
    });
});
