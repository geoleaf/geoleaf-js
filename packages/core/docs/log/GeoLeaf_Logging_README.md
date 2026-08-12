---
title: "GeoLeaf.Log — Logging module documentation"
---

# GeoLeaf.Log — Logging module documentation

**Applies to**: @geoleaf/core v3.x

**Source**: `src/modules/utils/log/` (logger.ts, log-config.ts, index.ts)

---

The **GeoLeaf.Log** module provides the central logging system used by every GeoLeaf module.
It gives log messages consistent, filtered and configurable handling.

It also allows verbosity to be driven from the external JSON configuration (`logging.level`).

---

## 1. Functional role of GeoLeaf.Log

1. Centralise every log emitted by the GeoLeaf library.
2. Normalise message display with a type prefix: `[GeoLeaf.DEBUG]`, `[GeoLeaf.INFO]`, and so on.
3. Allow logs to be filtered by **verbosity level**: `"debug"`, `"info"`, `"warn"`, `"error"`.
4. Offer a single entry point to trace the internals of:
    - Core
    - Baselayers
    - UI
    - POI
    - GeoJSON
    - Route
    - Config
    - API
    - Legend
5. Integrate with the external JSON configuration to enable or disable log levels automatically.
6. Reduce noise in quiet mode (`quietMode`): repetitive messages are grouped and filtered.

---

## 2. Public API of the Logging module

The module exposes four log levels, control methods and a quiet mode:

- `GeoLeaf.Log.debug(...args)`
- `GeoLeaf.Log.info(...args)`
- `GeoLeaf.Log.warn(...args)`
- `GeoLeaf.Log.error(...args)`
- `GeoLeaf.Log.setLevel(level)`
- `GeoLeaf.Log.getLevel()`
- `GeoLeaf.Log.getLevelName()`
- `GeoLeaf.Log.setQuietMode(enabled)`
- `GeoLeaf.Log.showSummary()`

---

## 3. `GeoLeaf.Log.debug(...args)`

Prints a detailed message for development.

```js
GeoLeaf.Log.debug("[GeoLeaf.POI] Loading POIs…");
```

### Usage

- Tracking intermediate values
- Following internal flows
- In-depth debugging

### Filtering

Printed only when `logging.level = "debug"`.

---

## 4. `GeoLeaf.Log.info(...args)`

Standard information message.

```js
GeoLeaf.Log.info("[GeoLeaf.Core] Map initialized.");
```

### Usage

- Successful initialisation
- Configuration loading
- Non-critical changes

### Filtering

Printed when the level is:

- `"debug"`
- `"info"`

---

## 5. `GeoLeaf.Log.warn(...args)`

Non-blocking warning message.

```js
GeoLeaf.Log.warn("[GeoLeaf.Config] Missing 'basemap.id' key, falling back to 'street'.");
```

### Usage

- Partial configuration
- Missing but non-critical data
- Automatic fallback

### Filtering

Printed when the level is:

- `"debug"`
- `"info"`
- `"warn"`

---

## 6. `GeoLeaf.Log.error(...args)`

Critical error message.

```js
GeoLeaf.Log.error("[GeoLeaf.Config] Failed to load the configuration.");
```

### Usage

- Blocking errors
- Modules left uninitialised
- Serious problems

### Filtering

Always printed, including when `logging.level = "error"`.

---

## 7. `GeoLeaf.Log.setLevel(level)`

Changes the global log level at runtime.

```js
GeoLeaf.Log.setLevel("debug");
```

### Accepted values

| Value          | Behaviour                                           |
| -------------- | --------------------------------------------------- |
| `"debug"`      | Every message is printed                            |
| `"info"`       | info, warn, error                                   |
| `"warn"`       | warn and error only                                 |
| `"error"`      | error only                                          |
| `"production"` | warn + error, and `quietMode` enabled automatically |

This function is called automatically by `GeoLeaf.Config` when the JSON file contains:

```json
{
    "logging": { "level": "debug" }
}
```

---

## 8. `GeoLeaf.Log.getLevel()`

Returns the numeric level currently active.

```js
const level = GeoLeaf.Log.getLevel();
// Returns: 0 (DEBUG) | 1 (INFO) | 2 (WARN) | 3 (ERROR)
```

---

## 9. `GeoLeaf.Log.getLevelName()`

Returns the name of the active level.

```js
const name = GeoLeaf.Log.getLevelName();
// Returns: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
```

---

## 10. `GeoLeaf.Log.setQuietMode(enabled)`

Enables or disables quiet mode. In quiet mode:

- Repetitive messages are grouped (printed twice, then hidden)
- A summary message states that messages have been filtered out
- Critical messages (containing `Error`, `Failed`, `WARN`, and so on) are always printed

```js
GeoLeaf.Log.setQuietMode(true);
// [GeoLeaf.INFO] Silent mode activated - repetitive logs reduced
```

> The `"production"` level enables `quietMode` automatically.

---

## 11. `GeoLeaf.Log.showSummary()`

Prints a recap of the grouped messages (useful at the end of a debugging session).

```js
GeoLeaf.Log.showSummary();
// [GeoLeaf.INFO] Grouped log summary
// • 12x: Module loaded...
// • 8x: Profile loaded...
```

---

## 12. Exposed constants

### `LEVELS`

Available numeric levels:

```js
import { LEVELS } from "@geoleaf/core";
// { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
```

---

## 13. Integration with JSON configuration

### Example

```json
{
    "map": {
        "target": "geoleaf-map",
        "center": [-32.95, -60.65],
        "zoom": 12
    },
    "logging": {
        "level": "warn"
    }
}
```

### How it works

1. `GeoLeaf.Config.load()` loads the JSON.
2. The module detects the `logging.level` key.
3. `GeoLeaf.Log.setLevel("warn")` is called automatically.
4. Every log below that level is filtered out.

---

## 14. Typical usage sequence

### A. Directly from code

```js
GeoLeaf.Log.setLevel("debug");

GeoLeaf.Log.debug("Internal details…");
GeoLeaf.Log.info("Initialization OK.");
GeoLeaf.Log.warn("Missing data, falling back.");
GeoLeaf.Log.error("Critical error.");
```

### B. Through JSON configuration

```js
GeoLeaf.loadConfig("./data/config.json", {
    autoInit: true,
});
```

In that case, no `GeoLeaf.Log.setLevel()` call needs to be written in external code.

### C. Production mode

```js
GeoLeaf.Log.setLevel("production");
// Equivalent to: setLevel('warn') + setQuietMode(true)
```

---

## 15. Quick summary of the Logging API

| Method               | Role                                             |
| -------------------- | ------------------------------------------------ |
| `debug()`            | Detailed messages (development only)             |
| `info()`             | Standard messages                                |
| `warn()`             | Warnings                                         |
| `error()`            | Critical errors                                  |
| `setLevel(level)`    | Changes the active level                         |
| `getLevel()`         | Returns the active level (numeric)               |
| `getLevelName()`     | Returns the active level (string)                |
| `setQuietMode(bool)` | Enables quiet mode (filters repetitive messages) |
| `showSummary()`      | Prints the recap of grouped messages             |

---

## 16. Best practices

### In development

- Always use `"debug"` to see everything.
- Add detailed logs in the areas being debugged.

### In staging

- Switch to `"info"` or `"warn"`.

### In production

- Use `"warn"`, `"error"` or `"production"` only.
- The `"production"` level enables `quietMode` and reduces noise automatically.

### Recommended log style

Always prefix logs with the calling module:

```
[GeoLeaf.Core]
[GeoLeaf.Config]
[GeoLeaf.POI]
[GeoLeaf.GeoJSON]
…
```

This keeps debugging immediate and structured in the browser console.

---

## 17. Internal architecture

```
utils/log/
├── index.ts      ← Barrel export: Log, LEVELS, configureLogging
├── logger.ts     ← Implementation: Log (Proxy), _LogImpl, LEVELS, quietMode, grouping
└── log-config.ts ← configureLogging() (integration with the JSON config)
```

The exported `Log` is a **Proxy** over `_LogImpl`. That indirection lets tests override
`global.GeoLeaf.Log` with a mock without touching the imports of the source modules.

---

## 18. Tests

```bash
npm test -- log

# Test files
# packages/core/__tests__/log/
```

---

## See also

- `GeoLeaf.Errors` — typed errors logged through `GeoLeaf.Log.error()`
- `GeoLeaf.Config` — calls `GeoLeaf.Log.setLevel()` while loading the profile
