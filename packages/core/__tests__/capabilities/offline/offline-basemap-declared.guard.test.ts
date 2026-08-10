/**
 * Garde 8.1 / A7′ — un fond de carte doit être RÉELLEMENT disponible hors réseau.
 *
 * `resource-enumerator.ts` filtre les fonds sur `basemap.offline === true`
 * (`_addBasemapResources`). Tant qu'aucun profil livré ne pose ce drapeau, la branche est
 * gardée par une clé que personne ne déclare : le filtre rend une liste vide, tout le chemin
 * de mise en cache de fond est inatteignable depuis un profil réel, et **aucun test unitaire
 * ne le voit** — ceux de `resource-enumerator.test.js` montent leurs propres `__basemaps`
 * synthétiques, donc ils resteraient verts sur un dépôt où plus aucun profil ne déclare rien.
 *
 * C'est exactement le **compteur C2** de la clause de complétude (« tout chemin gardé par une
 * clé qu'aucun profil ne pose »), et c'est ce que cette garde mesure sur le disque.
 *
 * ## Pourquoi la seconde assertion porte sur le VECTORIEL, et pas sur le nombre de fonds
 *
 * 🛑 **La disponibilité hors réseau d'un fond n'est pas une propriété du serveur, c'est une
 * propriété du FORMAT.** Les quatre stratégies du Service Worker gardent sur `status === 200`
 * et une réponse opaque porte `0` (`sw-core.js`). Un fond **vectoriel** est parsé par MapLibre
 * (PBF) : sa requête est nécessairement en mode `cors`, donc sa réponse n'est jamais opaque —
 * la garantie est structurelle. Un fond **raster** cross-origin n'offre pas cette garantie :
 * la sonde du 06/08/2026 a bien mesuré `Access-Control-Allow-Origin: *` sur les 3 origines
 * réelles, mais **c'est le mode de la requête qui décide**, et il n'est pas établi.
 *
 * Basculer un raster à `offline: true` ressemblerait donc à un correctif sans en être un.
 * La garde exige qu'au moins **un** fond hors-ligne soit vectoriel, ce qui est la seule forme
 * dont on sache démontrer qu'elle survit.
 *
 * ⚠️ **Elle n'exige PAS que TOUS les fonds hors-ligne soient vectoriels**, et c'est délibéré :
 * ce serait affirmer plus que ce qui est mesuré. Le mode réel des requêtes raster de MapLibre
 * n'a jamais été relevé en navigateur (c'était la moitié ② de la sonde CORS, non exécutée).
 * Une garde qui dépasse sa preuve se fait croire jusqu'au jour où elle coûte un run.
 *
 * ## Périmètre — dérivé, jamais écrit en dur
 *
 * Les profils sont filtrés par **la même règle que `scripts/build-deploy.cjs`** : `schemas/` et
 * tout répertoire préfixé `_` sont écartés. `_reference` est une fixture de test qui n'est
 * jamais déployée, et elle porte justement un `street` **raster** en `offline: true` — une
 * combinaison que cette garde ne doit ni valider ni condamner, puisque le rôle d'une fixture
 * est d'exercer les branches du schéma. Écrire la liste des profils en dur ici la ferait
 * cesser de matcher au premier ajout, et la garde sortirait verte en n'ayant rien scanné.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PROFILES = join(ROOT, "profiles");

/**
 * Une entrée de `basemaps.json`, réduite à ce que cette garde en lit.
 *
 * ⚠️ Volontairement LARGE et tout-optionnel : la garde lit des fichiers de profil **réels**,
 * pas une forme déjà validée par le schéma. Un type strict ici ferait échouer la compilation
 * sur un profil mal formé au lieu de faire échouer la GARDE, ce qui déplacerait le rouge hors
 * de l'endroit qui l'explique.
 */
interface BasemapEntry {
    type?: string;
    style?: string;
    url?: string;
    offline?: boolean;
}

/**
 * Les profils LIVRÉS, selon la règle de `build-deploy.cjs` (`schemas/` + préfixe `_` écartés).
 * Dérivée du disque, pour que l'ajout d'un profil entre dans le périmètre sans geste.
 */
function deployedProfileIds(): string[] {
    if (!existsSync(PROFILES)) return [];
    return readdirSync(PROFILES, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
        .map((e) => e.name);
}

/** Toutes les entrées de fond d'un profil livré, aplaties avec leur profil d'origine. */
function deployedBasemaps(): Array<{ profileId: string; key: string; entry: BasemapEntry }> {
    const out: Array<{ profileId: string; key: string; entry: BasemapEntry }> = [];
    for (const id of deployedProfileIds()) {
        const file = join(PROFILES, id, "config", "core", "basemaps.json");
        if (!existsSync(file)) continue;
        const doc = JSON.parse(readFileSync(file, "utf8")) as {
            basemaps?: Record<string, BasemapEntry>;
        };
        for (const [key, entry] of Object.entries(doc.basemaps ?? {})) {
            out.push({ profileId: id, key, entry });
        }
    }
    return out;
}

/**
 * Un fond est VECTORIEL au sens de `_addBasemapResources` : `type: "maplibre"`, ou un `style`
 * sans `url`. ⚠️ Le prédicat est RECOPIÉ de `resource-enumerator.ts` et doit le rester —
 * l'ancrer sur l'identifiant d'un fond (`ign-plan-3d`) ferait rougir cette garde au premier
 * renommage correct, alors que l'invariant, lui, n'aurait pas bougé.
 */
function isVector(entry: BasemapEntry): boolean {
    return entry.type === "maplibre" || (!!entry.style && !entry.url);
}

describe("8.1 / A7′ — le hors-ligne a un fond qu'il peut réellement servir", () => {
    it("sanity : le périmètre n'est pas vide (sinon la garde passe sans rien scanner)", () => {
        const profiles = deployedProfileIds();
        const basemaps = deployedBasemaps();
        expect(profiles.length).toBeGreaterThan(0);
        expect(basemaps.length).toBeGreaterThan(0);
    });

    it("au moins un profil LIVRÉ déclare un fond `offline: true` (compteur C2)", () => {
        const offline = deployedBasemaps().filter(({ entry }) => entry.offline === true);
        expect(
            offline.map(({ profileId, key }) => `${profileId}/${key}`),
            "aucun profil livré ne pose `offline: true` — `_addBasemapResources` filtre sur " +
                "une liste vide et tout le chemin de cache de fond est inatteignable"
        ).not.toHaveLength(0);
    });

    it("au moins un de ces fonds est VECTORIEL — la seule forme non opaque par construction", () => {
        const offlineVector = deployedBasemaps().filter(
            ({ entry }) => entry.offline === true && isVector(entry)
        );
        expect(
            offlineVector.map(({ profileId, key }) => `${profileId}/${key}`),
            "les fonds hors-ligne livrés sont tous raster : une réponse opaque porte " +
                "`status: 0` et le Service Worker la refuse, donc aucun ne survit à une coupure"
        ).not.toHaveLength(0);
    });

    it("un fond vectoriel hors-ligne porte bien un `style` résoluble", () => {
        const offlineVector = deployedBasemaps().filter(
            ({ entry }) => entry.offline === true && isVector(entry)
        );
        for (const { profileId, key, entry } of offlineVector) {
            expect(entry.style, `${profileId}/${key} : fond vectoriel sans URL de style`).toMatch(
                /^https?:\/\//
            );
        }
    });
});
