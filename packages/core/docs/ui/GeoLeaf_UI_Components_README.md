---
title: "GeoLeaf UI Components — Documentation Détaillée"
---

# GeoLeaf UI Components — Documentation Détaillée

Product Version: GeoLeaf Platform V3

**Modules** : `GeoLeaf._UIComponents`, `GeoLeaf.UI.Notifications`, et composants UI

**Version** : 3.0.0

**Fichiers source (monorepo)** : `packages/core/src/modules/built-in/ui/`

**Dernière mise à jour** : mars 2026

---

## Vue d'ensemble

Le système de **composants UI** GeoLeaf fournit des **briques réutilisables** pour construire l'interface utilisateur de la cartographie. Ces composants standardisent :

- La création d'éléments DOM avec cleanup automatique
- Les patterns d'accordéons et panneaux
- Les notifications toast
- Les symboles de légende (cercles, lignes, polygones)
- Les contrôles MapLibre (échelle, coordonnées)
- La gestion d'événements et états UI

---

## Architecture des composants UI

```
built-in/ui/
├── ui-api.ts                        // Orchestrateur principal
├── theme.ts                         // Gestion thèmes (light/dark)
├── components.ts                    // Composants DOM réutilisables (accordéon…)
├── dom-utils.ts                     // resolveField, getActiveProfileConfig
├── event-delegation.ts              // Délégation d'événements
├── pill-search.ts                   // Champ de recherche « pill »
├── desktop/                         // Panneau desktop
│   ├── desktop-panel.ts
│   ├── desktop-panel-registry.ts
│   ├── desktop-panel-theme.ts
│   └── desktop-tabs-seam.ts
└── mobile/                          // Barre d'outils mobile
    ├── mobile-toolbar.ts
    ├── mobile-toolbar-pill.ts
    ├── mobile-toolbar-proximity.ts
    ├── mobile-toolbar-sheet.ts
    └── mobile-toolbar-state.ts
```

> **Sorti de `built-in/ui/` en v3.0.0.** Le panneau de filtres (`filter-panel*`,
> `filter-state-manager`) appartient à la capacité `filter` ; les notifications à
> `toast-renderer` ; les contrôles carte (plein écran, géolocalisation, thème, échelle,
> coordonnées) à leurs capacités respectives ; le rendu de fiche (`content-builder`) à
> `feature-info`. Ces modules ne vivent plus ici.

---

## Module 1 : `GeoLeaf._UIComponents` (composants réutilisables)

### Rôle

Fournit des **composants réutilisables** pour Legend et LayerManager : accordéons, symboles de légende, éléments de style.

### API Principale

#### `createAccordion(container, config)`

Crée un accordéon avec header cliquable et body collapsible.

**Paramètres** :

- `container` (HTMLElement) : Conteneur parent
- `config` (Object) :
    - `layerId` : ID de la couche
    - `label` : Titre de l'accordéon
    - `collapsed` : État initial (replié ou non)
    - `visible` : Couche visible (grise si false)
    - `onToggle` : Callback lors du toggle

**Retourne** : `{ accordionEl, headerEl, bodyEl, toggleEl }`

**Exemple** :

```javascript
const legendContainer = document.querySelector(".gl-legend__body");

const { accordionEl, bodyEl } = GeoLeaf._UIComponents.createAccordion(legendContainer, {
    layerId: "parcs",
    label: "Parcs et Jardins",
    collapsed: false,
    visible: true,
    onToggle: (layerId, isExpanded) => {
        console.log(`Accordion ${layerId} is now ${isExpanded ? "open" : "closed"}`);
    },
});

bodyEl.appendChild(document.createTextNode("Legend content"));
```

#### `renderCircleSymbol(container, config)`

Rend un symbole circulaire (pour POI/markers) avec icône SVG optionnelle.

**Paramètres** :

- `container` : Conteneur du symbole
- `config` :
    - `radius` : Rayon en pixels (défaut: 8)
    - `fillColor` : Couleur de remplissage
    - `color` : Couleur de bordure
    - `weight` : Épaisseur bordure
    - `fillOpacity` : Opacité
    - `icon` : ID d'icône SVG sprite (ex: `'#tree'`)
    - `iconColor` : Couleur de l'icône

**Exemple** :

```javascript
const symbolContainer = document.createElement("div");

// Simple circle
GeoLeaf._UIComponents.renderCircleSymbol(symbolContainer, {
    radius: 10,
    fillColor: "#228B22",
    color: "#006400",
    weight: 2,
    fillOpacity: 0.8,
});

// Circle with icon
GeoLeaf._UIComponents.renderCircleSymbol(symbolContainer, {
    radius: 12,
    fillColor: "#FF5733",
    icon: "#restaurant",
    iconColor: "#FFFFFF",
});
```

#### `renderLineSymbol(container, config)`

Rend un symbole de ligne (pour routes/LineString).

```javascript
GeoLeaf._UIComponents.renderLineSymbol(symbolContainer, {
    color: "#3388ff",
    weight: 3,
    opacity: 1,
    dashArray: "5, 10",
});
```

#### `renderPolygonSymbol(container, config)`

Rend un symbole de polygone (pour zones/Polygon).

```javascript
GeoLeaf._UIComponents.renderPolygonSymbol(symbolContainer, {
    fillColor: "#3388ff",
    fillOpacity: 0.4,
    color: "#0066cc",
    weight: 2,
});
```

#### `attachEventHandler(element, eventType, handler)`

Attache un event listener avec cleanup automatique.

```javascript
const cleanup = GeoLeaf._UIComponents.attachEventHandler(button, "click", () =>
    console.log("Clicked!")
);

// Later: remove the listener
cleanup();
```

---

## Module 2 : `GeoLeaf.UI.Notifications` (notifications.ts)

### Rôle

Système de **toast notifications** avec animations et auto-dismiss.

### API Principale

#### `init(config)`

Initialise le système de notifications.

**Config** :

- `container` : Sélecteur du conteneur (défaut: `'#gl-notifications'`)
- `maxVisible` : Nombre max de toasts visibles (défaut: 3)
- `durations` : Durées par type (ms)
- `position` : Position (`'bottom-center'`, `'top-right'`, etc.)
- `animations` : Activer animations (défaut: true)

```javascript
GeoLeaf.UI.Notifications.init({
    container: "#gl-notifications",
    maxVisible: 5,
    position: "top-right",
    durations: {
        success: 2000,
        error: 7000,
    },
});
```

#### `success(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.success("Données chargées avec succès !");
GeoLeaf.UI.Notifications.success("Sauvegarde réussie", 5000);
```

#### `error(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.error("Impossible de charger les données");
GeoLeaf.UI.Notifications.error("Erreur réseau", 10000);
```

#### `warning(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.warning("Connexion instable");
```

#### `info(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.info("Chargement en cours...");
```

#### `clear()`

```javascript
GeoLeaf.UI.Notifications.clear();
```

### Structure HTML générée

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center">
    <div class="gl-toast gl-toast--success" role="alert" aria-live="polite">
        <div class="gl-toast__icon">✓</div>
        <div class="gl-toast__content">
            <div class="gl-toast__message">Données chargées avec succès !</div>
        </div>
        <button class="gl-toast__close" aria-label="Fermer">×</button>
    </div>
</div>
```

---

## Module 3 : Contrôles MapLibre

### Rôle

Chaque contrôle carte est désormais une **capacité in-core**, activée par configuration et
installée par son propre `install.ts` (`capabilities/<id>/`). Le fichier agrégateur
`ui/controls.ts` n'existe plus.

### API via `GeoLeaf.UI`

```javascript
// Geolocation — implémentée par la capacité `geolocation`
GeoLeaf.UI.initGeolocationControl(map, {
    position: "topleft",
    enableHighAccuracy: true,
});

// Theme toggle — implémenté par la capacité `theme-toggle`
GeoLeaf.UI.initThemeToggleControl(map, { position: "topright" });
```

> **Retirés de `GeoLeaf.UI` en v3.0.0** _(breaking)_ : `initFullscreenControl()` (capacité
> `fullscreen`, activée par `modules.fullscreen`) et `initPoiAddControl()` (plugin
> `@geoleaf-plugins/editor`, piloté par `GeoLeaf.Editor`). Les contrôles d'échelle,
> coordonnées, branding et légende suivent le même modèle : configuration, pas appel.

### Configuration dans profile.json

```json
{
    "ui": {
        "controls": {
            "fullscreen": true,
            "geolocation": true,
            "themeToggle": true
        },
        "showCoordinates": true,
        "showScale": true,
        "scaleType": "numeric"
    }
}
```

---

## Module 4 : Système de filtrage (filter-panel/)

### Architecture

Le système de filtrage est divisé en modules spécialisés :

```
filter-panel/
├── filter-panel-accordion.ts  // Accordéons du panneau filtres
├── lazy-loader.ts             // Chargement lazy des composants filtres
├── proximity-manual-mode.ts   // Saisie manuelle de la position de proximité
├── proximity-state.ts         // État géolocalisation pour filtre proximité
├── shared.ts                  // Utilitaires partagés
└── svg-helpers.ts             // Génération icônes SVG inline
```

### Composants UI générés

**1. Recherche textuelle**

```html
<div class="gl-filter-control gl-filter-control--search">
    <label for="search-input">Recherche</label>
    <input type="text" id="search-input" placeholder="Rechercher..." />
</div>
```

**2. Sélecteur de catégorie**

```html
<div class="gl-filter-control gl-filter-control--select">
    <label for="category-select">Catégorie</label>
    <select id="category-select">
        <option value="">— Tous —</option>
        <option value="restaurant">Restaurants</option>
        <option value="hotel">Hôtels</option>
    </select>
</div>
```

**3. Checkboxes multi-sélection**

```html
<div class="gl-filter-control gl-filter-control--checkboxes">
    <label>Tags</label>
    <div class="gl-filter-checkboxes">
        <label><input type="checkbox" value="parking" /> Parking</label>
        <label><input type="checkbox" value="wifi" /> WiFi</label>
    </div>
</div>
```

**4. Filtre de proximité**

```html
<div class="gl-filter-control gl-filter-control--proximity">
    <label>Proximité</label>
    <input type="range" min="0" max="5000" step="100" value="1000" />
    <span class="proximity-value">1.0 km</span>
</div>
```

**5. Tags actifs**

```html
<div class="gl-filter-active-tags">
    <span class="gl-filter-tag" data-filter-type="category" data-filter-value="restaurant">
        Restaurant
        <button class="gl-filter-tag__remove">×</button>
    </span>
    <button class="gl-filter-clear-all">Tout effacer</button>
</div>
```

### État des filtres

```javascript
const filterState = {
    search: "restaurant",
    category: "food",
    subcategory: "",
    tags: ["parking", "wifi"],
    proximity: {
        enabled: true,
        radius: 1000, // metres
        center: [48.8566, 2.3522],
    },
};
```

---

## Thématisation CSS

Tous les composants UI utilisent des **classes CSS BEM** pour faciliter la personnalisation.

### Variables CSS

```css
:root {
    /* Notifications */
    --gl-toast-success: #10b981;
    --gl-toast-error: #ef4444;
    --gl-toast-warning: #f59e0b;
    --gl-toast-info: #3b82f6;

    /* Accordéons */
    --gl-accordion-header-bg: #f5f5f5;
    --gl-accordion-header-bg-hover: #e0e0e0;
    --gl-accordion-border: #ddd;

    /* Symboles */
    --gl-symbol-size: 16px;
    --gl-symbol-border: #666;

    /* Filtres */
    --gl-filter-bg: white;
    --gl-filter-border: #ddd;
    --gl-filter-tag-bg: #3b82f6;
    --gl-filter-tag-color: white;
}

/* Dark theme */
[data-theme="dark"] {
    --gl-accordion-header-bg: #2c3e50;
    --gl-accordion-header-bg-hover: #34495e;
    --gl-accordion-border: #555;
    --gl-filter-bg: #2c3e50;
    --gl-filter-border: #555;
}
```

---

## Intégration inter-modules

### Exemple 1 : Légende avec accordéons

```javascript
// In legend-renderer.ts
const { accordionEl, bodyEl } = GeoLeaf._UIComponents.createAccordion(container, {
    layerId: "parcs",
    label: "Parcs et Jardins",
    collapsed: false,
    visible: true,
});

const items = [
    { label: "Parc urbain", color: "#228B22" },
    { label: "Jardin public", color: "#90EE90" },
];

items.forEach((item) => {
    const itemEl = document.createElement("div");
    itemEl.className = "gl-legend__item";
    bodyEl.appendChild(itemEl);

    GeoLeaf._UIComponents.renderCircleSymbol(itemEl, {
        fillColor: item.color,
        radius: 8,
    });

    const labelEl = document.createElement("span");
    labelEl.className = "gl-legend__item-label";
    labelEl.textContent = item.label;
    itemEl.appendChild(labelEl);
});
```

### Exemple 2 : Notifications après chargement

```javascript
// After loading a GeoJSON layer (internal module)
fetch(layerUrl)
    .then(() => {
        GeoLeaf.UI.Notifications.success('Couche "Parcs" chargée avec succès !');
    })
    .catch((error) => {
        GeoLeaf.UI.Notifications.error(`Erreur de chargement : ${error.message}`);
    });
```

---

## Limitations

1. **Notifications** : Maximum 3 toasts simultanés (configurable via `maxVisible`)
2. **Accordéons** : Pas de support d'imbrication multiple (accordéons dans accordéons)
3. **Symboles** : Icônes SVG requièrent sprite SVG défini
4. **Filtres de proximité** : Calcul côté client (peut être lent avec +10k POIs)

---

## Modules liés

- **[GeoLeaf.Legend](../legend/GeoLeaf_Legend_README.md)** : Utilise accordéons et symboles
- **[GeoLeaf.LayerManager](../layer-manager/GeoLeaf_LayerManager_README.md)** : Utilise composants UI
- **[GeoLeaf.Filter](../API_REFERENCE.md#filter--the-filter-panel-singular)** : filtrage attributaire (le pluriel `GeoLeaf.Filters` a été supprimé en v3.1)
- **[GeoLeaf.Layers](../API_REFERENCE.md#layers--feature-data)** : données des couches (le module POI a été dissous en v3)

---

**Version** : 3.0.0

**Dernière mise à jour** : mars 2026
