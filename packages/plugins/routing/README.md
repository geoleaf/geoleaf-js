# @geoleaf-plugins/routing

Route computation plugin for [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js). It asks an
external routing provider for an itinerary between two or more points, and normalises the answer
into a single model whatever the provider.

> **Status** — This package is **not usable yet**. Its shell is published so that the API surface
> and the plugin contract are fixed in the open; route computation itself lands in a following
> release. `GeoLeaf.Routing.getConfig()` is the only method that exists today. This paragraph
> disappears when it stops being true.

---

## Installation

```bash
npm install @geoleaf-plugins/routing
```

> **Note** — Prerequisite: `@geoleaf/core` must be loaded before this plugin.

---

## Quick start

```js
import "@geoleaf-plugins/routing";

// After GeoLeaf.boot() — GeoLeaf.Routing is available on globalThis.GeoLeaf
const cfg = GeoLeaf.Routing.getConfig();
```

### Load it eagerly, not on demand

Import this plugin **before** `GeoLeaf.boot()`. It is deliberately the light half of the two
navigation packages, and lazy-loading it does not work the way it looks like it should: the
"Route to here" entry point is a profile-declared `action` widget whose visibility is gated on
`GeoLeaf.plugins.isLoaded()`. A lazily registered plugin only enters the registry once it has
loaded — so it would hide its own entry point, and nothing would ever trigger the load that
reveals it. No error is emitted; the button simply never appears.

---

## Attribution — read this before you ship

Both built-in engines route on **OpenStreetMap**. Its ODbL permits commercial use and requires
nothing to be shared back for a route drawn on a map — but it does require **attribution wherever
the derived work is shown**. A map displaying a computed itinerary without crediting the data is out
of compliance, and the party out of compliance is **the one shipping the map**.

So the plugin does it for you, and you should know how, in case you build your own interface:

- Every provider declares an `attribution`. It is **required**, and `createProvider()` **refuses** a
  provider whose attribution is missing or blank — it will log which one and return `null` rather
  than compute a route it cannot credit.
- `RouteResult.attribution` carries the credit for that route. It travels with the data rather than
  being read from configuration, because a route computed by one engine can still be on screen after
  you have pointed the profile at another.
- `publishRoute()` mounts the credit in the map container; `clearRoute()` removes it. If you publish
  the geometry yourself instead of using these, **the credit is yours to display**.
- `getProvider()` answers `{ id, attribution }` for the configured engine, or `null`.

Registering your own engine? Declare its credit:

```js
GeoLeaf.Routing.registerProvider("my-engine", (endpoint) => ({
    id: "my-engine",
    attribution: "© My data source",
    async route(request) {
        /* … */
    },
}));
```

⚠️ There is no default credit and there will not be one. Substituting
`"© OpenStreetMap contributors"` for an unknown engine would attribute data to a source that may not
have produced it — a false statement rather than a missing one.

## Configuration — `modules.routing`

| Key            | Type                 | Default           | Meaning                                                                                                                                         |
| -------------- | -------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `boolean`            | `true`            | Turns the plugin on.                                                                                                                            |
| `showButton`   | `boolean`            | `false`           | Shows the toolbar entry point.                                                                                                                  |
| `provider`     | `string`             | `"valhalla"`      | Which engine to query. An id with no registered adapter yields `null` — **never a silent substitution**.                                        |
| `endpoint`     | `string`             | `""`              | Base URL of the engine. Empty selects the provider's own default. A value that does not start with `https://` is **refused**, never downgraded. |
| `timeoutMs`    | `number`             | `10000`           | How long before the request is **aborted**. `≤ 0` or non-finite falls back to the default.                                                      |
| `maxWaypoints` | `number`             | `10`              | Cap on stops. Beyond it, adding is refused **with the limit named**.                                                                            |
| `profile`      | `string`             | `"car"`           | Travel mode: `car`, `foot` or `bike`. An unknown token **falls back** to `car` rather than reaching the engine.                                 |
| `layerId`      | `string`             | `"routing-route"` | The profile layer the computed route is published into.                                                                                         |
| `labelField`   | `string \| string[]` | `"name"`          | The feature property (or ordered list of candidates) carrying a stop's display name.                                                            |

`showButton` defaults to `false` on purpose while there is no panel to open: a visible control
that does nothing is worse than an absent one, because it does not announce itself — it gets
clicked.

🛑 **A LIST is accepted, and it is what a multi-layer profile needs.** The entry-point button is
declared PER LAYER in the profile, while this setting is global to the plugin — and layers rarely
agree on the name of their label. The first candidate that is present and non-empty wins; a plain
string still works and means a list of one. Guessing is still refused: taking "the first string
property" would name a destination after a status code.

⚠️ **`labelField` carries a constraint no schema expresses**: the property it names must ALSO be
listed in the `payloadFields` of the profile's `action` widget. With only one of the two, the event
arrives without the property and the destination has no name — a profile that is valid on both
sides and renders a silent panel.

```json
{
    "modules": {
        "routing": {
            "enabled": true,
            "showButton": false,
            "provider": "valhalla",
            "endpoint": "https://routing.example.org",
            "timeoutMs": 10000,
            "maxWaypoints": 10
        }
    }
}
```

---

## 🛑 An API key placed in a profile is publicly readable

A profile is **static JSON served to the browser**. Everything in it — including anything you put
in `endpoint` — reaches every visitor, and reaches them in a file they can open, save and share.
`https://routing.example.org/route?api_key=abc123` in a profile is not a configured secret: it is a
published one.

This is not a theoretical concern for this repository. Its own `deploy/` folder once shipped a
development token in a file that was `.gitignore`d and guarded against _execution_ on non-local
hosts — and a plain `curl` of the deployed URL still returned it in clear. Two safeguards, and an
angle between them: **a secret is read, it is not executed.**

⚠️ **A build-time environment variable is not an answer either.** Injected at build, it ends up in a
served file — the same exposure under another name.

**What to do instead, in order of preference:**

1. **Use an engine that needs no key.** Several public and self-hostable routing engines do not.
   `endpoint` exists precisely so you can point at your own.
2. **Put the key on a server you control**, and give `endpoint` the URL of a thin proxy that adds
   it. The browser then holds nothing.
3. **If the key must reach the browser, restrict it at the provider** — by HTTP referrer, by
   origin, and by quota. A restricted key that leaks costs you a quota; an unrestricted one costs
   you a bill.

⚠️ Restriction by referrer is a **mitigation, not a secret**: it makes the key useless from another
origin, it does not make it unreadable from yours. Treat a key in a profile as public, and choose it
so that being public is acceptable.

---

## Relationship to `@geoleaf-plugins/navigation`

Two packages, and the split is not arbitrary. Route computation is useful on its own — knowing the
distance and the path to a point does not require being guided along it. Turn-by-turn guidance, on
the other hand, is worthless without a route. **The dependency is asymmetric, so that is where the
boundary goes**, and a single package would make every consumer pay for a guidance runtime most of
them do not want.

`@geoleaf-plugins/navigation` depends on this package; the reverse is never true.

---

## License

MIT © 2026 Mattieu Pottier
