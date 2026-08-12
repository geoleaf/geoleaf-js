---
title: "GeoLeaf Notifications — Public API"
---

# GeoLeaf Notifications — Public API

> **Module:** `@geoleaf/core` — available from boot
> **Namespace:** `GeoLeaf.notify()` (shortcut) + `GeoLeaf.Notifications.*` (full namespace)
> **ESM export:** `import { Notifications } from "@geoleaf/core"`

---

## Contents

1. [Overview](#overview)
2. [CDN / ESM usage](#cdn--esm-usage)
3. [ESM usage (bundler)](#esm-usage-bundler)
4. [API reference](#api-reference)
5. [Types](#types)
6. [Option details](#option-details)
7. [Internal architecture — Priority queue](#internal-architecture--priority-queue)
8. [DOM structure and CSS classes](#dom-structure-and-css-classes)
9. [Telemetry integration](#telemetry-integration)
10. [Integration examples](#integration-examples)
11. [Accessibility](#accessibility)
12. [Responsive (mobile)](#responsive-mobile)
13. [Debugging](#debugging)
14. [Security notes](#security-notes)

---

## Overview

GeoLeaf ships an internal toast notification system (`NotificationSystem`) used by the core to inform the user (data loading, network errors, and so on).

Since version 2.0.0 this system is publicly exposed to **integrators**:

| Entry point                                     | Usage                               |
| ----------------------------------------------- | ----------------------------------- |
| `GeoLeaf.notify(msg, type, opts)`               | Top-level shortcut, simple usage    |
| `GeoLeaf.Notifications.success(msg)`            | Full namespace, typed methods       |
| `import { Notifications } from "@geoleaf/core"` | ESM import for third-party bundlers |

**Main characteristics:**

- Priority queue: errors > warnings > info/success
- 3 temporary toasts + 2 persistent toasts visible at the same time
- Smooth animations with automatic reordering by priority
- Accessibility: `aria-live="assertive"` for errors
- `prefers-reduced-motion` support

---

## CDN / ESM usage

```html
<script type="module" src="geoleaf.esm.js"></script>
<script>
    // After GeoLeaf.boot() / geoleaf:app:ready event

    // Top-level shortcut
    GeoLeaf.notify("Welcome to the map", "info");

    // Full namespace
    GeoLeaf.Notifications.success("Data loaded successfully");
    GeoLeaf.Notifications.warning("Unstable connection", { duration: 6000 });
    GeoLeaf.Notifications.error("Unable to load the layer", {
        persistent: true,
        dismissible: true,
    });
</script>
```

### Listening for the `geoleaf:app:ready` event

```js
document.addEventListener("geoleaf:app:ready", () => {
    GeoLeaf.notify("Map ready", "success", 2000);
});
```

---

## ESM usage (bundler)

```ts
import { Notifications } from "@geoleaf/core";
// `contracts/notification.contract` is not a valid import path. The contract file is
// `notify.contract.ts` and is not published; both types live in the capability and are
// reachable through the `capabilities/*` subpath export.
import type { NotifyType, NotifyOptions } from "@geoleaf/core/capabilities/toast-renderer/types.js";

// Simple notification
Notifications.info("New update available");

// With options
Notifications.error("Synchronisation failed", {
    duration: 8000,
    dismissible: true,
});

// Generic signature
// `notify()` has TWO forms, and they do not mix:
//   notify(message, type, duration)  — positional, the 3rd argument is a NUMBER
//   notify(message, options)         — object, the type travels INSIDE the options
// Passing options in 3rd position does not compile. To combine a type and options,
// merge both into the second argument:
function notifyUser(message: string, type: NotifyType, opts?: NotifyOptions) {
    Notifications.notify(message, { ...opts, type });
}

// Check system status
const status = Notifications.getStatus();
console.log(`${status.activeToasts} active toast(s)`);
```

---

## API reference

### `GeoLeaf.notify(message, type, options?)` _(top-level shortcut)_

Displays a toast notification. Available directly on the `GeoLeaf` namespace.

```js
GeoLeaf.notify(message, type, duration?)
GeoLeaf.notify(message, type, options?)
GeoLeaf.notify(message, options?)
```

| Parameter  | Type            | Default            | Description                 |
| ---------- | --------------- | ------------------ | --------------------------- |
| `message`  | `string`        | —                  | Text displayed in the toast |
| `type`     | `NotifyType`    | `"info"`           | Notification type           |
| `duration` | `number`        | _(type-dependent)_ | Display duration in ms      |
| `options`  | `NotifyOptions` | —                  | Options object (see below)  |

---

### `GeoLeaf.Notifications.*` / `Notifications.*`

#### `.notify(message, typeOrOptions?, duration?)`

Generic method. Supports both the positional and the object signature.

#### `.success(message, options?)`

Green toast — confirmation of a successful action. Default duration: **3,000 ms**.

#### `.error(message, options?)`

Red toast — critical error. Default duration: **5,000 ms**. Highest priority in the queue.

#### `.warning(message, options?)`

Orange toast — non-blocking alert. Default duration: **4,000 ms**.

#### `.info(message, options?)`

Blue/neutral toast — information. Default duration: **3,000 ms**.

#### `.dismiss(toastEl)`

Closes a specific toast from its DOM element.

#### `.clearAll()`

Immediately removes every visible toast and empties the queue.

#### `.getStatus()` → `NotifyStatus`

Returns a snapshot of the current state of the system.

```js
const s = GeoLeaf.Notifications.getStatus();
// {
//   enabled: true,
//   initialized: true,
//   activeToasts: 1,
//   temporaryToasts: 1,
//   persistentToasts: 0,
//   queued: 0,
//   maxVisible: 3,
//   maxPersistent: 2,
//   position: "bottom-center"
// }
```

---

## Types

### `NotifyType`

```ts
type NotifyType = "info" | "success" | "warning" | "error";
```

### `NotifyOptions`

```ts
interface NotifyOptions {
    type?: NotifyType; // type override (useful with notify())
    duration?: number; // display duration in ms (ignored if persistent: true)
    persistent?: boolean; // true → no auto-dismiss (default: false)
    dismissible?: boolean; // true → close button (default: true)
}
```

### `NotifyStatus`

```ts
interface NotifyStatus {
    enabled: boolean;
    initialized: boolean;
    activeToasts: number;
    temporaryToasts: number;
    persistentToasts: number;
    queued: number;
    maxVisible: number;
    maxPersistent: number;
    position: string;
}
```

---

## Option details

### `duration`

Time before the toast closes automatically, in milliseconds.

```js
GeoLeaf.Notifications.info("Message", { duration: 8000 }); // 8 seconds
```

Default durations:

| Type      | Default duration |
| --------- | ---------------- |
| `info`    | 3,000 ms         |
| `success` | 3,000 ms         |
| `warning` | 4,000 ms         |
| `error`   | 5,000 ms         |

### `persistent`

A persistent toast never closes on its own. It stays visible until an explicit `dismiss()` or `clearAll()`.

```js
GeoLeaf.Notifications.error("Lost connection to the server", { persistent: true });

// Later, when connection is restored:
GeoLeaf.Notifications.clearAll();
GeoLeaf.Notifications.success("Connection restored");
```

### `dismissible`

Displays a × button that lets the user close the toast manually.

```js
GeoLeaf.Notifications.warning("Update available", {
    persistent: true,
    dismissible: true, // user can dismiss
});
```

---

## Internal architecture — Priority queue

### Priorities

| Type               | Priority   |
| ------------------ | ---------- |
| `error`            | 3 (high)   |
| `warning`          | 2 (medium) |
| `success` / `info` | 1 (low)    |

### Queue behaviour

- **Limit**: 15 pending notifications at most
- **Eviction**: the lowest-priority entries are dropped when the queue is full
- **Counters**: 3 temporary toasts and 2 persistent toasts visible at the same time, at most

### Display flow

1. Toast added with a priority derived from its type
2. Queue sorted by priority (desc) then timestamp (asc)
3. Toasts displayed as slots become available
4. **Reordering**: when an `error` arrives while the queue is full, an `info`/`success` toast is removed with a `slideUp` animation
5. **Eviction**: when 15 toasts are pending, the lowest-priority one is dropped

### Behaviour example

```js
// Initial state: 3 info toasts visible + 5 queued
GeoLeaf.Notifications.info("Info 1");
GeoLeaf.Notifications.info("Info 2");
GeoLeaf.Notifications.info("Info 3");
// ... 5 more queued

// A priority error arrives
GeoLeaf.Notifications.error("Critical error");

// Result:
// - 1 info toast removed with slideUp animation
// - Error displayed immediately
// - 2 info toasts remain visible
```

---

## DOM structure and CSS classes

### Generated DOM structure

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center">
    <div class="gl-toast gl-toast--success gl-toast--visible" role="alert" aria-live="polite">
        <span class="gl-toast__message">Success message</span>
        <button class="gl-toast__close" aria-label="Close">×</button>
    </div>
</div>
```

### Required HTML container

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center"></div>
```

### Main classes

| Class                              | Description                             |
| ---------------------------------- | --------------------------------------- |
| `.gl-notifications`                | Fixed container                         |
| `.gl-notifications--bottom-center` | Position variant                        |
| `.gl-toast`                        | Individual toast                        |
| `.gl-toast--visible`               | Visible state (opacity: 1)              |
| `.gl-toast--removing`              | Exit animation                          |
| `.gl-toast--sliding-up`            | Reordering animation (evicted toast)    |
| `.gl-toast--sliding-down`          | Reordering animation (toast moved down) |
| `.gl-toast--success`               | Success type (green)                    |
| `.gl-toast--error`                 | Error type (red)                        |
| `.gl-toast--warning`               | Warning type (orange)                   |
| `.gl-toast--info`                  | Info type (blue)                        |
| `.gl-toast__message`               | Message content                         |
| `.gl-toast__close`                 | Close button                            |

### Available positions

- `bottom-center` (default, recommended)
- `top-right`
- `bottom-right`
- `top-center`

### CSS animations

```css
/* Slide-up animation (toast evicted by higher priority) */
@keyframes slideUp {
    from {
        transform: translateY(0);
        opacity: 1;
    }
    to {
        transform: translateY(-100%);
        opacity: 0;
    }
}

/* Slide-down animation (toast moved down in stack) */
@keyframes slideDown {
    from {
        transform: translateY(-20px);
        opacity: 0.5;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}
```

---

## Telemetry integration

The system records metrics automatically through `GeoLeaf.Storage.Telemetry` when that module is available.

| Metric                          | Description                        | Type    |
| ------------------------------- | ---------------------------------- | ------- |
| `notification.shown.success`    | Success toasts displayed           | Counter |
| `notification.shown.error`      | Error toasts displayed             | Counter |
| `notification.shown.warning`    | Warning toasts displayed           | Counter |
| `notification.shown.info`       | Info toasts displayed              | Counter |
| `notification.dismissed.manual` | Manual close (× click)             | Counter |
| `notification.dismissed.auto`   | Automatic close (timeout)          | Counter |
| `notification.queued`           | Additions to the queue             | Counter |
| `notification.dropped`          | Notifications evicted (queue full) | Counter |

**Start-up buffer**: when `Telemetry` is not loaded yet, metrics are buffered for 30 seconds, then:

- Flushed automatically if `Telemetry` becomes available
- Discarded after 30 s if `Telemetry` never loads (avoids memory leaks)

---

## Integration examples

### Hook on a layer toggle event

```js
document.addEventListener("geoleaf:layer:toggle", (e) => {
    const { layerId, visible } = e.detail;
    if (visible) {
        GeoLeaf.notify(`Layer "${layerId}" enabled`, "info", 2000);
    }
});
```

### Hook on a layer loading error

```js
document.addEventListener("geoleaf:layer:error", (e) => {
    GeoLeaf.Notifications.error(`Unable to load layer "${e.detail.layerId}"`, {
        persistent: true,
        dismissible: true,
    });
});
```

### Notification after adding a POI (AddPOI plugin)

```js
document.addEventListener("geoleaf:poi:added", (e) => {
    GeoLeaf.Notifications.success(`POI "${e.detail.name}" added successfully`);
});
```

### Offline cache (Storage plugin)

```js
// Download success
GeoLeaf.Notifications.success(`Profile downloaded: ${sizeMB} MB`, 4000);

// Storage error
GeoLeaf.Notifications.error("Offline storage unavailable", 5000);

// Download stopped
GeoLeaf.Notifications.warning("Download stopped", 3000);
```

### POI synchronisation

```js
// Start info (persistent)
GeoLeaf.Notifications.info("Synchronisation in progress...", {
    persistent: true,
    dismissible: false,
});

// Conditional success/warning
if (results.failed > 0) {
    GeoLeaf.Notifications.warning(
        `Sync finished: ${results.synced} succeeded, ${results.failed} failed`,
        5000
    );
} else {
    GeoLeaf.Notifications.success(`Sync finished: ${results.synced} succeeded`, 5000);
}
```

### Checking the system before notifying

```js
const status = GeoLeaf.Notifications.getStatus();

if (status.initialized && status.enabled) {
    GeoLeaf.Notifications.info("Notification system operational");
} else {
    console.warn("[GeoLeaf] Notifications unavailable", status);
}
```

---

## Accessibility

- `role="alert"` on every toast
- `aria-live="assertive"` for errors and priority toasts
- `aria-live="polite"` for success/warning/info
- `aria-label` on the close button
- `prefers-reduced-motion` support (transitions disabled when requested)
- Focus management (`:focus-within`)

```css
@media (prefers-reduced-motion: reduce) {
    .gl-toast,
    .gl-notifications {
        transition: none !important;
    }
}
```

---

## Responsive (mobile)

On mobile (< 768 px) toasts span the full width of the screen:

```css
@media (max-width: 768px) {
    .gl-notifications--bottom-center {
        left: 10px;
        right: 10px;
        transform: none;
    }
}
```

---

## Debugging

```js
// Check current state
console.log(GeoLeaf.Notifications.getStatus());

// Test queue behavior
for (let i = 0; i < 20; i++) {
    GeoLeaf.Notifications.info(`Test ${i}`);
}
// Expected: 3 visible, 12 queued, 5 dropped

// Check Telemetry metrics
if (GeoLeaf.Storage?.Telemetry) {
    const report = GeoLeaf.Storage.Telemetry.getMetricsReport();
    console.log("Notification metrics:", report);
}
```

---

## Security notes

::: warning

Messages passed to `GeoLeaf.notify()` are handled as **plain text** — they are inserted through `textContent`, never `innerHTML`.

When a message is built from user input or an external source, never inject HTML into it. GeoLeaf guards against XSS injection at its own level, but composing the message remains the integrator's responsibility.

:::

```js
// Correct — static text or trusted source
GeoLeaf.notify("Connection restored", "success");

// Correct — internal GeoLeaf data
GeoLeaf.notify(`POI "${poi.name}" loaded`, "success");

// Avoid — raw HTML from user input
GeoLeaf.notify(`<b>${userInput}</b>`, "info"); // do not do this
```

---

**Related documentation:**

- [GeoLeaf_UI_README.md](../ui/GeoLeaf_UI_README.md) — Main UI module
- [EVENTS_API.md](../EVENTS_API.md) — System events
