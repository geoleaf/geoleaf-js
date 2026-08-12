---
title: "CSS Animation Optimization Guide — GeoLeaf"
---

# CSS Animation Optimization Guide — GeoLeaf

**Applies to:** `@geoleaf/core` v3.x
**Target**: 60 FPS on every device

---

## Optimisation principles

### 1. GPU-accelerated properties

**Fast (GPU-accelerated):**

- `transform` (translate, rotate, scale)
- `opacity`
- `filter`

**Slow (CPU-bound, triggers layout/paint):**

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

## The `will-change` property

Tells the browser that an animation is about to run on the element.

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

::: warning

Too many simultaneous `will-change` declarations consume GPU memory.

:::

---

## Performance profiling

### Chrome DevTools

1. Open DevTools > **Performance** tab
2. Start recording (Ctrl+E)
3. Interact with the application (trigger the animations)
4. Stop recording
5. Analyse:
    - **FPS meter**: should stay at 60 FPS (green line)
    - **Main thread**: look for long tasks (red bars)
    - **Compositor**: green bars mean GPU-accelerated

### Target metrics

| Metric           | Target   | Warning | Critical |
| ---------------- | -------- | ------- | -------- |
| **FPS**          | 60       | < 55    | < 30     |
| **Frame time**   | 16.67 ms | > 18 ms | > 33 ms  |
| **Scripting**    | < 5 ms   | > 10 ms | > 20 ms  |
| **Layout/Paint** | < 3 ms   | > 5 ms  | > 10 ms  |

---

## Optimised animation patterns

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

## Easing functions

```css
/* Standard — normal transitions */
.standard {
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Deceleration (ease out) — elements entering the screen */
.decelerate {
    transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}

/* Acceleration (ease in) — elements leaving the screen */
.accelerate {
    transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}
```

| Easing        | Use case         | Effect                  |
| ------------- | ---------------- | ----------------------- |
| `ease-out`    | Entry animations | Fast start, slow finish |
| `ease-in`     | Exit animations  | Slow start, fast finish |
| `ease-in-out` | State changes    | Slow start and finish   |
| `linear`      | Rotation/spin    | Constant speed          |

---

## Mobile optimisations

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

## Optimisations applied inside GeoLeaf

### Toast notifications

- Double `requestAnimationFrame` for the toast entry
- `transform: translateY()` instead of `top`
- `will-change: transform, opacity` before the animation, `auto` afterwards

### POI side panel

- Slide through `transform: translateX()` (never `left`)
- `300ms ease-out` transition on entry, `200ms ease-in` on exit

### Layer manager

- Expand/collapse through `max-height` + `opacity` (avoids animating `height`)
- Duration reduced to 200 ms for responsiveness

### MapLibre GL map resize

- `map.resize()` is called after fullscreen with the `CONSTANTS.FULLSCREEN_TRANSITION_MS` delay (10 ms), to let the browser recompute the dimensions.

### Measured results

| Animation          | Before | After  | Gain  |
| ------------------ | ------ | ------ | ----- |
| Toast notification | 45 FPS | 60 FPS | +33 % |
| Modal/backdrop     | 50 FPS | 60 FPS | +20 % |
| Layer expand       | 40 FPS | 60 FPS | +50 % |
| Panel scroll       | 48 FPS | 60 FPS | +25 % |

---

## Advanced techniques

### IntersectionObserver for scroll-driven animations

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

### Virtual scrolling (long lists)

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

## Test checklist

- [ ] Desktop Chrome — 60 FPS
- [ ] Mobile Chrome — 60 FPS
- [ ] Safari iOS — 60 FPS
- [ ] 4x CPU throttling
- [ ] Slow network (Slow 3G)
- [ ] `prefers-reduced-motion` enabled

---

## References

- [Google Web Fundamentals — Rendering Performance](https://developers.google.com/web/fundamentals/performance/rendering)
- [CSS Triggers — What triggers layout/paint/composite](https://csstriggers.com/)
- [MDN — CSS Performance Optimization](https://developer.mozilla.org/en-US/docs/Web/Performance/CSS_performance_optimization)
