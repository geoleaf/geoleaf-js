/*!
 * GeoLeaf Core – Shared / Profile storage keys
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Web-storage keys of the profile choice — ONE declaration, because they have TWO writers.
 *
 * `boot-core` reads (and clears) these keys at startup to decide which profile boots, and
 * the profile-switcher capability writes them when the user switches. Until this module,
 * each side spelled the literals itself: `"gl-profile"` existed as an exported constant in
 * the capability AND as a raw string in the boot, and `"gl-selected-profile"` as three raw
 * strings across both. A key like this drifts in the worst possible way — a typo on one
 * side does not error, it makes the boot silently stop seeing the user's choice.
 *
 * The home is `kernel/shared/` because that is exactly what this directory is for: state
 * contracts shared across module boundaries, re-exported by the mediation barrel so a
 * capability never has to deep-import the kernel (ESLint boundary), and the app never has
 * to import a capability for a string.
 */

/** localStorage key holding the user's STANDING profile choice — survives the session. */
export const PROFILE_STORAGE_KEY = "gl-profile";

/**
 * sessionStorage key holding a ONE-SHOT profile selection for the next boot.
 *
 * Written by the switcher right before reload, consumed (read then removed) by `boot-core`:
 * the removal is what makes it one-shot, so a later manual reload falls back to the
 * standing choice above.
 */
export const SELECTED_PROFILE_STORAGE_KEY = "gl-selected-profile";
