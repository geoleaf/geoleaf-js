/**
 * Guard — the profile HARVEST loses nothing in silence.
 *
 * ## Why this guard exists, and why HERE
 *
 * `profile-switcher` only renders from two harvested profiles (PS-04). An
 * INTENDED degradation, not a defect. The guard's subject was thus never the
 * threshold: it is its **silence**. A `profile.json` gone unreadable, or a
 * profile directory that stops being harvested, makes the selector vanish
 * from the interface — and the only existing signal was a
 * `build-deploy.cjs` `log.warn` one had to be reading.
 *
 * 🛑 **The only gate that saw anything was `e2e/24-profile-switcher.spec.js`,
 * and it is on no default path**: `ci-local.cjs` reserves E2E for `--e2e`,
 * and `ci.yml`'s E2E steps carry `if: github.event_name ==
 * 'workflow_dispatch'`. A green `ci:local` and a green push were thus
 * compatible with the capability absent from the interface. This file is a
 * **unit test**, so it falls into "Unit tests" AND "Coverage gate", both in
 * `ci-local.cjs`'s `STEPS` (default path) and in `ci.yml`. That is the whole
 * difference, and the only motive for its location.
 *
 * ## What it asserts, and what it does NOT
 *
 * It asserts that **the harvest is lossless**: every directory
 * `build-deploy.cjs` considers a profile yields a valid entry, and that entry
 * survives the RUNTIME filter.
 *
 * ⚠️ It **does not require two profiles**. Shipping a second profile is a
 * product decision about what the public repo embeds — it belongs to Mattieu,
 * not to a guard. A guard requiring `>= 2` would not measure a degradation,
 * it would impose an arbitration. The floor kept is **1**: zero harvestable
 * profiles is a state no read can come out of right, and `build-deploy.cjs`
 * already treats it as `log.err`.
 *
 * ⚠️ Nor does it cover the WRITE of `data.availableProfiles` into the shipped
 * variant — `build-deploy.cjs` does that, and verifying it would need a
 * `deploy/` on disk, absent from a fresh clone. `e2e/24-profile-switcher.spec.js`
 * exercises it, when run. The split is deliberate and written here so this
 * guard is not believed wider than it is.
 *
 * ## Perimeter — derived from disk, never hardcoded
 *
 * Same rule as `scripts/build-deploy.cjs`: `schemas/` and any `_`-prefixed
 * directory are set aside (`_reference` is a test fixture, never deployed).
 * ⚠️ **The predicate is COPIED from `build-deploy.cjs` and must stay so** —
 * same choice, same motive, as `offline-basemap-declared.guard.test.ts`.
 * Hardcoding the profile list would make the guard stop matching at the
 * first addition, and it would come out green having scanned nothing: PH-01's
 * reason to exist.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const { Config } = await import("../../../src/kernel/config/config-primitives.ts");
const { getAvailableProfiles } =
    await import("../../../src/capabilities/profile-switcher/config.ts");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PROFILES = join(ROOT, "profiles");

/** A `data.availableProfiles` entry, as the harvest produces it. */
type ProfileEntry = { id: string; displayLabel: string; icon?: string };

/** `harvestFrom`'s output — the three lists the guard confronts. */
type Harvest = { dirs: string[]; entries: ProfileEntry[]; lost: string[] };

/**
 * Typed view of the singleton for the only member this file touches.
 *
 * ⚠️ `get` is **grafted at boot** by `config-accessors.ts`: it does not exist
 * on the bare import, so `Config`'s type does not carry it — correctly. This
 * view's `?` says exactly that, and it is also what makes the `afterEach`'s
 * `delete` legal.
 */
type ConfigWithGet = { get?: (path: string, def?: unknown) => unknown };

/**
 * `Config.get` stub — assigned, never spied: `get` is grafted onto the
 * singleton at boot (`config-accessors.ts`), it does not exist on the bare
 * import and `vi.spyOn` would throw. Idiom taken from
 * `profile-switcher-capability.test.js`.
 */
const _config = Config as unknown as ConfigWithGet;
const _originalGet = _config.get;
function stubConfig(cfg: unknown): void {
    _config.get = (path, def) => {
        const v = path
            .split(".")
            .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cfg);
        return v === undefined ? def : v;
    };
}
afterEach(() => {
    if (_originalGet === undefined) delete _config.get;
    else _config.get = _originalGet;
});

/**
 * Replays `scripts/build-deploy.cjs`'s harvest over a profile directory.
 *
 * Pure and parameterised by the directory: what allows exercising it on a
 * degraded SYNTHETIC tree (PH-04) without touching the repo. A guard whose
 * red input cannot be forged is never seen turning red.
 *
 * @param dir Directory playing the role of `profiles/`.
 * @returns The directories seen, the entries produced, and those lost at the `catch`.
 */
function harvestFrom(dir: string): Harvest {
    if (!existsSync(dir)) return { dirs: [], entries: [], lost: [] };
    const dirs = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
        .map((e) => e.name);

    const entries: ProfileEntry[] = [];
    const lost: string[] = [];
    for (const id of dirs) {
        try {
            const meta = JSON.parse(readFileSync(join(dir, id, "profile.json"), "utf8")) as {
                displayLabel?: string;
                label?: string;
                icon?: string;
            };
            entries.push({
                id,
                displayLabel: meta.displayLabel || meta.label || id,
                ...(meta.icon ? { icon: meta.icon } : {}),
            });
        } catch {
            // Exactly `build-deploy.cjs`'s `catch`: it does not fail the
            // build, it warns and goes on. THAT silence is what the guard turns red.
            lost.push(id);
        }
    }
    return { dirs, entries, lost };
}

describe("la récolte de profils ne perd rien en silence", () => {
    it("PH-01 — le périmètre n'est pas vide (sinon la garde passe sans rien scanner)", () => {
        const { dirs } = harvestFrom(PROFILES);
        expect(
            dirs,
            "aucun répertoire de profil récoltable sous profiles/ — `build-deploy.cjs` sort " +
                "déjà en `log.err` sur cet état, et le sélecteur n'a plus rien à offrir"
        ).not.toHaveLength(0);
    });

    it("PH-02 — tout profil récoltable rend une entrée : rien n'est perdu au `catch`", () => {
        const { dirs, entries, lost } = harvestFrom(PROFILES);
        expect(
            lost,
            "ces répertoires sont vus par `build-deploy.cjs` comme des profils mais leur " +
                "`profile.json` est illisible ou absent : ils sont exclus de " +
                "`data.availableProfiles` avec un simple `log.warn`, donc l'utilisateur ne peut " +
                "plus les atteindre et RIEN ne le dit"
        ).toEqual([]);
        expect(entries).toHaveLength(dirs.length);
    });

    it("PH-02b — chaque entrée porte la forme que le sélecteur sait rendre", () => {
        const { entries } = harvestFrom(PROFILES);
        for (const e of entries) {
            expect(typeof e.id, `${e.id} : identifiant non textuel`).toBe("string");
            expect(e.id.length, "identifiant vide").toBeGreaterThan(0);
            expect(typeof e.displayLabel, `${e.id} : libellé non textuel`).toBe("string");
            expect(e.displayLabel.length, `${e.id} : libellé vide`).toBeGreaterThan(0);
        }
    });

    it("PH-03 — chaque entrée récoltée survit au filtre RUNTIME réel", () => {
        // The link is made with the capability's REAL function, not a copy:
        // if its defensive filter (PS-14) tightened, or the harvest started
        // producing a shape it discards, the count announced at build would
        // stop being the count the user sees — a gap no warning prints.
        const { entries } = harvestFrom(PROFILES);
        stubConfig({ data: { availableProfiles: entries } });
        const visible = getAvailableProfiles();
        expect(visible.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    });

    it("PH-04 — TÉMOIN INVERSE : sur une récolte dégradée, la garde REFUSE", () => {
        // ⚠️ Without this witness, PH-02 and PH-03 would be indistinguishable
        // from hollow assertions: a guard never seen red guards nothing, and
        // a guard seen red on ONE mutation can stay hollow for another. The
        // two mechanisms are thus exercised separately, on a synthetic tree —
        // the real repo is never touched.
        const tmp = mkdtempSync(join(tmpdir(), "gl-b49-"));
        mkdirSync(join(tmp, "bon"));
        writeFileSync(join(tmp, "bon", "profile.json"), '{"displayLabel":"Bon","icon":"🟢"}');
        mkdirSync(join(tmp, "casse"));
        writeFileSync(join(tmp, "casse", "profile.json"), "{ pas du JSON");
        mkdirSync(join(tmp, "sans-json"));
        // The two exclusions must stay exclusions, not become losses.
        mkdirSync(join(tmp, "schemas"));
        mkdirSync(join(tmp, "_reference"));

        const { dirs, entries, lost } = harvestFrom(tmp);
        expect(dirs.sort()).toEqual(["bon", "casse", "sans-json"]);
        expect(lost.sort()).toEqual(["casse", "sans-json"]);
        expect(entries.map((e) => e.id)).toEqual(["bon"]);
        // …and that is indeed what PH-02 would refuse on the real repo.
        expect(entries).not.toHaveLength(dirs.length);

        // Second mechanism, independent of the first: the runtime filter
        // discards entries the harvest could produce if its shape drifted. PH-03 would see it.
        stubConfig({
            data: { availableProfiles: [{ id: "bon" }, { id: "" }, { id: 42 }, null] },
        });
        expect(getAvailableProfiles().map((e) => e.id)).toEqual(["bon"]);
    });
});
