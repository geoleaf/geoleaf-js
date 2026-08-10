---
title: "Architecture performance — GeoLeaf"
---

# Architecture performance — GeoLeaf

**Product Version** : GeoLeaf Platform V3

**S'applique à :** `@geoleaf/core` v3.x
**Dernière mise à jour** : mars 2026

---

Court document sur les choix techniques liés à la **performance** dans GeoLeaf (Worker GeoJSON, lazy loading, requestIdleCallback, rendu MapLibre GL JS, bonnes pratiques).

---

## 1. Worker GeoJSON

Le chargement des couches GeoJSON peut faire du **fetch + parse** dans un **Web Worker** pour ne pas bloquer le thread principal. Si le Worker est indisponible ou si les données viennent du cache, le parse peut s'effectuer sur le main thread (gros fichiers = risque de freeze).

- **Fichiers concernés** : `packages/core/src/kernel/geojson/` — `loader/`, `geojson-worker.ts`,
  `worker-manager.ts`.
- **Bonnes pratiques** : pour les très gros GeoJSON, privilégier la découpe en plusieurs couches, le lazy loading par vue, ou les vector tiles si le profil le permet.

---

## 2. Lazy loading (code splitting)

- ⚠️ **La machinerie `src/lazy/` a été SUPPRIMÉE (S5, BREAKING).** POI, Route, Themes, Table, Search n'existent plus (dissous/purgés) ; Legend, LayerManager, Labels sont **eager** (dans la clôture de boot). Les chunks `src/lazy/*` étaient des coquilles de ré-export sur du code déjà eager, que Rollup émettait **vides** — le boot déclenchait un `import()` d'un fichier vide à chaque page. Ce qui reste réellement lazy, ce sont les **`import()` dynamiques** ponctuels (ex. le moteur offline, chargé à la demande), pas un système de chunks secondaires.
- **Préchargement** : supprimé en S5. `_loadAllSecondaryModules()` chargeait ces mêmes chunks vides — le boot ne fait plus d'aller-retour réseau pour rien.
- **Lazy UI** : `lazyLoadImage` (IntersectionObserver), `lazyExecute` (report d'exécution via `requestIdleCallback` ou `setTimeout`) dans les helpers DOM.

---

## 3. requestIdleCallback

Utilisé pour **répartir le travail** et garder l'UI réactive :

- **GeoJSON** : après parse (Worker ou main), l'ajout des features à la couche MapLibre GL est fait par **chunks** (ex. 200 features par batch) via `requestIdleCallback` (fallback `setTimeout`) pour ne pas bloquer le main thread. Voir `geojson/loader/single-layer.ts` (`_addFeaturesChunked`).
- **Profil / couches** : planification de tâches lourdes (ex. chargement de couches) avec `requestIdleCallback` (timeout 3000 ms) ou `setTimeout` en fallback. Voir `geojson/loader/profile.ts`.
- **Helpers** : `lazyExecute(callback, timeout)` utilise `requestIdleCallback` si disponible.

---

## 4. Rendu MapLibre GL JS

GeoLeaf utilise **MapLibre GL JS ^6.0.0** comme moteur cartographique. Caractéristiques clés :

- **Rendu WebGL** : toutes les couches vectorielles et raster sont rendues sur le GPU via WebGL.
- **Style expression** : les filtres, couleurs et visibilité sont exprimés comme des expressions MapLibre GL Style Spec — évalués par le moteur de rendu, pas en JavaScript.
- **Source GeoJSON** : les données GeoJSON sont injectées via `map.getSource(id).setData(geojson)` pour les mises à jour incrémentales sans recréer la couche.
- **Clustering natif** : le clustering POI utilise le clustering intégré MapLibre GL (côté source, pas de recalcul JS).

---

## 5. Bonnes pratiques

| Sujet                    | Recommandation                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Taille GeoJSON**       | Éviter un seul fichier énorme ; découper en couches ou par zone/vue si possible. En cas de gros fichier, le Worker + chunked addData limitent le freeze.                                         |
| **Nombre de couches**    | Limiter le nombre de couches actives simultanées si les données sont lourdes ; utiliser la visibilité par thème et le lazy loading des couches.                                                  |
| **Charge au boot**       | Gatée par `npm run size` (clôture des imports statiques depuis l'entrée) ; inspecter la répartition avec `dist/stats.html`. Pour livrer moins : composer son entrée (`COOKBOOK.md`, _Recipe 8_). |
| **Métriques runtime**    | Utiliser `GeoLeaf.getPerformanceMetrics()` ou `GeoLeaf.boot({ onPerformanceMetrics })` pour suivre le temps jusqu'à première couche et interactivité.                                            |
| **Expressions de style** | Préférer les expressions MapLibre GL Style Spec aux fonctions JS pour le filtrage et le style (exécutées sur le thread de rendu).                                                                |
| **resize()**             | Appeler `map.resize()` après tout changement de dimensions du conteneur (fullscreen, panneau latéral). Utiliser `CONSTANTS.FULLSCREEN_TRANSITION_MS` comme délai.                                |

---

## 6. Budget bundle

La métrique qui compte au chargement est le **boot payload** : l'entrée `geoleaf.esm.js` **+ la clôture transitive des chunks qu'elle importe statiquement**. Depuis `kernel-exports`, l'entrée elle-même n'est qu'un **shim de ~0,5 KB gz** — la budgéter seule ne piège aucune régression (c'est la méprise « `src/lazy` réduit le boot », que ce projet a déjà payée). `check-bundle-size.cjs` mesure donc la clôture. Les `import()` **dynamiques** ne sont pas suivis (vrais lazy). MapLibre GL est une dépendance peer externe, hors bundle.

| Artefact                                 | Cible / statut                                         | Commande de vérification |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------ |
| **Boot payload** (entrée + chunks stat.) | alerte > 270 KB gz, **échec build > 300 KB** (~178 KB) | `npm run size`           |
| `geoleaf.esm.js` seul (gz)               | ~0,5 KB — shim, **informatif, PAS un budget**          | `npm run size`           |
| Sourcemaps (`.map`, publiées sur npm)    | soft > 900 KB gz (n'échoue jamais le build)            | `npm run size`           |

---

## Voir aussi

- `packages/core/docs/performance/CSS_ANIMATION_OPTIMIZATION.md` — optimisation des animations CSS
- `packages/core/docs/ARCHITECTURE_GUIDE.md` — architecture modulaire et séquence boot
- `packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md` — couches GeoJSON
- `packages/core/docs/PERFORMANCE_METRICS.md` — métriques runtime et budget de charge au boot
