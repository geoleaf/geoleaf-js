// @ts-check
// E2E — capacité `profile-switcher` (S1 de roadmap_feature-selecteurs-ui).
//
// Ce que ce spec apporte, et qu'aucun test unitaire ne peut donner :
//
//   • Le sélecteur est réellement injecté dans le VRAI gestionnaire de couches, construit
//     par le vrai boot — pas dans un DOM de test reconstitué à la main. C'est le seul
//     endroit où le seam kernel, le lifecycle de la capacité et le panneau se rencontrent.
//   • `data.availableProfiles` est réellement RÉCOLTÉ par `build-deploy.cjs` et lu au
//     runtime. Un test unitaire stube cette liste ; ici elle vient du déployé, donc un
//     défaut de la récolte se voit.
//   • La bascule recharge effectivement sur le bon profil (sessionStorage + reload +
//     purge SW), chaîne que happy-dom ne peut pas exécuter.
//
// ⚠️ La capacité est opt-in : elle n'est visible que parce que `profiles/geoleaf.config.json`
// pose `modules.profile-switcher.enabled: true`. Si ce spec devient rouge après un changement
// de config, vérifier d'abord ce drapeau — pas le code.
//
// ═══ PRÉCONDITION MESURÉE — B-49, 10/08/2026 ═══
//
// 🛑 Ce fichier a été 4/4 ROUGE le 10/08/2026, et il décrivait le PRODUIT CONFORME. Le profil
// client est sorti du dépôt (`f218691e`) : la récolte est passée de 2 profils à 1, et PS-04 dit
// qu'à un seul profil le sélecteur **ne se rend pas** — une liste à une option annonce un choix
// qui n'existe pas. Les quatre assertions ci-dessous supposent toutes qu'un choix existe.
//
// ⚠️ AUCUNE de ces assertions n'a été relâchée, et c'est le point. Passer `>= 2` à `>= 1`
// aurait rendu ce spec incapable de voir ce pour quoi il existe. Il garde donc son exigence
// entière, et c'est sa PRÉCONDITION qui est devenue explicite : elle est **mesurée sur la
// variante réellement servie**, à chaque run, et le fichier se **réarme tout seul** le jour où
// un second profil est livré. Rien à décommenter, rien à se rappeler.
//
// 🛑 Et ce spec n'est PLUS l'unique oracle de la récolte : il ne l'a jamais été sur un chemin
// par défaut (`ci-local.cjs` réserve l'E2E à `--e2e`, `ci.yml` la réserve à
// `workflow_dispatch`), ce qui est le vrai sujet de B-49. L'œil qui reste ALLUMÉ en
// permanence est unitaire — `packages/core/__tests__/capabilities/profile-switcher/
// profile-harvest.guard.test.ts` (PH-01…PH-04) — et il rougit sur toute dégradation
// SILENCIEUSE de la récolte. Neutraliser ce fichier sans lui aurait refermé le rouge ET l'œil.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

// Viewport ≥ 1440 px : le sélecteur vit DANS le gestionnaire de couches, et le
// gestionnaire n'est atteignable que par le panneau latéral desktop. Sous 1440, le
// contrôle est `display:none` (il passe par la feuille mobile) — mesuré, pas supposé.
test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1600, height: 900 },
});

const SWITCHER = ".gl-profile-switcher";
const SELECT = ".gl-profile-switcher__select";
const LAYERS_TAB = '[data-gl-rp-tab="layers"]';

/** Attend le boot complet (carte native chargée) puis les capacités différées. */
async function bootReady(page) {
    await page.waitForFunction(
        () => {
            const n = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!(n && typeof n.loaded === "function" && n.loaded());
        },
        null,
        { timeout: 25000 }
    );
    await page.waitForTimeout(1200);
}

/**
 * Ouvre l'onglet « Couches » du panneau latéral.
 *
 * Le gestionnaire de couches est **replié par défaut** (`gl-layer-manager--collapsed`) et
 * son volet reste fermé tant qu'aucun onglet n'est actif : le sélecteur est donc dans le
 * DOM mais de largeur nulle. C'est le comportement voulu — un utilisateur ouvre le
 * gestionnaire avant de choisir son jeu de données — et ce geste fait donc partie du
 * parcours à tester, pas du décor.
 */
async function openLayersPanel(page) {
    const tab = page.locator(LAYERS_TAB);
    await tab.first().click();
    await page.waitForTimeout(400);
}

// ─────────────────────────────────────────────────────────────────────────────
// Précondition — mesurée sur la VARIANTE SERVIE, jamais déduite des sources.
//
// C'est le patron de `30-sync-cycle.spec.js` : un `beforeAll` qui mesure, un motif nommé, un
// TÉMOIN hors du `describe` pour qu'un fichier entièrement sauté ne se lise pas comme un
// fichier entièrement vert. Ici la mesure porte sur `data.availableProfiles` du config racine
// tel qu'il est SERVI — c'est la seule chose dont la page dispose, `build-deploy.cjs` étant le
// seul à savoir énumérer `profiles/` (un navigateur ne liste pas un répertoire serveur).
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre de profils récoltés dans la variante servie, ou `null` si la mesure a échoué. */
let harvested = null;
/** Motif de saut, nommé et daté. `null` ⇒ le fichier joue. */
let skipReason = null;

test.beforeAll(async ({ request }) => {
    try {
        const r = await request.get(`${baseURL("core")}/profiles/geoleaf.config.json`, {
            timeout: 8000,
        });
        if (!r.ok()) {
            skipReason = `config racine de la variante servie : HTTP ${r.status()} — déployé absent ou vhost non servi`;
            return;
        }
        const list = (await r.json())?.data?.availableProfiles;
        harvested = Array.isArray(list) ? list.length : null;
    } catch (e) {
        skipReason = `config racine de la variante servie illisible (${String(e).slice(0, 80)})`;
        return;
    }

    if (harvested === null) {
        skipReason =
            "`data.availableProfiles` absente ou non-tableau dans la variante servie — le " +
            "déployé n'est pas passé par `build-deploy.cjs`, ou sa récolte a été écrasée";
        return;
    }
    if (harvested < 2) {
        // ⚠️ SAUT MOTIVÉ ET DATÉ — B-49 (registre `_docs_projet/registres/backlog_technique.md`).
        // POURQUOI : la variante servie ne récolte qu'un profil, et PS-04 (fiche
        // `docs/specs/capacites/profile-switcher.md`) prescrit qu'à moins de deux profils le
        // sélecteur ne se rend PAS. Les 4 tests décriraient alors un produit conforme comme un
        // défaut. QUAND il se réactive : tout seul, au premier run où la variante servie
        // récolte ≥ 2 profils — la condition est re-mesurée à chaque exécution, il n'y a aucun
        // drapeau à remettre. Livrer ce second profil est une décision produit (voie 1 de
        // B-49, voisine de B-213) qui appartient à Mattieu, pas à ce fichier.
        skipReason =
            `B-49 — la variante servie ne récolte que ${harvested} profil : PS-04 prescrit qu'en ` +
            "dessous de 2 le sélecteur ne se rende pas, donc ces 4 tests décriraient le produit " +
            "conforme comme un défaut. Réarmé AUTOMATIQUEMENT dès qu'un second profil est livré " +
            "(condition re-mesurée à chaque run). La dégradation SILENCIEUSE de la récolte reste " +
            "vue, elle, par `profile-harvest.guard.test.ts` — chemin par défaut, PH-01…PH-04";
    }
});

test("TÉMOIN — si ce fichier se saute, le motif est NOMMÉ et la récolte n'est pas à zéro", async () => {
    // ⚠️ HORS du `describe`, donc hors de portée de son `beforeEach` : c'est le seul test qui
    // doit s'exécuter même quand la précondition n'est pas tenue. Sans lui, ce fichier
    // passerait pour vert dans un rapport lu vite alors qu'il n'a rien joué — exactement ce
    // que B-49 reproche au silence.
    if (skipReason) {
        test.info().annotations.push({ type: "skip-reason", description: skipReason });
        expect(skipReason.length, "un saut doit porter un motif lisible").toBeGreaterThan(20);
    }
    // Une récolte VIDE n'est jamais un état acceptable, sauté ou non : `build-deploy.cjs` sort
    // déjà en `log.err` dessus. Le saut de B-49 couvre « 1 profil », pas « aucun ».
    expect(
        harvested,
        "la variante servie ne récolte AUCUN profil — ce n'est pas la dégradation prévue par " +
            "PS-04, c'est une récolte cassée (voir `profile-harvest.guard.test.ts`)"
    ).not.toBe(0);
});

test.describe("profile-switcher — sélecteur de profil", () => {
    test.beforeEach(() => {
        test.skip(skipReason !== null, skipReason ?? "");
    });

    test("la liste des profils est récoltée au build et lisible au runtime", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const profiles = await page.evaluate(() => window.GeoLeaf?.ProfileSwitcher?.list?.() ?? []);

        // La récolte tourne sur les dossiers de profils réellement livrés : au moins les
        // deux qu'il faut pour que le sélecteur ait un sens.
        expect(profiles.length).toBeGreaterThanOrEqual(2);
        expect(profiles.every((p) => typeof p.id === "string" && p.id.length > 0)).toBe(true);
        expect(profiles.every((p) => typeof p.displayLabel === "string")).toBe(true);
        expect(profiles.map((p) => p.id)).toContain("tourism");
    });

    test("le sélecteur est monté en TÊTE du gestionnaire de couches", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const el = page.locator(SWITCHER).first();
        await expect(el).toHaveCount(1);

        // Position structurelle : juste après l'en-tête, donc HORS du corps que
        // renderSections() vide à chaque rendu.
        const placement = await page.evaluate((sel) => {
            const node = document.querySelector(sel);
            return {
                prev: node?.previousElementSibling?.className ?? null,
                next: node?.nextElementSibling?.className ?? null,
                insideBody: !!node?.closest(".gl-layer-manager__body"),
            };
        }, SWITCHER);

        expect(placement.prev).toContain("gl-layer-manager__header-wrapper");
        expect(placement.next).toContain("gl-layer-manager__body-wrapper");
        expect(placement.insideBody).toBe(false);
    });

    test("il reflète le profil actif et n'est jamais dupliqué", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const active = await page.evaluate(() => window.GeoLeaf?.Config?.getActiveProfileId?.());
        await expect(page.locator(SELECT).first()).toHaveValue(String(active));
        await expect(page.locator(SWITCHER)).toHaveCount(1);
    });

    test("changer de profil recharge sur le profil choisi", async ({ page }) => {
        await page.goto("/");
        await bootReady(page);

        const target = await page.evaluate(() => {
            const active = window.GeoLeaf?.Config?.getActiveProfileId?.();
            const list = window.GeoLeaf?.ProfileSwitcher?.list?.() ?? [];
            return list.map((p) => p.id).find((id) => id !== active) ?? null;
        });
        expect(target, "il faut au moins 2 profils livrés pour ce scénario").not.toBeNull();

        // Le parcours réel : on ouvre le gestionnaire, PUIS on choisit.
        await openLayersPanel(page);
        await expect(page.locator(SELECT).first()).toBeVisible();

        await page.locator(SELECT).first().selectOption(String(target));

        // La bascule navigue : attendre le nouveau boot, puis vérifier le profil actif.
        await page.waitForURL(new RegExp(`profile=${target}`), { timeout: 25000 });
        await bootReady(page);

        const nowActive = await page.evaluate(() => window.GeoLeaf?.Config?.getActiveProfileId?.());
        expect(nowActive).toBe(target);
    });
});
