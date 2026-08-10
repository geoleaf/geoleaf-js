---
title: "GeoLeaf — Utilisation via CDN et NPM"
---

# GeoLeaf — Utilisation via CDN et NPM

**Version produit** : GeoLeaf Platform V3
**S'applique à :** `@geoleaf/core` v3.x
**Dernière mise à jour** : mars 2026

> Convention de versioning : **Platform V3** est le label produit ; le SemVer technique des packages/releases est en **3.0.x**. Voir [VERSIONING_POLICY.md](VERSIONING_POLICY.md).

---

Ce document décrit les méthodes recommandées pour charger GeoLeaf dans une application web :

- via **CDN UNPKG** ;
- via **CDN jsDelivr** ;
- via **NPM / ESM** dans un bundler moderne ;
- via un **bundle ESM local** (`dist/geoleaf.esm.js`) ;
- avec un **exemple HTML complet** ;
- avec des **avertissements API** autour de `GeoLeaf.Core.init(...)`.

> **Note v2.0.0 :** GeoLeaf distribue exclusivement en **ESM**. Il n'y a plus de bundle UMD (`geoleaf.min.js`). Utiliser `<script type="module">` ou un bundler moderne (Vite, Webpack, Rollup).

> **Note** : les URLs CDN ci-dessous supposent que le package `@geoleaf/core` est publié sur NPM.

> **Peer dependency** : `maplibre-gl ^6.0.0` doit être chargé séparément — il n'est **pas** inclus dans le bundle GeoLeaf.

> 🛑 **Les trois recettes ci-dessous ne chargeaient que la FEUILLE DE STYLE de MapLibre, jamais son JavaScript** — mesuré le 08/08/2026, défaut antérieur à la montée en v6 et sans rapport avec elle. `new maplibregl.Map()` levait donc sur un global absent : aucune des trois ne pouvait fonctionner. Elles portent désormais le shim qui manquait. C'est la même classe que le défaut consigné en 6.7b, où les deux README chargeaient MapLibre sous une forme qui ne publiait pas le global.

> ⚠️ **MapLibre est ESM-only depuis sa v6** et n'expose plus de global : les deux lignes de shim sont ce qui repose `globalThis.maplibregl`, que GeoLeaf lit. Ce shim est **en ligne**, donc il exige `'unsafe-inline'` (ou un nonce/hash) dans `script-src` — en production, préférer l'auto-hébergement décrit dans [`GETTING_STARTED.md`](GETTING_STARTED.md), dont le shim est un fichier.

> **Périmètre licence** : le package `@geoleaf/core` est sous licence MIT. Les plugins sont distribués séparément — voir §10 (tous les plugins sont MIT sur npmjs).

---

## 1. Utilisation via UNPKG (CDN)

```html
<!-- MapLibre GL JS (peer dependency — doit être chargé avant GeoLeaf) -->
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf styles -->
<link rel="stylesheet" href="https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css" />

<!-- GeoLeaf ESM (via script type="module") -->
<script type="module">
    import { Core } from "https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 2. Utilisation via jsDelivr (CDN)

```html
<!-- MapLibre GL JS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf styles -->
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>

<!-- GeoLeaf ESM -->
<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 3. Utilisation locale du bundle ESM (dist/)

```html
<!-- MapLibre GL JS (auto-hébergé ici — le shim est un fichier, pas un bloc en ligne) -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- GeoLeaf styles locaux -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />

<!-- GeoLeaf ESM local -->
<script type="module">
    import { Core } from "/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 4. Import NPM / ESM dans un bundler moderne

```bash
npm install @geoleaf/core maplibre-gl
```

```typescript
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";

Core.init({
    mapId: "geoleaf-map",
    center: [-32.95, -60.65], // [lat, lng] — GeoLeaf ; MapLibre attend [lng, lat], la conversion est interne
    zoom: 12,
    theme: "light",
});
```

---

## 5. Exemple HTML complet

```html
<!DOCTYPE html>
<html lang="fr">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Exemple GeoLeaf — CDN ESM</title>

        <!-- MapLibre GL JS (peer dependency) — feuille de style ET moteur -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css"
        />
        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>

        <!-- GeoLeaf styles -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
        />

        <style>
            html,
            body {
                margin: 0;
                padding: 0;
                height: 100%;
            }
            #geoleaf-map {
                width: 100vw;
                height: 100vh;
            }
        </style>
    </head>
    <body>
        <div id="geoleaf-map"></div>

        <script type="module">
            import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";

            document.addEventListener("DOMContentLoaded", () => {
                Core.init({
                    mapId: "geoleaf-map",
                    center: [-32.95, -60.65], // [lat, lng] — GeoLeaf ; MapLibre attend [lng, lat], la conversion est interne
                    zoom: 12,
                    theme: "light",
                });
            });
        </script>
    </body>
</html>
```

---

## 6. API `GeoLeaf.Core.init(...)`

```typescript
interface GeoLeafCoreInitOptions {
    mapId: string;
    center: [number, number]; // [lat, lng] — convention GeoLeaf
    zoom: number;
    theme?: string;
    basemapId?: string;
    configUrl?: string;
    onReady?: (ctx: GeoLeafCoreContext) => void;
    onError?: (error: unknown) => void;
}

interface GeoLeafCoreContext {
    map: maplibregl.Map;
    baselayers?: unknown;
    ui?: unknown;
    config?: unknown;
}
```

> **Note :** Le type `map` dans le contexte est `maplibregl.Map`.
> ⚠️ `center` suit la convention **GeoLeaf** — `[lat, lng]`. Ce sont les `coordinates` d'une
> feature GeoJSON qui sont en `[lng, lat]` ; la conversion est faite par l'adaptateur.

---

## 7. Artefacts dist/

Forme du répertoire `dist/` après build :

```
dist/
 ├─ geoleaf.esm.js          ← Bundle ESM principal (CDN, bundlers)
 ├─ geoleaf-main.min.css    ← Styles minifiés (kernel + toutes les capacités in-core)
 ├─ chunks/                 ← Chunks du code splitting — REQUIS, voir ci-dessous
 ├─ sw-core.js              ← Service Worker — copié TEL QUEL, jamais bundlé
 ├─ geojson-worker.js       ← Web Worker GeoJSON — copié tel quel lui aussi
 ├─ esm/                    ← ESM granulaire, un module par source
 │   └─ bundle-esm-entry.js ← entrée à exports nommés (résolue par exports["."])
 └─ types/                  ← déclarations TypeScript
```

> ⚠️ **`sw-core.js` et `geojson-worker.js` manquaient à cet arbre jusqu'au 08/08/2026.** Ce sont
> des **workers** : ils ne sont pas bundlés mais copiés tels quels, et chargés par une URL au
> runtime, jamais par un `import`. Aucune des deux erreurs qu'ils causent en leur absence ne
> ressemble à « un fichier manque » — le hors-ligne cesse simplement de fonctionner.

> ⚠️ **`dist/chunks/` fait partie du livrable — l'auto-héberger sans lui donne une application morte.** `geoleaf.esm.js` **importe** ces chunks : les copier est obligatoire, pas optionnel. Leurs noms portent un hachage de contenu et changent à chaque build, donc ils ne se listent jamais à la main — on copie le répertoire.
>
> 🛑 Ce paragraphe a affirmé l'inverse jusqu'au 07/08/2026 : « il n'y a plus de `dist/chunks/` de modules lazy », en renvoyant à un `src/lazy/` qui n'existe pas. L'arbre ci-dessus omettait le répertoire, et qui suivait cette page pour auto-héberger obtenait une application qui ne bootait pas.

Deux familles de chunks y cohabitent, et la distinction compte pour qui optimise son chargement :

- **Ceux que l'entrée importe statiquement** — chargés à chaque boot. Ce sont eux, et eux seuls, que `build-deploy.cjs` déclare en `<link rel="modulepreload">` dans la page déployée.
- **Ceux qu'un `import()` va chercher** — l'`offline-engine`, le générateur de QR code. Les précharger irait chercher d'avance ce que leur `import()` existe pour différer.

Pour embarquer moins, composer son entrée à partir des sous-chemins `exports` (voir `COOKBOOK.md`, _Recipe 8_) — le reste est **tree-shaké**. Les décomptes ne sont pas écrits ici : `npm run size` les mesure.

### 7.1 — Le `dist/` du PAQUET et celui de l'APPLICATION sont deux arbres différents

L'arbre ci-dessus est celui du **paquet npm** (`packages/core/dist/`), le seul qui concerne
l'auto-hébergement décrit sur cette page. L'application déployable (`npm run build:deploy:all`)
en produit un **autre**, et confondre les deux est un piège :

|                                                                | `packages/core/dist/` (paquet) | `deploy/<variante>/dist/` (application)                   |
| -------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `esm/`, `types/`                                               | ✅                             | ❌ **absents** — l'app n'est pas consommée par un bundler |
| Bundles de plugins `geoleaf-*.plugin.js`                       | ❌                             | ✅ un par plugin embarqué dans la variante                |
| Chunks paresseux de plugin (`terra-draw`, `jspdf`, `gtfs-rt`…) | ❌                             | ✅                                                        |
| Variantes pré-compressées `.br` / `.gz`                        | ❌                             | ✅ **servies en priorité** par le serveur                 |

⚠️ **Les pré-compressés ne sont pas décoratifs.** Un serveur configuré en `gzip_static`/
`brotli_static` sert le `.gz` ou le `.br` **et ignore le `.js`**. Modifier un fichier déployé sans
régénérer son compressé rend donc l'ancien contenu, silencieusement — c'est exactement ce qui a
fait diagnostiquer le mauvais coupable pendant une panne entière (**B-168**) : toutes les
vérifications lisaient le `.js` pendant que le serveur servait le `.gz`.

⚠️ **Le serveur doit connaître le type MIME de `.mjs`** (`types { text/javascript mjs; }` en
nginx). MapLibre 6 est ESM-only et son shim de global est un `.mjs` : servi en
`application/octet-stream`, le navigateur **refuse de l'exécuter** et rien ne boote.

---

## 8. Avertissements API

- Charger **MapLibre GL JS avant GeoLeaf** (peer dependency).
- Utiliser **`<script type="module">`** — pas de script classique sans `type="module"`.
- Ne pas mélanger ESM CDN et bundle local.
- **Coordonnées :** `Core.init({ center })` attend **`[lat, lng]`**. Les `coordinates` GeoJSON restent `[lng, lat]`.
- Versionner explicitement les URLs CDN (ex : `@3.0.0`, pas `@latest`).
- Prévoir un fallback local en production.

---

## 9. Check-list intégration

- [ ] MapLibre GL JS CSS chargé
- [ ] MapLibre GL JS JS chargé (peer dependency)
- [ ] GeoLeaf CSS chargé
- [ ] GeoLeaf ESM importé (`type="module"`)
- [ ] `window.GeoLeaf` défini
- [ ] `Core.init()` disponible
- [ ] Carte visible dans le DOM (hauteur CSS définie)
- [ ] `center` au format `[lat, lng]` (les `coordinates` GeoJSON, elles, sont `[lng, lat]`)
- [ ] URLs CDN versionnées explicitement

---

## 10. Extensions optionnelles

- **`@geoleaf-plugins/offline-ui`** — UI de sélection hors-ligne. **MIT**, publié sur **npmjs.org**. _(Le moteur hors-ligne lui-même — IndexedDB, cache, sync — est intégré au core depuis la v3, sous le gate `modules.offline`.)_
- **`@geoleaf-plugins/editor`** — Édition géométrique et capture de POI. Licence **MIT**, publié sur npmjs.org.

Pour plus d'informations : [geoleaf.dev](https://geoleaf.dev).
