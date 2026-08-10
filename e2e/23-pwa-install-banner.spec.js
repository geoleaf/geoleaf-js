// @ts-check
// E2E: 23-pwa — bannières d'installation PWA (deploy-core, port 8766).
//
// Ce fichier décharge le scénario **S7** de la table de vérification navigateur de
// `roadmap_optimisation-capacites.md`, qui disait pourquoi il ne pouvait PAS être couvert
// en unitaire : « le rendu réel est derrière un `setTimeout(1500)` et `getLabel` résout
// selon la langue active du runtime ; happy-dom n'exerce ni la minuterie réelle ni le
// rendu DOM complet (les tests avancent des fake timers, pas le vrai délai) ».
//
// ⚠️ Contexte indispensable pour lire ces tests : jusqu'au 21/07/2026, la capacité `pwa`
// était **morte en production**. `_applyModularEnrichedProfile` retournait l'objet profil
// au lieu de la config fusionnée, si bien que `capabilities/pwa/install.ts:55` recevait
// `undefined` pour `modules.pwa`, partait en branche « gate off » et appelait
// `_unregisterAll()`. Aucune de ces bannières n'avait donc JAMAIS pu s'afficher, sur aucun
// profil. Ces tests sont la première vérification réelle de ce chemin.
//
// Les 3 sous-scénarios de S7 :
//   1. `installPrompt.enabled:true` + `short_name` posé, en langue NON-FR
//      → bannière traduite portant le nom d'app configuré (et pas « GeoLeaf »)
//   2. iOS Safari non installé → bannière iOS (celle derrière le `setTimeout(1500)`)
//   3. profil sans `installPrompt.enabled` → AUCUNE bannière

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") });

// Volontairement distinct de « GeoLeaf » : c'est ce qui rend le test discriminant.
// Si la lecture de `modules.pwa.short_name` régresse, le repli est « GeoLeaf » et
// l'assertion tombe — au lieu de passer sur une valeur identique par coïncidence.
const APP_NAME = "Atlas Rosario";

/**
 * Réécrit `modules.pwa` dans la réponse de `geoleaf.config.json` avant le boot.
 * Même véhicule que `cfg-c1-root-features.spec.js` : `modules.pwa` est un bloc
 * app-global déclaré dans ce fichier, pas dans le bundle de profil.
 */
async function patchPwa(page, patch) {
    await page.addInitScript((p) => {
        const origFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input && input.url;
            const res = await origFetch(input, init);
            if (url && url.includes("geoleaf.config.json")) {
                try {
                    const cfg = await res.clone().json();
                    cfg.modules = Object.assign({}, cfg.modules);
                    cfg.modules.pwa = Object.assign({}, cfg.modules.pwa, p);
                    return new Response(JSON.stringify(cfg), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                } catch {
                    return res;
                }
            }
            return res;
        };
    }, patch);
}

/** Émet un `beforeinstallprompt` synthétique — Chromium ne le déclenche pas en headless. */
async function fireBeforeInstallPrompt(page) {
    await page.evaluate(() => {
        const evt = /** @type {any} */ (new Event("beforeinstallprompt"));
        evt.prompt = () => Promise.resolve();
        evt.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
        window.dispatchEvent(evt);
    });
}

test.describe("23-pwa — bannière d'installation (S7)", () => {
    test("installPrompt activé + short_name posé, en anglais → bannière traduite au nom configuré", async ({
        page,
    }) => {
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            name: "Atlas Cartographique Rosario",
            installPrompt: { enabled: true },
        });
        // `?lang=en` prime sur `ui.language` (i18n.ts:62) — le plus court chemin vers une
        // langue non-FR sans toucher au profil.
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Ré-émission bornée : `beforeinstallprompt` est edge-triggered et son écouteur est
        // posé par `PwaLifecycle` dans la passe `sharedLifecycle`, dont l'ordre vis-à-vis de
        // l'apparition du conteneur de carte n'est pas garanti. Un dispatch unique peut donc
        // tomber avant l'armement et être perdu sans trace. Même motif que le seam
        // `geoleaf:feature:hover` de `22-feature-info`.
        const banner = page.locator("#gl-install-banner");
        await expect(async () => {
            await fireBeforeInstallPrompt(page);
            await expect(banner).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 15000 });

        // Les DEUX moitiés du scénario, assertées séparément pour qu'un échec dise laquelle.
        // (a) le libellé est bien en anglais — `pwa.install.title` vaut « Install the {0} app »
        //     en `en` contre « Installer l'application {0} » en `fr`.
        await expect(banner).toContainText("Install the");
        await expect(banner).not.toContainText("Installer l'application");
        // (b) le nom vient de la config, pas du repli de la bibliothèque.
        await expect(banner).toContainText(APP_NAME);
        await expect(banner).not.toContainText("GeoLeaf");

        // Le bouton d'action est traduit lui aussi (`pwa.install.button`).
        await expect(banner).toContainText("Install");
    });

    test("profil SANS installPrompt.enabled → aucune bannière, même sur beforeinstallprompt", async ({
        page,
    }) => {
        // ⚠️ CE TEST PATCHE DÉSORMAIS LA CONFIG, et le motif mérite d'être lu.
        //
        // Il disait « la config livrée porte `installPrompt.enabled: false` — on ne patche donc
        // RIEN, ce test éprouve l'état par défaut du déploiement réel ». C'était vrai jusqu'à
        // **B-113**, qui a activé l'invite d'installation : sur une flotte iOS c'est la
        // condition de survie du stockage hors-ligne, sur Android le signal d'engagement le
        // moins cher.
        //
        // 🛑 Le test n'était donc plus vert que parce que le DÉPLOYÉ était périmé. La première
        // reconstruction honnête l'a fait rougir — mesuré le 02/08/2026 — et le rouge aurait
        // été attribué au Sprint 3 alors qu'il venait d'un changement de configuration.
        //
        // Ce qu'il garde reste EXACTEMENT le même : un profil qui n'active pas l'invite
        // n'affiche aucune bannière. Ce qui change, c'est qu'il faut désormais poser cet état
        // explicitement au lieu de l'hériter du déployé — ce qui est plus honnête : un test
        // qui dépend d'un défaut de configuration ambiant ne dit pas ce qu'il croit dire.
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            installPrompt: { enabled: false },
        });
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        await fireBeforeInstallPrompt(page);
        // Laisser passer largement le délai de la bannière iOS (1500 ms) : si une bannière
        // devait apparaître par erreur, elle en a le temps.
        await page.waitForTimeout(2500);

        await expect(page.locator("#gl-install-banner")).toHaveCount(0);
        await expect(page.locator("#gl-ios-install-banner")).toHaveCount(0);
    });
});

test.describe("23-pwa — bannière iOS (S7)", () => {
    // `isIOSInstallable()` teste `/iPhone|iPad|iPod/i` sur l'UA puis `navigator.standalone
    // !== true` (platform.ts:23-40). Un UA iPhone suffit donc à emprunter ce chemin ;
    // `standalone` est absent sous Chromium, ce qui correspond bien à « pas encore installé ».
    test.use({
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        viewport: { width: 390, height: 844 },
    });

    test("iOS non installé → bannière iOS après son délai réel, au nom configuré", async ({
        page,
    }) => {
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            installPrompt: { enabled: true },
        });
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Pas de `beforeinstallprompt` ici : iOS ne l'émet pas, c'est toute la raison d'être
        // de cette seconde bannière. Elle arrive seule, derrière `setTimeout(1500)` — le
        // délai réel que happy-dom ne pouvait pas exercer.
        const banner = page.locator("#gl-ios-install-banner");
        await expect(banner).toBeVisible({ timeout: 15000 });

        await expect(banner).toContainText(APP_NAME);
        await expect(banner).not.toContainText("GeoLeaf");
        // `pwa.ios.title` = « Install {0} » en anglais, « Installer {0} » en français.
        await expect(banner).toContainText("Install");
    });
});
