---
title: "GeoLeaf — Accessibilité RGAA / WCAG 2.1"
---

# GeoLeaf — Accessibilité RGAA / WCAG 2.1

> Référence : loi n° 2005-102 du 11 février 2005, décret n° 2019-768 du 24 juillet 2019.
> S'applique à : `@geoleaf/core` **v3.x** — dernière vérification 2026-07-29
> Périmètre : `@geoleaf/core` (paquet MIT public)

---

## Statut de conformité

**Niveau déclaré : Partiellement conforme — ~87 % des critères RGAA 4.1 applicables**

Les composants couverts ci-dessous ont été audités et corrigés dans le cadre du Sprint §1.5. Les non-conformances résiduelles sont documentées en section « Dérogations ».

---

## Composants accessibles

### 1. Lightbox (galerie d'images POI)

| Critère                                    | Implémentation                                      |
| ------------------------------------------ | --------------------------------------------------- |
| `role="dialog"` sur le conteneur           | ✅                                                  |
| `aria-modal="true"`                        | ✅                                                  |
| `aria-labelledby="gl-lightbox-title"`      | ✅ titre masqué visuellement                        |
| Labels i18n sur les 3 boutons              | ✅ `aria.lightbox.close/prev/next`                  |
| `img.alt` = compteur contextuel            | ✅ `aria.lightbox.counter` (ex : « Image 2 sur 5 ») |
| Focus trap (Tab/Shift+Tab)                 | ✅ cycle dans le dialog                             |
| Retour focus au déclencheur (close)        | ✅ `_triggerElement.focus()`                        |
| Navigation clavier ArrowLeft/Right, Escape | ✅                                                  |

**Clés i18n disponibles (toutes les 6 langues) :**

```
aria.lightbox.title     Galerie d'images
aria.lightbox.close     Fermer
aria.lightbox.prev      Image précédente
aria.lightbox.next      Image suivante
aria.lightbox.counter   Image {0} sur {1}
```

---

### 2. Side panel POI (fiche détaillée)

| Critère                                           | Implémentation                      |
| ------------------------------------------------- | ----------------------------------- |
| `role="complementary"`                            | ✅                                  |
| `aria-label` via i18n (`aria.sidepanel.landmark`) | ✅                                  |
| Focus déplacé sur bouton fermer à l'ouverture     | ✅                                  |
| Fermeture Escape                                  | ✅                                  |
| Focus trap Tab/Shift+Tab                          | ✅ (§1.5.3)                         |
| Restauration focus à la fermeture                 | — (overlay sans déclencheur unique) |

---

### 3. Dialogs modaux — Mobile sheet

| Critère                                  | Implémentation        |
| ---------------------------------------- | --------------------- |
| `role="dialog"`                          | ✅                    |
| `aria-modal="true"`                      | ✅                    |
| `aria-labelledby="gl-sheet-panel-title"` | ✅                    |
| `aria-describedby="gl-sheet-panel-body"` | ✅ (§1.5.8)           |
| Focus trap Tab/Shift+Tab                 | ✅ `_attachFocusTrap` |
| Fermeture Escape                         | ✅                    |

---

### 4. Barre d'outils mobile (`role="toolbar"`)

| Critère                                     | Implémentation                     |
| ------------------------------------------- | ---------------------------------- |
| `role="toolbar"`                            | ✅                                 |
| `aria-orientation="vertical"`               | ✅                                 |
| `aria-label` via i18n (`aria.toolbar.root`) | ✅                                 |
| Labels i18n sur chaque bouton               | ✅                                 |
| Roving tabindex                             | ✅ (§1.5.5) — un seul `tabindex=0` |
| Navigation ArrowUp/Down/Left/Right          | ✅                                 |
| Navigation Home/End                         | ✅                                 |
| Synchronisation tabindex au clic            | ✅ `focusin`                       |

---

### 5. Contrôles cartographiques

Les trois contrôles suivants sont conformes WCAG 2.1 AA (§1.5.4) :

| Contrôle                 | `aria-label`                       |
| ------------------------ | ---------------------------------- |
| `control-fullscreen.ts`  | `aria.fullscreen.enter/exit_label` |
| `control-geolocation.ts` | `aria.geoloc.toggle_label`         |
| `control-poi-add.ts`     | `aria.poi_add.label`               |

---

### 6. Slider proximité

L'élément `<input type="range">` expose nativement `aria-valuemin`, `aria-valuemax` et `aria-valuenow` via les attributs HTML `min`, `max`, `value`. Complété par `aria-label` (`aria.proximity.slider`).

---

### 7. Panel desktop — Navigation par onglets

| Critère                                  | Implémentation        |
| ---------------------------------------- | --------------------- |
| `role="tablist"` sur le conteneur        | ✅                    |
| `aria-label` via i18n (`aria.panel.nav`) | ✅                    |
| `role="tab"` sur chaque onglet           | ✅                    |
| `aria-selected="true/false"`             | ✅ géré dynamiquement |
| `aria-controls="gl-rp-pane-{id}"`        | ✅                    |
| `aria-labelledby` sur les panneaux       | ✅                    |
| Navigation Arrow/Home/End                | ✅                    |

---

### 8. Panneau de filtres — Accordéons

| Critère                            | Implémentation        |
| ---------------------------------- | --------------------- |
| `<button>` sémantique dans heading | ✅ (critère D1 RGAA)  |
| `aria-expanded="false/true"`       | ✅ mis à jour au clic |
| `aria-controls="{contentId}"`      | ✅                    |
| Icône flèche `aria-hidden="true"`  | ✅                    |

---

### 9. Notifications

| Critère                    | Implémentation    |
| -------------------------- | ----------------- |
| `aria-live="polite"`       | ✅ annonces SR    |
| `aria-label` bouton fermer | ✅ i18n           |
| `prefers-reduced-motion`   | ✅ animations off |

---

### 10. Layer Manager (gestionnaire de couches)

| Critère                                 | Implémentation                                       |
| --------------------------------------- | ---------------------------------------------------- |
| `aria-pressed` sur les toggles          | ✅                                                   |
| `aria-label` sur les contrôles          | ✅                                                   |
| `aria-label` sur le `<select>` de style | ✅ i18n `aria.layer.style_select` (+ libellé couche) |

> Le sélecteur de style (`<select>` natif, un par couche à styles multiples) n'a pas de `<label>` associé : il reçoit un `aria-label` i18n contextualisé avec le libellé de la couche (WCAG 4.1.2 `select-name`).

---

### 11. Basemaps (fonds de carte)

| Critère                                         | Implémentation                      |
| ----------------------------------------------- | ----------------------------------- |
| `aria-pressed` sur les boutons                  | ✅                                  |
| `aria-label` contextuel                         | ✅                                  |
| `aria-label` sur le `<select>` de fond de carte | ✅ i18n `aria.layer.basemap_select` |

---

### 12. Barre de recherche

| Critère                            | Implémentation              |
| ---------------------------------- | --------------------------- |
| `aria-label` sur bar/input/boutons | ✅ i18n                     |
| `aria-expanded` sur le conteneur   | ✅                          |
| Focus visible sur conteneur        | ✅ `:focus-within` (§1.5.9) |

---

### 13. Permalink

| Critère         | Implémentation |
| --------------- | -------------- |
| `aria-expanded` | ✅             |

---

### 14. PWA (install prompt + iOS banner)

| Critère              | Implémentation |
| -------------------- | -------------- |
| `aria-live="polite"` | ✅             |
| `aria-label` boutons | ✅             |

---

## Support multilingue ARIA

Toutes les clés ARIA sont traduites dans les 6 langues : **fr, en, de, es, pt, it**
Fichiers : `packages/core/src/lang/lang_*.ts`

---

## Dérogations et non-conformances résiduelles

| Élément                                  | Critère RGAA                     | Justification                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markers MapLibre (nom POI)               | 4.1 — images décoratives         | Les markers DOM (`<div>`) reçoivent désormais `aria-label` (nom du POI) et `role="img"` si le POI est nommé (§1.5.10). Les POI sans nom restent non annoncés — l'alternative reste le side panel.                                                                         |
| Icônes POI (canvas ImageData)            | 1.1 — image porteuse (catégorie) | Les icônes sont rendues via `map.addImage()` en `ImageData` (canvas WebGL). Contrairement aux `<img>`, les canvas sont exemptés de l'obligation d'attribut `alt` (WCAG H37 — applicable aux images HTML uniquement). La catégorie POI reste accessible via le side panel. |
| Popups riches (HTML complexe dans popup) | 11.1 — étiquettes de champ       | Le contenu est injecté par le profil JSON ; la responsabilité du profil est côté intégrateur.                                                                                                                                                                             |
| Contraste des thèmes custom              | 1.4.3 WCAG                       | Les thèmes sont configurables par profil. Le thème par défaut respecte le ratio 4.5:1. Les thèmes custom sont sous la responsabilité de l'intégrateur.                                                                                                                    |
| Restauration focus (side panel)          | 9.2.1 WCAG (focus)               | Le side panel s'ouvre via clic sur un marker POI non nativement focusable au clavier. Le focus ne peut pas être restauré sur le déclencheur après fermeture — comportement inhérent à la cartographie interactive.                                                        |

---

## Déclaration d'accessibilité (synthèse)

**Organisme** : GeoLeaf Platform / Mattieu Pottier
**Technologie** : HTML5, CSS3, JavaScript / TypeScript
**Outils de test** : axe-core (intégré dans les tests E2E Playwright), vérifications manuelles clavier
**Date de la dernière évaluation** : 2026-03-25

**Résultat de l'audit** :
La bibliothèque `@geoleaf/core` est **partiellement conforme** au RGAA version 4.1.
(Critères non applicables exclus de la base de calcul — ~87 % des critères applicables)

**Contact** : Pour signaler un défaut d'accessibilité, ouvrir une issue sur le dépôt GitHub ou contacter l'équipe GeoLeaf.

---

## Changelog accessibilité

| Date       | Version | Changements                                                                                                                                                                                                                                                                                                |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-16 | 3.0.0   | §10/§11 — Nom accessible des `<select>` du layer-manager (WCAG 4.1.2 `select-name`) : `aria-label` i18n `aria.layer.style_select` (sélecteur de style, + libellé couche) et `aria.layer.basemap_select` (fond de carte), 6 langues. Résout l'échec e2e « sheet modal mobile » d'axe.                       |
| 2026-03-25 | 1.4.0   | §1.5.10 — Complétion Sprint §2.1 : `prefers-reduced-motion` étendu à toolbar/sheet/search/proximity/recenter ; contraste cluster texte thème sombre `#e5e7eb` → `#111827` (1.83:1 → 7.86:1, WCAG AA+AAA) ; `aria-label`+`role="img"` sur markers MapLibre DOM (POI nommés) ; dérogations table mise à jour |
| 2026-03-25 | 1.3.0   | §1.5.9 — Audit post-migration MapLibre : corrections CSS `:focus` → `:focus-visible` (6 sélecteurs), ajout `:focus-within` sur `.gl-search-bar`, suppression CSS legacy `.geoleaf-interactive`, documentation 7 composants manquants, dérogation 'markers' → 'markers MapLibre'                            |
| 2026-03-25 | 1.2.0   | §1.5 — Lightbox dialog + focus trap, labels i18n, img.alt ; sidepanel focus trap ; toolbar roving tabindex ; sheet aria-describedby                                                                                                                                                                        |
| 2026-03-20 | 1.1.x   | §1.4 — Events API (non lié à l'accessibilité)                                                                                                                                                                                                                                                              |
| 2026-03-19 | 1.1.x   | §1.2 — Thème auto (prefers-color-scheme) appliqué                                                                                                                                                                                                                                                          |
