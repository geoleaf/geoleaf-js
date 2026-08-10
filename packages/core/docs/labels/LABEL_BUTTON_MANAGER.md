---
title: "Label Button Manager"
---

# Label Button Manager

Product Version: GeoLeaf Platform V3

**Module:** `packages/core/src/modules/optional/labels/label-button-manager.ts`
**Version:** 3.0.0
**Last Updated:** March 2026

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

#### `sync(layerId)` — ⚠️ **n'existe pas**

> ⚠️ **Ce membre n'a jamais existé sur la surface publique.** Mesuré le 30/07/2026 :
> `_LabelButtonManager` expose `createButton`, `syncImmediate`, `removeButtons` et les privés
> `_doSync` / `_getState` / `_applyState`. **Aucun `sync`.** Les deux appelants réels du dépôt
> (`kernel/themes/theme-applier/visibility.ts`) utilisent `syncImmediate`.
>
> La voie **débouncée** décrite ci-dessous existe bien — c'est `_doSync`, **privée**. Un
> appelant externe n'a que `syncImmediate`.
>
> Rien ne pouvait le signaler : le global déclare `_LabelButtonManager?: unknown`, donc aucun
> appel qui passe par lui n'est typé (**B-13**), et les gates d'exemples ne reconnaissent pas
> cette forme (**B-78**).

**Comportement de `_doSync` (privé)** : annule le sync en attente pour cette couche, en
replanifie un après 300 ms, et évite les mises à jour DOM en rafale.

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

- Timeout created on a `_doSync()` call — **privé**, interne au module
- Timeout cancelled if a new `_doSync()` is called before execution
- Timeout deleted after execution or cancellation

⚠️ Ces trois lignes ont nommé `sync()` jusqu'au 09/08/2026. **Ce membre n'existe pas** — la
voie débouncée est `_doSync`, privée. Un appelant externe n'a que `syncImmediate()`, qui
**annule** le timeout au lieu d'en créer un.

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
| ✅            | ✅            | Enabled, can click |
| ✅            | ❌            | Disabled, grayed   |
| ❌            | ✅            | Disabled, grayed   |
| ❌            | ❌            | Disabled, grayed   |

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

    // Sync label button — `syncImmediate` est la SEULE voie publique ; la variante
    // débouncée (`_doSync`) est privée.
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
    - `_doSync()` (privé) debounces updates (300 ms)
    - `syncImmediate()` — la seule voie publique — executes without delay
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

### Quelle méthode appeler

⚠️ **Il n'y a qu'une méthode publique de synchronisation : `syncImmediate()`.** La colonne
« débouncé » ci-dessous décrit `_doSync`, qui est **privée** — un appelant externe ne l'atteint
pas. Le tableau distingue donc l'INTENTION, pas deux points d'entrée.

| Scénario                        | Voie                    | Motif                                     |
| ------------------------------- | ----------------------- | ----------------------------------------- |
| Fichier de style chargé         | `syncImmediate()`       | Non urgent, mais c'est la seule voie      |
| Thème changé                    | `syncImmediate()`       | Ce que fait `theme-applier/visibility.ts` |
| Config mise à jour              | `syncImmediate()`       | Idem                                      |
| Bascule de visibilité de couche | `syncImmediate()`       | Action utilisateur, retour instantané     |
| Clic sur le bouton              | interne                 | Géré par le gestionnaire de clic          |
| Couche retirée de la carte      | `syncImmediate()`       | Changement d'état critique                |
| _(débounce 300 ms)_             | `_doSync()` — **privé** | Interne au module, pas une API            |

### Performance Tips

1. **Il n'y a qu'une voie publique : `syncImmediate()`**

    Le debounce (300 ms) existe, mais il est **interne** : il vit dans `_doSync`, qui est
    privé. Un intégrateur n'a donc **aucun moyen de débouncer** — grouper ses appels est la
    seule chose qu'il puisse faire de son côté.

    ```javascript
    // La seule voie publique, pour un lot comme pour un seul.
    layerIds.forEach((id) => manager.syncImmediate(id));
    ```

    ⚠️ **Ce bloc conseillait `sync()` en « Good » et `syncImmediate()` en « Bad » jusqu'au
    09/08/2026.** Le conseil était mort deux fois : `sync` n'existe pas, et la capacité qu'il
    vantait est inatteignable depuis l'extérieur. **Ne pas exposer `_doSync` pour sauver le
    conseil** — ce serait élargir la surface publique pour rattraper une phrase, alors que
    c'est documenter une capacité inatteignable qui a produit le défaut. Si le debounce doit
    devenir public un jour, ce sera une décision d'API, pas une correction de documentation.

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

---

**Last Updated:** March 2026
**Module Version:** 3.0.0
