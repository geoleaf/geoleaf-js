// @ts-check
// Config-contract Phase C / C2 — E2E ciblés (présence/visibilité réelle) pour B3 (ui.json).
//
// La couverture exhaustive PAR VALEUR de tous les flags `ui.*` est en Vitest
// (__tests__/config/s11-*), qui patche la config au niveau unitaire contre les vrais
// chemins de code. Ici on confirme seulement, en navigateur réel (deploy-core, PWA +
// service worker, profil tourism), que la chaîne `ui.show* → contrôle DOM` tient de
// bout en bout — limité aux contrôles CORE à sélecteur stable et à effet DOM net.
//
// Mécanisme de patch (validé par sonde DOM, 2026-06-14) : monkeypatch de `window.fetch`
// — il intercepte AVANT le service worker (comme cfg-c1, contrairement à page.route qui
// ne capte pas les requêtes médiées par le SW). La cible est `profile-bundle.json` :
// `build-deploy` bundle TOUTE la config d'un profil dans ce fichier unique (il n'y a PAS
// de `config/core/ui.json` servi séparément) — flags UI à `bundle.ui.ui.<flag>`, gates de
// capacité à `bundle.modules.<id>.enabled`. Les arguments sont passés en ARGUMENT
// d'addInitScript — pas via closure (sérialiser une fonction-closure en chaîne perd ses
// variables → le patch ne s'appliquerait jamais).
//
// ⚠️ Deux systèmes de gate coexistent, et `ui.show*` n'est plus le bon pour tout le monde :
// `ui.showScale` / `ui.showCoordinates` ne sont lus par AUCUN code (migrés vers
// `modules.scale.enabled` / `modules.coordinates.enabled`), tandis que
// `ui.showBaseLayerControls` reste bien lu. D'où les deux helpers ci-dessous.
//
// Préfixe `cfg-` (convention roadmap config-contract, anti-collision avec la
// numérotation 10,11,12… de plugin-validation).
//
// HORS PÉRIMÈTRE E2E (couverts par Vitest s11) : showFilterPanel / showLegend /
// showLayerManager / showThemeSelector / showTable — contrôles plugin-defined sans
// sélecteur core stable, différés et dépendants de données/thèmes/plugins, non
// assertables proprement ici (ex. le toggle filtre est `display:none` même flag=true).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Force `bundle.ui.ui[flag] = value` en interceptant `profile-bundle.json` via un
 * monkeypatch `window.fetch` self-contained ({flag,value} passés en argument).
 */
async function patchUiFlag(page, flag, value) {
    await page.addInitScript(
        ({ flag, value }) => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("profile-bundle.json")) {
                    try {
                        const cfg = await res.clone().json();
                        if (cfg.ui && cfg.ui.ui) cfg.ui.ui[flag] = value;
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
        },
        { flag, value }
    );
}

/**
 * Force `bundle.modules[capId].enabled = value`, même véhicule (profile-bundle.json).
 *
 * Les contrôles scale et coordinates ne sont plus pilotés par `ui.showScale` /
 * `ui.showCoordinates` : ces deux clés ne sont lues NULLE PART dans
 * `packages/core/src` (grep = 0 hit hors commentaires « migrated from »). Chaque
 * capacité porte son propre gate — `modules.scale.enabled` et
 * `modules.coordinates.enabled` — testé `=== false` au montage différé
 * (capabilities/{scale,coordinates}/lifecycle.ts, sur `geoleaf:app:ready`).
 *
 * La cible reste `profile-bundle.json` : le bloc `modules` du bundle est fusionné
 * clé par clé dans la config effective (config/profile.ts:236 → `mergeModulesBag`),
 * et ces deux gates sont relus APRÈS le merge — donc le patch est honoré.
 */
async function patchModuleGate(page, capId, value) {
    await page.addInitScript(
        ({ capId, value }) => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("profile-bundle.json")) {
                    try {
                        const cfg = await res.clone().json();
                        cfg.modules = Object.assign({}, cfg.modules);
                        cfg.modules[capId] = Object.assign({}, cfg.modules[capId], {
                            enabled: value,
                        });
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
        },
        { capId, value }
    );
}

async function bootMap(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
}

// Contrôles CORE à sélecteur stable + effet flag→DOM net, confirmés par sonde sur
// deploy-core (tourism). Gate = `=== false` pour les trois (absent ⇒ affiché).
//
// `key` = la clé de config RÉELLEMENT lue par le code, et `patch` le véhicule
// correspondant. Les deux ne coïncident plus : `showBaseLayerControls` reste un flag
// `ui.*` (basemaps/ui.ts:93), tandis que scale et coordinates ont migré vers le gate
// de leur capacité (`modules.<id>.enabled`).
const CORE_CONTROLS = [
    // basemaps/ui.ts:93 (eager, `showBaseLayerControls === false`) — tourism défaut false
    {
        key: "ui.showBaseLayerControls",
        id: "showBaseLayerControls",
        patch: patchUiFlag,
        selector: "#gl-left-panel",
    },
    // capabilities/scale/lifecycle.ts:30 (différé geoleaf:app:ready, `enabled === false`)
    {
        key: "modules.scale.enabled",
        id: "scale",
        patch: patchModuleGate,
        selector: ".gl-scale-main-wrapper",
    },
    // capabilities/coordinates/lifecycle.ts:35 (différé, readout ancré sur le wrapper scale)
    {
        key: "modules.coordinates.enabled",
        id: "coordinates",
        patch: patchModuleGate,
        selector: ".gl-scale-coordinates",
    },
];

test.describe("cfg-c2 — ui.show* → contrôles DOM (contrôles core)", () => {
    for (const { key, id, patch, selector } of CORE_CONTROLS) {
        test(`${key}:true → ${selector} visible`, async ({ page }) => {
            await patch(page, id, true);
            await bootMap(page);
            await expect(page.locator(selector).first()).toBeVisible({ timeout: 10000 });
        });

        test(`${key}:false → ${selector} absent`, async ({ page }) => {
            await patch(page, id, false);
            await bootMap(page);
            // Laisser tourner l'UI différée (geoleaf:app:ready) : si le contrôle devait
            // apparaître, ce serait fait — on asserte alors qu'il reste absent.
            await page.waitForTimeout(4000);
            await expect(page.locator(selector)).toHaveCount(0);
        });
    }
});
