// @ts-check
// Config-contract Phase C / C1 — E2E ciblés (effets visibles) pour B1/B2.
//
// La couverture exhaustive par-valeur est en Vitest (__tests__/config/s10-*).
// Ici on confirme seulement, en navigateur réel, que la chaîne config → effet
// visible fonctionne de bout en bout pour des effets robustes au rendu logiciel
// (DOM, indépendants de WebGL) : le bandeau de branding (geoleaf.config.json).
//
// Prefixe `cfg-` (convention roadmap config-contract, anti-collision avec la
// numérotation 10,11,12… de plugin-validation).
//
// PRÉREQUIS D'EXÉCUTION : harnais e2e standard (`npm run build:deploy:all` pour
// peupler deploy/*, puis Playwright) AVEC rendu logiciel WebGL (flags SwiftShader
// d'e2e/helpers/launch-options.js — câblés dans playwright.config.js par le
// chantier boot-di-lifecycle ; sans eux le `new maplibregl.Map()` headless échoue
// et le branding n'est jamais monté). La couverture par-valeur, elle, est en
// Vitest (__tests__/config/s10-*) et ne dépend pas du navigateur.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

test.describe("cfg-c1 — racine/features (effets visibles)", () => {
    test("branding.enabled:true + branding.text → bandeau affiché avec le texte", async ({
        page,
    }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        const branding = page.locator(".gl-branding");
        await expect(branding).toBeVisible({ timeout: 10000 });
        // deploy-core/profiles/geoleaf.config.json → modules.branding.text "Propulsé par © GeoLeaf…"
        await expect(branding).toContainText("Propulsé par");
    });

    test("modules.branding.enabled:false → aucun bandeau (effet du flag)", async ({ page }) => {
        // Patch the geoleaf.config.json response before boot to disable branding.
        //
        // La clé est `modules.branding.enabled`, PAS la racine `branding` : la capacité a
        // migré de la clé app-globale racine vers son bloc de capacité
        // (capabilities/branding/branding-capability.ts → gate.configPath
        // "modules.branding.enabled", opt-in). Patcher `cfg.branding` n'écrivait plus
        // que sur une clé morte — le bandeau restait affiché.
        //
        // geoleaf.config.json est bien la cible : le gate est évalué sur le baseCfg
        // PRÉ-MERGE (app/boot-core.ts:207 `toCapConfig(baseCfg)`), et `modules.branding`
        // est un bloc app-global déclaré dans ce fichier.
        await page.addInitScript(() => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("geoleaf.config.json")) {
                    try {
                        const cfg = await res.clone().json();
                        cfg.modules = Object.assign({}, cfg.modules);
                        cfg.modules.branding = Object.assign({}, cfg.modules.branding, {
                            enabled: false,
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
        });

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        // Give the boot/branding init time to run, then assert the banner never appears.
        await page.waitForTimeout(1500);
        await expect(page.locator(".gl-branding")).toHaveCount(0);
    });
});
