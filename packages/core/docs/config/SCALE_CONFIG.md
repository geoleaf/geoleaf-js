---
title: "Configuration Scale Control (scaleConfig)"
---

# Configuration Scale Control (scaleConfig)

**Version** : 3.0.0
**Date de création** : Décembre 2025
**Dernière mise à jour** : mars 2026

---

## Description

Le module `ScaleControl` affiche l'échelle de la carte sous différentes formes : échelle graphique MapLibre GL JS ScaleControl, échelle numérique (ex: 1:250 000), et niveau de zoom. Il peut être positionné dans n'importe quel coin de la carte et offre une option d'édition interactive de l'échelle.

## Localisation dans le code

- **Module** : `packages/core/src/modules/built-in/ui/scale-control.ts`
- **Initialisation** : `GeoLeaf.UI.ScaleControl.init(map, options)`
- **Chargement** : `packages/core/src/bundle-esm-entry.ts` (import dans l'ordre Rollup)

## Structure de configuration

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNumericEditable": false,
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

## Paramètres disponibles

### scaleGraphic (boolean)

Active/désactive l'échelle graphique MapLibre GL JS (barre horizontale avec graduations).

**Valeur par défaut:** `true`

**Comportement:**

- `true` : Affiche l'échelle graphique MapLibre GL JS native (ScaleControl)
- `false` : N'affiche pas l'échelle graphique

**Exemple:**

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "position": "bottomleft"
    }
}
```

### scaleNumeric (boolean)

Active/désactive l'affichage de l'échelle numérique au format "1:250 000".

**Valeur par défaut:** `false`

**Comportement:**

- `true` : Affiche l'échelle numérique dans un bloc personnalisé
- `false` : N'affiche pas l'échelle numérique

**Format:** L'échelle est calculée automatiquement en fonction du niveau de zoom et de la latitude du centre de la carte.

**Exemple:**

```json
{
    "scaleConfig": {
        "scaleNumeric": true,
        "position": "bottomleft"
    }
}
```

**Rendu:** `1:250 000` (avec espaces comme séparateurs de milliers)

### scaleNumericEditable (boolean)

Rend l'échelle numérique éditable via un champ input. L'utilisateur peut saisir une échelle cible et la carte s'ajustera au niveau de zoom correspondant.

**Valeur par défaut:** `false`

**Prérequis:** `scaleNumeric` doit être `true`

**Comportement:**

- `true` : L'échelle devient un champ input éditable
- `false` : L'échelle est affichée en lecture seule

**Utilisation:**

1. L'utilisateur clique sur le champ
2. Saisit une échelle au format "1:xxx xxx" (ex: "1:100 000")
3. Valide avec Entrée ou en cliquant ailleurs
4. La carte effectue un zoom pour atteindre cette échelle

**Exemple:**

```json
{
    "scaleConfig": {
        "scaleNumeric": true,
        "scaleNumericEditable": true,
        "position": "bottomleft"
    }
}
```

**Formats acceptés:**

- `1:250000`
- `1:250 000`
- `1: 250000`

### scaleNivel (boolean)

Active/désactive l'affichage du niveau de zoom MapLibre GL JS (ex: "Zoom: 12").

**Valeur par défaut:** `false`

**Comportement:**

- `true` : Affiche le niveau de zoom actuel
- `false` : N'affiche pas le niveau de zoom

**Exemple:**

```json
{
    "scaleConfig": {
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

**Rendu:** `Zoom: 12`

### position (string)

Définit la position du contrôle d'échelle sur la carte.

**Valeur par défaut:** `"bottomleft"`

**Valeurs possibles:**

- `"topleft"` : Coin supérieur gauche
- `"topright"` : Coin supérieur droit
- `"bottomleft"` : Coin inférieur gauche (recommandé, même position que branding/coordinates)
- `"bottomright"` : Coin inférieur droit

**Exemple:**

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNivel": true,
        "position": "bottomright"
    }
}
```

## Exemples d'utilisation

### Configuration minimale (échelle graphique uniquement)

```json
{
    "scaleConfig": {
        "scaleGraphic": true
    }
}
```

### Configuration complète non-éditable

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNumericEditable": false,
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

### Configuration avec échelle éditable

```json
{
    "scaleConfig": {
        "scaleGraphic": false,
        "scaleNumeric": true,
        "scaleNumericEditable": true,
        "scaleNivel": true,
        "position": "bottomright"
    }
}
```

### Désactiver complètement

Supprimer `scaleConfig` du profile.json ou définir tous les paramètres à `false`:

```json
{
    "scaleConfig": {
        "scaleGraphic": false,
        "scaleNumeric": false,
        "scaleNivel": false
    }
}
```

## Calculs techniques

### Calcul de l'échelle

L'échelle est calculée avec la formule :

```javascript
metersPerPixel = ((156543.03392 * cos((lat * π) / 180)) / 2) ^ zoom;
scale = (metersPerPixel * 96) / 0.0254;
```

**Facteurs:**

- `156543.03392` : Taille du monde en mètres au niveau de zoom 0
- Latitude du centre de la carte (cos pour projection Web Mercator)
- Résolution d'écran : 96 DPI
- Conversion mètres → pouces : 0.0254 m/inch

### Calcul du zoom depuis l'échelle

Pour calculer le niveau de zoom nécessaire pour atteindre une échelle donnée :

```javascript
metersPerPixel = (targetScale * 0.0254) / 96;
zoom = log2((156543.03392 * cos((lat * π) / 180)) / metersPerPixel);
```

Le zoom est arrondi à l'entier le plus proche et limité entre 0 et 22.

## Styling CSS

Le module utilise les variables CSS GeoLeaf :

```css
.gl-scale-control {
    background: var(--gl-color-bg-surface);
    color: var(--gl-color-text-main);
    box-shadow: var(--gl-shadow-small);
}

.gl-scale-zoom {
    color: var(--gl-color-text-muted);
}
```

**Personnalisation:** Vous pouvez surcharger ces styles dans votre CSS personnalisé.

## API JavaScript

### Initialisation automatique

```javascript
// Initialise automatiquement depuis la config du profil actif
GeoLeaf.UI.ScaleControl.init(map);
```

### Initialisation manuelle

```javascript
// Initialisation avec config personnalisée
GeoLeaf.UI.ScaleControl.init(map, {
    scaleGraphic: true,
    scaleNumeric: true,
    scaleNumericEditable: false,
    scaleNivel: true,
    position: "bottomleft",
});
```

### Destruction

```javascript
// Nettoyer le contrôle
GeoLeaf.UI.ScaleControl.destroy();
```

## Événements

Le contrôle écoute automatiquement les événements MapLibre GL JS suivants :

- `zoomend` : Mise à jour lors du changement de zoom
- `moveend` : Mise à jour lors du déplacement de la carte

Ces événements déclenchent une mise à jour de l'échelle et du niveau de zoom affichés.

## Notes techniques

### Précision de l'échelle

L'échelle calculée est approximative car :

- Elle dépend de la latitude (projection Web Mercator déforme aux latitudes élevées)
- La résolution d'écran peut varier (96 DPI est une valeur standard)
- Les arrondis sont appliqués pour la lisibilité

### Performance

Le module est optimisé :

- Mise à jour uniquement sur `zoomend` et `moveend` (pas en temps réel pendant le déplacement)
- Calculs mathématiques légers
- Pas d'impact sur les performances de rendu

### Compatibilité

- **MapLibre GL JS :** Utilise le ScaleControl natif MapLibre pour l'échelle graphique
- **Navigateurs :** Compatible tous navigateurs modernes (ES2022+)
- **Mobile :** Fonctionne sur mobile, input éditable tactile-friendly

## Fichiers concernés

- `packages/core/src/modules/built-in/ui/scale-control.ts` — Module principal
- `packages/core/src/bundle-esm-entry.ts` — Chargement du module
- `packages/core/demo/` — Initialisation dans la démo
- `profiles/*/profile.json` — Configuration

## Historique

- **2.0.0** : Refactorisation complète sur MapLibre GL JS (mars 2026)
- **1.0.0** : Création du module ScaleControl
    - Échelle graphique
    - Échelle numérique calculée
    - Échelle éditable avec input
    - Affichage du niveau de zoom
    - Positionnement configurable
