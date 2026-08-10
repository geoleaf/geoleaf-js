---
title: "CSS Animation Optimization Guide — GeoLeaf"
---

# CSS Animation Optimization Guide — GeoLeaf

**Product Version** : GeoLeaf Platform V3

**S'applique à :** `@geoleaf/core` v3.x
**Cible** : 60 FPS sur tous les appareils

**Dernière mise à jour** : mars 2026

---

## Principes d'optimisation

### 1. Propriétés accélérées GPU

**Rapide (accéléré GPU) :**

- `transform` (translate, rotate, scale)
- `opacity`
- `filter`

**Lent (CPU-bound, déclenche layout/paint) :**

- `width`, `height`
- `top`, `left`, `right`, `bottom`
- `margin`, `padding`
- `border`

```css
/* BAD - triggers layout recalculation */
.element {
    transition: left 0.3s ease;
}
.element:hover {
    left: 100px;
}

/* GOOD - GPU-accelerated */
.element {
    transition: transform 0.3s ease;
}
.element:hover {
    transform: translateX(100px);
}
```

---

## Propriété `will-change`

Indique au navigateur qu'une animation est imminente sur cet élément.

```css
/* Set before animation */
.element {
    will-change: transform, opacity;
}

/* Animate */
.element.active {
    transform: scale(1.2);
    opacity: 0.8;
}

/* Remove after animation to release GPU memory */
.element.completed {
    will-change: auto;
}
```

```js
// Set will-change before triggering animation
element.style.willChange = "transform";
requestAnimationFrame(() => {
    element.classList.add("animated");
});

// Cleanup after transition
element.addEventListener("transitionend", () => {
    element.style.willChange = "auto";
});
```

**Attention** : trop de déclarations `will-change` simultanées consomment de la mémoire GPU.

---

## Profiling performance

### Chrome DevTools

1. Ouvrir DevTools > onglet **Performance**
2. Démarrer l'enregistrement (Ctrl+E)
3. Interagir avec l'application (déclencher les animations)
4. Arrêter l'enregistrement
5. Analyser :
    - **FPS meter** : doit rester à 60 FPS (ligne verte)
    - **Main thread** : chercher les tâches longues (barres rouges)
    - **Compositor** : barres vertes = accéléré GPU

### Métriques cibles

| Métrique         | Cible    | Alerte  | Critique |
| ---------------- | -------- | ------- | -------- |
| **FPS**          | 60       | < 55    | < 30     |
| **Frame time**   | 16.67 ms | > 18 ms | > 33 ms  |
| **Scripting**    | < 5 ms   | > 10 ms | > 20 ms  |
| **Layout/Paint** | < 3 ms   | > 5 ms  | > 10 ms  |

---

## Patterns d'animation optimisés

### Fade In/Out

```css
/* Optimized with opacity only */
.fade-enter {
    opacity: 0;
}
.fade-enter-active {
    opacity: 1;
    transition: opacity 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
.fade-exit {
    opacity: 1;
}
.fade-exit-active {
    opacity: 0;
    transition: opacity 200ms cubic-bezier(0.4, 0, 1, 1);
}
```

### Slide In/Out

```css
/* Use transform instead of margin/position */
.slide-enter {
    transform: translateY(-20px);
    opacity: 0;
}
.slide-enter-active {
    transform: translateY(0);
    opacity: 1;
    transition:
        transform 300ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Scale Animation

```css
/* Use transform: scale() */
.scale-enter {
    transform: scale(0.8);
    opacity: 0;
}
.scale-enter-active {
    transform: scale(1);
    opacity: 1;
    transition:
        transform 250ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
        opacity 250ms ease;
}
```

---

## Fonctions d'easing

```css
/* Standard — transitions normales */
.standard {
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Deceleration (ease out) — éléments entrant à l'écran */
.decelerate {
    transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}

/* Acceleration (ease in) — éléments quittant l'écran */
.accelerate {
    transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}
```

| Easing        | Cas d'usage          | Effet                       |
| ------------- | -------------------- | --------------------------- |
| `ease-out`    | Animations d'entrée  | Démarrage rapide, fin lente |
| `ease-in`     | Animations de sortie | Démarrage lent, fin rapide  |
| `ease-in-out` | Changements d'état   | Début et fin lents          |
| `linear`      | Rotation/spin        | Vitesse constante           |

---

## Optimisations mobiles

```css
/* Reduce animation duration on mobile */
@media (max-width: 768px) {
    .animated {
        transition-duration: 200ms;
    }
}

/* Respect user preference for reduced motion */
@media (prefers-reduced-motion: reduce) {
    * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}

/* Force GPU layer (use sparingly) */
.animated-element {
    transform: translateZ(0);
    backface-visibility: hidden;
}
```

---

## Optimisations appliquées dans GeoLeaf

### Notifications toast

- Double `requestAnimationFrame` pour l'entrée du toast
- `transform: translateY()` à la place de `top`
- `will-change: transform, opacity` avant animation, `auto` après

### Panneau latéral POI

- Slide via `transform: translateX()` (pas de `left`)
- Transitions `300ms ease-out` pour l'entrée, `200ms ease-in` pour la sortie

### Layer manager

- Expand/collapse via `max-height` + `opacity` (évite `height` animé)
- Durée réduite à 200 ms pour la réactivité

### Resize carte MapLibre GL

- Appel `map.resize()` après fullscreen avec délai `CONSTANTS.FULLSCREEN_TRANSITION_MS` (10 ms) pour laisser le navigateur recalculer les dimensions.

### Résultats mesurés

| Animation          | Avant  | Après  | Gain  |
| ------------------ | ------ | ------ | ----- |
| Toast notification | 45 FPS | 60 FPS | +33 % |
| Modal/backdrop     | 50 FPS | 60 FPS | +20 % |
| Layer expand       | 40 FPS | 60 FPS | +50 % |
| Scroll panneau     | 48 FPS | 60 FPS | +25 % |

---

## Techniques avancées

### IntersectionObserver pour animations au scroll

```js
const observer = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("animate-in");
                observer.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.1 }
);

document.querySelectorAll(".lazy-animate").forEach((el) => {
    observer.observe(el);
});
```

### Virtual scrolling (listes longues)

```js
// Only render visible items — 60 FPS even with 10,000 items
const visibleStart = Math.floor(scrollTop / itemHeight);
const visibleEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight);
const visibleItems = allItems.slice(visibleStart, visibleEnd);
```

### Debounced scroll handlers

```js
let scrollTimeout: ReturnType<typeof setTimeout>;
window.addEventListener(
    "scroll",
    () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            updateUI();
        }, 150);
    },
    { passive: true } // passive: true improves scroll performance
);
```

---

## Checklist de test

- [ ] Desktop Chrome — 60 FPS
- [ ] Mobile Chrome — 60 FPS
- [ ] Safari iOS — 60 FPS
- [ ] CPU throttling 4x
- [ ] Réseau lent (Slow 3G)
- [ ] `prefers-reduced-motion` activé

---

## Références

- [Google Web Fundamentals — Rendering Performance](https://developers.google.com/web/fundamentals/performance/rendering)
- [CSS Triggers — What triggers layout/paint/composite](https://csstriggers.com/)
- [MDN — CSS Performance Optimization](https://developer.mozilla.org/en-US/docs/Web/Performance/CSS_performance_optimization)

---

**Version** : 3.0.0

**Dernière mise à jour** : mars 2026
