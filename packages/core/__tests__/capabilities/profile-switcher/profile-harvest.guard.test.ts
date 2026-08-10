/**
 * Garde B-49 — la RÉCOLTE de profils ne perd rien en silence.
 *
 * ## Pourquoi cette garde existe, et pourquoi ICI
 *
 * `profile-switcher` ne se rend qu'à partir de deux profils récoltés (PS-04). C'est une
 * dégradation VOULUE, pas un défaut. Le sujet de B-49 n'a donc jamais été le seuil : c'est
 * son **silence**. Un `profile.json` devenu illisible, ou un répertoire de profil qui cesse
 * d'être récolté, fait disparaître le sélecteur de l'interface — et le seul signal existant
 * était un `log.warn` de `build-deploy.cjs` qu'il fallait être en train de lire.
 *
 * 🛑 **La seule gate qui voyait quelque chose était `e2e/24-profile-switcher.spec.js`, et elle
 * n'est sur aucun chemin par défaut** : `ci-local.cjs` réserve l'E2E à `--e2e`, et les étapes
 * E2E de `ci.yml` portent `if: github.event_name == 'workflow_dispatch'`. Un `ci:local` vert et
 * un push vert étaient donc compatibles avec la capacité absente de l'interface. Ce fichier est
 * un **test unitaire**, donc il tombe dans « Unit tests » ET « Coverage gate », les deux dans
 * `STEPS` (chemin par défaut) de `ci-local.cjs` et dans `ci.yml`. C'est toute la différence, et
 * c'est le seul motif de son emplacement.
 *
 * ## Ce qu'elle affirme, et ce qu'elle N'affirme PAS
 *
 * Elle affirme que **la récolte est sans perte** : tout répertoire que `build-deploy.cjs`
 * considère comme un profil rend une entrée valide, et cette entrée survit au filtre RUNTIME.
 *
 * ⚠️ Elle **n'exige pas deux profils**. Livrer un second profil est une décision produit sur ce
 * que le dépôt public embarque (voie 1 de B-49, voisine de B-213) — elle appartient à Mattieu,
 * pas à une garde. Une garde qui exigerait `>= 2` ne mesurerait pas une dégradation, elle
 * imposerait un arbitrage. Le plancher retenu est **1** : zéro profil récoltable est un état
 * dont aucune lecture ne peut sortir juste, et `build-deploy.cjs` le traite déjà en `log.err`.
 *
 * ⚠️ Elle ne couvre pas non plus l'ÉCRITURE de `data.availableProfiles` dans la variante livrée
 * — c'est `build-deploy.cjs` qui la fait, et la vérifier demanderait un `deploy/` sur le disque,
 * absent d'un clone frais. C'est `e2e/24-profile-switcher.spec.js` qui l'éprouve, quand on le
 * lance. Le partage est délibéré et il est écrit ici pour qu'on ne croie pas cette garde plus
 * large qu'elle n'est.
 *
 * ## Périmètre — dérivé du disque, jamais écrit en dur
 *
 * Même règle que `scripts/build-deploy.cjs` : `schemas/` et tout répertoire préfixé `_` sont
 * écartés (`_reference` est une fixture de test, jamais déployée). ⚠️ **Le prédicat est RECOPIÉ
 * de `build-deploy.cjs` et doit le rester** — même choix, même motif, que
 * `offline-basemap-declared.guard.test.ts`. Écrire la liste des profils en dur ferait cesser la
 * garde de matcher au premier ajout, et elle sortirait verte en n'ayant rien scanné : c'est la
 * raison d'être de PH-01.
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
const { getAvailableProfiles } = await import(
    "../../../src/capabilities/profile-switcher/config.ts"
);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PROFILES = join(ROOT, "profiles");

/** Une entrée de `data.availableProfiles`, telle que la récolte la produit. */
type ProfileEntry = { id: string; displayLabel: string; icon?: string };

/** Le rendu de `harvestFrom` — les trois listes que la garde confronte. */
type Harvest = { dirs: string[]; entries: ProfileEntry[]; lost: string[] };

/**
 * Vue typée du singleton pour le seul membre que ce fichier touche.
 *
 * ⚠️ `get` est **greffé au boot** par `config-accessors.ts` : il n'existe pas sur l'import nu,
 * donc le type de `Config` ne le porte pas — et c'est correct. Le `?` de cette vue dit
 * exactement cela, et c'est aussi ce qui rend le `delete` du `afterEach` légal.
 */
type ConfigWithGet = { get?: (path: string, def?: unknown) => unknown };

/**
 * Stub de `Config.get` — assigné, jamais espionné : `get` est greffé sur le singleton au boot
 * (`config-accessors.ts`), il n'existe pas sur l'import nu et `vi.spyOn` jetterait.
 * Idiome repris de `profile-switcher-capability.test.js`.
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
 * Rejoue la récolte de `scripts/build-deploy.cjs` sur un répertoire de profils.
 *
 * Pure et paramétrée par le répertoire : c'est ce qui permet de l'éprouver sur un arbre
 * SYNTHÉTIQUE dégradé (PH-04) sans toucher au dépôt. Une garde dont on ne peut pas fabriquer
 * l'entrée rouge ne se voit jamais rougir.
 *
 * @param dir Répertoire jouant le rôle de `profiles/`.
 * @returns Les répertoires vus, les entrées produites, et ceux perdus au `catch`.
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
            // Exactement le `catch` de `build-deploy.cjs` : il n'échoue pas le build, il
            // avertit et poursuit. C'est CE silence-là que la garde transforme en rouge.
            lost.push(id);
        }
    }
    return { dirs, entries, lost };
}

describe("B-49 — la récolte de profils ne perd rien en silence", () => {
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
        // Le lien est établi avec la VRAIE fonction de la capacité, pas une copie : si son
        // filtre défensif (PS-14) se resserrait, ou si la récolte se mettait à produire une
        // forme qu'il écarte, le compte annoncé au build cesserait d'être le compte vu par
        // l'utilisateur — un écart qu'aucun avertissement n'imprime.
        const { entries } = harvestFrom(PROFILES);
        stubConfig({ data: { availableProfiles: entries } });
        const visible = getAvailableProfiles();
        expect(visible.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    });

    it("PH-04 — TÉMOIN INVERSE : sur une récolte dégradée, la garde REFUSE", () => {
        // ⚠️ Sans ce témoin, PH-02 et PH-03 seraient indiscernables d'assertions creuses : une
        // garde jamais vue rouge ne garde rien, et une garde vue rouge sur UNE mutation peut
        // rester creuse pour une autre. Les deux mécanismes sont donc éprouvés séparément, sur
        // un arbre synthétique — le dépôt réel n'est jamais touché.
        const tmp = mkdtempSync(join(tmpdir(), "gl-b49-"));
        mkdirSync(join(tmp, "bon"));
        writeFileSync(join(tmp, "bon", "profile.json"), '{"displayLabel":"Bon","icon":"🟢"}');
        mkdirSync(join(tmp, "casse"));
        writeFileSync(join(tmp, "casse", "profile.json"), "{ pas du JSON");
        mkdirSync(join(tmp, "sans-json"));
        // Les deux exclusions doivent rester des exclusions, pas devenir des pertes.
        mkdirSync(join(tmp, "schemas"));
        mkdirSync(join(tmp, "_reference"));

        const { dirs, entries, lost } = harvestFrom(tmp);
        expect(dirs.sort()).toEqual(["bon", "casse", "sans-json"]);
        expect(lost.sort()).toEqual(["casse", "sans-json"]);
        expect(entries.map((e) => e.id)).toEqual(["bon"]);
        // …et c'est bien ce que PH-02 refuserait sur le dépôt réel.
        expect(entries).not.toHaveLength(dirs.length);

        // Second mécanisme, indépendant du premier : le filtre runtime écarte des entrées que
        // la récolte pourrait produire si sa forme dérivait. PH-03 le verrait.
        stubConfig({
            data: { availableProfiles: [{ id: "bon" }, { id: "" }, { id: 42 }, null] },
        });
        expect(getAvailableProfiles().map((e) => e.id)).toEqual(["bon"]);
    });
});
