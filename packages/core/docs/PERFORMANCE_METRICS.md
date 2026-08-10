---
title: "Métriques de performance runtime (GeoLeaf)"
---

# Métriques de performance runtime (GeoLeaf)

Ce document décrit les **métriques custom** exposées par GeoLeaf après le chargement de la carte.

## Métriques collectées

| Métrique           | Description                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `timeToMapReadyMs` | Temps entre le chargement de la page (navigation start) et l’événement **map ready** (première couche affichée), en ms. |
| `timeToAppReadyMs` | Temps entre le chargement de la page et l’événement **app ready** (application interactive), en ms.                     |
| `startupTotalMs`   | Durée de l’initialisation (mesure `geoleaf:startup-total` : de `initApp` start à ready), en ms.                         |
| `capturedAt`       | Date/heure de capture des métriques (ISO string).                                                                       |

Les métriques sont calculées une fois, au déclenchement de l’événement `geoleaf:app:ready`.

## Utilisation

### Récupérer les métriques après chargement

```js
// Après geoleaf:app:ready
const metrics = GeoLeaf.getPerformanceMetrics();
console.log(metrics.timeToMapReadyMs, metrics.startupTotalMs);
```

Équivalent : `GeoLeaf.getRuntimeMetrics()`.

### Callback au boot (recommandé en prod)

Pour envoyer les métriques à un backend ou à un outil d’analytics sans polluer la console :

```js
GeoLeaf.boot({
    onPerformanceMetrics: function (metrics) {
        // Envoi vers votre analytics / beacon
        if (navigator.sendBeacon && metrics.timeToMapReadyMs != null) {
            navigator.sendBeacon("/api/perf", JSON.stringify(metrics));
        }
    },
});
```

### Affichage en console (développement)

Pour afficher les métriques dans la console à chaque chargement :

- **Option 1** : avant d’appeler `GeoLeaf.boot()`, définir  
  `GeoLeaf._debugPerf = true;`
- **Option 2** : en global, définir  
  `window.__GEOLEAF_PERF_DEBUG__ = true;`

Puis appeler `GeoLeaf.boot()` comme d’habitude. Au moment de `geoleaf:app:ready`, un message du type  
`[GeoLeaf Perf] map ready: 1234ms | app ready: 1250ms | startup: 1200.0ms`  
sera logué.

### Réinitialisation (tests / SPA)

Si vous rechargez la carte sans recharger la page :

```js
GeoLeaf.resetRuntimeMetrics();
```

Les prochains `getPerformanceMetrics()` ou `onPerformanceMetrics` recalculeront les métriques.

## Événements utilisés en interne

- `geoleaf:map:ready` : carte prête, première couche affichée.
- `geoleaf:app:ready` : application prête (détail avec `version`, `timestamp`).

Les marques Performance API utilisées sont : `geoleaf:initApp:start`, `geoleaf:initApp:ready`, et la mesure `geoleaf:startup-total`.

## Objectif de charge au boot

Le coût réel au boot est l'entrée `geoleaf.esm.js` **plus la clôture transitive de ses imports statiques** — les `import()` dynamiques en sont exclus. C'est cette clôture qui est mesurée et **gatée au build** par `npm run size` (`scripts/check-bundle-size.cjs`) : **alerte au-delà de 270 KB gzip**, **échec du build au-delà de 300 KB gzip**.

> **Il n'existe plus de bundle « Lite ».** Pour embarquer moins que la bibliothèque entière, composez votre propre entrée à partir des installers des capacités dont vous avez besoin : le reste est alors **tree-shaké** — absent, et non différé. Recette : `COOKBOOK.md`, _Recipe 8_ ; exemple gaté par `npm run size:example` : `examples/minimal/entry.ts` (9 capacités sur 18).

### Mesures de référence (perf-baseline.json)

Mesures enregistrées avant refactoring R4, à titre de baseline :

| Artefact                                 | Taille brute | Taille gzip   | Note                                                     |
| ---------------------------------------- | ------------ | ------------- | -------------------------------------------------------- |
| ESM flat bundle (toutes chunks inlinées) | 580.67 KB    | **127.42 KB** | Référence pré-R4                                         |
| ESM main entry (split build)             | 5.81 KB      | 1.73 KB       | Point d'entrée seul — les chunks sont chargés séparément |
| CSS bundle                               | 151.88 KB    | 22.58 KB      | Styles UI complets                                       |

> **Temps d'init (pre-R4) :** médiane mesurée à **1 012,9 ms** — objectif post-R4 : &lt;600 ms (mesure post-R4 en attente).

### Vérification

- **Gate de charge au boot** : `npm run size` (à la racine du monorepo) mesure la clôture des imports statiques depuis l'entrée et échoue au-delà du budget. C'est le contrôle qui fait autorité.
- **Script benchmark** : `npm run benchmark` (à la racine du monorepo) affiche les tailles brutes et gzip des artefacts de `dist/`.
- **Visualizer Rollup** : après `npm run build` dans `packages/core`, ouvrir `packages/core/dist/stats.html` dans le navigateur pour voir la répartition des tailles (dont gzip) par module.

À faire régulièrement (avant release ou après gros changements) pour maintenir la cible.

## Web Vitals (LCP, INP, CLS)

Les métriques ci‑dessus sont **custom** (temps jusqu’à première couche et jusqu’à interactivité). Pour les **Web Vitals** (LCP, INP, CLS), vous pouvez intégrer la librairie [web-vitals](https://github.com/GoogleChrome/web-vitals) côté application et combiner son callback avec `onPerformanceMetrics` pour un envoi unique (custom + Web Vitals) vers votre analytics.
