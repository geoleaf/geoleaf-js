# E2E Helpers — GeoLeaf-JS

Utilitaires partagés pour les tests Playwright du monorepo GeoLeaf-JS.

---

## Fichiers disponibles

### `axe-config.js`

Configuration partagée de `@axe-core/playwright` pour les tests d'accessibilité RGAA/WCAG.

**Usage :**

```javascript
const { scanPage, scanComponent } = require("./helpers/axe-config");

// Scan WCAG 2.1 AA complet sur la page entière
const results = await scanPage(page);
expect(results.violations).toHaveLength(0);

// Scan ciblé sur un composant (modal, panel, toolbar...)
const results = await scanComponent(page, ".geoleaf-sidepanel");
expect(results.violations).toHaveLength(0);
```

**Fonctions exportées :**

| Fonction                        | Signature                              | Description                                                 |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `scanPage(page)`                | `(Page) → Promise<AxeResults>`         | Scan WCAG 2.1 AA complet — exclut les internals MapLibre GL |
| `scanComponent(page, selector)` | `(Page, string) → Promise<AxeResults>` | Scan ciblé sur un sélecteur CSS                             |

**Configuration appliquée :**

- Tags WCAG : `wcag2a`, `wcag2aa`
- Exclusions MapLibre (faux positifs par design) : `.maplibregl-canvas`, `.maplibregl-canvas-container`
- Règles désactivées globalement : `svg-img-alt` (sprites SVG MapLibre sans alternative textuelle, attendu)

**Exemple complet (extrait de `05-accessibility.spec.js`) :**

```javascript
const { scanPage } = require("./helpers/axe-config");

test("Map controls are accessible", async ({ page }) => {
    await page.goto("http://localhost:8766");
    await page.waitForSelector(".maplibregl-map");
    const results = await scanPage(page);
    expect(results.violations).toHaveLength(0);
});
```

### `base-url.js`

Résout **quelle URL sert quelle variante de déploiement**. Les specs nomment la variante
(`baseURL('core' | 'full' | 'coverage')`), jamais un port.

```js
const { baseURL } = require("./helpers/base-url.js");
test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });
```

Deux cibles, choisies par `E2E_TARGET` :

| Cible                | URLs                          | Serveurs                                        |
| -------------------- | ----------------------------- | ----------------------------------------------- |
| `ports` **(défaut)** | `localhost:8766/8768/8769`    | démarrés par le bloc `webServer` de la config   |
| `nginx`              | vhosts `*.geoleaf.local.test` | **aucun** — le nginx de dev sert déjà `deploy/` |

**Pourquoi ce fichier existe** : les 40 URLs littérales des specs épinglaient la suite aux
http-servers que Playwright démarre. Démarrer un serveur étant interdit en session Claude Code,
la suite ne pouvait être lancée que par Mattieu — et elle est restée rouge quatre jours faute de
regard. Le blocage tenait aux **URLs**, pas à l'infrastructure.

Le helper exporte aussi `isNginxTarget` (qui vide le bloc `webServer`) et `hostResolverArgs`
(un `--host-resolver-rules` qui évite d'avoir à éditer le fichier hosts Windows pour
`demo.coverage.`). Un `E2E_TARGET` inconnu **jette** : un repli silencieux sur `ports`
redémarrerait les quatre serveurs.

⚠️ Les deux cibles ne sont pas isomorphes (CORS, `X-Frame-Options`, CSP, HTTP/2, HTTPS) :
un rouge vu seulement sous nginx se re-joue sur `ports` avant d'être qualifié.

### `launch-options.js`

`launchOptions` Playwright partagés pour forcer le **rendu WebGL logiciel** (SwiftShader) sur les hôtes **sans GPU** (CI `ubuntu-latest`, WSL). MapLibre GL a besoin d'un contexte WebGL ; headless Chrome ≥137 verrouille le fallback logiciel derrière un flag, donc sans lui `getNativeMap()` reste `null` et les helpers `waitForMap` timeout.

Injecté **globalement** via `use.launchOptions` dans `playwright.config.js` → couvre toutes les specs map-natives (05 groupes 1-4, 06, 07, 08, 09, 10).

**Convention `E2E_HW_GL` :**

| Valeur                 | Effet                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| _(non défini, défaut)_ | Flags logiciels appliqués (CI/WSL obtiennent un contexte). La spec 06 **n'écrit pas** `perf-baseline.json`. |
| `E2E_HW_GL=1`          | GL **matériel** réel (machine à GPU). La spec 06 réécrit `perf-baseline.json` avec des chiffres réels.      |

> ⚠️ Ne jamais committer un `perf-baseline.json` généré sous rendu logiciel (valeurs faussées). La garde d'écriture de la spec 06 le prévient mécaniquement par défaut.

**Exports :**

| Symbole            | Type                  | Description                                                                 |
| ------------------ | --------------------- | --------------------------------------------------------------------------- |
| `launchOptions`    | `{ args?: string[] }` | À étaler dans un bloc `use` Playwright. Vide si `E2E_HW_GL=1`.              |
| `useHardwareGl`    | `boolean`             | `true` si `E2E_HW_GL=1` — sert aussi de garde d'écriture du perf-baseline.  |
| `SOFTWARE_GL_ARGS` | `string[]`            | Les 4 flags Chromium (swiftshader / angle / unsafe / ignore-gpu-blocklist). |

### Recapture de la perf-baseline (`E2E_HW_GL=1`)

`perf-baseline.json` (racine du repo) est le **contrat de performance runtime** : temps d'init, rendu GeoJSON, FPS au zoom et empreinte mémoire (heap). La spec `06-performance-baseline.spec.js` le réécrit — mais **uniquement sous GL matériel** (`E2E_HW_GL=1`). Sous rendu logiciel les chiffres sont faussés, donc la garde d'écriture les ignore (`perf-baseline.json` reste inchangé).

**Quand recapturer :**

- après un refacto perf-sensible du cœur (séquence de boot, adaptateur MapLibre, rendu GeoJSON) ;
- en préparation d'une release ;
- après une montée de version MapLibre GL JS ou du SDK navigateur ;
- quand `runtime._status` est repassé à `pending_measurement`.

**Prérequis :** une machine à **GPU réel** (ni la CI, ni WSL sans passthrough) + les variantes deploy buildées — les 3 webServers Playwright (8766 / 8768 / 8769) doivent pouvoir démarrer :

```bash
npm run build:deploy:all && npm run build:deploy-coverage
```

> Sans `build:deploy-coverage`, le port 8769 (`deploy-coverage`) manque et tout le run timeout à 60 s.
> Depuis Windows (repo monté via WSL), exécuter sous Node 22 : `wsl.exe -- bash -lc 'cd <repo> && …'`.
> `wsl.exe` sans `-d` entre dans la distro par défaut, et dans CELLE du chemin courant quand
> il est en `\\wsl.localhost\…` — même convention que le trampoline de `.husky/pre-commit`,
> qui accepte `GEOLEAF_WSL_DISTRO` pour qui a plusieurs distros.

**Capturer :**

```bash
E2E_HW_GL=1 npx playwright test e2e/06-performance-baseline.spec.js
```

La spec lit le baseline existant, met à jour `runtime.{initTime,geojsonRender,fps,memory,webVitals}` et réécrit le fichier. ⚠️ **`runtime.memory` est depuis le 10/08 un ENREGISTREMENT, pas un contrat** — aucune garde ne le lit, il documente l'environnement d'une capture ; sa forme a changé (`heapDelta10k_mb` + `_instrument`), et le `after10kFeatures_mb` encore commité décrit l'instrument retiré jusqu'à la prochaine capture. Les autres sections (`bundle`, `_notes`, `version`, snapshots historiques `*_pre_r4`) sont **préservées** : finaliser à la main après coup — `runtime._status` → `captured`, puis `capturedAt`, `environment` (hôte GPU) et bump de `version`.

**Valider :** lire les logs `[perf] …` du run (init, FPS plain/clustered, mémoire), puis vérifier le diff — `git diff perf-baseline.json` ne doit toucher que `runtime` + métadonnées, **jamais** `bundle` (gardé séparément par `scripts/benchmark.cjs`).

> ⚠️ **Ne jamais committer** un baseline généré sous rendu logiciel. La garde d'écriture le bloque par défaut ; vérifier malgré tout que les valeurs FPS diffèrent d'un run soft-GL (où elles seraient nulles ou aberrantes).

### `perf-gate.js` — gate de régression runtime

Compagnon de `perf-baseline.json` : définit de combien une capture e2e live peut s'écarter du baseline commité avant que le run n'échoue. Le gate est **bimodal**, piloté par le flag `useHardwareGl` existant :

| Mode                              | Flag          | Écriture baseline | Gate    |
| --------------------------------- | ------------- | ----------------- | ------- |
| **Capture** (recâlage volontaire) | `E2E_HW_GL=1` | OUI               | **OFF** |
| **Vérification** (défaut WSL/CI)  | _(absent)_    | NON               | **ON**  |

**Que gate-t-on ?** Seules les métriques **GL-indépendantes** échouent le run :

| Métrique        | Gate                                                         | Pourquoi                                                                                      |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `geojsonRender` | **dur** — plafond `max(commité.max × 3, 5 ms)`               | timing JS `addSource`/`addLayer`, indépendant du GPU                                          |
| `memory` (heap) | **dur** — bande absolue `0,5 → 3 Mo` sur le **delta retenu** | heap JS, indépendant du GPU — mais **pas sous n'importe quel instrument**                     |
| `initTime`      | souple — plafond absolu `< 10 s`                             | réseau-inclus sur http-server local (spread 1,6–3,3 s), trop bruité                           |
| `fps`           | **AUCUN** — informatif, comme les Web Vitals                 | non-représentatifs sous GL logiciel, et **bruités bien au-delà du seuil qu'on leur opposait** |
| clustering      | **dur** — ≥ 1 cluster, et compression `> 1` à n ≥ 1000       | oracle déterministe, indépendant du GL                                                        |
| fuite mémoire   | ⚠️ **AUCUN en pratique** — vert par construction             | 6.2.6 lit `performance.memory`, **figée** : `growthRate = 0` toujours. Smoke, pas garde       |

> Garde anti-faux-échec : si `runtime._status !== "captured"` (baseline fraîche/vide), le gate est **skippé** (informatif), jamais en échec. ⚠️ **Il ne couvre plus la ligne `memory`** : sa bande est absolue et ne lit aucun baseline, précisément pour que l'instrument neuf ne soit pas jugé contre un contrat capturé avec l'ancien.

> 🛑 **La ligne `memory` a dit « plafond `commité × 1,5` » jusqu'au 10/08/2026, et elle gardait le VIDE.** La grandeur tranchée était `performance.memory.usedJSHeapSize`, que Chrome quantifie **et fige pour la durée de la page** hors `--enable-precise-memory-info` : mesuré à **0,00 Mo de delta** aux cinq instants d'une page et aux doses **0, 10 000 et 30 000** features, sur 10 pages fraîches. Le test assérait donc le heap **ambiant**, dont la dispersion (24,8 → 45,2 Mo, ×1,8) débordait le ×1,5 toléré — un rouge par construction, sans régression produit. **Ce qui gate désormais** : le **delta retenu** lu par CDP `Runtime.getHeapUsage` après `HeapProfiler.collectGarbage` ×2 **des deux côtés** (sans le GC, le delta brut mesuré est **négatif**), sur un ajout par **`adapter.addGeoJSONLayer`** — l'API GeoLeaf — et non plus par `map.addSource` natif. Bande mesurée **1,51–1,57 Mo** sur 8 relevés, témoin à 0,09–0,15 : d'où `floorMb: 0,5` (anti-creux — un delta nul **rougit**) et `ceilMb: 3` (dérive de dépendance, pas bruit). Table complète, mutations éprouvées et **angles morts** (heap du worker, fuites, empreinte de boot) : à l'assertion, dans `06-performance-baseline.spec.js`.
>
> ⚠️ **Ne pas « réparer » un rouge en élargissant la bande, ni en recapturant le baseline** : le seul geste légitime est de **re-mesurer** — `E2E_TARGET=nginx PROBE_MODE=bande node scripts/probe-heap-metrics.mjs` — et de bouger un seuil **avec la table qui le justifie, à côté**. `heapDeltaBandMb()` jette si on l'appelle pour une autre dose que 10 000 features.

> 🛑 **La ligne `fps` a dit « directionnel — `clustered ≥ plain − 5 fps` » jusqu'au 10/08/2026, et elle ENSEIGNAIT une prémisse fausse** : que le rapport des deux termes serait représentatif là où leurs valeurs absolues ne le sont pas. Mesuré sur 5 runs (même code, même déployé, cible nginx, dont 3 machine au repos) — l'étendue de la marge `clustered − (plain − 5)` va de **31 à 52 fps** selon le cas, pour un seuil de **5** ; à 5k et 10k `plain` vaut **1 fps** dans 5 runs sur 5, ce qui rendait l'assertion vraie sans rien prouver ; et les deux termes ne parcourent pas le même chemin de rendu (marqueurs **DOM** contre couches **GL**). Éprouvé : clustering **totalement coupé** → l'ancien invariant restait vert 3 fois sur 4 ; clustering **dissous** → 4 fois sur 4. Le motif complet, la table des mesures et les angles morts assumés vivent à l'assertion, dans `06-performance-baseline.spec.js`.
>
> ⚠️ **Ne pas le réintroduire en élargissant le slack** : l'élargir rend l'assertion creuse aux quatre cas au lieu de deux. Ce que ce test peut asserter sous GL logiciel, c'est que le clustering **prend effet** et **compresse** — pas ce qu'il coûte. Le coût ne se mesure que sur GL matériel (`npm run perf:capture`, `E2E_HW_GL=1`), contre un baseline capturé sur le même hôte.

**Lancer le gate (mode vérification)** — sous GL logiciel, ne réécrit pas le baseline :

```bash
npm run perf:gate
```

Prérequis identiques à la recapture (`build:deploy:all` + `build:deploy-coverage`, sinon timeout 8769).

**Activation CI (différée au dégel 2026-07-01).** La CI GitHub est gelée et aucun workflow n'existe encore. Quand elle rouvre, ajouter une étape qui exécute le gate en mode vérification, après le build des variantes deploy :

```yaml
# .github/workflows/<ci>.yml — étape à ajouter au dégel
- name: Runtime regression gate
  run: |
      npm run build:deploy:all && npm run build:deploy-coverage
      npm run perf:gate
```

Le gate s'exécute sous GL logiciel (runners sans GPU) et n'échoue que sur les métriques GL-indépendantes — les FPS y restent informatifs. Le baseline n'est jamais réécrit en CI (garde `E2E_HW_GL`).

### `web-vitals.js` — Web Vitals e2e

Mesure **LCP / INP / CLS** dans la spec 06 via la librairie [`web-vitals`](https://github.com/GoogleChrome/web-vitals) — une **devDependency injectée au runtime du test, jamais bundlée** dans le produit (preuve : `npm run size` reste à ~70 KB gz). Helper exposant deux fonctions :

| Fonction                | Rôle                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `injectWebVitals(page)` | À appeler **avant** `page.goto(...)`. Injecte lib + handlers en **une seule** `addInitScript`.        |
| `readWebVitals(page)`   | Lit `window.__webVitals` (`{ lcp, inp, cls }`) après interactions ; chaque métrique non vue = `null`. |

> ⚠️ **Piège d'injection.** Playwright évalue chaque `addInitScript` dans **son propre scope de fonction** : le `var webVitals` de l'IIFE **ne fuit donc pas** vers `window`. Le helper concatène lib + enregistrement des handlers dans **un seul** script pour que la closure d'enregistrement voie le binding `webVitals` en scope (pas de global).

**Posture — informational / non-gating** (comme les FPS, finding S2) : sous GPU virtualisé WSLg, les timings paint/interaction ne sont pas représentatifs. Le bloc 6.2.7 ne pose **aucun seuil dur** (assertion de sanité : les 3 clés existent) ; les valeurs sont écrites dans `runtime.webVitals` **uniquement en capture** (`E2E_HW_GL=1`). Un vrai contrat Web Vitals exigerait une capture Windows natif + écran réel. Hook RUM prod optionnel = Backlog B.3.

> **Budget sourcemaps (`npm run size`, hors e2e).** En parallèle, `scripts/check-bundle-size.cjs` suit désormais la taille des `.map` du core (entry + `dist/chunks/*.map`) — **warn soft uniquement** (publiées npm mais non chargées au boot), jamais de hard-fail. Détail dans l'en-tête du script.

### `touch.js` — gestes tactiles (14/08/2026)

Réservé au projet **`chromium-touch`** de `playwright.config.js` : le renderer n'accepte l'entrée
tactile qu'après le `Emulation.setTouchEmulationEnabled` que Playwright émet sous `hasTouch: true`.

| Fonction                                    | Rôle                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `touchDrag(page, from, to, {steps})`        | Presse, glisse en `steps` points (12 par défaut), relâche. Coordonnées en px CSS du viewport.       |
| `touchDragInspect(page, from, to, inspect)` | Idem, mais exécute `inspect()` **avant le relâchement** — pour ce qui n'existe qu'en cours de geste |

> 🛑 **Pourquoi CDP et pas `page.dispatchEvent` / `new TouchEvent()`.** Ces deux-là construisent
> l'événement _dans la page_ : `isTrusted: false`, et surtout le navigateur n'en dérive **aucun**
> `pointer*`. Un moteur de dessin qui n'écoute que les Pointer Events — Terra Draw, par exemple —
> ne les voit pas du tout : on testerait sa propre dispatch, pas l'interaction.
> `Input.dispatchTouchEvent` n'est pas un contournement, c'est **l'appel que Playwright fait
> lui-même** pour `touchscreen.tap()` ; un glissement, c'est le même appel avec des `touchMove` au
> milieu, donc l'entrée traverse le vrai pipeline (hit-testing, reconnaissance de geste, événements
> dérivés).

> ⚠️ **`page.touchscreen` n'a que `tap(x, y)`** — pas de drag, pas de swipe. C'est une limite de
> l'API, pas un oubli : son propre docblock renvoie à la dispatch manuelle pour les autres gestes.

Deux détails qui décident du résultat : le **même `id` de point** sur `touchStart` et tous les
`touchMove` (sinon Chromium y voit des pressions distinctes au lieu d'une source tactile), et un
`touchEnd` **sans aucun point** (le protocole l'exige). Un tick `requestAnimationFrame` sépare les
moves — MapLibre agrège l'entrée par frame, et empiler douze `send()` d'affilée charge un thread
principal qui est déjà le goulot de cette suite.

### Coût de rebuild au changement de fond (bloc 6.2.8, F-RENDER-1) — RETIRÉ

Bloc supprimé par **RM-P1b(c)** : le rebuild instrumenté qu'il mesurait n'existe plus. Le switch de fond passe désormais par `transformStyle` (MapLibre v5), qui préserve nativement les sources/couches GeoLeaf — plus de teardown `map.setStyle()`, plus de mesure `geoleaf:basemap-rebuild`. La décision GO/NO-GO F-RENDER-1 (gain perf marginal) est close ; le levier retenu est la **correction / anti-fuite**, pas la perf.

---

### `offline.js` · `idb.js` · `db-seed.js` — le harnais hors-ligne

Les trois primitives sans lesquelles **cinq des six critères de preuve** hors-ligne n'ont pas
d'instrument. Elles existent parce que les défauts hors-ligne ont tous survécu de la même
façon : un spec assertait qu'une chose s'était **produite** (un événement, un drapeau) et
jamais que les bons octets avaient **atterri**.

| Fichier      | Rôle                                                  | Ne fait délibérément PAS                                     |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| `offline.js` | couper le réseau, et **prouver** que rien n'est sorti | n'ouvre aucune base                                          |
| `idb.js`     | **lire** ce qui est stocké                            | **ne crée jamais** de store (aucune version passée à `open`) |
| `db-seed.js` | **créer** une base et la remplir                      | seul fichier autorisé à déclencher un `onupgradeneeded`      |

**Trois pièges mesurés, à connaître avant d'écrire un scénario :**

1. **Le trafic se lit sur le CONTEXTE, pas sur la page.** Un `fetch` émis par le Service
   Worker n'atteint jamais `page.on("request")`. Compter au niveau page rendrait « zéro
   requête » pendant que le SW parle au réseau.
2. **Une requête COUPÉE compte quand même.** Sous `setOffline`, une tentative sort en
   `requestfailed`. Ne compter que les succès noterait comme propre un chemin qui a bel et
   bien tendu la main vers le réseau.
3. **Sur une page de carte le réseau n'est JAMAIS durablement calme** — ~47 URLs au boot, puis
   les tuiles raster en continu. `assertZeroNetwork` **doit** être scopé par `allow`, et
   précédé de `settleNetwork`. Il n'y a **aucune** liste d'exclusion par défaut : elle
   excuserait en silence le trafic qu'un futur scénario doit précisément attraper.

**Semer AVANT `goto` de l'app**, toujours — sinon il n'y a pas de migration à observer :

```js
// ⚠️ `import ... with { type: "json" }` fait échouer la gate Lint (le parser ESLint
// configuré ici ne connaît pas les attributs d'import, même si Node 22 les accepte).
const dump = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("../fixtures/offline/db-v3-dump.json", import.meta.url)),
        "utf8"
    )
);
await wipeOnOrigin(page, baseURL("core"));
await seedLegacyDump(page, baseURL("core"), dump); // pose une v3 réelle, app non bootée
await page.goto(`${baseURL("core")}/`); // ← l'app démarre SUR cette base
```

> 🛑 **Le schéma vit dans la fixture, pas dans `db-seed.js`.** Un mirroir en code dérive en
> silence le jour où la production change — et le passage en v4 va justement réécrire ce schéma en
> v4. Ajouter la v4 = ajouter `db-v4-dump.json`, pas éditer le helper.

`e2e/fixtures/offline/db-v3-dump.json` porte le schéma v3 **et** de quoi éprouver chaque
critère : trois entrées à la **même milliseconde** dont l'ordre de relecture est inversé
(reproduction de la collision d'horodatage, vérifiée), une entrée `failed` invisible à l'index `pending`, deux
sauvegardes à clés **numériques** (bug 2), et la **même** image sous ses deux formes — un vrai
`Blob` et une chaîne `data:` (bug 3). Chaque enregistrement porte un `_comment` disant ce
qu'il sert à prouver ; le seeder les retire avant écriture.

---

## Ajouter un helper

Créer un nouveau fichier `helpers/{nom}.js` en **ESM**, avec `// @ts-check` en tête et un
`export { … }` **en fin de fichier** — c'est la forme des 10 helpers existants, sans exception.

> ⚠️ **Cette section affirmait le contraire jusqu'au 02/08/2026** (« exports CommonJS
> (`module.exports`) … Playwright s'exécute en contexte Node.js sans transformation ESM »).
> C'était faux, et vérifiable en une commande : `grep -L '^export ' e2e/helpers/*.js` ne rend
> rien. C'est exactement la classe de défaut que le compteur **C5** de la roadmap nomme —
> une prose démentie par le code, dans le document qui sert d'instruction. Corrigé en
> ajoutant `offline.js` et `idb.js`, c'est-à-dire en suivant l'instruction et en la voyant
> fausse.

**Deux contraintes que la gate fait respecter, à connaître avant d'écrire :**

- **`waitForFunction` prend TROIS arguments** — `(fn, arg, options)`. La forme à deux
  arguments `(fn, {timeout})` fait passer le timeout pour un argument de la fonction : il est
  **ignoré**, et l'attente retombe sur le timeout par défaut. `check-e2e-wait-signature.cjs`
  (E2E-WAIT-SIG) scanne `e2e/` **et** `e2e/helpers/`. Écrire `(fn, null, { timeout })`.
- **Les helpers ne portent pas d'assertion `expect`** sauf à être explicitement des
  assertions (`assertZeroNetwork`) : un helper qui assert en silence rend le rouge illisible
  depuis le spec qui l'appelle.

---

## Voir aussi

- [e2e/README.md](../README.md) — Vue d'ensemble des scénarios E2E
- [docs/guides/core/testing/TESTING_GUIDE.md](../../docs/guides/core/testing/TESTING_GUIDE.md) — Guide de test du projet
