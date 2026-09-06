---
title: "Label Button Manager"
---

# Label Button Manager

**Module:** `packages/core/src/modules/optional/labels/label-button-manager.ts`

## Table of Contents

1. [Purpose & Architecture](#purpose--architecture)
2. [API Reference](#api-reference)
3. [State Management](#state-management)
4. [Decision Logic](#decision-logic)
5. [Integration Examples](#integration-examples)
6. [Testing](#testing)

---

## Purpose & Architecture

### Overview

The **Label Button Manager** is a centralized controller for label toggle buttons in the Layer Manager. It provides a single source of truth for button creation, state synchronization, and decision logic.

### Responsibilities

1. **Create** label buttons during first render of a layer in Layer Manager
2. **Synchronize** button state (enabled/disabled, active/inactive)
3. **Apply** consistent decision logic across all layers

### Key Design Principles

- **Single Responsibility**: One module handles ALL label button logic
- **Stateless**: nothing is cached — each repaint derives the button from live state
- **Synchronous**: a repaint happens on the call, with no timer between the two
- **Defensive Coding**: Handles missing DOM elements gracefully

### Source file structure

```
optional/labels/
├── label-button-manager.ts       // Centralized button manager (this module)
├── labels.ts                     // Label rendering engine
└── label-renderer.ts             // Low-level label rendering
```

---

## API Reference

### Public Methods

#### `createButton(layerId, controlsContainer)`

Creates a label button for a layer during first render.

**Parameters:**

- `layerId` (string, required) - Layer identifier
- `controlsContainer` (HTMLElement, required) - DOM container for layer controls

**Returns:**

- `HTMLElement` - The created button element
- `null` - If parameters are missing or creation fails

**Behavior:**

- Checks if button already exists (prevents duplicates)
- Creates button with label icon
- Uses i18n key `aria.labels.toggle` for `aria-label` and `title`
- Attaches click handler for label toggle
- Inserts button before visibility toggle in controls
- Initially disabled until first sync

**Example:**

```javascript
// Called by Layer Manager during first render
const button = GeoLeaf._LabelButtonManager.createButton("poi-restaurants", controlsContainer);
```

**DOM Structure:**

```html
<button
    class="gl-layer-manager__label-toggle gl-layer-manager__label-toggle--disabled"
    type="button"
    disabled
    aria-label="Afficher/masquer les étiquettes"
    aria-pressed="false"
>
    <span class="gl-layer-manager__label-toggle-icon">🏷️</span>
</button>
```

---

#### `sync(layerId)` — does not exist

::: danger
`sync()` is not part of the surface. `_LabelButtonManager` exposes `createButton`,
`syncImmediate` and `removeButtons`, plus the private `_doSync` / `_getState` / `_applyState`.
There is no `sync`. Inside the core, `kernel/themes/theme-applier/visibility.ts` calls
`syncImmediate`.
:::

::: danger NO DEBOUNCE EXISTS — corrected 04/09/2026
This page described, in three places, a debounced path with a 300 ms timer and a
`_syncTimeouts` map. **None of it is in the code, and none of it ever was measured to be.**
`label-button-manager.ts` is 168 lines and contains no `setTimeout`, no `clearTimeout` and no
timer state at all; `_doSync` finds the button and repaints it, synchronously. Whoever read
this page and staggered their calls to avoid "bursts of DOM updates" was pacing around a
mechanism that does not exist.
:::

**Use Cases:**

- Style file loaded
- Configuration updated
- Theme changed
- Non-critical state changes

---

#### `syncImmediate(layerId)`

::: tip USE THE PUBLIC ROUTE — `GeoLeaf.Labels.syncLayerControl(layerId)`
Since 04/09/2026 this repaint has a **public** name. `_LabelButtonManager` is internal: it
exists on the mounted object, so the type contract has to declare it, but nothing promises it
survives a refactor. This page taught the internal key by name for a long time, which is how
integrators came to depend on it; the repository's migration table
(`docs/reference/consumers/INTERNAL_MEMBER_MIGRATION.md`) records the route for each
internal member. It is cited rather than linked on purpose: this page is built as part
of the documentation site, whose root stops at `packages/core/docs/`, so a link
climbing out of it resolves on disk and is dead in the published site.
The description below documents the internal method; the public route delegates to it.
:::

Synchronizes button state immediately.

**Parameters:**

- `layerId` (string, required) - Layer identifier

**Returns:** void

**Behavior:**

- Re-reads the layer's state and repaints the button, synchronously
- No-op on an empty `layerId`, or when the layer has no row on screen

**Example:**

```javascript
// Called after layer visibility toggle
GeoLeaf.Labels.syncLayerControl("poi-restaurants");
```

**Use Cases:**

- Layer visibility toggled
- User action requiring immediate visual feedback
- Critical state changes

---

### Internal Methods

#### `_doSync(layerId)` (private)

Executes the actual synchronization logic.

**Process:**

1. Find button in DOM (with fallback to create if missing)
2. Collect current state using `_getState()`
3. Apply state to button using `_applyState()`

**Fallback Behavior:**

- If button not found but layer item exists, creates button on-the-fly
- Logs debug messages for troubleshooting
- Handles missing DOM elements gracefully

---

#### `_getState(layerId)` (private)

Collects current state from all relevant components.

**Returns:**

```javascript
{
  layerId: "poi-restaurants",
  layerExists: true,
  layerVisible: true,
  labelEnabled: true,
  areLabelsActive: false
}
```

**State Properties:**

- `layerId` - Layer identifier
- `layerExists` - Layer found in `GeoJSONCore.getLayerById()`
- `layerVisible` - Layer visibility from `_visibility.current`
- `labelEnabled` - Style has `label.enabled: true`
- `areLabelsActive` - Labels currently displayed for this layer

**Dependencies:**

- `GeoJSONCore.getLayerById()` - Layer data access (internal module `built-in/geojson/core.ts`)
- `Labels.areLabelsEnabled()` - Label visibility status (internal module `optional/labels/labels.ts`)

---

#### `_applyState(button, state)` (private)

Applies decision logic to button based on collected state.

**Parameters:**

- `button` (HTMLButtonElement) - Button to update
- `state` (Object) - State from `_getState()`

**Decision Logic:**

```
Can Use Labels = layerVisible AND labelEnabled

IF Can Use Labels:
  - button.disabled = false
  - Remove "gl-layer-manager__label-toggle--disabled"
  - IF areLabelsActive AND layerVisible:
      - Add "gl-layer-manager__label-toggle--on"
      - aria-pressed = "true"
  - ELSE:
      - Remove "gl-layer-manager__label-toggle--on"
      - aria-pressed = "false"
ELSE:
  - button.disabled = true
  - Add "gl-layer-manager__label-toggle--disabled"
  - Remove "gl-layer-manager__label-toggle--on"
  - aria-pressed = "false"
```

**CSS Classes:**

- `gl-layer-manager__label-toggle` - Base class (always present)
- `gl-layer-manager__label-toggle--disabled` - Button is disabled (grayed out)
- `gl-layer-manager__label-toggle--on` - Labels are active (highlighted)

---

## State Management

### The module holds NO state

This section described a `_syncTimeouts: Map<layerId, timeoutId>` with a create / cancel /
delete lifecycle. **That map does not exist** (corrected 04/09/2026), and neither does the
debounce it served.

The module is stateless by design, which the [Key Design Principles](#key-design-principles)
above already said and this section contradicted: the button's appearance is derived, on each
call, from state read live elsewhere — see [State Sources](#state-sources) just below. Nothing
is cached, so nothing can go stale, and there is no pending work to cancel.

::: warning
`sync()` does not exist either. An external caller uses `GeoLeaf.Labels.syncLayerControl()`,
which repaints synchronously.
:::

---

### State Sources

The module does NOT store layer state. It queries live state from:

1. **`GeoJSONCore.getLayerById()`** (imported from `built-in/geojson/core.ts`)
    - `_visibility.current` - Layer visibility
    - `currentStyle.label.enabled` - Label configuration

2. **`Labels.areLabelsEnabled()`** (imported from `optional/labels/labels.ts`)
    - Current label visibility for layer

**Benefits:**

- Single source of truth (no synchronization issues)
- Always reflects latest state
- No stale data

---

## Decision Logic

### Rules

The button follows these **simple rules**:

1. **Button is ALWAYS visible** for all layers
2. **Button is clickable** IF:
    - Layer is visible (`_visibility.current = true`)
    - AND style has `label.enabled: true`
3. **Button is disabled (grayed)** IF:
    - Layer is hidden
    - OR style has `label.enabled: false`
4. **Button shows active state** IF:
    - Button is clickable
    - AND labels are currently displayed

### Visual States

| Layer Visible | label.enabled | Button State       |
| ------------- | ------------- | ------------------ |
| Yes           | Yes           | Enabled, can click |
| Yes           | No            | Disabled, grayed   |
| No            | Yes           | Disabled, grayed   |
| No            | No            | Disabled, grayed   |

### Flowchart

```
┌─────────────────┐
│  Button Render  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Is Layer ON?   │
└────────┬────────┘
         │
    ┌────┴────┐
    │ NO      │ YES
    ▼         ▼
┌──────┐  ┌──────────────────┐
│ Gray │  │ label.enabled?   │
│ OUT  │  └────────┬─────────┘
└──────┘           │
              ┌────┴────┐
              │ NO      │ YES
              ▼         ▼
          ┌──────┐  ┌──────────┐
          │ Gray │  │ ENABLED  │
          │ OUT  │  │ clickable│
          └──────┘  └─────┬────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ areLabelsOn?  │
                  └───────┬───────┘
                          │
                     ┌────┴────┐
                     │ NO      │ YES
                     ▼         ▼
                  ┌──────┐  ┌──────┐
                  │Normal│  │Active│
                  └──────┘  └──────┘
```

---

## Integration Examples

### Example 1: Layer Manager Initial Render

**File:** `built-in/layer-manager/renderer.ts`

```javascript
// During first render of layer in Layer Manager
function _renderLayerItem(layerId) {
    const layerItem = document.createElement("div");
    layerItem.classList.add("gl-layer-manager__item");
    layerItem.setAttribute("data-layer-id", layerId);

    const controls = document.createElement("div");
    controls.classList.add("gl-layer-manager__item-controls");

    // Create label button
    if (GeoLeaf._LabelButtonManager) {
        GeoLeaf._LabelButtonManager.createButton(layerId, controls);
    }

    // Create visibility toggle
    const visibilityToggle = _createVisibilityToggle(layerId);
    controls.appendChild(visibilityToggle);

    layerItem.appendChild(controls);
    return layerItem;
}
```

---

### Example 2: Style Loader Sync

**File:** `optional/labels/labels.ts`

```javascript
// After loading new style file
async function loadStyle(layerId, styleId) {
    const styleData = await fetchStyle(layerId, styleId);

    // Apply style to layer
    applyStyle(layerId, styleData);

    // Repaint the label control through the public route.
    GeoLeaf.Labels?.syncLayerControl(layerId);
}
```

---

### Example 3: Layer Visibility Toggle

**File:** `built-in/layer-manager/visibility-checker.ts`

```javascript
// User toggles layer visibility
function toggleLayerVisibility(layerId) {
    const layerData = GeoJSONCore.getLayerById(layerId);

    if (layerData._visibility.current) {
        // Hide MapLibre layer
        map.setLayoutProperty(layerId, "visibility", "none");
        layerData._visibility.current = false;
    } else {
        // Show MapLibre layer
        map.setLayoutProperty(layerId, "visibility", "visible");
        layerData._visibility.current = true;
    }

    // Sync label button IMMEDIATELY (urgent update)
    if (GeoLeaf._LabelButtonManager) {
        GeoLeaf._LabelButtonManager.syncImmediate(layerId);
    }
}
```

---

### Example 4: Label Toggle Click Handler

**Internal to createButton():**

```javascript
const onLabelToggle = function (ev) {
    ev.stopPropagation();
    ev.preventDefault();
    if (button.disabled) return;

    // Verify label.enabled in current style
    const layerData = GeoJSONCore.getLayerById(layerId);
    const labelEnabled = layerData?.currentStyle?.label?.enabled === true;

    if (!labelEnabled) return;

    // Toggle labels via Labels module
    const newState = Labels.toggleLabels(layerId);

    // Update button visual immediately
    if (newState) {
        button.classList.add("gl-layer-manager__label-toggle--on");
        button.setAttribute("aria-pressed", "true");
    } else {
        button.classList.remove("gl-layer-manager__label-toggle--on");
        button.setAttribute("aria-pressed", "false");
    }
};
```

---

## Testing

### Test File

**Location:** `packages/core/__tests__/labels/label-button-visibility.test.js`

### Test Coverage

The test suite covers:

1. **Button Creation**
    - Creates button with correct structure
    - Prevents duplicate buttons
    - Inserts button in correct position
    - Returns null for invalid parameters

2. **State Synchronization**
    - `_doSync()` (private) finds the button, reads the state, repaints
    - `syncImmediate()` delegates to it; `GeoLeaf.Labels.syncLayerControl()` is the public route
    - Handles missing buttons gracefully

3. **Decision Logic**
    - Button enabled when layer visible + label.enabled
    - Button disabled when layer hidden
    - Button disabled when label.enabled = false
    - Active state reflects label visibility

4. **Integration**
    - Works with Layer Manager render
    - Responds to visibility toggles
    - Updates on style changes
    - Handles missing GeoLeaf modules

### Running Tests

```bash
# Run all label tests
npm test -- labels

# Run button manager tests specifically
npm test -- label-button-visibility.test.js

# Run with coverage
npm run test:coverage
```

### Sample Test

```javascript
describe("LabelButtonManager", () => {
    test("button enabled when layer visible and label.enabled", () => {
        const layerId = "test-layer";

        // Setup layer
        mockLayer(layerId, {
            visible: true,
            style: { label: { enabled: true } },
        });

        // Create button
        const button = GeoLeaf._LabelButtonManager.createButton(layerId, container);

        // Sync state
        GeoLeaf._LabelButtonManager.syncImmediate(layerId);

        // Assertions
        expect(button.disabled).toBe(false);
        expect(button.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(false);
    });
});
```

---

## Best Practices

### Which method to call

::: warning
There is **one** synchronisation path, and every row below names the same one. This table used
to separate "urgent" from "debounced" scenarios; since the debounce does not exist, the
distinction it drew was between two intents, not two entry points — and it read as a choice.
:::

| Scenario                   | Path                        | Reason                                  |
| -------------------------- | --------------------------- | --------------------------------------- |
| Style file loaded          | `Labels.syncLayerControl()` | The public route                        |
| Theme changed              | `Labels.syncLayerControl()` | What `theme-applier/visibility.ts` does |
| Configuration updated      | `Labels.syncLayerControl()` | Same                                    |
| Layer visibility toggled   | `Labels.syncLayerControl()` | Same                                    |
| Button clicked             | internal                    | Handled by the click handler            |
| Layer removed from the map | `Labels.syncLayerControl()` | Same                                    |

### Performance Tips

1. **There is a single public path: `GeoLeaf.Labels.syncLayerControl()`**

    Each call repaints one layer's control on the spot — there is no timer anywhere in the
    module, so nothing coalesces a burst on your behalf. A repaint is a handful of DOM reads
    and class toggles on a single element, so a batch is cheap; if a caller ever needs to
    coalesce, that is the caller's own job.

    ```javascript
    // The public path, for a batch as much as for a single layer.
    layerIds.forEach((id) => GeoLeaf.Labels.syncLayerControl(id));
    ```

2. **Trust the decision logic**

    ```javascript
    // Do not manually disable/enable buttons
    // Let _applyState() handle it
    ```

### Debugging

**Enable debug logging:**

```javascript
GeoLeaf.Config.setDebug({
    enabled: true,
    modules: ["labels", "ui"],
});
```

**Check button state in console:**

```javascript
// Get button
const button = document.querySelector(
    '[data-layer-id="poi-restaurants"] .gl-layer-manager__label-toggle'
);

// Inspect state
console.log({
    disabled: button.disabled,
    classes: button.className,
    ariaPressed: button.getAttribute("aria-pressed"),
});

// Get layer state (internal)
const state = GeoLeaf._LabelButtonManager._getState("poi-restaurants");
console.log("Layer state:", state);
```

---

## Related Documentation

- **[Layer Manager](../layer-manager/GeoLeaf_LayerManager_README.md)** — Layer Manager integration
- **[GeoLeaf.Legend](../legend/GeoLeaf_Legend_README.md)** — Legend module
