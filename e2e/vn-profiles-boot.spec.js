// @ts-check
// VÉRIFICATION NAVIGATEUR — matrice de boot des profils livrés, scénario F.3 de
// `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` (backlog R.7b).
//
// F.3 est le seul scénario qui exige de booter CHAQUE profil livré avec sa vraie config
// embarquée — ce qu'aucun test unitaire ne fait, et que happy-dom ne peut pas faire (pas de
// moteur, pas de boot MapLibre réel).
//
// Contre-épreuve S11/E2E : `pwa` et `offline` étaient **morts sur tous les profils livrés**.
//
// ⚠️ CE QUE CE TEST VÉRIFIE, ET CE QU'IL NE VÉRIFIE PAS — arbitré au pré-vol 24/07, R.21 :
//
//   • **Vérifié (browser-only, per-profil, discriminant)** : chaque profil livré BOOTE
//     réellement — carte native chargée, bon profil actif, aucune erreur de boot. Aucun test
//     unitaire ne fait ça ; c'est le vrai apport navigateur de F.3.
//
//   • **PAS vérifié ici** : l'activation FONCTIONNELLE de pwa/offline. Deux raisons, toutes
//     deux mesurées. (1) `registerGlobals` monte `gl.PWA` et `gl._OfflineDetector`
//     INCONDITIONNELLEMENT (`pwa/install.ts:47`) — asserter leur présence serait une garde
//     auto-réalisatrice (R.21), vraie que la capacité soit vivante ou morte. (2) L'activation
//     réelle de la PWA, c'est l'enregistrement du service worker, et la suite tourne en
//     `serviceWorkers: 'block'` : `navigator.serviceWorker.controller` est `false` par
//     construction. Le vérifier exige un run SW-autorisé — hors de cette passe, comme le
//     passage E2E d'origine (territoire Mattieu).
//
// ⚠️ Pourquoi PAS « aucune erreur console » brute : plusieurs profils référencent des données
// EXTERNES (couches sur serveurs distants, `qgis.geoleaf.dev`) injoignables depuis le déployé
// local → `Failed to load layer` / CORS. Ces erreurs sont ENVIRONNEMENTALES ; les compter
// rendrait le test tributaire de serveurs tiers. On ne retient que les erreurs de boot qui n'en
// sont PAS — celles qui trahiraient une vraie régression du boot d'un profil.

import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/**
 * Les profils réellement livrés — LUS SUR LE DISQUE, jamais écrits ici.
 *
 * ⚠️ Cette liste était en dur (8 noms, pré-vol du 24/07). Le 27/07, Mattieu a ramené
 * `profiles/` à 2 profils métier : les 6 autres étaient des démos, et ce test les a tous
 * cherchés dans un déployé qui ne les contenait plus (B-42). Un test qui énumère en dur ce
 * qu'un répertoire contient ne casse pas quand le répertoire change — il casse **plus tard**,
 * et il accuse le mauvais coupable.
 *
 * Le filtre reproduit EXACTEMENT celui de `scripts/build-deploy.cjs` : ni `schemas/`, ni les
 * répertoires préfixés `_` (`_reference` est l'échantillon exhaustif des formes de config, pas
 * une démo livrable). Si les deux filtres divergeaient, ce test chercherait un profil absent du
 * déployé — la panne d'aujourd'hui, sous un autre nom.
 */
const PROFILES = fs
    .readdirSync(new URL("../profiles/", import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

// Anti-test-vide : sans profil, la boucle ci-dessous ne déclare AUCUN test et la suite sort
// verte en n'ayant rien vérifié — exactement le mode d'échec que ce fichier existe pour couvrir.
if (PROFILES.length === 0) {
    throw new Error(
        "vn-profiles-boot : aucun profil livrable trouvé sous `profiles/`. " +
            "Un répertoire vide ferait passer ce test en ne bootant rien."
    );
}

// Erreurs environnementales attendues sur le déployé local (données externes absentes) —
// à distinguer d'une régression de boot/capacité.
const DATA_LOAD_NOISE = [
    /\[GeoLeaf\.GeoJSON\] Failed to load layer/i,
    /Access to fetch at .* has been blocked by CORS/i,
    /Failed to (load resource|fetch)/i,
    /net::ERR_/i,
    /\[SWRegister\] Registration failed/i,
];
const isEnvironmental = (t) => DATA_LOAD_NOISE.some((re) => re.test(t));

test.describe("VN — boot de chaque profil livré (F.3)", () => {
    for (const profile of PROFILES) {
        test(`F.3 — ${profile} : boot complet sans erreur`, async ({ page }) => {
            const bootErrors = [];
            const record = (t) => {
                if (!isEnvironmental(t)) bootErrors.push(t.split("\n")[0].slice(0, 120));
            };
            page.on("console", (m) => m.type() === "error" && record(m.text()));
            page.on("pageerror", (e) => record(String(e)));

            // Sélection du profil AVANT le boot, comme le sélecteur de la démo.
            await page.addInitScript((id) => {
                try {
                    sessionStorage.setItem("gl-selected-profile", id);
                } catch (e) {
                    void e;
                }
            }, profile);

            await page.goto("/");

            // 1 — boot complet : la carte native est chargée.
            await page.waitForFunction(
                () => {
                    const n = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                    return !!(n && typeof n.loaded === "function" && n.loaded());
                },
                null,
                { timeout: 25000 }
            );
            await page.waitForTimeout(1200); // laisser les capacités différées s'installer

            // 2 — le bon profil a bien été chargé (le sélecteur a pris effet).
            const active = await page.evaluate(() =>
                window.GeoLeaf?.Config?.getActiveProfileId?.()
            );
            expect(active, "profil actif inattendu").toBe(profile);

            // 3 — aucune erreur de BOOT (les échecs de données externes sont exclus, voir en-tête).
            // Une capacité qui jetterait à l'installation — la forme qu'aurait un profil « mort » —
            // surfacerait ici ; un no-op silencieux, non, et ce dernier reste au run SW-autorisé.
            expect(
                bootErrors,
                `erreurs de boot non environnementales sur ${profile} : ${bootErrors.join(" | ")}`
            ).toEqual([]);
        });
    }
});
