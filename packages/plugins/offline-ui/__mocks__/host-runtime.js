/**
 * Mock partiel de `@geoleaf/host-runtime` — routé par l'alias de `vitest.config.ts`.
 *
 * ## Pourquoi il remplace `__mocks__/field-renderer.js` (Sprint 6, S6b / B-144)
 *
 * La décision W3 a déplacé `confirmDialog` et `createFocusTrap` de `@geoleaf/field-renderer`
 * vers `@geoleaf/host-runtime`. Les cinq sources d'`offline-ui` qui les importaient ont suivi,
 * donc l'alias devait suivre aussi — sans quoi le VRAI `confirmDialog` serait chargé et
 * **ouvrirait une vraie modale** au milieu de la suite, exactement ce que l'ancien mock
 * empêchait.
 *
 * ## 🛑 Pourquoi il est PARTIEL, et pourquoi ça compte
 *
 * L'ancien mock pouvait tout remplacer : `offline-ui` n'utilisait que trois symboles de
 * `field-renderer`. De `host-runtime`, il en utilise **neuf** — `Log`, `tLabel`,
 * `coreConfigGet`, `getGeoLeaf`, `getUINotifications`, `fetchWithTimeout` en plus des deux
 * fonctions d'interface. Les remplacer tous par des stubs ferait passer les tests sur une
 * plomberie fictive.
 *
 * D'où la ré-export du module réel, **par un chemin relatif** : le specifier
 * `@geoleaf/host-runtime` est intercepté par l'alias, donc l'importer ici créerait une boucle.
 * Seuls les deux symboles d'interface sont surchargés.
 *
 * `vi` est un global vitest (`globals: true`). Les tests peuvent surcharger la valeur résolue :
 *   confirmDialog.mockResolvedValueOnce(false)
 */
export * from "../../../libs/host-runtime/src/index.ts";

const _fn = typeof vi !== "undefined" ? () => vi.fn() : () => () => {};

/** Résout `true` par défaut (l'utilisateur confirme). À surcharger par test. */
export const confirmDialog =
    typeof vi !== "undefined" ? vi.fn(() => Promise.resolve(true)) : () => Promise.resolve(true);

/** Piège de focus : `activate`/`deactivate` sont des no-ops en test. */
export const createFocusTrap = () => ({ activate: _fn(), deactivate: _fn() });
