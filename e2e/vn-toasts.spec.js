// @ts-check
// VÉRIFICATION NAVIGATEUR — famille toasts. Scénarios C.4, C.5, D.3, D.4 de
// `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` (backlog R.7b).
//
// Ces quatre scénarios sont dans la table parce que `happy-dom` ne peut décider aucun d'eux :
// il ne calcule ni la cascade CSS effective (C.4, C.5), ni les animations de sortie (D.3), et
// il ne voit pas un cycle de vie réel de la carte (D.4).
//
// ⚠️ Chaque test porte sa CONTRE-ÉPREUVE en tête : c'est elle qui dit pourquoi le test existe
// et ce qu'il faut regarder le jour où il rougit. Les quatre sont des 🔴 — des régressions
// DÉJÀ survenues en production, donc des tests de non-régression au sens propre.
//
// Contrat DOM réellement émis (inspection du code, pas de la doc) :
//   - conteneur → `#gl-notifications`            (renderer/notifications.ts:116)
//   - toast     → `.gl-toast` + `.gl-toast--{type}` (info|success|warning|error)
//   - sortie    → `.gl-toast--removing`          (exclue du décompte des visibles)
// API : `GeoLeaf.notify(msg, type)` (primitive noyau) et `GeoLeaf.Notifications.*`
// (façade riche, montée par capabilities/toast-renderer/install.ts:49).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** Toasts présents et NON en cours de disparition — c'est le décompte que `maxVisible` borne. */
const VISIBLE = ".gl-toast:not(.gl-toast--removing)";

/** Les 4 types et la couleur que leur règle CSS impose au liséré (notifications.css:227-288). */
const TYPES = [
    { type: "success", rgb: "rgb(16, 185, 129)" }, // #10b981
    { type: "error", rgb: "rgb(239, 68, 68)" }, //    #ef4444
    { type: "warning", rgb: "rgb(245, 158, 11)" }, // #f59e0b
    { type: "info", rgb: "rgb(59, 130, 246)" }, //    #3b82f6
];

test.describe("VN — toasts (C.4, C.5, D.3, D.4)", () => {
    test.beforeEach(async ({ page }) => {
        // Capture d'un état d'AVANT : `geoleaf:app:ready` part PENDANT le boot, donc un
        // abonnement posé après `goto` le raterait. `addInitScript` s'exécute avant tout
        // script du document, ce qui est la seule position d'où l'événement est observable.
        // Le drapeau sert à C.5 (voir son commentaire) : c'est le seul jalon postérieur au
        // dernier `applyTheme()` du boot, lequel réécrit les classes de thème du `<body>`.
        await page.addInitScript(() => {
            document.addEventListener(
                "geoleaf:app:ready",
                () => {
                    /** @type {any} */ (window).__glAppReady = true;
                },
                { once: true }
            );
        });
        await page.goto("/");
        await bootMap(page);
    });

    // ── C.4 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve S9 : la règle de base s'écrivait `border-left: 4px solid var(--gl-accent)`,
    // et `--gl-accent` N'EST DÉFINIE NULLE PART (le jeton réel est `--gl-color-accent`). Une
    // variable inexistante rend la déclaration RACCOURCIE invalide à l'évaluation : `border-left-
    // style` retombait à `none`, ce qui neutralisait AUSSI le `border-left-color` des 4 règles
    // par type. Le codage couleur des toasts n'a donc JAMAIS rien affiché.
    // C'est pour cela que le test asserte le `style` et la `width` autant que la couleur : une
    // couleur juste sur un liséré `none` est exactement le bug d'origine.
    test("C.4 — les 4 types de toast portent un liséré coloré effectivement peint", async ({
        page,
    }) => {
        for (const { type, rgb } of TYPES) {
            await page.evaluate(([t]) => window.GeoLeaf.notify(`vn-c4-${t}`, t), [type]);

            const toast = page.locator(`.gl-toast--${type}`).first();
            await expect(toast, `aucun toast rendu pour le type "${type}"`).toBeVisible({
                timeout: 5000,
            });

            const border = await toast.evaluate((el) => {
                const cs = getComputedStyle(el);
                return {
                    style: cs.borderLeftStyle,
                    width: cs.borderLeftWidth,
                    color: cs.borderLeftColor,
                };
            });

            // `none` ⇒ le jeton est de nouveau indéfini : le liséré n'existe pas, quelle que
            // soit la couleur calculée. C'est LE symptôme d'origine.
            expect(border.style, `${type} : liséré non peint (jeton CSS indéfini ?)`).toBe("solid");
            expect(border.width, `${type} : liséré d'épaisseur nulle`).toBe("4px");
            expect(border.color, `${type} : mauvaise couleur de liséré`).toBe(rgb);

            await page.evaluate(() => window.GeoLeaf.Notifications.clearAll());
        }
    });

    // ── C.5 🟠 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve S9 : un doublon de spécificité ÉGALE (`body.gl-theme-dark .gl-toast`,
    // 0-2-1, dupliqué) imposait un gris fixe au fond des toasts, qui cessait donc de suivre
    // les variables de thème. On n'asserte pas une couleur en dur — elle appartient au thème —
    // mais le fait que le fond DIFFÈRE entre les deux thèmes : c'est exactement ce qu'un gris
    // fixe rendait impossible.
    // ⚠️ Le thème sombre se pilote par la CLASSE `body.gl-theme-dark` (notifications.css:23,
    // 206, 313), PAS par `prefers-color-scheme` : `emulateMedia` ne bascule rien ici.
    test("C.5 — le fond des toasts suit le thème (clair ≠ sombre)", async ({ page }) => {
        // ⚠️ COURSE (MapLibre 6.2.0) — `bootMap()` du `beforeEach` est un PROXY : il rend la
        // main dès que la carte native porte un style, c'est-à-dire au module `core-map` du
        // registry. L'applicateur de thème du boot vit DEUX modules plus loin —
        // `UIModule` #12 → `UI.init()` → `_initThemeControl()` → `_UITheme.applyTheme()` —
        // et `UIModule` déclare `dependencies = ["config","core-map","shared","geojson"]`,
        // donc il attend le chargement des couches. Tout ce test s'exécutait dans cet
        // intervalle.
        // Or `applyTheme()` COMMENCE par `body.classList.remove("gl-theme-light",
        // "gl-theme-dark")` (kernel/ui/theme.ts:87). S'il atterrit entre le `toggle()`
        // ci-dessous et la lecture du fond, il EFFACE la classe que le test vient de poser :
        // la passe sombre se lit en clair, les deux mesures deviennent égales, et le test
        // rougit sur « le fond ne change pas avec le thème » en accusant un gris fixe qui
        // n'existe pas. Le `<body>` livré part `gl-theme-dark` (`deploy/*/index.html`), donc
        // le boot RÉÉCRIT toujours cette classe : la fenêtre est structurelle, la v6 l'a
        // seulement déplacée dans la nôtre en sérialisant deux requêtes de module de plus.
        // 🛑 UNE PREMIÈRE RÉDACTION DE CE VERROU ATTENDAIT `#geoleaf-map.gl-theme-*`, ET IL
        // NE VERROUILLAIT RIEN — relecture adversariale, puis vérifié dans le code :
        //   · `kernel/map/facade.ts:151` appelle `applyThemeSafe()` à la CRÉATION de la carte,
        //     donc au module `core-map`, DEUX modules avant l'écrivain qu'il prétendait
        //     attendre. Le marqueur est déjà posé quand `bootMap()` rend la main : l'attente
        //     durait ~0 ms.
        //   · et il n'est pas latché : `kernel/ui/ui-api.ts:161,169` rappellent `applyTheme`
        //     via `initAutoTheme` puis `initThemeToggle`, chacun commençant par un
        //     `classList.remove("gl-theme-light","gl-theme-dark")` (theme.ts:87). La classe
        //     est donc RÉÉCRITE après coup — exactement la course qu'on veut fermer.
        // Un verrou qui attend zéro milliseconde est pire qu'aucun : il fait croire la course
        // fermée, et le taux d'échec baisse juste assez pour le confirmer à tort.
        //
        // Le seul jalon POSTÉRIEUR au dernier `applyTheme` du boot est `geoleaf:app:ready` :
        // `setupReveal()` est appelé ligne 149 de `app/boot-modules/ui.module.ts`, après
        // `initUIPanels` (l.113) et après l'`UI.init()` → `_initThemeControl()` qui applique le
        // thème (l.67, l.77), et `app/init-reveal.ts:121` en est l'unique émetteur.
        // ⚠️ Capturé par `addInitScript` — donc AVANT tout script de la page : l'événement part
        // pendant le boot, s'y abonner après `goto` le raterait. C'est un état d'AVANT, il ne
        // s'observe pas après coup.
        await page.waitForFunction(() => window.__glAppReady === true, null, { timeout: 25000 });

        const bgFor = async (dark) => {
            // Message distinct par passe : le toast mesuré est identifié par SON texte, plus
            // par `.first()`. Le boot émet ses propres toasts APRÈS `bootMap()` — celui de
            // chargement sur `geoleaf:theme:applying` (persistant, dispatché par
            // `ThemeEngineModule`, qui court après `UIModule`) et celui de profil sur
            // `geoleaf:profile:loaded` — et `.first()` prend le PLUS ANCIEN du conteneur.
            // C'est donc potentiellement un toast né AVANT la bascule de thème : son fond
            // est alors en pleine transition `all .3s` (toast-renderer.css:127) et se lit à
            // une valeur intermédiaire, voire encore à celle de l'autre thème. Un toast créé
            // APRÈS la bascule naît à sa couleur finale — aucune transition ne court sur le
            // premier calcul de style d'un élément fraîchement inséré.
            const msg = dark ? "vn-c5-sombre" : "vn-c5-clair";
            await page.evaluate(
                ({ isDark, m }) => {
                    // Purge d'abord : `clearAll()` pose `--removing`, ce qui libère aussitôt
                    // le budget `maxVisible` — il se compte sur
                    // `.gl-toast:not(.gl-toast--removing)` (notifications.ts:399-402). Sans
                    // elle, des toasts de boot encore à l'écran peuvent faire METTRE EN FILE
                    // celui qu'on veut mesurer, qui ne s'afficherait jamais.
                    window.GeoLeaf.Notifications.clearAll();
                    document.body.classList.toggle("gl-theme-dark", isDark);
                    // Émis dans la MÊME tâche que la bascule : rien ne peut s'intercaler
                    // entre la classe et la création du toast qui la mesure.
                    window.GeoLeaf.notify(m, "info");
                },
                { isDark: dark, m: msg }
            );
            const toast = page.locator(VISIBLE).filter({ hasText: msg }).first();
            await expect(toast).toBeVisible({ timeout: 5000 });
            const bg = await toast.evaluate((el) => getComputedStyle(el).backgroundColor);
            await page.evaluate(() => window.GeoLeaf.Notifications.clearAll());
            return bg;
        };

        const light = await bgFor(false);
        const dark = await bgFor(true);

        expect(light, "fond de toast transparent en thème clair").not.toBe("rgba(0, 0, 0, 0)");
        expect(dark, "fond de toast transparent en thème sombre").not.toBe("rgba(0, 0, 0, 0)");
        expect(dark, "le fond ne change pas avec le thème (gris fixe ?)").not.toBe(light);
    });

    // ── D.3 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve S8 : une rafale au-delà du budget affichait PLUS de toasts que
    // `maxVisible` — 4 mesurés pour un budget de 2. L'invariant testé ici est le budget
    // lui-même, au défaut du profil (`DEFAULT_MAX_VISIBLE = 3`, constants.ts:30) : une rafale
    // de 8 erreurs ne doit jamais laisser plus de 3 toasts NON sortants à l'écran.
    // Le budget est lu depuis la page, pas écrit en dur ici : un test qui recopie la constante
    // qu'il vérifie ne vérifie que lui-même.
    test("D.3 — une rafale d'erreurs ne dépasse jamais maxVisible", async ({ page }) => {
        const status = await page.evaluate(() => window.GeoLeaf.Notifications.getStatus());

        // ⚠️ `maxVisible` NE SUFFIT PAS comme garde, et B-56 l'a prouvé par l'échec : il vaut
        // `DEFAULT_MAX_VISIBLE` (3) dès l'évaluation du module (notifications.ts:68), donc
        // AUSSI sur un renderer jamais monté. Le seul champ qui distingue un renderer vivant
        // d'un renderer inerte est `initialized` (= `!!this.container`). Sans lui, la rafale
        // ci-dessous partait au repli console et le test rendait `shown = 0` sans rien pouvoir
        // dire de la raison — c'est exactement ce qui a fait passer un défaut de séquence de
        // boot pour un mystère du renderer.
        expect(status.initialized, "renderer de toasts NON monté (#gl-notifications absent)").toBe(
            true
        );
        const budget = status.maxVisible;
        expect(budget, "maxVisible illisible depuis la façade").toBeGreaterThan(0);

        await page.evaluate(() => {
            for (let i = 0; i < 8; i++) window.GeoLeaf.notify(`vn-d3-${i}`, "error");
        });

        // Le pic se mesure après stabilisation des animations d'entrée : compter trop tôt
        // laisserait passer un dépassement transitoire, qui est exactement le défaut d'origine.
        await page.waitForTimeout(1200);
        const shown = await page.locator(VISIBLE).count();

        expect(shown, `${shown} toasts affichés pour un budget de ${budget}`).toBeLessThanOrEqual(
            budget
        );
        expect(shown, "la rafale n'a rien affiché du tout").toBeGreaterThan(0);
    });

    // ── D.4 🔴 ────────────────────────────────────────────────────────────────────────
    // Contre-épreuve B.19/B.27 : après un `destroy()` (hôte SPA qui démonte puis remonte la
    // carte), les notifications étaient PERDUES — pas seulement non affichées : le repli
    // console ne se déclenchait pas non plus, donc le message disparaissait EN SILENCE.
    // C'est ce silence que le correctif visait, et c'est lui que ce test garde.
    //
    // ⚠️ Le passage navigateur du R.7b a mesuré la frontière exacte du correctif, et elle
    // n'est pas là où la table la plaçait. Deux cas, deux comportements :
    //   · un toast a été émis AVANT le cycle → le conteneur survit → le toast se réaffiche ;
    //   · aucun toast avant le cycle (cas SPA pur : monter, démonter, remonter) → le conteneur
    //     n'est pas recréé, `notify()` rend `undefined` et le message part au repli console.
    // ⚠️ Corrigé le 28/07/2026 (B-56) : ces lignes disaient que le conteneur est créé
    // « PARESSEUSEMENT au premier `notify()` ». C'est FAUX, et cette prémisse a masqué le
    // mécanisme de D.3 pendant tout le diagnostic. L'unique créateur de `#gl-notifications`
    // est `capabilities/toast-renderer/lifecycle.ts` (`init()`), appelé une seule fois par le
    // registry ; `destroy()` le retire et rien ne le remonte ensuite.
    // Ce test asserte donc le contrat réellement tenu — **rien n'est perdu** — et le test
    // `D.4b` ci-dessous porte l'observable plus fort que la table demandait, resté ouvert.
    test("D.4 — une notification émise après destroy → recreate n'est jamais perdue", async ({
        page,
    }) => {
        // Attendre la carte CHARGÉE, pas seulement stylée : détruire trop tôt mesurerait une
        // course d'initialisation, pas le scénario SPA que D.4 décrit.
        await waitMapLoaded(page);
        const console_ = captureConsole(page);

        const state = await page.evaluate(() => {
            const api = window.GeoLeaf.Core.getMap();
            const native = api.getNativeMap();
            const c = native.getCenter();
            return {
                id: window.GeoLeaf.Core.listMaps()[0],
                center: [c.lng, c.lat],
                zoom: native.getZoom(),
            };
        });

        await page.evaluate((id) => window.GeoLeaf.Core.destroy(id), state.id);
        const recreated = await page.evaluate(
            (s) => !!window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
            state
        );
        expect(recreated, "la carte n'a pas pu être recréée").toBe(true);
        await bootMap(page);

        const MSG = "vn-d4-apres-recreate";
        await page.evaluate((m) => window.GeoLeaf.notify(m, "success"), MSG);

        // Le message doit atterrir quelque part : à l'écran, OU dans la console. Les deux
        // voies muettes en même temps, c'est le défaut d'origine — un message avalé.
        await expect
            .poll(
                async () => {
                    const shown = await page.locator(VISIBLE).filter({ hasText: MSG }).count();
                    const logged = console_.all.some((l) => l.includes(MSG));
                    return shown > 0 || logged;
                },
                {
                    timeout: 10000,
                    message:
                        "message avalé : ni toast affiché, ni repli console (défaut B.19/B.27)",
                }
            )
            .toBe(true);

        // ⚠️ PAS d'assertion « 0 erreur console pendant le cycle » ici, et c'est délibéré.
        // Mesuré au R.7b : sur une carte STABILISÉE le cycle est propre (0 erreur, sonde
        // dédiée), mais si un travail asynchrone est encore EN VOL au moment du `destroy()`,
        // il retombe sur un adaptateur disparu et journalise — `[Labels] Error preparing
        // labels` (`_ensureZoomListener` → `off()`) ou `[GeoJSON] MapLibre adapter not
        // available` (chargement de couche en cours), selon ce qui traînait. Cette propreté-là
        // est le scénario **D.5** (asymétries de teardown), pas D.4 ; l'asserter ici rendrait
        // D.4 intermittent pour une raison étrangère à ce qu'il prouve — et une suite qui
        // clignote est exactement ce qui l'a fait suspendre le 20/07.
        expect(console_.errors.filter((e) => e.includes(MSG))).toEqual([]);
    });

    // ── D.4b 🔴 — OUVERT, mesuré le 24/07 au R.7b ────────────────────────────────────
    // L'observable que la table demande vraiment : « Le toast s'affiche ; rien n'est perdu ».
    // La seconde moitié est tenue (test D.4 ci-dessus) ; la PREMIÈRE ne l'est pas dans le cas
    // SPA pur. Mesure : page fraîche → `destroy()` → `Core.init()` → `notify()` rend
    // `undefined`, `#gl-notifications` reste absent, aucun toast — seul le repli console
    // parle. Le conteneur n'est créé qu'au premier `notify()`, et `destroy()` désarme cette
    // création paresseuse sans la réarmer : même famille que les 4 asymétries de teardown de
    // B.27 (scénario D.5), sur un chemin qu'elles n'avaient pas couvert.
    // `fixme` et non `skip` : ce test décrit un défaut CONNU et OUVERT. Le retirer le jour où
    // le renderer se réarmera est le critère de complétude du correctif.
    test.fixme(
        "D.4b — le toast se réaffiche après un cycle destroy → recreate à froid",
        async ({ page }) => {
            const state = await page.evaluate(() => {
                const native = window.GeoLeaf.Core.getMap().getNativeMap();
                const c = native.getCenter();
                return {
                    id: window.GeoLeaf.Core.listMaps()[0],
                    center: [c.lng, c.lat],
                    zoom: native.getZoom(),
                };
            });

            // Aucun `notify()` avant le cycle : c'est la condition qui distingue les deux cas.
            await page.evaluate((id) => window.GeoLeaf.Core.destroy(id), state.id);
            await page.evaluate(
                (s) => window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
                state
            );
            await bootMap(page);

            await page.evaluate(() => window.GeoLeaf.notify("vn-d4b-a-froid", "success"));

            const toast = page.locator(VISIBLE).filter({ hasText: "vn-d4b-a-froid" });
            await expect(
                toast,
                "le renderer de toasts ne se réarme pas après destroy()"
            ).toBeVisible({
                timeout: 10000,
            });
        }
    );
});
