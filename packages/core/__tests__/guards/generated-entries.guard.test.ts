/**
 * Guard GEN — les deux entrées d'exemple sont GÉNÉRÉES, et le disque le prouve.
 *
 * ## Ce que la garde remplace, et pourquoi elle n'est pas une étape CI
 *
 * La tâche 8.3 demandait une étape `git diff --exit-code examples/`. Elle est portée ici, en
 * test, pour une raison simple : une étape CI doit s'inscrire dans `scripts/ci-local.cjs` **et**
 * dans `.github/workflows/ci.yml`, alors que ce test est ramassé par la suite existante et
 * n'ajoute **aucune inscription** — donc rien à tenir synchronisé.
 *
 * 🛑 **Cet en-tête a donné un autre motif, technique, et il était FAUX** (corrigé le 08/08/2026).
 * Il affirmait que « **PARITY-11 compare les listes de commandes des deux côtés** — oublier l'une
 * des deux inscriptions fait rougir `ci:local` ». **La gate est DIRECTIONNELLE** : `ci.yml ⊆
 * ci:local`. Elle itère les feuilles de `ci.yml` et n'a aucune boucle inverse ; PARITY-11 elle-même
 * ne vise que les feuilles inscrites à `DEFERRED_TO_E2E`. Mesuré : une étape ajoutée à
 * `ci-local.cjs` sans équivalent distant sort **verte et silencieuse**. Oublier `ci.yml` n'aurait
 * donc rien fait rougir du tout — ce qui est PIRE que ce que la phrase décrivait, et ne change
 * rien au choix fait ici.
 *
 * ⚠️ Ce qu'on perd, écrit pour ne pas l'oublier : `git diff` verrait une édition manuelle
 * **non committée**, pas ce test. Le défaut visé est la dérive dans le TEMPS, pas l'état de
 * l'index — mais la nuance est réelle.
 *
 * ## Les règles GEN
 *
 * ⚠️ Ce titre a écrit « les TROIS règles » jusqu'au 08/08/2026 — il y en avait quatre (GEN-04
 * est entrée avec la tâche 8.4), sans compter les quatre DEP posées par 8.5 dans le même
 * fichier. Le nombre est retiré plutôt que corrigé : c'est le même geste que la doctrine B-43
 * applique partout ailleurs ici, et la seule forme qui ne se périme pas à la règle suivante.
 *
 *   GEN-01  **Chaque entrée est identique à ce que le générateur produit** depuis le `caps=`
 *           de son propre marqueur. C'est la non-dérive proprement dite.
 *   GEN-02  **La liste « Left out » de `minimal` est exactement le complément de `caps=`.**
 *           C'est la même classe de défaut que 7.1 — une liste en prose à côté d'une liste de
 *           code —, et le seul endroit du lot où elle survit délibérément (elle porte un
 *           raisonnement que le générateur ne sait pas écrire). Gardée plutôt que retirée.
 *   GEN-03  **Le corpus n'est pas vide** — deux entrées attendues, pas zéro.
 *   GEN-04  **Le générateur voit TOUT `FULL.capabilities`, et dans le même ordre** (8.4). Elle
 *           met les DEUX extracteurs du tableau face à face : celui qui le PARSE
 *           (`gen-entry.cjs`) et celui qui l'IMPORTE (ici, comme `manifest-full-completeness`).
 *           Leur désaccord était réel — 16 contre 21 — et aucune règle ne le voyait.
 *
 * ## Preuve par mutation — vue le 08/08/2026, ROUGES **et** VERTES
 *
 * Une garde jamais vue rouge ne garde rien ; une garde qu'on n'a pas vue RESTER verte peut
 * n'être juste que par chance. Les huit mutations, et ce qu'elles ont rendu :
 *
 *   M-B1  restaurer l'algorithme du 07/08 (borne sur le texte BRUT)  → 🔴 GEN-04, **en nommant
 *         les cinq** : `language-switcher, profile-switcher, theme-palette, theme-selector,
 *         vector-tiles`. C'est la régression exacte, reproduite et nommée.
 *   M-B2  `.reverse()` en fin de `manifestOrder()`                    → 🔴 GEN-04 (moitié ORDRE)
 *   M-B3  un commentaire portant `["x"],` dans le tableau            → 🟢 **reste vert**
 *   M-B4a un commentaire PLEINE LIGNE citant `FILTER_INSTALLER`      → 🟢 **reste vert**
 *   M-B4b le même en FIN DE LIGNE                                    → 🟢 **reste vert**
 *   M-B5  `capabilityDirs()` rend `[]`                                → 🔴 anti-gate-vide
 *   M-B6  retirer `dependencies: ["pwa"]` du disque                   → 🔴 DEP-01 + DEP-03
 *   M-B7  `checkDeps` rend `[]`                                       → 🔴 DEP-01
 *   M-B8  retirer le contrôle de deps de `buildRegion`                → 🔴 DEP-04
 *
 * ⚠️ **M-B3/B4a/B4b sont aussi importantes que les rouges** : elles distinguent « la borne est
 * bien calculée » de « la borne tombe au bon endroit ce jour-là ». M-B4b a d'ailleurs tranché un
 * choix d'écriture — la regex simplement ANCRÉE en début de ligne, envisagée d'abord, la laissait
 * passer et comptait 22 installers au lieu de 21.
 *
 * ## Ce que la garde N'exige PAS, et c'est une décision
 *
 * Que les deux entrées embarquent la **même** liste. Le pré-vol du 07/08 a daté les deux
 * consignes : « keep this list in lock-step » date du **14/07/2026**, l'exclusion délibérée de
 * `cluster`/`toast-renderer`/`geolocation` dans `minimal` du **15/07/2026**. La divergence
 * 6 contre 9 n'est donc pas la dérive que 8.3 décrivait — c'est un choix documenté des deux
 * côtés, et c'est la consigne d'égalité qui était périmée. Elle a été retirée.
 *
 * @see roadmap_socle-init.md 📦 (archivée le 09/08/2026) §Sprint 8, tâche 8.3
 * @see scripts/gen-entry.cjs — le générateur, réutilisé tel quel plutôt que réimplémenté
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");

const gen = createRequire(import.meta.url)(path.join(REPO, "scripts/gen-entry.cjs"));

// L'AUTRE autorité sur `FULL.capabilities` — importée, là où le script la PARSE. C'est tout
// l'intérêt de GEN-04 : mettre les deux extracteurs face à face plutôt que d'en croire un.
const { FULL } = await import("../../src/presets/manifest.full.ts");

const ENTRIES = [
    "packages/core/examples/minimal/entry.ts",
    "packages/core/examples/consumer/entry.ts",
];

describe("GEN — les entrées d'exemple sont générées, pas écrites à la main", () => {
    it("GEN-03 — le corpus n'est pas vide et les fichiers existent", () => {
        expect(ENTRIES.length).toBeGreaterThan(0);
        for (const rel of ENTRIES) {
            expect(fs.existsSync(path.join(REPO, rel)), `${rel} est introuvable`).toBe(true);
        }
    });

    it.each(ENTRIES)("GEN-01 — %s est identique à sa régénération", (rel) => {
        const abs = path.join(REPO, rel);
        const spec = gen.readSpec(abs);
        const expected = gen.spliceRegion(spec.src, spec.line, gen.buildRegion(spec));

        expect(
            expected === spec.src,
            `${rel} a DÉRIVÉ de ce que scripts/gen-entry.cjs produit depuis son propre \`caps=\`.\n` +
                `Régénérer : node scripts/gen-entry.cjs --file=${rel}`
        ).toBe(true);
    });

    it("GEN-02 — la liste « Left out » de minimal est le complément exact de caps=", () => {
        const abs = path.join(REPO, ENTRIES[0]);
        const { caps, src } = gen.readSpec(abs);

        const m = src.match(/\*\*Left out:\*\*([\s\S]*?)\. Not one line/);
        expect(
            m,
            "Le bloc « **Left out:** … . Not one line » a disparu de l'en-tête"
        ).not.toBeNull();
        const declared = [...m[1].matchAll(/`([\w-]+)`/g)].map((x) => x[1]).sort();

        const expected = gen
            .capabilityDirs()
            .filter((c) => !caps.includes(c))
            .sort();

        expect(declared).toEqual(expected);
    });

    it("GEN-04 — le générateur voit TOUT FULL.capabilities, et dans le même ordre", () => {
        const dirs = gen.capabilityDirs();

        // Anti-gate-vide, avant tout le reste : les deux côtés doivent voir un corpus non vide,
        // et le MÊME. C'est cette égalité de taille qui rougissait avant le 08/08 (16 ≠ 21).
        expect(dirs.length).toBeGreaterThan(10);
        expect(FULL.capabilities.length).toBe(dirs.length);

        // ⚠️ `mode: "relative"` est OBLIGATOIRE et n'est pas une commodité : en mode npm le
        // générateur échoue sur `pwa`, qui n'a aucun `./facades/pwa.js` déclaré dans la carte
        // `exports` (trou connu, versé au backlog au Sprint 8). Ne pas « corriger » ce mode.
        const region = gen.buildRegion({ caps: dirs, mode: "relative", id: "gen04" });

        // Côté SCRIPT : les ids que la région importe, dans l'ordre d'émission — qui est
        // exactement celui que `manifestOrder()` a rendu.
        const seen = [
            ...region.matchAll(
                /^import \{ \w+ \} from "[^"]*capabilities\/([\w-]+)\/install\.js";$/gm
            ),
        ].map((m) => m[1]);

        // Côté IMPORT : la seule autre autorité du dépôt sur ce tableau.
        const truth = FULL.capabilities.map((i) => i.declaration.id);

        expect(
            seen,
            `Les deux extracteurs de \`FULL.capabilities\` sont en désaccord.\n` +
                `  script (parse) : ${seen.length} → ${seen.join(", ")}\n` +
                `  import (vérité): ${truth.length} → ${truth.join(", ")}\n` +
                `C'est le défaut du 08/08 : la borne du tableau se prenait sur le texte BRUT, et ` +
                `un \`],\` dans un commentaire la faisait tomber à 16 sur 21.`
        ).toEqual(truth);
    });
});

/**
 * Guard DEP — le graphe de dépendances déclaré est TRAVERSÉ, pas seulement déclaré (8.5).
 *
 * ⚠️ `ICapabilityDeclaration.dependencies` n'est lu **nulle part au runtime** — le registre de
 * capacités ne le touche pas. Sa seule utilité est au build, dans `gen-entry.cjs`. Or jusqu'au
 * 08/08/2026 ce contrôle ne vivait que dans le `main()` du script : la garde ci-dessus appelle
 * `buildRegion`, donc la seule arête réelle du dépôt n'était traversée par **aucune exécution
 * automatique**. Le contrôle a été déplacé au point d'émission ; ces règles l'y épinglent.
 *
 * Les sujets sont **dérivés du disque**, jamais écrits : le jour où `offline → pwa` cesse d'être
 * la seule arête, ces règles éprouvent celle qui l'a remplacée au lieu de rougir sur un nom.
 */
describe("DEP — le graphe de dépendances des capacités est traversé", () => {
    /** La première capacité du disque qui déclare une dépendance, et ses arêtes attendues. */
    function anyEdge() {
        const cap = gen.capabilityDirs().find((c) => gen.declaredDeps(c).length > 0);
        return cap ? { cap, edges: gen.declaredDeps(cap).map((d) => `${cap} → ${d}`) } : null;
    }

    it("DEP-03 — le sujet existe encore : au moins une arête déclarée dans le dépôt", () => {
        // Anti-gate-vide. Sans elle, DEP-01/02/04 passeraient sur l'ensemble vide le jour où
        // plus aucune capacité ne déclare de `dependencies` — une garde verte qui ne garde rien.
        expect(
            anyEdge(),
            "aucune capacité ne déclare de `dependencies` — les règles DEP n'ont plus de sujet, " +
                "il faut décider si elles gardent encore quelque chose plutôt que de les laisser vertes"
        ).not.toBeNull();
    });

    it("DEP-01 — une dépendance non embarquée est trouvée ET nommée", () => {
        const { cap, edges } = anyEdge();
        expect(gen.checkDeps([cap])).toEqual(edges);
    });

    it("DEP-02 — le graphe complet ne signale rien", () => {
        const { cap } = anyEdge();
        expect(gen.checkDeps([cap, ...gen.declaredDeps(cap)])).toEqual([]);
    });

    it("DEP-04 — buildRegion REFUSE d'émettre une entrée au graphe incomplet", () => {
        const { cap, edges } = anyEdge();
        expect(() => gen.buildRegion({ caps: [cap], mode: "relative", id: "dep04" })).toThrow(
            edges[0]
        );
    });
});
