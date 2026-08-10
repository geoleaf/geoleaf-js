---
title: "GeoLeaf.LayerManager — Documentation du module"
---

# GeoLeaf.LayerManager — Documentation du module

**Version** : 3.0.0
**Fichier source (monorepo)** : `packages/core/src/modules/built-in/layer-manager/layer-manager-api.ts`
**Facade publique** : `packages/core/src/modules/geoleaf.layer-manager.ts`
**Dernière mise à jour** : mars 2026

---

## Rôle fonctionnel

Le module **GeoLeaf.LayerManager** fournit un **contrôle UI MapLibre GL JS interactif** affiché dans un coin de la carte.
Il permet d'afficher et de gérer des sections configurables : fonds de carte (basemaps), couches GeoJSON, thèmes, cache offline, etc.

**Ce module est distinct de `GeoLeaf.Legend`** (voir section « Distinction » en bas de page).

---

## Architecture modulaire

```
packages/core/src/modules/geoleaf.layer-manager.ts  (facade publique)
        │
        └─→ layer-manager/layer-manager-api.ts       (logique principale)
                │
                ├─→ layer-manager/control.ts          (contrôle MapLibre GL JS)
                ├─→ layer-manager/renderer.ts         (rendu des sections/items)
                ├─→ layer-manager/basemap-selector.ts (sélection fonds de carte)
                ├─→ layer-manager/theme-selector.ts   (sélection thèmes)
                ├─→ layer-manager/layer-manager-helpers.ts (utilitaires)
                └─→ layer-manager/shared.ts           (état partagé)
```

---

## API publique

### `GeoLeaf.LayerManager.init(options?)`

Initialise le gestionnaire de couches et l'ajoute à la carte.

**Paramètres** :

- `options` (Object, optionnel) :
    - `map` : Instance MapLibre Map (si absent, tentative via `GeoLeaf.Core.getMap()`)
    - `position` : `"bottomright"` (défaut), `"bottomleft"`, `"topleft"`, `"topright"`
    - `title` : Titre du panneau (défaut : `"Gestionnaire de layers"`)
    - `collapsible` : `true` (défaut)
    - `collapsed` : `false` (défaut)
    - `sections` : Array de sections initiales

**Retourne** : `IControl | null`

```javascript
// Initialisation depuis config (recommandé)
GeoLeaf.LayerManager.init();

// Avec options personnalisées
GeoLeaf.LayerManager.init({
    position: "bottomleft",
    collapsible: true,
    collapsed: false,
    title: "Couches",
});
```

> La configuration est aussi lue depuis `layerManagerConfig` dans `geoleaf.config.json` :
>
> ```json
> {
>     "layerManagerConfig": {
>         "position": "bottomright",
>         "collapsible": true,
>         "collapsed": false
>     }
> }
> ```

---

### `GeoLeaf.LayerManager.refresh(immediate?)`

Rafraîchit l'affichage du gestionnaire.
Utile après un changement de thème ou de visibilité de couches.

**Paramètres** :

- `immediate` (boolean, optionnel) : `false` (défaut, debouncé) ou `true` (immédiat)

```javascript
// Rafraîchissement debouncé (groupé par défaut)
GeoLeaf.LayerManager.refresh();

// Rafraîchissement immédiat
GeoLeaf.LayerManager.refresh(true);
```

---

## Résumé de l'API

| Méthode               | Rôle                                |
| --------------------- | ----------------------------------- |
| `init(options?)`      | Initialise le contrôle sur la carte |
| `refresh(immediate?)` | Rafraîchit l'affichage du panneau   |

---

## Configuration via profil JSON

Le gestionnaire lit sa configuration depuis `geoleaf.config.json` au démarrage :

```json
{
    "layerManagerConfig": {
        "position": "bottomright",
        "title": "Couches",
        "collapsible": true,
        "collapsed": false,
        "sections": [
            { "id": "basemap", "label": "Fonds de carte", "collapsedByDefault": false },
            { "id": "geojson", "label": "Couches vectorielles", "collapsedByDefault": true },
            { "id": "cache", "label": "Cache offline", "collapsedByDefault": true }
        ]
    }
}
```

---

## CSS — classes BEM

```css
.gl-layer-manager                      /* Conteneur principal */
.gl-layer-manager__wrapper             /* Wrapper interne */
.gl-layer-manager__header              /* En-tête (titre + toggle) */
.gl-layer-manager__title               /* Titre du panneau */
.gl-layer-manager__toggle              /* Bouton collapse/expand */
.gl-layer-manager__body                /* Corps du panneau */
.gl-layer-manager__section             /* Section individuelle */
.gl-layer-manager__section-title       /* Titre de section */
.gl-layer-manager__section--collapsed  /* Section repliée */
.gl-layer-manager__item                /* Item dans une section */
.gl-layer-manager--collapsed           /* Panneau replié */
```

---

## Distinction Legend vs LayerManager

GeoLeaf expose **deux modules distincts** dans ce domaine :

| Aspect         | `GeoLeaf.Legend`                                           | `GeoLeaf.LayerManager`                                                  |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Facade**     | `packages/core/src/modules/geoleaf.legend.ts`              | `packages/core/src/modules/geoleaf.layer-manager.ts`                    |
| **Source**     | `src/capabilities/legend/legend-api.ts`                    | `src/modules/built-in/layer-manager/layer-manager-api.ts`               |
| **Rôle**       | Légende cartographique automatique (générée depuis styles) | Gestionnaire de couches UI (panneau interactif MapLibre GL JS IControl) |
| **Gestion**    | Couches GeoJSON et leur rendu légendaire                   | Sections configurables (basemaps, couches, thèmes)                      |
| **Chargement** | Automatique depuis styles des couches                      | Manuel via sections JSON (profil)                                       |
| **Alias ?**    | Non — module indépendant                                   | Non — module indépendant                                                |

Ces deux modules sont **indépendants et non aliasés**.

---

## Modules liés

- **[GeoLeaf.Core](../core/GeoLeaf_core_README.md)** : Fournit l'instance de carte
- **[GeoLeaf.Legend](../legend/GeoLeaf_Legend_README.md)** : Légende cartographique automatique
- **[GeoLeaf.Baselayers](../baselayers/GeoLeaf_Baselayers_README.md)** : Fonds de carte
