// @ts-check
// E2E Playwright — deploy variants (e2e/)

import { defineConfig, devices } from "@playwright/test";
import { launchOptions } from "./e2e/helpers/launch-options.js";
import { baseURL, isNginxTarget, hostResolverArgs } from "./e2e/helpers/base-url.js";

export default defineConfig({
    // Deploy variants only (e2e/)
    testDir: ".",
    testMatch: ["e2e/**/*.spec.js"],
    // Never scan Claude Code worktree copies (.claude/worktrees/*) — they carry
    // their own node_modules and duplicate every spec, which crashes the loader
    // ("Requiring @playwright/test second time").
    testIgnore: ["**/.claude/**"],

    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    // T6.2 — chemins EXPLICITES. Deux défauts, tous deux fermés ici :
    //   1. `playwright.coverage.config.js` déclarait le MÊME `outputFolder` que ce
    //      fichier : lancer la variante coverage après la suite complète écrasait
    //      silencieusement son rapport. Cette config a été SUPPRIMÉE au même commit
    //      (son `testMatch` était un sous-ensemble strict de celui-ci, et le spec 07 pose
    //      lui-même son `baseURL`) — la collision se résout par soustraction.
    //   2. aucun `outputDir` n'était déclaré, donc les résultats tombaient dans le
    //      `test-results/` par défaut de Playwright — homonyme du FICHIER
    //      `test-results.json` du reporter Vitest (ci.yml:112, lu par
    //      check-test-failures.cjs:20), qui n'a rien à voir et ne bouge pas.
    //
    // ⚠️ `outputDir` et `outputFolder` doivent rester FRÈRES, jamais imbriqués :
    // le reporter HTML vide son dossier avant génération et Playwright refuse la
    // configuration si l'un contient l'autre.
    outputDir: "artifacts/playwright/results",
    reporter: [
        // ⚠️ `open: 'never'` — le défaut `'on-failure'` DÉMARRE un serveur HTTP pour servir
        // le rapport, ce que CLAUDE.md interdit en session. Risque préexistant, fermé ici.
        ["html", { outputFolder: "artifacts/playwright/report", open: "never" }],
        ["list"],
    ],
    timeout: 60 * 1000,

    use: {
        // Default baseURL: deploy-core (port 8766, or its nginx vhost under E2E_TARGET=nginx)
        baseURL: baseURL("core"),
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        // ⚠️ 30 s, et NON 10 s — porté le 01/08/2026. Le run CI 30703087739 a produit
        // 5 `locator.click: Timeout 10000ms` (4 comptés en échec, 1 en flaky car repassé au
        // retry) qu'aucun run local n'a jamais vus. `retries: 2` étant actif en CI, chacun des
        // 4 a échoué TROIS fois : ce ne sont pas des flakes. Leur call log est explicite, et il
        // dit l'inverse de ce qu'on croit en le lisant vite :
        //
        //     - element is visible, enabled and stable      ← la stabilité PASSE
        //     - scrolling into view if needed / done scrolling
        //     - performing click action                     ← ÇA BLOQUE ICI
        //
        // Ce n'est donc ni un élément instable, ni un recouvrement : c'est la DISPATCH de
        // l'événement dont le renderer ne renvoie pas l'ack, parce que son thread principal
        // est occupé. Le budget d'action mesure une latence d'ack, pas une durée d'animation.
        //
        // Mesure de la même action (`.gl-emprise-ok`) en dégradant ce poste vers le runner :
        //
        //     24 cœurs, bridage CPU ×8   → 1 887 ms
        //      2 cœurs, sans bridage     → 4 641 ms
        //      2 cœurs + bridage ×4      → 8 093 ms   ← 81 % du budget, sur une machine
        //                                               MOINS dégradée que le runner
        //
        // ⚠️ Le facteur qui compte est le NOMBRE DE CŒURS, pas `setCPUThrottlingRate` :
        // celui-ci ne bride que le thread JS, alors que SwiftShader rastérise en parallèle.
        // Une repro par bridage seul reste optimiste — il faut `taskset -c 0,1`.
        // (`E2E_HW_GL` non défini ici ⇒ ce poste tourne DÉJÀ sous SwiftShader comme la CI ;
        // le GL n'est pas la variable, contrairement à la perf-baseline.)
        //
        // La valeur est alignée sur `navigationTimeout` : les deux attendent le même thread.
        actionTimeout: 30 * 1000,
        navigationTimeout: 30 * 1000,
        // Force software WebGL on GPU-less hosts (CI/WSL); opt out with E2E_HW_GL=1.
        // `hostResolverArgs` is empty on the default target — spreading it is a no-op there.
        launchOptions: {
            ...launchOptions,
            args: [...(launchOptions.args || []), ...hostResolverArgs],
        },
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            // 🛑 UN `testIgnore` DE PROJET ÉCRASE CELUI DU NIVEAU CONFIG — il ne s'y ajoute
            // PAS (`playwright/lib/common/index.js`, `takeFirst`). Le `**/.claude/**` de la
            // ligne 15 disparaît donc pour ce projet dès qu'on déclare la clé ici, et les
            // copies de worktree reviennent avec le crash de double chargement que le
            // commentaire ci-dessus décrit. Il est RECOPIÉ, ce n'est pas une redondance.
            testIgnore: ["**/.claude/**", "e2e/**/*.touch.spec.js"],
        },
        {
            // Deux défauts mobiles que la souris synthétique ne peut pas voir, par
            // construction et non par accident :
            //   · editor  — au 1er tap, Terra Draw pose une LineString [c, c] et RIEN
            //     d'autre. Sur desktop le survol déplace le 2e sommet et masque le défaut ;
            //     au doigt il n'y a pas de survol.
            //   · measure — `createDragTool` filtre sur `originalEvent.button !== 0`, qu'un
            //     TouchEvent ne peut pas satisfaire.
            //
            // ⚠️ Ce projet NE REJOUE PAS la suite au doigt : `testMatch` le borne aux seuls
            // specs écrits pour lui. Un `grep:` par tag aurait CHARGÉ les 40+ fichiers pour
            // n'en garder que deux.
            //
            // ⚠️ Les specs tactiles restent À PLAT dans `e2e/` — d'où le suffixe plutôt
            // qu'un sous-répertoire. `scripts/check-e2e-wait-signature.cjs` lit `e2e/` par
            // un `readdirSync` NON RÉCURSIF : un `e2e/touch/` échapperait à la gate EN
            // SILENCE.
            name: "chromium-touch",
            testMatch: ["e2e/**/*.touch.spec.js"],
            testIgnore: ["**/.claude/**"],
            use: {
                ...devices["Desktop Chrome"],
                // Le créneau des deux plugins est mobile, et 390×844 est la valeur déjà
                // retenue par `09-editor.spec.js`.
                viewport: { width: 390, height: 844 },
                hasTouch: true,
                // Sûr ici, et vérifié plutôt que supposé : `isMobile` fait prendre en compte
                // le `<meta name="viewport">`, que les deux variantes servies déclarent bien
                // en `width=device-width`. Sans ce meta, Chromium retomberait à 980 px CSS et
                // la mise en page mobile ne serait PAS exercée.
                isMobile: true,
                // ⚠️ NE PAS reprendre `devices["Pixel 7"]` en bloc : il emporte un
                // `deviceScaleFactor: 2.625` — qui triple la surface à rastériser sous le
                // SwiftShader logiciel des `launchOptions` — et un UA Android, or du code
                // produit branche déjà sur l'UA (cf. `23-pwa-install-banner.spec.js`).
                deviceScaleFactor: 1,
            },
        },
    ],

    // Auto-start servers, one per deploy variant under test (5.5 — 3, not 4):
    //   8766 deploy-core · 8768 deploy-full · 8769 deploy-coverage
    // 8769 is a distinct axis (instrumented copy of deploy-core, built by
    // build-deploy-coverage.cjs), not a plugin variant. 8767 was retired with deploy-storage.
    //
    // ⚠️ EMPTY UNDER E2E_TARGET=nginx, and that is the whole point of the target: the four
    // deploy folders are already served by the persistent dev nginx (docker-compose.dev.yml),
    // so the suite runs WITHOUT STARTING ANY SERVER. Do not "simplify" this ternary away —
    // it is the property that makes the suite runnable in a Claude Code session at all.
    webServer: isNginxTarget
        ? []
        : [
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-core -p 8766 -c0 --cors",
                  url: "http://localhost:8766",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
              // ARCHI S8 — 8767 (deploy-storage) is gone: storage now ships in BOTH gated variants,
              // so a storage-only deploy tested nothing the others did not. Its 2 specs moved to 8768.
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-full -p 8768 -c0 --cors",
                  url: "http://localhost:8768",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
              {
                  command:
                      "node node_modules/http-server/bin/http-server deploy/deploy-coverage -p 8769 -c0 --cors",
                  url: "http://localhost:8769",
                  reuseExistingServer: !process.env.CI,
                  timeout: 60 * 1000,
                  stdout: "pipe",
                  stderr: "pipe",
              },
          ],
});
