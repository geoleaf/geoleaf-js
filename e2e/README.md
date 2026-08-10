# Tests E2E Playwright — variantes de déploiement

Un seul projet Playwright (`chromium`). Chaque spec vise **une variante de déploiement**,
désignée par son nom logique — jamais par un port. ⚠️ **Ni le nombre de tests ni le nombre de
fichiers ne sont recopiés ici** : les deux divergent à chaque commit. `npx playwright test --list`
les rend, et `ls e2e/*.spec.js | wc -l` compte les fichiers.

> 🛑 Cette ligne a annoncé « **41 fichiers de specs** » jusqu'au 08/08/2026, dans la phrase même
> qui refusait de recopier le décompte des tests — mesure du jour : **42**. Le 41 avait été posé le
> 05/08, et `31-offline-second-load.spec.js` est arrivé le 07/08. Deux jours ont suffi.

| Variante   | Contenu                                         | Servie depuis            | Specs                                                                   |
| ---------- | ----------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `core`     | core seul                                       | `deploy/deploy-core`     | ~20 fichiers (01, 04, 06, 11→16, 19, `cfg-*`…)                          |
| `full`     | offline-ui + cog + **editor** (édition unifiée) | `deploy/deploy-full`     | `02-storage`, `03-storage-poi`, `09-editor`, `17-cog`, `29`, `30`, `31` |
| `coverage` | copie **instrumentée** de core (istanbul)       | `deploy/deploy-coverage` | `07-boot-sequence`, `20-geocoding`, `21-table`, `22`                    |

> ⚠️ **Il y avait une QUATRIÈME variante, `addpoi`, retirée au Sprint 5 (05/08/2026)** avec le
> plugin du même nom, fusionné dans `editor`. La note qui vivait ici — « `addpoi` et `full` sont
> exclusives, c'est pourquoi ARCHI S8 a consolidé à 3 variantes et non 2 » — décrivait une
> exclusivité qui **n'existe plus** : il n'y a qu'un plugin d'édition, donc plus rien à exclure.
> Les specs qui visaient `addpoi` sont sur `full`, la seule variante portant à la fois l'édition
> et le hors-ligne.
> `coverage` est un **axe** distinct, pas une variante de plugins.

## Les deux cibles — `E2E_TARGET`

Les URLs ne sont plus écrites dans les specs : elles sont résolues par
[`helpers/base-url.js`](helpers/base-url.js), qui expose `baseURL('core' | 'full' | 'coverage')` — et qui **jette** sur toute autre valeur.

| Cible                | URLs                                                | Serveurs                                        | Usage                       |
| -------------------- | --------------------------------------------------- | ----------------------------------------------- | --------------------------- |
| `ports` **(défaut)** | `http://localhost:8766 / 8768 / 8769`               | **Démarrés par Playwright** (bloc `webServer`)  | CI, et run de **référence** |
| `nginx`              | `https://demo[.full\|.coverage].geoleaf.local.test` | **Aucun** — le nginx de dev sert déjà `deploy/` | Boucle de développement     |

```bash
npm run test:e2e                                   # cible ports (référence)
E2E_TARGET=nginx npx playwright test               # cible nginx — AUCUN serveur lancé
E2E_TARGET=nginx npx playwright test e2e/19-permalink.spec.js
```

Sous `E2E_TARGET=nginx`, le bloc `webServer` de `playwright.config.js` vaut `[]` : c'est ce qui
rend la suite exécutable là où démarrer un serveur est interdit. Un `E2E_TARGET` inconnu
**jette** au chargement de la config — un repli silencieux sur `ports` redémarrerait les quatre
serveurs, c'est-à-dire exactement ce que la cible existe pour éviter.

⚠️ **Les deux cibles ne sont pas isomorphes.** Sous nginx : pas de `Access-Control-Allow-Origin: *`
(le `--cors` de `http-server`), `X-Frame-Options: DENY` et `Content-Security-Policy:
frame-ancestors 'self'` ajoutés, `Cache-Control: no-store`, HTTP/2, origine HTTPS. Un test qui
assertionne sur les en-têtes, le framing ou le temps peut légitimement diverger.
**Un rouge vu seulement sous nginx est une piste, pas un verdict** — le re-jouer sur `ports`
avant de conclure. `ports` est la cible contre laquelle les assertions ont été écrites.

## Prérequis — les TROIS commandes vont ensemble, et la première n'est pas optionnelle

```bash
npx turbo run build && npm run build:deploy:all && node scripts/build-deploy-coverage.cjs
```

🛑 **Ce bloc a omis `turbo run build` jusqu'au 08/08/2026, et l'omission ne se voit pas : elle sort
en code 0.** `build-deploy.cjs` **assemble** depuis les `dist/` existants et n'en rebâtit qu'une
partie — après une modification de source, l'enchaîner seul produit un déployé **périmé**, et tout
E2E lancé ensuite éprouve l'ancien bundle **en se croyant vert**. Mesuré, et ça a coûté un cycle de
vérification entier (**B-105**). C'est le protocole en trois temps de `CLAUDE.md` §Points
d'attention ; `scripts/ci-local.cjs` l'applique déjà dans ses étapes E2E.

⚠️ `build:deploy` **vide `deploy/`** et ne reconstruit **pas** `deploy-coverage`. L'oublier fait
échouer au démarrage les 4 specs de la cible `coverage`. Sous la cible `nginx`, un dossier absent
rend un **503 qui nomme la commande à lancer** (`docker/nginx.dev.conf`, location `@missing`).

Après un rebuild, la cible nginx est servie immédiatement (le conteneur monte `./deploy` en
lecture seule) ; seul l'ajout ou le renommage d'un **vhost** demande `npm run demo:up`.

## Débogage

```bash
npx playwright test e2e/01-core-only.spec.js       # un seul fichier
npx playwright test --headed                        # navigateur visible
npx playwright test --debug                         # Playwright Inspector
npx playwright show-report                          # rapport HTML du dernier run
```

## Pannes courantes

| Symptôme                                     | Cause probable                                | Solution                                                                     |
| -------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:876X`                | Cible `ports`, serveur non démarré            | `npm run test:e2e` les démarre ; vérifier que `deploy/` est bâti             |
| **503** « deploy/deploy-… absent »           | Cible `nginx`, variante non bâtie             | La réponse **nomme** la commande exacte à lancer                             |
| **404 Traefik** (`text/plain`, 19 o.)        | vhost non routé (labels du conteneur périmés) | `npm run demo:up`                                                            |
| `E2E_TARGET="…" is not a known target`       | Faute de frappe sur la variable               | `ports` ou `nginx` — le garde est volontaire                                 |
| Tests WebGL en échec                         | Pas de GPU (CI, WSL)                          | `helpers/launch-options.js` force SwiftShader ; `E2E_HW_GL=1` pour l'inverse |
| `[SWRegister] Registration failed … 'scope'` | `serviceWorkers: 'block'`                     | **Artefact de test**, pas une régression                                     |

## Voir aussi

- [`helpers/README.md`](helpers/README.md) — axe, launch-options, perf-gate, web-vitals, base-url
- `_docs_projet/travail/rapports/rapport_table-verification-navigateur.md` — les 46 scénarios que
  la suite unitaire ne peut pas décider.
  ⚠️ **Cité, pas lié, et le motif tient à ce fichier-ci.** Ce rapport est interne : il ne part pas
  dans le dépôt public, alors que ce README, lui, y part. Un lien markdown résoudrait donc ici et
  mourrait là-bas — et **aucune gate de ce dépôt ne peut le voir**, puisque la cible existe tant
  qu'on mesure depuis l'atelier. Mesuré le 10/08/2026 sur le clone public : c'était le seul lien
  de cette classe, et il y sortait `check-dead-links` en rouge. Ne pas le re-lier.
