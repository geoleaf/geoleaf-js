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
4. **Manage** debouncing to prevent excessive updates

### Key Design Principles

- **Single Responsibility**: One module handles ALL label button logic
- **Centralized State**: No scattered button management code
- **Debounced Updates**: 300ms debounce for non-critical updates
- **Immediate Sync**: Optional immediate updates for critical changes (layer visibility)
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
`sync()` is not part of the public surface. `_LabelButtonManager` exposes `createButton`,
`syncImmediate` and `removeButtons`, plus the private `_doSync` / `_getState` / `_applyState`.
There is no `sync`. Inside the core, `kernel/themes/theme-applier/visibility.ts` calls
`syncImmediate`.

The debounced path described below does exist, but it is `_doSync`, which is private. An external
caller only has `syncImmediate`.
:::

::: warning
`GeoLeafGlobal` declares `_LabelButtonManager?: unknown`, so calls made through it are not
type-checked: a wrong method name surfaces at runtime only.
:::

**Behaviour of `_doSync` (private)**: cancels the pending sync for that layer, schedules a new one
300 ms later, and avoids bursts of DOM updates.

**Use Cases:**

- Style file loaded
- Configuration updated
- Theme changed
- Non-critical state changes

---

#### `syncImmediate(layerId)`

Synchronizes button state immediately without debouncing.

**Parameters:**

- `layerId` (string, required) - Layer identifier

**Returns:** void

**Behavior:**

- Cancels any pending debounced sync
- Executes sync immediately
- Use for critical updates requiring instant feedback

**Example:**

```javascript
// Called after layer visibility toggle (urgent)
GeoLeaf._LabelButtonManager.syncImmediate("poi-restaurants");
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

### Button Registry

The module maintains internal state for each button:

```javascript
{
  _syncTimeouts: Map<layerId, timeoutId>
}
```

**Purpose:**

- Track pending debounced syncs
- Allow cancellation before execution
- Prevent duplicate updates

**Lifecycle:**

- Timeout created on a `_doSync()` call — private, internal to the module
- Timeout cancelled if a new `_doSync()` is called before execution
- Timeout deleted after execution or cancellation

::: warning
`sync()` does not exist. The debounced path is `_doSync`, which is private. An external caller
only has `syncImmediate()`, and that method **cancels** the timeout instead of creating one.
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

    // Sync label button — `syncImmediate` is the ONLY public path; the debounced
    // variant (`_doSync`) is private.
    if (GeoLeaf._LabelButtonManager) {
        GeoLeaf._LabelButtonManager.syncImmediate(layerId);
    }
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
    - `_doSync()` (private) debounces updates (300 ms)
    - `syncImmediate()` — the only public path — executes without delay
    - Cancels pending syncs correctly
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
There is only one public synchronisation method: `syncImmediate()`. The "debounced" row below
describes `_doSync`, which is private and unreachable from outside. The table therefore separates
intents, not two entry points.
:::

| Scenario                   | Path                  | Reason                                  |
| -------------------------- | --------------------- | --------------------------------------- |
| Style file loaded          | `syncImmediate()`     | Not urgent, but it is the only path     |
| Theme changed              | `syncImmediate()`     | What `theme-applier/visibility.ts` does |
| Configuration updated      | `syncImmediate()`     | Same                                    |
| Layer visibility toggled   | `syncImmediate()`     | User action, instant feedback           |
| Button clicked             | internal              | Handled by the click handler            |
| Layer removed from the map | `syncImmediate()`     | Critical state change                   |
| _(300 ms debounce)_        | `_doSync()` — private | Internal to the module, not an API      |

### Performance Tips

1. **There is a single public path: `syncImmediate()`**

    The 300 ms debounce exists, but it is internal: it lives in `_doSync`, which is private.
    An integrator therefore has no way to debounce, and grouping calls is the only measure
    available on the caller side.

    ```javascript
    // The only public path, for a batch as much as for a single layer.
    layerIds.forEach((id) => manager.syncImmediate(id));
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
