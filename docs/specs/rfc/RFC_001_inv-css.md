# RFC-001 — INV-CSS : injection CSS des plugins compatible CSP stricte

**Statut :** Acceptée → Appliquée
**Date :** 21 juin 2026
**Auteur :** Mattieu Pottier
**Cible :** `PLUGIN_ARCHITECTURE_SPEC.md` §2 (nouvel invariant `INV-CSS`) + §9 (checklist) ; `scripts/verify-plugin-contract.cjs` (nouveau check `PC-13`)
**Contrat :** Plugin Contract v1 — changement **non cassant** (invariant ajouté) → spec **1.2.0 → 1.3.0**

---

## Contexte

La roadmap de remédiation sécurité a retiré `'unsafe-inline'` de la directive CSP `style-src` (B.5, 2026-06-21). La validation navigateur (Sprint 4) a alors révélé un défaut (**B.7**) : la CSS des plugins violait `style-src 'self'` par **deux mécanismes** :

1. **Bundler** — `rollup-plugin-postcss` en `inject: true` génère le helper `styleInject` qui crée un élément `<style>` (et écrit son `textContent`) au chargement du plugin (addpoi, storage, editor, measure, print, form-renderer).
2. **Codé main** — `document.createElement("style")` + `textContent` directement dans le code du plugin (connector, editor).

Un élément `<style>` et son `textContent` **sont soumis à `style-src`** → bloqués sous CSP stricte. Seules les écritures **CSSOM** y échappent : constructable stylesheets (`new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets`) ou écritures propriété-par-propriété (`element.style.setProperty` / `GeoLeaf.Helpers.applyCssText`).

B.7 a corrigé **tous** les sites via un injecteur CSSOM (helper de build `scripts/rollup/csp-style-inject.mjs` branché en `postcss({ inject: cspStyleInject })`, et helper runtime `adoptStylesheet()` pour les sites codés main), gardé par l'e2e `18-security` (gardien B.7 sur deploy-addpoi-storage). **INV-CSS rend la règle normative** pour empêcher toute régression future : un nouveau plugin réintroduisant un `<style>` re-violerait silencieusement la CSP stricte du déploiement, sans qu'aucun garde-fou ne l'attrape (l'e2e ne couvre qu'une variante).

## Énoncé normatif proposé (INV-CSS)

> Un plugin **DOIT** injecter sa CSS de manière compatible avec une CSP `style-src` stricte (`'self'`, sans `'unsafe-inline'`) : via le **CSSOM** — constructable stylesheets (`new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets`) ou écritures propriété-par-propriété (`element.style.setProperty` / `GeoLeaf.Helpers.applyCssText`). Il **NE DOIT JAMAIS** créer d'élément `<style>` (`document.createElement("style")`, ni le `styleInject` du bundler via `postcss({ inject: true })`) ni poser un attribut `style` inline.
>
> **Pilier : Sécurité.** Le scaffold `_plugin-template` et le helper de build `scripts/rollup/csp-style-inject.mjs` fournissent la forme conforme par défaut.

## Enforcement — PC-13

`scripts/verify-plugin-contract.cjs` (mode `--fail` en CI + pre-commit) gagne le check **PC-13 → INV-CSS** :

- **`rollup.config.mjs`** : `inject: true` dans `postcss(...)` → violation (utiliser `inject: cspStyleInject` ou `extract`).
- **`src/**/\*.{ts,js}`** (hors `**tests**`) : `document.createElement("style")` → violation (utiliser un injecteur CSSOM).

## Impact

Les **11 plugins sont déjà conformes** (post-B.7) ; PC-13 verrouille l'état (0 nouvelle violation). Les bibliothèques partagées (`form-renderer`) sont **hors périmètre d'audit** du contrat (§0) mais alignées en pratique (helper CSSOM local).

## Décision

**Acceptée** le 2026-06-21 (Mattieu Pottier). **Appliquée** dans le même changement : `INV-CSS` ajouté à la spec (§2 table des invariants, §9 checklist, note §0 bibliothèques partagées), version du document **1.2.0 → 1.3.0** (journal §10) ; **PC-13** ajouté au vérificateur de contrat.

---

## ⏱️ Note de relecture — 27/07/2026 (refonte documentaire V3)

**Le corps de cette RFC n'est pas réécrit** : une RFC appliquée est exacte à sa date, et son
« 11 plugins » comme sa mention de `form-renderer` étaient vrais le 21/06/2026.

**Mais un de ses pointeurs est vivant et a déménagé** — `INV-CSS` renvoie les auteurs de
plugins vers un helper de build, et le chemin cité ici ne résout plus :

| Cité dans cette RFC                   | Emplacement réel au 27/07/2026                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `scripts/rollup/csp-style-inject.mjs` | **`packages/build-config/csp-style-inject.mjs`** — importé par `packages/build-config/rollup.mjs`, que les plugins consomment |

Les autres artefacts sont vérifiés présents : `packages/_plugin-template/`,
`e2e/18-security.spec.js`, et **`PC-13` est bien câblé** dans
`scripts/verify-plugin-contract.cjs`. `node scripts/verify-plugin-contract.cjs` rend
**13/13 conformes**.

---

_MP-i — Mattieu Pottier Indépendant_
