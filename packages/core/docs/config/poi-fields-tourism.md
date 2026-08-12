---
title: "GeoLeaf – tourism profile"
---

# GeoLeaf – `tourism` profile

## Specification of the opening hours, price and traveller review fields

### Accordion section handling (mobile UI)

---

This document defines the **official format** of the fields used by the `tourism` business profile for POIs (MyLatinTrip, general tourism):

- `attributes.openingHours`
- `attributes.price`
- `attributes.reviews`
- UI layout options: `accordion` and `defaultOpen`

These formats are the reference for:

- **generating** the data (backend, Odoo, API),
- **rendering** in the GeoLeaf side panel (`poiProfiles.tourism.layout`),
- mobile-optimised display through **collapsible panels (accordions)**.

---

## 0. Accordion system (mobile optimisation)

Rich or long sections of the tourism profile can be displayed as **collapsible** panels (accordions) in the side panel.

Two UI options are supported in every entry of `poiProfiles.tourism.layout`:

```json
{
    "accordion": true,
    "defaultOpen": false
}
```

- `accordion: true` → tells the UI engine to render the section inside a collapsible panel.
- `defaultOpen: false` → the section is collapsed by default (recommended on mobile).

### Sections concerned (official GeoLeaf reference)

| Section              | Source field                 | Accordion recommended |
| -------------------- | ---------------------------- | --------------------- |
| Detailed description | `attributes.longDescription` | Yes                   |
| Opening hours        | `attributes.openingHours`    | Yes                   |
| Prices               | `attributes.price`           | Yes                   |
| Photo gallery        | `attributes.gallery`         | Yes                   |
| Traveller reviews    | `attributes.reviews`         | Yes                   |

**Purpose:**

- improve navigation on mobile,
- avoid excessive scrolling,
- keep the side panel readable even with rich content.

---

## 1. `attributes.openingHours` field

### 1.1. Level 1 – Free text (universal fallback)

The simplest accepted format is a **string**. In that case GeoLeaf displays the text as it is.

- Type: `string`
- Examples:

```jsonc
"openingHours": "Open daily 9am-6pm"
```

```jsonc
"openingHours": "By reservation only"
```

---

### 1.2. Level 2 – Structured weekly format

A structured format makes the information usable (future sorting, filtering by open day, and so on).

- Type: `object`
- Keys:

| Key        | Type     | Required | Description                                                       |
| ---------- | -------- | -------- | ----------------------------------------------------------------- |
| `timezone` | `string` | Yes      | IANA time zone (for example `"America/Argentina/Cordoba"`).       |
| `note`     | `string` | No       | Optional general note (seasonal closures, conditions, and so on). |
| `rows`     | `array`  | Yes      | List of opening ranges per group of days.                         |

#### Structure of `rows`

Each `rows[i]` entry is an object:

| Key     | Type       | Required | Description                                                                   |
| ------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| `days`  | `string[]` | Yes      | Days covered (`"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"`). |
| `open`  | `string`   | Yes      | Opening time in `HH:MM` format (24h).                                         |
| `close` | `string`   | Yes      | Closing time in `HH:MM` format (24h).                                         |
| `note`  | `string`   | No       | Specific detail for the range (for example "high season", "by reservation").  |

#### Full example

```jsonc
"openingHours": {
  "timezone": "America/Argentina/Cordoba",
  "note": "Closed on national public holidays.",
  "rows": [
    {
      "days": ["mon", "tue", "wed", "thu", "fri"],
      "open": "09:00",
      "close": "18:00",
      "note": "Standard hours."
    },
    {
      "days": ["sat"],
      "open": "10:00",
      "close": "16:00"
    },
    {
      "days": ["sun"],
      "open": "00:00",
      "close": "00:00",
      "note": "Closed on Sundays."
    }
  ]
}
```

---

## 2. `attributes.price` field

### 2.1. Level 1 – Free text (universal fallback)

```jsonc
"price": "From 25,000 ARS / night"
```

```jsonc
"price": "Free, donations welcome"
```

---

### 2.2. Level 2 – Structured price format

- Type: `object`

| Key        | Type     | Required | Description                        |
| ---------- | -------- | -------- | ---------------------------------- |
| `currency` | `string` | Yes      | ISO 4217 code                      |
| `from`     | `number` | Yes      | Minimum price                      |
| `to`       | `number` | No       | Maximum price                      |
| `unit`     | `string` | Yes      | Unit (per_night, per_person, etc.) |
| `note`     | `string` | No       | Additional information             |

#### Example

```jsonc
"price": {
  "currency": "ARS",
  "from": 25000,
  "to": 42000,
  "unit": "per_night",
  "note": "Indicative low-season rate, breakfast included."
}
```

---

## 3. `attributes.reviews` field

List of traveller reviews.

### Structure of a review

| Key          | Type     | Required |
| ------------ | -------- | -------- |
| `authorName` | `string` | Yes      |
| `rating`     | `number` | No       |
| `title`      | `string` | No       |
| `comment`    | `string` | Yes      |
| `date`       | `string` | No       |
| `source`     | `string` | No       |
| `language`   | `string` | No       |
| `url`        | `string` | No       |

#### Example

```jsonc
"reviews": [
  {
    "authorName": "Camille",
    "rating": 4.8,
    "title": "Incredible view over the valley",
    "comment": "Excellent welcome, clean and quiet room.",
    "date": "2025-03-12",
    "source": "internal",
    "language": "en-GB"
  }
]
```

---

## 4. Accordion in `poiProfiles.tourism.layout` (official excerpt)

```jsonc
{
  "type": "text",
  "label": "Detailed description",
  "field": "attributes.longDescription",
  "variant": "multiline",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "text",
  "label": "Opening hours",
  "field": "attributes.openingHours",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "text",
  "label": "Prices",
  "field": "attributes.price",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "gallery",
  "label": "Photo gallery",
  "field": "attributes.gallery",
  "accordion": true,
  "defaultOpen": false
},
{
  "type": "reviews",
  "label": "Traveller reviews",
  "field": "attributes.reviews",
  "accordion": true,
  "defaultOpen": false
}
```

---

## 5. Format summary

### openingHours

- `string` **or**
- `object { timezone, note?, rows[] }`

### price

- `string` **or**
- `object { currency, from, to?, unit, note? }`

### reviews

- `array` of `{ authorName, rating?, title?, comment, date?, source?, language?, url? }` objects

### Accordion UI

- `accordion: true`
- `defaultOpen: false`

---

This document is the **official GeoLeaf reference** for the `tourism` profile and its side-panel presentation.
