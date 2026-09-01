# @geoleaf-plugins/navigation

Turn-by-turn guidance plugin for [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js). It follows
the user's position along a route computed by [`@geoleaf-plugins/routing`](https://www.npmjs.com/package/@geoleaf-plugins/routing),
announces the next manoeuvre, and recomputes when the user leaves the path.

> **Status** — This package is a **shell**. It mounts its namespace and declares its contract; it
> guides no one yet. `GeoLeaf.Navigation.getConfig()` is the only method that exists today.
> This paragraph disappears when it stops being true.

---

## Installation

```bash
npm install @geoleaf-plugins/navigation @geoleaf-plugins/routing
```

> **Note** — Prerequisites: `@geoleaf/core` and `@geoleaf-plugins/routing` must both be loaded
> before this plugin. Guidance without a computed route has no object, and the plugin declares
> that dependency rather than discovering it at runtime.

---

## Quick start

```js
import "@geoleaf-plugins/routing";
import "@geoleaf-plugins/navigation";

// After GeoLeaf.boot() — GeoLeaf.Navigation is available on globalThis.GeoLeaf
const cfg = GeoLeaf.Navigation.getConfig();
```

Unlike `routing`, this plugin is meant to be **loaded on demand**. Guidance is only ever entered
after a route has been computed — that is, from an interface already drawn by a plugin already
loaded — so the constraint that forces `routing` to load eagerly does not apply here, and this is
the heavier half of the two.

---

## Configuration — `modules.navigation`

| Key                       | Type      | Default | Meaning                                                            |
| ------------------------- | --------- | ------- | ------------------------------------------------------------------ |
| `enabled`                 | `boolean` | `true`  | Turns the plugin on.                                               |
| `showButton`              | `boolean` | `false` | Shows the toolbar entry point.                                     |
| `arrivalRadiusMetres`     | `number`  | `30`    | Within this distance, a stop counts as reached.                    |
| `offRouteThresholdMetres` | `number`  | `40`    | Beyond this distance from the line, a reading counts as off-route. |
| `confirmExit`             | `number`  | `3`     | Consecutive off readings needed to confirm a departure.            |
| `confirmReturn`           | `number`  | `2`     | Consecutive on readings needed to confirm a return.                |
| `retryAfterFixes`         | `number`  | `2`     | Fixes to wait before the first retry after a failed recomputation. |
| `maxRetryFixes`           | `number`  | `8`     | Ceiling on that wait, which doubles on each failure.               |
| `voiceEnabled`            | `boolean` | `true`  | Starting state of spoken announcements — switchable in session.    |
| `voiceAnnounceAtMetres`   | `number`  | `200`   | How far ahead a manoeuvre is first announced.                      |
| `keepScreenAwake`         | `boolean` | `true`  | Keeps the screen on while guidance runs.                           |
| `followZoom`              | `number`  | `17.5`  | Zoom held while following. Re-applied on every fix.                |
| `followPitch`             | `number`  | `60`    | Tilt held while following, in degrees. Capped at 80 by the engine. |
| `cameraMaxTransitionMs`   | `number`  | `1000`  | Ceiling on a camera transition, in milliseconds.                   |

`showButton` defaults to `false` while there is no panel to open: a visible control that does
nothing is worse than an absent one, because it does not announce itself — it gets clicked.
Guidance is entered from the **route**, in the panel of `@geoleaf-plugins/routing`, because there
is nothing to guide along until a route exists.

🛑 **These thresholds live here and nowhere else.** The engine modules take every one of them as a
parameter and default none: a value written both in configuration and in the module that reads it
diverges from the configuration without anything turning red, on a quantity nobody re-measures
because both sides look authoritative.

⚠️ **An out-of-range value falls back to its default — it is neither honoured nor thrown on.**
`confirmExit: 0` is not a shorter confirmation, it is the ABSENCE of one: every noisy reading would
become a confirmed departure, and a provider quota measured in requests per minute empties in
minutes. `offRouteThresholdMetres` must also stay wider than `arrivalRadiusMetres` — a vehicle
parked at a delivery is routinely further from the road than from the stop, and the two crossing
would make every arrival read as a departure.

---

## Platform access is confined to three adapters

The plugin reaches `navigator.geolocation`, `speechSynthesis`, `navigator.wakeLock` and the
`online` event **only** from `src/platform/`. Everywhere else it consumes an adapter.

⚠️ The repository's gate names the first three; the `online` listener lives there too, although
nothing forces it. The property being protected is not the gate's list — it is that a native port
replaces those files and nothing else. A fourth browser API reached from elsewhere would break that
while the gate stayed **green**, which is worse than having no gate at all.

This is the one structural property worth knowing about this package: it makes a later native port
a matter of replacing three files rather than re-reading the plugin. The rule is enforced by a
gate in the repository, not left to review.

---

## Spoken guidance

A manoeuvre is announced once, when the driver comes within `voiceAnnounceAtMetres` of it. The
starting state is `voiceEnabled`; it is switchable for the running session:

```js
GeoLeaf.Navigation.setVoiceEnabled(false); // silences what is speaking, too
GeoLeaf.Navigation.isVoiceEnabled();
GeoLeaf.Navigation.isVoiceAvailable(); // hide your toggle when this is false
```

The switch is **session-scoped by contract**: every session starts again from the profile value.
And `isVoiceAvailable()` exists so an interface can HIDE its toggle rather than grey it out — an
engine without speech synthesis does not have the feature, and a greyed control says "this exists,
but not for you", which is false.

⚠️ Turning announcements off **cancels what is already speaking**. A switch that only stopped
future announcements would leave someone who just asked for quiet listening to the next twenty
seconds of instructions — which reads as a control that does not work.

---

## The screen stays awake

With `keepScreenAwake` (the default), guidance holds a screen wake lock for the length of a
session, and **re-takes it every time the page becomes visible again**. That second half is the
one that matters: browsers release the lock whenever the document is hidden — a call, a glance at
a message, a locked phone — and coming back does not restore it. An implementation that asks once
passes every test and lets the screen go dark in traffic.

The lock is a comfort and never a prerequisite: it is refused on an insecure origin, on a low
battery, under a policy. Guidance never waits on it and never warns about it.

---

## License

MIT © 2026 Mattieu Pottier
