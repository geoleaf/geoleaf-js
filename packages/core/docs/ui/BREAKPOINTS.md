---
title: "Breakpoints — GeoLeaf Mobile Friendly"
---

# Breakpoints — GeoLeaf Mobile Friendly

**Date :** Mars 2026  
**Contexte :** Roadmap interface mobile-friendly, Phase 0.

---

## Variables CSS

Définies dans `src/css/geoleaf-theme.css` (`:root`) :

| Variable     | Valeur | Usage                                                         |
| ------------ | ------ | ------------------------------------------------------------- |
| `--gl-bp-sm` | 480px  | Smartphone                                                    |
| `--gl-bp-md` | 640px  | Grande phablet / transition                                   |
| `--gl-bp-lg` | 768px  | Tablette 6″ — **seuil barre pill « icônes seules »** (mobile) |
| `--gl-bp-xl` | 1024px | PC 10″ / 13″                                                  |

---

## Seuil « mobile » pour la barre pill

- **Choix : 768px** (`--gl-bp-lg`).
- En `max-width: 768px` : affichage de la barre pill d’utilitaires (icônes seules), panneaux en overlay/sheet.
- Au-dessus de 768px : layout desktop (barre des thèmes, panneaux latéraux, etc.).

---

## Usage dans le code

- **CSS** : les media queries utilisent les valeurs en pixels directement (les variables CSS ne sont pas autorisées dans `@media`). Garder la cohérence avec le tableau ci‑dessus, par exemple :
    - `@media (max-width: 768px)` pour le seuil mobile / barre pill.
    - `@media (max-width: 640px)` pour phablet.
    - `@media (max-width: 480px)` pour petit smartphone.
    - `@media (min-width: 1024px)` pour desktop large.
- **JavaScript** : utiliser `getComputedStyle(document.documentElement).getPropertyValue('--gl-bp-lg')` (ou équivalent) si besoin de détection de viewport alignée sur les breakpoints.

---

## Viewport

Les pages d’application (ex. `demo/index.html`) doivent inclure :

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

## Ne pas utiliser `user-scalable=no` (bloque le zoom, mauvais pour l’accessibilité).

## Comportement par device (phases 5-7)

| Largeur     | Appareil                 | Comportement                                                                        |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------- |
| ≤ 768 px    | Smartphone / tablette 6" | Barre pill, sheets overlay, side panel POI **100vw** en overlay (pas de push carte) |
| 769–1024 px | PC 10"                   | Layout desktop, `--gl-sidepanel-width: 360px`, carte décalée de 360 px              |
| ≥ 1025 px   | PC 13"+                  | Layout desktop, `--gl-sidepanel-width: 420px` (défaut), carte décalée de 420 px     |

### Variable `--gl-sidepanel-width`

La largeur du side panel POI est pilotée par la variable CSS `--gl-sidepanel-width` :

- Définie à `420px` dans `:root` de chaque fichier thème (`geoleaf-theme.css`, `geoleaf-theme-alt.css`, `geoleaf-theme-green.css`).
- Surchargée à `360px` dans `@media (min-width: 769px) and (max-width: 1024px)` dans ces mêmes fichiers.
- Sur mobile (≤ 768px) le panel en `width: 100vw` écrase la variable ; la carte garde `right: 0`.

Tous les offsets dépendants (`.maplibregl-ctrl-bottom-right`, `.gl-theme-toggle--map`, `.maplibregl-ctrl-top-right`) utilisent `calc(var(--gl-sidepanel-width) + 10px)` — plus de valeur `420px` codée en dur.

---

## Barre pill — résumé accessibilité (Phase 7)

- Chaque bouton a `aria-label`.
- Les boutons ouvrant un sheet ont `aria-expanded="false"` par défaut, passent à `"true"` à l'ouverture.
- Le dialog sheet : `role="dialog"`, `aria-modal="true"`, `aria-labelledby="gl-sheet-panel-title"`.
- Focus trap Tab/Shift-Tab dans le sheet ; Échap ferme ; focus renvoyé sur le déclencheur à la fermeture.
- Zone tactile min 44 px ; `:focus-visible` avec `--gl-color-focus-ring`.
