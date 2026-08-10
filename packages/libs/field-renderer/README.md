# @geoleaf/field-renderer

> Generic field catalog, responsive modal, focus-trap and validators for GeoLeaf plugins.

**MIT** — published on npmjs.org

## Overview

Shared form-rendering package extracted from `@geoleaf-plugins/editor`.
Provides a catalogue of 23+ field components, a responsive modal/drawer, focus-trap, and a set of pure validators. Consumed by `@geoleaf-plugins/editor`.

## Usage

```ts
import { ComponentRegistry, createResponsiveModal, validators } from "@geoleaf/field-renderer";
```

## Requirements

- Host page must expose `globalThis.GeoLeaf.I18n.t(key)` for label resolution (falls back to the key itself).
- Pure DOM library — no external runtime dependencies.
