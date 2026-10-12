# @geoleaf/field-renderer

> Generic field catalog, responsive modal and validators for GeoLeaf plugins.

**MIT** — published on npmjs.org

## Overview

Shared form-rendering package extracted from `@geoleaf-plugins/editor`.
Provides a catalogue of 23+ field components, a responsive modal/drawer, and a set of pure validators. Consumed by `@geoleaf-plugins/editor`.

## Usage

```ts
import { ComponentRegistry, createResponsiveModal, validators } from "@geoleaf/field-renderer";
```

## Requirements

- Nothing is required of the host page. Labels are read from `globalThis.GeoLeaf.I18n.getLabel(key)` when the host knows the key, else from the built-in catalogue in the active language, else the key itself is shown.
- Pure DOM library — no external runtime dependencies.
