/**
 * @file taxonomy-symbol-prefix.guard.test.js
 * @description Test-garde — aucun `svgId` de profil ne répète son propre `symbolPrefix`.
 *
 * Pourquoi ce garde existe (palier M des fiches specs/, 28/07/2026)
 * -----------------------------------------------------------------
 * `resolvePoiIcon` compose l'identifiant d'image MapLibre par CONCATÉNATION :
 *
 *     symbolPrefix + svgId   (+ "--" + teinte, s'il y en a une)
 *
 * Un profil qui écrit le préfixe **dans** `svgId` **et** le déclare dans `icons.symbolPrefix`
 * produit donc un identifiant doublé — `tourism-poi-cat-tourism-poi-cat-musee` — qui n'existe
 * dans aucun sprite. Le rendu ne lève rien : `icon-image` pointe vers une image jamais
 * enregistrée, et **le glyphe disparaît en silence**.
 *
 * ## Ce n'est pas une précaution de principe : c'est déjà arrivé, à l'échelle
 *
 * Le CDC de la refonte `taxonomy` (v3.0.0, 14/07/2026, §13.1) relevait le défaut sur **trois
 * profils déployés**, et pas marginalement : 11/11 catégories cassées sur l'un, 7/7 sur les deux
 * autres. Ces profils ont disparu depuis (retrait des 6 profils de démonstration, `4967db6d`) —
 * autrement dit **le défaut n'a jamais été corrigé, ses sujets ont été supprimés**. Rien n'a donc
 * jamais empêché sa réapparition.
 *
 * ## Ce que la règle avait pour seule défense jusqu'ici
 *
 * Une phrase, dans la `description` du `configSchema` de la capacité
 * (`capabilities/taxonomy/taxonomy-capability.ts` → `icons.symbolPrefix`) : « Do NOT repeat it
 * inside `svgId` ». Elle est publiée aux intégrateurs par `getCapabilitySchema('taxonomy')`, et
 * c'est très bien — mais une phrase ne vérifie rien. C'est exactement le régime documentaire que
 * la refonte V3 mesure comme le seul à avoir échoué dans ce dépôt.
 *
 * ## Pourquoi un TEST et non un script de `scripts/`
 *
 * Même motif que `doc-plugin-manifest.guard.test.js`, et il est écrit là-bas en entier : un script
 * neuf est refusé par `verify-repo-hygiene.cjs` / `verify-ci-scripts-tracked.cjs` tant qu'il n'est
 * pas suivi par git **et** inscrit dans `SCRIPTS_ALLOWLIST` — donc `ci:local` reste rouge jusqu'au
 * commit. Un test sous `__tests__/guards/` entre dans la suite déjà câblée.
 *
 * ⚠️ **Il ne s'ajoute pas non plus à `validate-profiles.cjs`**, qui serait pourtant le lieu
 * naturel : ce script est en cours de modification par un autre chantier au moment où ce garde est
 * écrit. Le jour où les deux se rejoignent, ce fichier peut disparaître au profit d'une règle
 * là-bas — la note est ici pour que ce soit une décision et non un oubli.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Trois assertions anti-garde-vide : au moins un profil trouvé, au moins un `symbolPrefix` non
 * vide, au moins un `svgId` lu. Sans elles, ce garde sortirait vert le jour où `profiles/` est
 * déplacé, où la clé est renommée, ou où plus aucun profil ne déclare de préfixe.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PROFILES_DIR = path.join(REPO_ROOT, "profiles");

/** Emplacement canonique du bloc `modules.taxonomy` d'un profil. */
const TAXONOMY_REL = path.join("config", "plugins", "taxonomy.json");

/**
 * Les profils présents sur le disque — la liste n'est pas écrite, elle est LUE.
 *
 * `schemas/` est le seul répertoire de `profiles/` qui ne soit pas un profil (il porte les
 * schémas JSON). Il est écarté par l'absence de `config/plugins/taxonomy.json`, pas par son nom :
 * un filtre nominatif cesserait de protéger au premier renommage.
 */
function readProfiles() {
    if (!fs.existsSync(PROFILES_DIR)) return [];
    return fs
        .readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ id: d.name, file: path.join(PROFILES_DIR, d.name, TAXONOMY_REL) }))
        .filter((p) => fs.existsSync(p.file))
        .map((p) => ({
            ...p,
            rel: `profiles/${p.id}/${TAXONOMY_REL.split(path.sep).join("/")}`,
            json: JSON.parse(fs.readFileSync(p.file, "utf8")),
        }));
}

/**
 * Récolte tous les `svgId` d'un bloc de taxonomie, à toute profondeur.
 *
 * La récolte est RÉCURSIVE et non ciblée sur `taxonomies.<nom>.categories.<val>.svgId` : les
 * sous-catégories en portent aussi, et un futur niveau en porterait encore. Viser le chemin exact
 * ferait sortir ce garde vert sur la moitié du gisement — c'est le défaut que le relevé d'origine
 * a précisément mesuré sur les sous-catégories.
 */
function collectSvgIds(node, out = []) {
    if (Array.isArray(node)) {
        for (const v of node) collectSvgIds(v, out);
        return out;
    }
    if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
            if (k === "svgId" && typeof v === "string") out.push(v);
            else collectSvgIds(v, out);
        }
    }
    return out;
}

const PROFILES = readProfiles();

describe("test-garde — aucun `svgId` de profil ne répète son `symbolPrefix`", () => {
    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("trouve au moins un profil portant un bloc taxonomy (sinon ce garde ne garde rien)", () => {
        expect(
            PROFILES.length,
            `aucun ${TAXONOMY_REL} sous ${PROFILES_DIR} — le répertoire a-t-il bougé ?`
        ).toBeGreaterThan(0);
    });

    it("trouve au moins un `symbolPrefix` non vide, tous profils confondus", () => {
        const withPrefix = PROFILES.filter(
            (p) => typeof p.json?.icons?.symbolPrefix === "string" && p.json.icons.symbolPrefix
        );
        expect(
            withPrefix.length,
            "aucun profil ne déclare `icons.symbolPrefix` : la clé a-t-elle été renommée ?"
        ).toBeGreaterThan(0);
    });

    it("lit au moins un `svgId`, tous profils confondus", () => {
        const total = PROFILES.reduce((n, p) => n + collectSvgIds(p.json).length, 0);
        expect(
            total,
            "aucun `svgId` récolté : la forme du bloc `taxonomies` a-t-elle changé ?"
        ).toBeGreaterThan(0);
    });

    PROFILES.forEach((profile) => {
        const prefix = profile.json?.icons?.symbolPrefix;
        if (typeof prefix !== "string" || prefix.length === 0) return;

        it(`${profile.rel} — aucun \`svgId\` ne commence par \`${prefix}\``, () => {
            const doubled = collectSvgIds(profile.json).filter((id) => id.startsWith(prefix));
            expect(
                doubled,
                doubled.length === 0
                    ? ""
                    : `${profile.rel} — ${doubled.length} \`svgId\` répètent le préfixe \`${prefix}\`, ` +
                          `ce qui produit un identifiant d'image DOUBLÉ (\`${prefix}${doubled[0]}\`) que le sprite ne contient pas. ` +
                          `L'icône disparaît SANS ERREUR. Retirer le préfixe des \`svgId\` : ${doubled.join(", ")}`
            ).toEqual([]);
        });
    });
});
