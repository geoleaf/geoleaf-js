# @geoleaf/core

**S'applique à :** `@geoleaf/core` v3.x · **Licence :** MIT · **Vérifié le :** 31/07/2026

Bibliothèque TypeScript de cartographie interactive construite sur **MapLibre GL JS**.
Entièrement configurable par des profils JSON — couches GeoJSON, styles, thèmes, taxonomie —
sans développement spécifique côté applicatif.

[![npm version](https://img.shields.io/npm/v/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![npm downloads](https://img.shields.io/npm/dm/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org/)

> **Ce fichier est une VITRINE, pas une référence.** Il donne l'installation, un exemple
> minimal et les points d'entrée. Tout le reste vit dans [`docs/`](docs/), qui part dans le
> même paquet npm — et un fait n'y est écrit qu'à un seul endroit.
>
> Ce n'est pas une préférence de style : ce README a porté pendant quatre mois une copie
> divergente de `docs/` (en-tête « Platform V2 » sur un paquet en 3.0.0, badges npm visant un
> paquet `geoleaf` qui n'est pas le nom publié, `GeoLeaf.POI.add()` copiable-collable sur une
> API dissoute, CDN épinglé `@2.0.0`, `node ≥18` pour un moteur qui en exige 22). Aucun de ces
> défauts n'était visible : les gates documentaires s'arrêtaient à `docs/`. Elles couvrent ce
> fichier depuis le 31/07/2026.

---

## Installation

```bash
npm install @geoleaf/core maplibre-gl
```

`maplibre-gl` est une **peerDependency** (`^6.0.0`) : le moteur reste externe au bundle, et
c'est **vous** qui le fournissez. **ESM uniquement** de part et d'autre — ni UMD ni CommonJS,
pour GeoLeaf comme pour MapLibre depuis sa v6. Cible de compilation : **ES2022**.

> ℹ️ **Ne pas confondre avec l'application livrée du dépôt** (`deploy/`), qui n'a aucune
> dépendance à installer : elle **auto-héberge** MapLibre dans `vendor/maplibre-gl/`, copié
> depuis `node_modules` au build et pré-caché par son service worker. Ce paquet-ci est la
> bibliothèque : il ne choisit pas la version du moteur, il la déclare.

**Le paquet déclare `engines.node`**, comme tous les paquets publiables du dépôt, depuis le
10/08/2026 — `npm install` avertit donc sur une version de Node trop ancienne, et échoue sous
`engine-strict`. Le range exact se lit dans le manifeste plutôt que d'être recopié ici :
`npm view @geoleaf/core engines` pour le paquet publié, `node -p "require('@geoleaf/core/package.json').engines.node"`
pour celui que vous avez installé.

⚠️ **Cette ligne a dit l'inverse jusqu'au 10/08/2026** — « le paquet ne déclare aucun `engines`,
et aucun des 15 paquets publiés ne le fait » — et **ses trois assertions étaient fausses le jour
où elle a cessé de l'être** : le dépôt compte 14 paquets publiables et non 15, « publiés » ne
valait que pour une minorité d'entre eux, et `engines` a été posé sur les 14 (B-98, soldée).
Le compte se dérive : `node -e "console.log(require('./scripts/lib/packages.cjs').publishable().length)"`.

```javascript
import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";

// `center` est [lat, lng] — les `coordinates` d'une feature GeoJSON restent [lng, lat]
Core.init({
    map: { target: "map", center: [46.5, 2.5], zoom: 6 },
});
```

⚠️ **La CSS s'importe par le sous-chemin déclaré `@geoleaf/core/style.css`.** Un
`@geoleaf/core/dist/…` lève `ERR_PACKAGE_PATH_NOT_EXPORTED` — la carte `exports` n'ouvre pas
`dist/`. Les URLs servies, elles, visent des fichiers et non des sous-chemins de paquet.

**Dans le navigateur — auto-hébergé** (ce que fait l'application livrée) :

GeoLeaf lit le moteur sur `globalThis.maplibregl`, que la v6 ne publie plus. Deux lignes le
reposent, dans un fichier placé à côté des modules copiés :

```javascript
// vendor/maplibre-gl/global.mjs
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

```html
<!-- MapLibre GL JS — ESM depuis la v6 ; le shim republie le global -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- GeoLeaf — ESM -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />
<script type="module" src="/dist/geoleaf.esm.js"></script>
```

Copier **les quatre fichiers** de `node_modules/maplibre-gl/dist/` — `maplibre-gl.mjs`,
`maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css` — dans un répertoire
**plat** : les trois modules se référencent entre eux par chemin relatif. Et vérifier que le
serveur connaît le type MIME de `.mjs`, faute de quoi le navigateur refuse le module.

> 🛑 **Ce bloc a dit l'exact inverse jusqu'à MapLibre 6, et les deux énoncés étaient justes à
> leur date.** En v5, le paquet déclarait `main: dist/maplibre-gl.js` sans `module` ni
> `exports` : le charger en `type="module"` ne publiait pas le global, défaut mesuré ici même
> le 08/08/2026. La v6 est ESM-only et ne publie plus aucun bundle classique — la forme sans
> `type="module"` rend maintenant un 404.

Détail du mode CDN, et pourquoi `dist/chunks/` doit être copié :
[`docs/usage-cdn.md`](docs/usage-cdn.md).

---

## Ce que le paquet expose

Les exports nommés de l'entrée ESM :

`Core` · `GeoLeafAPI` · `UI` · `LayerManager` · `Baselayers` · `Helpers` · `Validators` ·
`Events` · `Log` · `Errors` · `CONSTANTS` · `Utils` · `Config` · `applyCssText` · `Legend` ·
`Permalink` · `Share` · `Notifications` · `PWA`, plus les sous-modules API (`APIController`,
`PluginRegistry`, `CapabilityRegistry`, `BootInfo`, `showBootInfo`…).

⚠️ **`POI`, `Filters`, `Route` et `Table` ne sont plus exportés** — respectivement dissous au
S9, retiré au S4.5, et sortis en plugins. Un POI est aujourd'hui une feature d'une couche
GeoJSON ordinaire, lue et écrite par `GeoLeaf.Layers.*`.

**La liste ne se recopie pas, elle se dérive** — `npm run gen:api-surface` produit le manifeste
de surface, et une gate de fraîcheur le compare au code à chaque `ci:local`. Les signatures
complètes sont sur [geoleaf.dev/docs/api/](https://www.geoleaf.dev/docs/api/) (TypeDoc,
régénérable en local par `npm run docs:api`).

Le paquet déclare aussi des sous-chemins publics — `./kernel`, `./globals`, `./helpers`,
`./boot`, `./facades/*`, `./capabilities/*`, `./contracts/*`, `./presets/*`. Ils résolvent tous
(gate `check:subpath-resolve`), et sont documentés dans
[`docs/ARCHITECTURE_GUIDE.md`](docs/ARCHITECTURE_GUIDE.md).

---

## Documentation

**Index complet : [`docs/INDEX_CORE.md`](docs/INDEX_CORE.md)** — tout le dossier `docs/` est
public et distribué avec le paquet.

| Pour…                                 | Lire                                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| démarrer en 5 minutes                 | [GETTING_STARTED.md](docs/GETTING_STARTED.md)                   |
| un tutoriel pas à pas                 | [QUICKSTART_TUTORIAL.md](docs/QUICKSTART_TUTORIAL.md)           |
| l'usage complet                       | [USER_GUIDE.md](docs/USER_GUIDE.md)                             |
| configurer un profil                  | [PROFILES_GUIDE.md](docs/PROFILES_GUIDE.md)                     |
| la référence des fichiers JSON        | [CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md)           |
| l'API                                 | [API_REFERENCE.md](docs/API_REFERENCE.md)                       |
| les événements                        | [EVENTS_API.md](docs/EVENTS_API.md)                             |
| l'architecture et la séquence de boot | [ARCHITECTURE_GUIDE.md](docs/ARCHITECTURE_GUIDE.md)             |
| écrire un plugin                      | [PLUGIN_DEVELOPMENT_GUIDE.md](docs/PLUGIN_DEVELOPMENT_GUIDE.md) |
| des recettes                          | [COOKBOOK.md](docs/COOKBOOK.md) · [FAQ.md](docs/FAQ.md)         |
| la sécurité                           | [SECURITY.md](docs/SECURITY.md)                                 |
| l'accessibilité                       | [ACCESSIBILITY.md](docs/ACCESSIBILITY.md)                       |
| l'historique des versions             | [CHANGELOG.md](docs/CHANGELOG.md)                               |
| la politique de versionnage           | [VERSIONING_POLICY.md](docs/VERSIONING_POLICY.md)               |

---

## Plugins

Le core est autonome et tree-shakeable : il n'importe **jamais** un plugin (frontière gardée
par `verify-core-standalone.cjs`). Les plugins `@geoleaf-plugins/*` sont tous MIT, chacun avec
son propre versionnage et sa propre documentation.

La liste et les versions courantes s'impriment — `npm run versions:check` — et ne sont pas
recopiées ici : c'est exactement le genre de table qui diverge sans qu'on le voie. ⚠️ **Cette
section a annoncé « 13 plugins publiés sur npm » : les deux moitiés étaient fausses**, le compte
comme le verbe. `versions:check` mesure **le dépôt** ; `npm view <paquet> version` mesure **le
registre**, et leur écart n'est pas nul.

Écrire le sien : [PLUGIN_DEVELOPMENT_GUIDE.md](docs/PLUGIN_DEVELOPMENT_GUIDE.md).

---

## Licence

**MIT**, sans exception — pour le core comme pour chacun des plugins. Texte complet dans
[`LICENSE`](LICENSE) ; attributions tierces (dont MapLibre GL JS, BSD-3-Clause) dans
[`docs/NOTICE.md`](docs/NOTICE.md).

Usage commercial, modification et redistribution autorisés, à charge de conserver la notice de
licence et de documenter les changements.

---

## Support

- **Documentation** — [`docs/`](docs/) et [geoleaf.dev](https://geoleaf.dev)
- **Issues** — [GitHub](https://github.com/geoleaf/geoleaf-js/issues)
- **Contribuer** — [CONTRIBUTING.md](docs/CONTRIBUTING.md)

© 2026 Mattieu Pottier
