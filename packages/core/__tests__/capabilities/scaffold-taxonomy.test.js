/**
 * Taxonomie du scaffold de capacité — la règle réelle, figée (CAPACITÉS S10.4).
 *
 * Le scaffold verbeux des capacités (`install` + `<id>-capability` + `config` + `lifecycle` +
 * `public-api`) est DÉLIBÉRÉ : la prévisibilité prime sur la concision. Mais toutes les
 * capacités n'en portent pas les 5 fichiers, et jusqu'ici personne ne savait dire lesquelles
 * avaient le droit d'en manquer — la roadmap affirmait même qu'« aucune capacité ne porte
 * les 5 fichiers canoniques », alors que **10 sur 18** les portent.
 *
 * Ce test écrit la règle en la DÉRIVANT du code, jamais d'une liste :
 *
 *   - `install.ts` et `<id>-capability.ts`      → obligatoires, sans exception ;
 *   - `lifecycle.ts`                            → ssi la capacité PILOTE quelque chose,
 *                                                 c.-à-d. déclare `createModule` ou
 *                                                 `sharedLifecycle` dans son installer ;
 *   - `public-api.ts`                           → ssi le monde extérieur entre dans la
 *                                                 capacité (une façade `modules/geoleaf.*.ts`
 *                                                 ou `bundle-esm-entry.ts` la référence).
 *
 * Le seul cas qui ne se lit pas directement est la SOUS-FEATURE : `permalink` déclare bien un
 * `createModule`, mais il fabrique le module de `share/`, dont le lifecycle vit donc dans
 * `permalink/share/`. Le contrat porte déjà le marqueur qui le dit — le champ `moduleGate`,
 * « gate du module quand il diffère de celui de la capacité ». La règle le consomme au lieu
 * d'inscrire `permalink` en dur.
 *
 * ⚠️ Trois documents décrivaient cette famille de travers : ils listaient `permalink` comme
 * « sans createModule » (il en a un) et OMETTAIENT `vector-tiles` (qui est, lui, réellement
 * pull-based). Corrigés au S10 — c'est ce test qui les empêche de re-diverger.
 *
 * Structurel : il lit l'arborescence et la source des installeurs, il n'importe aucun module
 * et n'ouvre aucun fichier de configuration.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "../../src");
const CAPABILITIES = join(SRC, "capabilities");

/** Les répertoires de `capabilities/` — la liste n'est pas écrite, elle est lue. */
const IDS = readdirSync(CAPABILITIES).filter((d) => statSync(join(CAPABILITIES, d)).isDirectory());

/**
 * Capacités SANS `config.ts` de capacité, avec la raison de chacune.
 *
 * Contrairement aux deux règles ci-dessus, celle-ci ne se dérive pas : elle dépend d'OÙ vient
 * la configuration, ce que le code ne déclare nulle part. La liste est donc explicite — et
 * c'est le but : une 19ᵉ capacité sans `config.ts` fera rougir ce test tant que personne
 * n'aura écrit ici pourquoi elle a le droit de s'en passer.
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

/** Le texte de toutes les façades publiques + l'entrée ESM, concaténé une fois. */
const externalEntryPoints = (() => {
    const modulesDir = join(SRC, "api");
    const facades = readdirSync(modulesDir)
        .filter((f) => /^geoleaf\..*\.ts$/.test(f))
        .map((f) => readFileSync(join(modulesDir, f), "utf8"));
    return [...facades, readFileSync(join(SRC, "bundle-esm-entry.ts"), "utf8")].join("\n");
})();

/** Classe une capacité à partir de la SOURCE de son installeur. */
function classify(id) {
    const dir = join(CAPABILITIES, id);
    const installer = readFileSync(join(dir, "install.ts"), "utf8");
    // Ancrés sur l'indentation de membre (4 espaces) : sans cela, une mention en
    // commentaire de bloc (` * … createModule …`) suffirait à classer la capacité.
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

describe("capabilities — taxonomie du scaffold (S10.4)", () => {
    it("le périmètre est bien de 21 capacités", () => {
        // `layers/` a quitté `capabilities/` (ARCHI S12.3 : ce n'était pas une capacité,
        // c'était du kernel mal rangé). Si ce compte bouge, la roadmap et les 3 documents
        // d'architecture qui l'énoncent doivent bouger avec.
        // `roadmap_feature-selecteurs-ui` : 18 → 19 au S1 (`profile-switcher`),
        // 19 → 20 au S2 (`language-switcher`), 20 → 21 au S3 (`theme-palette`).
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
            // Pull-based : elle répond quand on l'interroge, elle ne s'abonne à rien.
            expect(c.hasRootLifecycle).toBe(false);
            return;
        }
        // Le lifecycle vit à la racine — sauf si le module créé est celui d'une
        // sous-feature, ce que `moduleGate` signale (permalink → share/).
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
        expect(NO_CONFIG_ACCESSOR[id].length).toBeGreaterThan(20); // une raison, pas un TODO
    });

    it("la famille pull-based est exactement cluster, taxonomy, vector-tiles", () => {
        // Assertion NOMMÉE, en plus des règles génériques ci-dessus : c'est la phrase que
        // preset.contract.ts, ARCHITECTURE.md et le CDC répètent chacun, et que les trois
        // écrivaient faux (permalink listé à tort, vector-tiles oublié). Si la famille
        // change, ce test rougit et les 3 documents doivent être repris ensemble.
        const pullBased = IDS.filter((id) => !classify(id).drivesALifecycle).sort();
        expect(pullBased).toEqual(["cluster", "taxonomy", "vector-tiles"]);
    });

    it("permalink pilote bien un module — celui de sa sous-feature share/", () => {
        // Le contre-exemple qui a fait mentir les 3 documents, épinglé explicitement.
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
        // La prémisse que la roadmap portait depuis sa v1.0.0 était fausse. Le compte est
        // figé ici pour qu'elle ne puisse pas se ré-écrire par inadvertance.
        // 10 → 13 au fil de `roadmap_feature-selecteurs-ui` : les 3 capacités de
        // sélecteur naissent complètes (config + lifecycle + public-api), au patron
        // `scale`/`theme-toggle`.
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
