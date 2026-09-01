/**
 * The capability scaffold's taxonomy — the real rule, pinned.
 *
 * The capabilities' verbose scaffold (`install` + `<id>-capability` +
 * `config` + `lifecycle` + `public-api`) is DELIBERATE: predictability beats
 * concision. But not all capabilities carry the 5 files, and until now nobody
 * could say which had the right to lack some — the roadmap even claimed "no
 * capability carries the 5 canonical files", while **10 of 18** did.
 *
 * This test writes the rule by DERIVING it from the code, never from a list:
 *
 *   - `install.ts` and `<id>-capability.ts`     → mandatory, no exception;
 *   - `lifecycle.ts`                            → iff the capability DRIVES
 *                                                 something, i.e. declares
 *                                                 `createModule` or
 *                                                 `sharedLifecycle` in its installer;
 *   - `public-api.ts`                           → iff the outside world enters
 *                                                 the capability (a
 *                                                 `modules/geoleaf.*.ts` facade
 *                                                 or `bundle-esm-entry.ts` references it).
 *
 * The only case that does not read directly is the SUB-FEATURE: `permalink`
 * does declare a `createModule`, but it builds `share/`'s module, whose
 * lifecycle thus lives in `permalink/share/`. The contract already carries
 * the marker saying so — the `moduleGate` field, "the module's gate when it
 * differs from the capability's". The rule consumes it instead of hardcoding
 * `permalink`.
 *
 * ⚠️ Three documents described this family wrong: they listed `permalink` as
 * "without createModule" (it has one) and OMITTED `vector-tiles` (which
 * really is pull-based). Fixed — this test is what keeps them from
 * re-diverging.
 *
 * Structural: it reads the tree and the installers' source, imports no module
 * and opens no configuration file.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "../../src");
const CAPABILITIES = join(SRC, "capabilities");

/** `capabilities/`'s directories — the list is not written, it is read. */
const IDS = readdirSync(CAPABILITIES).filter((d) => statSync(join(CAPABILITIES, d)).isDirectory());

/**
 * Capabilities WITHOUT a capability `config.ts`, with each one's reason.
 *
 * Unlike the two rules above, this one does not derive: it depends on WHERE
 * the configuration comes from, which the code declares nowhere. The list is
 * therefore explicit — and that is the goal: a new capability without
 * `config.ts` will turn this test red until someone writes here why it may
 * do without one.
 */
const NO_CONFIG_ACCESSOR = {
    offline:
        "config POUSSÉE par l'installer (sharedLifecycle) ; lecture générique par chemin via config-seam.ts, l'engine se charge en import() après boot",
    pwa: "config POUSSÉE par l'installer (sharedLifecycle) : `PwaLifecycle.init(ctx.config.modules?.pwa)` — cf. backlog, un accesseur typé absorberait le cast",
    "theme-selector":
        "config hors `modules.*` — elle vient de `themes.json` (ValidatedThemesConfig['config'])",
    "vector-tiles":
        "config PAR COUCHE (`data.vectorTiles` de layer-config.schema.json), pas app-globale",
};

/** The text of every public facade + the ESM entry, concatenated once. */
const externalEntryPoints = (() => {
    const modulesDir = join(SRC, "api");
    const facades = readdirSync(modulesDir)
        .filter((f) => /^geoleaf\..*\.ts$/.test(f))
        .map((f) => readFileSync(join(modulesDir, f), "utf8"));
    return [...facades, readFileSync(join(SRC, "bundle-esm-entry.ts"), "utf8")].join("\n");
})();

/** Classifies a capability from its installer's SOURCE. */
function classify(id) {
    const dir = join(CAPABILITIES, id);
    const installer = readFileSync(join(dir, "install.ts"), "utf8");
    // Anchored on member indentation (4 spaces): without it, a block-comment
    // mention (` * … createModule …`) would suffice to classify the capability.
    const createsModule = /^ {4}createModule\(/m.test(installer);
    const drivesSharedLifecycle = /^ {4}sharedLifecycle\(/m.test(installer);
    const isSubFeatureModule = /^ {4}moduleGate:/m.test(installer);
    const subdirs = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    return {
        dir,
        drivesALifecycle: createsModule || drivesSharedLifecycle,
        isSubFeatureModule,
        hasRootLifecycle: existsSync(join(dir, "lifecycle.ts")),
        hasSubFeatureLifecycle: subdirs.some((s) => existsSync(join(dir, s, "lifecycle.ts"))),
        hasPublicApi: existsSync(join(dir, "public-api.ts")),
        hasConfig: existsSync(join(dir, "config.ts")),
        isReachedFromOutside: new RegExp(`capabilities/${id}/`).test(externalEntryPoints),
    };
}

describe("capabilities — taxonomie du scaffold", () => {
    it("le périmètre est bien de 21 capacités", () => {
        // `layers/` left `capabilities/` (it was not a capability, it was
        // misfiled kernel). If this count moves, the roadmap and the 3
        // architecture documents stating it must move with it.
        // History: 18 → 19 (`profile-switcher`), 19 → 20 (`language-switcher`),
        // 20 → 21 (`theme-palette`).
        expect(IDS).toHaveLength(21);
    });

    it.each(IDS)("%s — porte les 2 fichiers obligatoires", (id) => {
        const dir = join(CAPABILITIES, id);
        expect(existsSync(join(dir, "install.ts"))).toBe(true);
        expect(existsSync(join(dir, `${id}-capability.ts`))).toBe(true);
    });

    it.each(IDS)("%s — a un lifecycle SSI elle pilote quelque chose", (id) => {
        const c = classify(id);
        if (!c.drivesALifecycle) {
            // Pull-based: it answers when queried, it subscribes to nothing.
            expect(c.hasRootLifecycle).toBe(false);
            return;
        }
        // The lifecycle lives at the root — unless the created module is a
        // sub-feature's, which `moduleGate` signals (permalink → share/).
        expect(c.hasRootLifecycle || (c.isSubFeatureModule && c.hasSubFeatureLifecycle)).toBe(true);
    });

    it.each(IDS)("%s — a un public-api SSI on entre dans la capacité de l'extérieur", (id) => {
        const c = classify(id);
        expect(c.hasPublicApi).toBe(c.isReachedFromOutside);
    });

    it.each(IDS)("%s — a un config.ts, ou figure dans les exceptions motivées", (id) => {
        const c = classify(id);
        if (c.hasConfig) {
            expect(NO_CONFIG_ACCESSOR).not.toHaveProperty(id);
            return;
        }
        expect(Object.keys(NO_CONFIG_ACCESSOR)).toContain(id);
        expect(NO_CONFIG_ACCESSOR[id].length).toBeGreaterThan(20); // a reason, not a TODO
    });

    it("la famille pull-based est exactement cluster, taxonomy, vector-tiles", () => {
        // NAMED assertion, on top of the generic rules above: the sentence
        // preset.contract.ts, ARCHITECTURE.md and the CDC each repeat, and
        // all three wrote wrong (permalink wrongly listed, vector-tiles
        // forgotten). If the family changes, this test turns red and the 3
        // documents must be reworked together.
        const pullBased = IDS.filter((id) => !classify(id).drivesALifecycle).sort();
        expect(pullBased).toEqual(["cluster", "taxonomy", "vector-tiles"]);
    });

    it("permalink pilote bien un module — celui de sa sous-feature share/", () => {
        // The counter-example that made the 3 documents lie, explicitly pinned.
        const c = classify("permalink");
        expect(c.drivesALifecycle).toBe(true);
        expect(c.isSubFeatureModule).toBe(true);
        expect(c.hasRootLifecycle).toBe(false);
        expect(c.hasSubFeatureLifecycle).toBe(true);
    });

    it("pwa et offline sont les 2 seules capacités app-globales (sharedLifecycle)", () => {
        const appGlobal = IDS.filter((id) =>
            /^ {4}sharedLifecycle\(/m.test(
                readFileSync(join(CAPABILITIES, id, "install.ts"), "utf8")
            )
        ).sort();
        expect(appGlobal).toEqual(["offline", "pwa"]);
    });

    it("13 capacités portent les 5 fichiers canoniques — et non « aucune »", () => {
        // The premise the roadmap carried since its v1.0.0 was false. The
        // count is pinned here so it cannot rewrite itself inadvertently.
        // 10 → 13 since: the 3 selector capabilities are born complete
        // (config + lifecycle + public-api), on the `scale`/`theme-toggle` pattern.
        const complete = IDS.filter((id) => {
            const c = classify(id);
            return c.hasConfig && c.hasRootLifecycle && c.hasPublicApi;
        }).sort();
        expect(complete).toEqual([
            "branding",
            "coordinates",
            "feature-info",
            "filter",
            "geolocation",
            "labels",
            "language-switcher",
            "legend",
            "profile-switcher",
            "scale",
            "theme-palette",
            "theme-toggle",
            "toast-renderer",
        ]);
    });
});
